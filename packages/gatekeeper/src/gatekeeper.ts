import CipherNode from '@mdip/cipher/node';
import { copyJSON, compareOrdinals } from '@mdip/common/utils';
import { isValidDID, generateCID } from '@mdip/ipfs/utils';
import {
    InvalidParameterError,
    InvalidOperationError
} from '@mdip/common/errors';
import { childLogger, createConsoleLogger, type LoggerLike } from '@mdip/common/logger';
import { IPFSClient } from '@mdip/ipfs/types';
import {
    BlockId,
    BlockInfo,
    CheckDIDsOptions,
    GatekeeperDb,
    GatekeeperInterface,
    GatekeeperEvent,
    GatekeeperOptions,
    ImportEventsResult,
    Operation,
    MdipDocument,
    ResolveDIDOptions,
    GetDIDOptions,
    CheckDIDsResult,
    ImportBatchResult,
    ProcessEventsResult,
    VerifyDbResult,
    Signature,
} from './types.js';

const ValidVersions = [1];
const ValidTypes = ['agent', 'asset'];
// Registries that are considered valid when importing DIDs from the network
const ValidRegistries = [
    'local',
    'hyperswarm',
    'TESS',
    'TBTC',
    'TFTC',
    'Signet',
    'Signet-Inscription',
    'BTC-Inscription'
];

enum ImportStatus {
    ADDED = 'added',
    MERGED = 'merged',
    REJECTED = 'rejected',
    DEFERRED = 'deferred',
}

export default class Gatekeeper implements GatekeeperInterface {
    private db: GatekeeperDb;
    private eventsQueue: GatekeeperEvent[];
    private readonly eventsSeen: Record<string, boolean>;
    private verifiedDIDs: Record<string, boolean>;
    private isProcessingEvents: boolean;
    private ipfs: IPFSClient;
    private cipher: CipherNode;
    readonly didPrefix: string;
    private log: LoggerLike;
    private readonly maxOpBytes: number;
    private readonly maxQueueSize: number;
    supportedRegistries: string[];
    private didLocks = new Map<string, Promise<void>>();

    constructor(options: GatekeeperOptions) {
        if (!options || !options.db) {
            throw new InvalidParameterError('missing options.db');
        }
        this.db = options.db;

        this.log = options.console
            ? createConsoleLogger(options.console)
            : childLogger({ service: 'gatekeeper' });

        this.eventsQueue = [];
        this.eventsSeen = {};
        this.verifiedDIDs = {};
        this.isProcessingEvents = false;
        this.ipfs = options.ipfs;
        this.cipher = new CipherNode();
        this.didPrefix = options.didPrefix || 'did:test';
        this.maxOpBytes = options.maxOpBytes || 64 * 1024; // 64KB
        this.maxQueueSize = options.maxQueueSize || 100;

        // Only DIDs registered on supported registries will be created by this node
        this.supportedRegistries = options.registries || ['local', 'hyperswarm'];

        for (const registry of this.supportedRegistries) {
            if (!ValidRegistries.includes(registry)) {
                throw new InvalidParameterError(`registry=${registry}`);
            }
        }
    }

    private async withDidLock<T>(did: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.didLocks.get(did) ?? Promise.resolve();
        let release: () => void = () => { };
        const gate = new Promise<void>(r => (release = r));

        this.didLocks.set(did, prev.then(() => gate, () => gate));

        try {
            await prev;
            return await fn();
        } finally {
            release();
            if (this.didLocks.get(did) === gate) {
                this.didLocks.delete(did);
            }
        }
    }

    async verifyDb(options?: { chatty?: boolean }): Promise<VerifyDbResult> {
        const chatty = options?.chatty ?? true;
        const dids = await this.getDIDs() as string[];
        const total = dids.length;
        let n = 0;
        let expired = 0;
        let invalid = 0;
        let verified = Object.keys(this.verifiedDIDs).length;

        const verifyStart = chatty ? Date.now() : 0;

        for (const did of dids) {
            n += 1;

            if (this.verifiedDIDs[did]) {
                continue;
            }

            let validUntil = null;

            try {
                const doc = await this.resolveDID(did, { verify: true });
                validUntil = doc.mdip?.validUntil;
            }
            catch (error) {
                if (chatty) {
                    this.log.warn(`removing ${n}/${total} ${did} invalid`);
                }
                invalid += 1;
                await this.db.deleteEvents(did);
                continue;
            }

            if (validUntil) {
                const expires = new Date(validUntil);
                const now = new Date();

                if (expires < now) {
                    if (chatty) {
                        this.log.warn(`removing ${n}/${total} ${did} expired`);
                    }
                    await this.db.deleteEvents(did);
                    expired += 1;
                }
                else {
                    const minutesLeft = Math.round((expires.getTime() - now.getTime()) / 60 / 1000);

                    if (chatty) {
                        this.log.debug(`expiring ${n}/${total} ${did} in ${minutesLeft} minutes`);
                    }
                    verified += 1;
                }
            }
            else {
                if (chatty) {
                    this.log.debug(`verifying ${n}/${total} ${did} OK`);
                }
                this.verifiedDIDs[did] = true;
                verified += 1;
            }
        }

        // Clear queue of permanently invalid events
        this.eventsQueue = [];

        if (chatty) {
            const durationMs = Date.now() - verifyStart;
            this.log.debug({ durationMs }, 'verifyDb');
        }

        return { total, verified, expired, invalid };
    }

    async checkDIDs(options?: CheckDIDsOptions): Promise<CheckDIDsResult> {
        const chatty = options?.chatty ?? false;
        let dids = options?.dids;

        if (!dids) {
            dids = await this.getDIDs() as string[];
        }

        const total = dids.length;
        let n = 0;
        let agents = 0;
        let assets = 0;
        let confirmed = 0;
        let unconfirmed = 0;
        let ephemeral = 0;
        let invalid = 0;
        const byRegistry: Record<string, number> = {}
        const byVersion: Record<number, number> = {}

        for (const did of dids) {
            n += 1;
            try {
                const doc = await this.resolveDID(did);

                if (doc.didResolutionMetadata?.error) {
                    invalid += 1;
                    if (chatty) {
                        this.log.warn(`can't resolve ${n}/${total} ${did} ${doc.didResolutionMetadata.error}`);
                    }
                    continue;
                }

                if (chatty) {
                    this.log.debug(`resolved ${n}/${total} ${did} OK`);
                }

                if (doc.mdip?.type === 'agent') {
                    agents += 1;
                }

                if (doc.mdip?.type === 'asset') {
                    assets += 1;
                }

                if (doc.didDocumentMetadata?.confirmed) {
                    confirmed += 1;
                }
                else {
                    unconfirmed += 1;
                }

                if (doc.mdip?.validUntil) {
                    ephemeral += 1;
                }

                const registry = doc.mdip?.registry;
                if (registry) {
                    byRegistry[registry] = (byRegistry[registry] || 0) + 1;
                }

                const version = doc.didDocumentMetadata?.version;
                if (version != null) {
                    const versionNum = parseInt(version, 10);
                    if (!isNaN(versionNum)) {
                        byVersion[versionNum] = (byVersion[versionNum] || 0) + 1;
                    }
                }
            }
            catch (error) {
            }
        }

        const byType = { agents, assets, confirmed, unconfirmed, ephemeral, invalid };
        const eventsQueue = this.eventsQueue;
        return { total, byType, byRegistry, byVersion, eventsQueue };
    }

    async listRegistries(): Promise<string[]> {
        return this.supportedRegistries;
    }

    // For testing purposes
    async resetDb(): Promise<boolean> {
        await this.db.resetDb();
        this.verifiedDIDs = {};
        return true;
    }

    async generateCID(operation: unknown, save: boolean = false): Promise<string> {
        const canonical = this.cipher.canonicalizeJSON(operation);

        if (save) {
            return this.ipfs.addJSON(JSON.parse(canonical));
        }

        return generateCID(JSON.parse(canonical));
    }

    async generateDID(operation: Operation): Promise<string> {
        const cid = await this.generateCID(operation);
        const prefix = operation.mdip?.prefix || this.didPrefix;
        return `${prefix}:${cid}`;
    }

    async verifyOperation(operation: Operation): Promise<boolean> {
        if (operation.type === 'create') {
            return this.verifyCreateOperation(operation);
        }

        if (operation.type === 'update' || operation.type === 'delete') {
            const doc = await this.resolveDID(operation.did);
            return this.verifyUpdateOperation(operation, doc);
        }

        return false;
    }

    verifyDIDFormat(did: string): boolean {
        return did.startsWith('did:');
    }

    verifyDateFormat(time?: string): boolean {
        if (!time) {
            return false;
        }
        const date = new Date(time);
        return !isNaN(date.getTime());
    }

    verifyHashFormat(hash: string): boolean {
        // Check if hash is a hexadecimal string of length 64
        const hex64Regex = /^[a-f0-9]{64}$/i;
        return hex64Regex.test(hash);
    }

    verifySignatureFormat(signature?: Signature): boolean {
        if (!signature) {
            return false;
        }

        if (!this.verifyDateFormat(signature.signed)) {
            return false;
        }

        if (!this.verifyHashFormat(signature.hash)) {
            return false;
        }

        // eslint-disable-next-line
        if (signature.signer && !this.verifyDIDFormat(signature.signer)) {
            return false;
        }

        return true;
    }

    async verifyCreateOperation(operation: Operation): Promise<boolean> {
        if (!operation) {
            throw new InvalidOperationError('missing');
        }

        if (JSON.stringify(operation).length > this.maxOpBytes) {
            throw new InvalidOperationError('size');
        }

        if (operation.type !== "create") {
            throw new InvalidOperationError(`type=${operation.type}`);
        }

        if (!this.verifyDateFormat(operation.created)) {
            // TBD ensure valid timestamp format
            throw new InvalidOperationError(`created=${operation.created}`);
        }

        if (!operation.mdip) {
            throw new InvalidOperationError('mdip');
        }

        if (!ValidVersions.includes(operation.mdip.version)) {
            throw new InvalidOperationError(`mdip.version=${operation.mdip.version}`);
        }

        if (!ValidTypes.includes(operation.mdip.type)) {
            throw new InvalidOperationError(`mdip.type=${operation.mdip.type}`);
        }

        if (!ValidRegistries.includes(operation.mdip.registry)) {
            throw new InvalidOperationError(`mdip.registry=${operation.mdip.registry}`);
        }

        if (!this.verifySignatureFormat(operation.signature)) {
            throw new InvalidOperationError('signature');
        }

        if (operation.mdip.validUntil && !this.verifyDateFormat(operation.mdip.validUntil)) {
            throw new InvalidOperationError(`mdip.validUntil=${operation.mdip.validUntil}`);
        }

        if (operation.mdip.type === 'agent') {
            if (!operation.publicJwk) {
                throw new InvalidOperationError('publicJwk');
            }

            const operationCopy = copyJSON(operation);
            delete operationCopy.signature;

            const msgHash = this.cipher.hashJSON(operationCopy);
            return this.cipher.verifySig(msgHash, operation.signature!.value, operation.publicJwk);
        }

        if (operation.mdip.type === 'asset') {
            if (operation.controller !== operation.signature?.signer) {
                throw new InvalidOperationError('signer is not controller');
            }

            const doc = await this.resolveDID(operation.signature!.signer, { confirm: true, versionTime: operation.signature!.signed });

            if (doc.mdip && doc.mdip.registry === 'local' && operation.mdip.registry !== 'local') {
                throw new InvalidOperationError(`non-local registry=${operation.mdip.registry}`);
            }

            const operationCopy = copyJSON(operation);
            delete operationCopy.signature;
            const msgHash = this.cipher.hashJSON(operationCopy);
            if (!doc.didDocument ||
                !doc.didDocument.verificationMethod ||
                doc.didDocument.verificationMethod.length === 0 ||
                !doc.didDocument.verificationMethod[0].publicKeyJwk) {
                throw new InvalidOperationError('didDocument missing verificationMethod');
            }
            // TBD select the right key here, not just the first one
            const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
            return this.cipher.verifySig(msgHash, operation.signature!.value, publicJwk);
        }

        throw new InvalidOperationError(`mdip.type=${operation.mdip.type}`);
    }

    async verifyUpdateOperation(operation: Operation, doc: MdipDocument): Promise<boolean> {
        if (JSON.stringify(operation).length > this.maxOpBytes) {
            throw new InvalidOperationError('size');
        }

        if (!this.verifySignatureFormat(operation.signature)) {
            throw new InvalidOperationError('signature');
        }

        if (!doc?.didDocument) {
            throw new InvalidOperationError('doc.didDocument');
        }

        if (doc.didDocumentMetadata?.deactivated) {
            throw new InvalidOperationError('DID deactivated');
        }

        if (doc.didDocument.controller) {
            // This DID is an asset, verify with controller's keys
            const controllerDoc = await this.resolveDID(doc.didDocument.controller, { confirm: true, versionTime: operation.signature!.signed });
            return this.verifyUpdateOperation(operation, controllerDoc);
        }

        if (!doc.didDocument.verificationMethod) {
            throw new InvalidOperationError('doc.didDocument.verificationMethod');
        }

        const signature = operation.signature!;
        const jsonCopy = copyJSON(operation);
        delete jsonCopy.signature;
        const msgHash = this.cipher.hashJSON(jsonCopy);

        if (signature.hash && signature.hash !== msgHash) {
            return false;
        }

        if (doc.didDocument.verificationMethod.length === 0 ||
            !doc.didDocument.verificationMethod[0].publicKeyJwk) {
            throw new InvalidOperationError('didDocument missing verificationMethod');
        }

        // TBD get the right signature, not just the first one
        const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
        return this.cipher.verifySig(msgHash, signature.value, publicJwk);
    }

    async queueOperation(registry: string, operation: Operation) {
        // Don't distribute local DIDs
        if (registry === 'local') {
            return;
        }

        // Always distribute on hyperswarm
        await this.db.queueOperation('hyperswarm', operation);

        // Distribute on specified registry
        if (registry !== 'hyperswarm') {
            const queueSize = await this.db.queueOperation(registry, operation);

            if (queueSize >= this.maxQueueSize) {
                this.supportedRegistries = this.supportedRegistries.filter(reg => reg !== registry);
            }
        }
    }

    async createDID(operation: Operation): Promise<string> {
        const valid = await this.verifyCreateOperation(operation);
        if (!valid) {
            throw new InvalidOperationError('signature')
        }

        const registry = operation.mdip!.registry;

        // Reject operations with unsupported registries
        if (!registry || !this.supportedRegistries.includes(registry)) {
            throw new InvalidOperationError(`registry ${registry} not supported`);
        }

        const did = await this.generateDID(operation);

        return this.withDidLock(did, async () => {
            const ops = await this.exportDID(did);

            // Check to see if we already have this DID in the db
            if (ops.length > 0) {
                return did;
            }

            await this.db.addEvent(did, {
                registry: 'local',
                time: operation.created!,
                ordinal: [0],
                operation,
                did
            });

            await this.queueOperation(registry, operation);
            return did;
        });
    }

    async generateDoc(anchor: Operation, defaultDID?: string): Promise<MdipDocument> {
        let doc: MdipDocument = {};
        try {
            if (!anchor?.mdip) {
                return {};
            }

            if (!ValidVersions.includes(anchor.mdip.version)) {
                return {};
            }

            if (!ValidTypes.includes(anchor.mdip.type)) {
                return {};
            }

            if (!ValidRegistries.includes(anchor.mdip.registry)) {
                return {};
            }

            const did = defaultDID ?? await this.generateDID(anchor);

            if (anchor.mdip.type === 'agent') {
                // TBD support different key types?
                doc = {
                    "didDocument": {
                        "@context": ["https://www.w3.org/ns/did/v1"],
                        "id": did,
                        "verificationMethod": [
                            {
                                "id": "#key-1",
                                "controller": did,
                                "type": "EcdsaSecp256k1VerificationKey2019",
                                "publicKeyJwk": anchor.publicJwk,
                            }
                        ],
                        "authentication": [
                            "#key-1"
                        ],
                    },
                    "didDocumentMetadata": {
                        "created": anchor.created,
                    },
                    "didDocumentData": {},
                    "mdip": anchor.mdip,
                };
            }

            if (anchor.mdip.type === 'asset') {
                doc = {
                    "didDocument": {
                        "@context": ["https://www.w3.org/ns/did/v1"],
                        "id": did,
                        "controller": anchor.controller,
                    },
                    "didDocumentMetadata": {
                        "created": anchor.created,
                    },
                    "didDocumentData": anchor.data,
                    "mdip": anchor.mdip,
                };
            }

            if (doc.didDocumentMetadata && anchor.mdip.prefix) {
                doc.didDocumentMetadata.canonicalId = did;
            }
        }
        catch (error) {
        }

        return doc;
    }

    async resolveDID(
        did?: string,
        options?: ResolveDIDOptions
    ): Promise<MdipDocument> {
        const { versionTime, versionSequence, confirm = false, verify = false } = options || {};

        if (!did || !isValidDID(did)) {
            return {
                didResolutionMetadata: {
                    error: "invalidDid"
                },
                didDocument: {},
                didDocumentMetadata: {}
            };
        }

        const events = await this.db.getEvents(did);

        if (events.length === 0) {
            return {
                didResolutionMetadata: {
                    error: "notFound"
                },
                didDocument: {},
                didDocumentMetadata: {}
            };
        }

        const anchor = events[0];
        let doc = await this.generateDoc(anchor.operation, did);

        if (versionTime && doc.mdip?.created && new Date(doc.mdip.created) > new Date(versionTime)) {
            // TBD What to return if DID was created after specified time?
        }

        function generateStandardDatetime(time: any): string {
            const date = new Date(time);
            // Remove milliseconds for standardization
            return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
        }

        const created = generateStandardDatetime(doc.didDocumentMetadata?.created);
        const canonicalId = doc.didDocumentMetadata?.canonicalId;
        let versionNum = 1; // initial version is version 1 by definition
        let confirmed = true; // create event is always confirmed by definition

        for (const { time, operation, registry, blockchain } of events) {
            const versionId = await this.generateCID(operation);
            const updated = generateStandardDatetime(time);
            let timestamp;

            if (doc.mdip?.registry) {
                let lowerBound;
                let upperBound;

                if (operation.blockid) {
                    const lowerBlock = await this.db.getBlock(doc.mdip.registry, operation.blockid);

                    if (lowerBlock) {
                        lowerBound = {
                            time: lowerBlock.time,
                            timeISO: new Date(lowerBlock.time * 1000).toISOString(),
                            blockid: lowerBlock.hash,
                            height: lowerBlock.height,
                        };
                    }
                }

                if (blockchain) {
                    const upperBlock = await this.db.getBlock(doc.mdip.registry, blockchain.height);

                    if (upperBlock) {
                        upperBound = {
                            time: upperBlock.time,
                            timeISO: new Date(upperBlock.time * 1000).toISOString(),
                            blockid: upperBlock.hash,
                            height: upperBlock.height,
                            txid: blockchain.txid,
                            txidx: blockchain.index,
                            batchid: blockchain.batch,
                            opidx: blockchain.opidx,
                        };
                    }
                }

                if (lowerBound || upperBound) {
                    timestamp = {
                        chain: doc.mdip.registry,
                        opid: versionId,
                        lowerBound,
                        upperBound,
                    };
                }
            }

            if (operation.type === 'create') {
                if (verify) {
                    const valid = await this.verifyCreateOperation(operation);

                    if (!valid) {
                        throw new InvalidOperationError('signature');
                    }
                }

                doc.didDocumentMetadata = {
                    created,
                    canonicalId,
                    versionId,
                    version: versionNum.toString(),
                    confirmed,
                    timestamp,
                }
                continue;
            }

            if (versionTime && new Date(time) > new Date(versionTime)) {
                break;
            }

            if (versionSequence && versionNum === versionSequence) {
                break;
            }

            confirmed = confirmed && doc.mdip?.registry === registry;

            if (confirm && !confirmed) {
                break;
            }

            if (verify) {
                const valid = await this.verifyUpdateOperation(operation, doc);

                if (!valid) {
                    throw new InvalidOperationError('signature');
                }

                // TEMP during did:test, operation.previd is optional
                if (operation.previd && operation.previd !== doc.didDocumentMetadata?.versionId) {
                    throw new InvalidOperationError('previd');
                }
            }

            if (operation.type === 'update') {
                versionNum += 1;

                doc = operation.doc || {};
                doc.didDocumentMetadata = {
                    created,
                    updated,
                    canonicalId,
                    versionId,
                    version: versionNum.toString(),
                    confirmed,
                    timestamp,
                }
                continue;
            }

            if (operation.type === 'delete') {
                versionNum += 1;

                doc.didDocument = { id: did };
                doc.didDocumentData = {};
                doc.didDocumentMetadata = {
                    deactivated: true,
                    created,
                    deleted: updated,
                    canonicalId,
                    versionId,
                    version: versionNum.toString(),
                    confirmed,
                    timestamp,
                }
            }
        }

        doc.didResolutionMetadata = {
            // We'll deliberately use millisecond precision here to avoid intermittent unit test failures
            retrieved: new Date().toISOString(),
        };

        // Remove deprecated fields
        delete (doc as any)['@context'];

        if (doc.mdip) {
            delete doc.mdip.opid // Replaced by didDocumentMetadata.versionId
            delete doc.mdip.registration // Replaced by didDocumentMetadata.timestamp
        }

        return copyJSON(doc);
    }

    async updateDID(operation: Operation): Promise<boolean> {
        if (!operation.did) {
            throw new InvalidOperationError('missing operation.did')
        }

        const doc = await this.resolveDID(operation.did);
        const updateValid = await this.verifyUpdateOperation(operation, doc);

        if (!updateValid) {
            return false;
        }

        const registry = doc.mdip?.registry;

        // Reject operations with unsupported registries
        if (!registry || !this.supportedRegistries.includes(registry)) {
            throw new InvalidOperationError(`registry ${registry} not supported`);
        }

        return this.withDidLock(operation.did, async () => {
            await this.db.addEvent(operation.did!, {
                registry: 'local',
                time: operation.signature?.signed || '',
                ordinal: [0],
                operation,
                did: operation.did
            });

            await this.queueOperation(registry, operation);

            return true;
        });
    }

    async deleteDID(operation: Operation): Promise<boolean> {
        return this.updateDID(operation)
    }

    async getDIDs(options?: GetDIDOptions): Promise<string[] | MdipDocument[]> {
        let { dids, updatedAfter, updatedBefore, confirm, verify, resolve } = options || {};
        if (!dids) {
            const keys = await this.db.getAllKeys();
            dids = keys.map(key => `${this.didPrefix}:${key}`);
        }

        if (updatedAfter || updatedBefore || resolve) {
            const start = updatedAfter ? new Date(updatedAfter) : null;
            const end = updatedBefore ? new Date(updatedBefore) : null;
            const docList: MdipDocument[] = [];
            const didList: string[] = [];

            for (const did of dids) {
                try {
                    const doc = await this.resolveDID(did, { confirm, verify });
                    const updatedStr = doc.didDocumentMetadata?.updated ?? doc.didDocumentMetadata?.created ?? 0;
                    const updated = new Date(updatedStr);

                    if (start && updated <= start) {
                        continue;
                    }

                    if (end && updated >= end) {
                        continue;
                    }

                    if (resolve) {
                        docList.push(doc);
                    } else {
                        didList.push(did);
                    }
                } catch {
                    continue;
                }
            }

            if (resolve) {
                return docList;
            }

            return didList;
        }

        return dids;
    }

    async exportDID(did: string): Promise<GatekeeperEvent[]> {
        return this.db.getEvents(did);
    }

    async exportDIDs(dids?: string[]): Promise<GatekeeperEvent[][]> {
        if (!dids) {
            dids = await this.getDIDs() as string[];
        }

        const batch = [];

        for (const did of dids) {
            batch.push(await this.exportDID(did));
        }

        return batch;
    }

    async importDIDs(dids: GatekeeperEvent[][]): Promise<ImportBatchResult> {
        return this.importBatch(dids.flat());
    }

    async removeDIDs(dids: string[]): Promise<boolean> {
        if (!Array.isArray(dids)) {
            throw new InvalidParameterError('dids');
        }

        for (const did of dids) {
            await this.db.deleteEvents(did);
        }

        return true;
    }

    async importEvent(event: GatekeeperEvent): Promise<ImportStatus> {
        try {
            if (!event.did) {
                if (event.operation.did) {
                    event.did = event.operation.did;
                }
                else {
                    event.did = await this.generateDID(event.operation);
                }
            }

            const did = event.did;

            return await this.withDidLock(did, async () => {
                const currentEvents = await this.db.getEvents(did);

                for (const e of currentEvents) {
                    if (!e.opid) {
                        e.opid = await this.generateCID(e.operation, true);
                    }
                }

                if (!event.opid) {
                    event.opid = await this.generateCID(event.operation, true);
                }

                const opMatch = currentEvents.find(item => item.operation.signature?.value === event.operation.signature?.value);

                if (opMatch) {
                    const first = currentEvents[0];
                    const nativeRegistry = first.operation.mdip?.registry;

                    if (opMatch.registry === nativeRegistry) {
                        // If this event is already confirmed on the native registry, no need to update
                        return ImportStatus.MERGED;
                    }

                    if (event.registry === nativeRegistry) {
                        // If this import is on the native registry, replace the current one
                        const index = currentEvents.indexOf(opMatch);
                        currentEvents[index] = event;
                        await this.db.setEvents(did, currentEvents);
                        return ImportStatus.ADDED;
                    }

                    return ImportStatus.MERGED;
                } else {
                    const ok = await this.verifyOperation(event.operation);

                    if (!ok) {
                        return ImportStatus.REJECTED;
                    }

                    if (currentEvents.length === 0) {
                        await this.db.addEvent(did, event);
                        return ImportStatus.ADDED;
                    }

                    // TEMP during did:test, operation.previd is optional
                    if (!event.operation.previd) {
                        await this.db.addEvent(did, event);
                        return ImportStatus.ADDED;
                    }

                    const idMatch = currentEvents.find(item => item.opid === event.operation.previd);

                    if (!idMatch) {
                        return ImportStatus.DEFERRED;
                    }

                    const index = currentEvents.indexOf(idMatch);

                    if (index === currentEvents.length - 1) {
                        await this.db.addEvent(did, event);
                        return ImportStatus.ADDED;
                    }

                    const first = currentEvents[0];
                    const nativeRegistry = first.operation.mdip?.registry;

                    if (event.registry === nativeRegistry) {
                        const nextEvent = currentEvents[index + 1];

                        if (nextEvent.registry !== event.registry ||
                            (event.ordinal && nextEvent.ordinal && compareOrdinals(event.ordinal, nextEvent.ordinal) < 0)) {
                            // reorg event, discard the rest of the operation sequence and replace with this event
                            const newSequence = [...currentEvents.slice(0, index + 1), event];
                            await this.db.setEvents(did, newSequence);
                            return ImportStatus.ADDED;
                        }
                    }
                }

                return ImportStatus.REJECTED;
            });
        } catch (error: any) {
            if (error.type === 'Invalid operation') {
                // Could be an event with a controller DID that hasn't been imported yet
                return ImportStatus.DEFERRED;
            }
        }

        return ImportStatus.REJECTED;
    }

    async importEvents(): Promise<ImportEventsResult> {
        let tempQueue = this.eventsQueue;
        const total = tempQueue.length;
        let event = tempQueue.shift();
        let i = 0;
        let added = 0;
        let merged = 0;
        let rejected = 0;

        this.eventsQueue = [];

        while (event) {
            i += 1;

            const status = await this.importEvent(event);

            if (status === ImportStatus.ADDED) {
                added += 1;
                this.log.debug(`import ${i}/${total}: added event for ${event.did}`);
            }
            else if (status === ImportStatus.MERGED) {
                merged += 1;
                this.log.debug(`import ${i}/${total}: merged event for ${event.did}`);
            }
            else if (status === ImportStatus.REJECTED) {
                rejected += 1;
                this.log.debug(`import ${i}/${total}: rejected event for ${event.did}`);
            }
            else if (status === ImportStatus.DEFERRED) {
                this.eventsQueue.push(event);
                this.log.debug(`import ${i}/${total}: deferred event for ${event.did}`);
            }

            event = tempQueue.shift();
        }

        return { added, merged, rejected };
    }

    async processEvents(): Promise<ProcessEventsResult> {
        if (this.isProcessingEvents) {
            return { busy: true };
        }

        let added = 0;
        let merged = 0;
        let rejected = 0;
        let done = false;

        try {
            this.isProcessingEvents = true;

            while (!done) {
                const response = await this.importEvents();

                added += response.added;
                merged += response.merged;
                rejected += response.rejected;

                done = (response.added === 0 && response.merged === 0);
            }
        }
        catch (error) {
            this.log.error({ error }, 'processEvents error');
            this.eventsQueue = [];
        }
        finally {
            this.isProcessingEvents = false;
        }

        const pending = this.eventsQueue.length;
        const response = { added, merged, rejected, pending };

        this.log.debug(`processEvents: ${JSON.stringify(response)}`);

        return response;
    }

    async verifyEvent(event: GatekeeperEvent): Promise<boolean> {
        if (!event.registry || !event.time || !event.operation) {
            return false;
        }

        const eventTime = new Date(event.time).getTime();

        if (isNaN(eventTime)) {
            return false;
        }

        const operation = event.operation;

        if (JSON.stringify(operation).length > this.maxOpBytes) {
            return false;
        }

        if (!this.verifySignatureFormat(operation.signature)) {
            return false;
        }

        if (operation.type === 'create') {
            if (!operation.created) {
                return false;
            }

            if (!operation.mdip) {
                return false;
            }

            if (!ValidVersions.includes(operation.mdip.version)) {
                return false;
            }

            if (!ValidTypes.includes(operation.mdip.type)) {
                return false;
            }

            if (!ValidRegistries.includes(operation.mdip.registry)) {
                return false;
            }

            // eslint-disable-next-line
            if (operation.mdip.type === 'agent') {
                if (!operation.publicJwk) {
                    return false;
                }
            }

            // eslint-disable-next-line
            if (operation.mdip.type === 'asset') {
                if (operation.controller !== operation.signature?.signer) {
                    return false;
                }
            }
        }
        else if (operation.type === 'update') {
            const doc = operation.doc;

            if (!doc || !doc.didDocument || !doc.didDocumentMetadata || !doc.didDocumentData || !doc.mdip) {
                return false;
            }

            if (!operation.did) {
                return false;
            }
        }
        else if (operation.type === 'delete') {
            if (!operation.did) {
                return false;
            }
        }
        else {
            return false;
        }

        return true;
    }

    async importBatch(batch: GatekeeperEvent[]): Promise<ImportBatchResult> {
        if (!batch || !Array.isArray(batch) || batch.length < 1) {
            throw new InvalidParameterError('batch');
        }

        let queued = 0;
        let rejected = 0;
        let processed = 0;

        for (let i = 0; i < batch.length; i++) {
            const event = batch[i];
            const ok = await this.verifyEvent(event);

            if (ok) {
                const eventKey = `${event.registry}/${event.operation.signature?.hash}`;
                if (!this.eventsSeen[eventKey]) {
                    this.eventsSeen[eventKey] = true;
                    this.eventsQueue.push(event);
                    queued += 1;
                }
                else {
                    processed += 1;
                }
            }
            else {
                rejected += 1;
            }
        }

        return {
            queued,
            processed,
            rejected,
            total: this.eventsQueue.length
        };
    }

    async exportBatch(dids?: string[]): Promise<GatekeeperEvent[]> {
        const allDIDs = await this.exportDIDs(dids);
        const nonlocalDIDs = allDIDs.filter(events => {
            if (events.length > 0) {
                const create = events[0];
                const registry = create.operation?.mdip?.registry;
                return registry && registry !== 'local'
            }
            return false;
        });

        const events = nonlocalDIDs.flat();
        return events.sort((a, b) => new Date(a.operation.signature?.signed ?? 0).getTime() - new Date(b.operation.signature?.signed ?? 0).getTime());
    }

    async getQueue(registry: string): Promise<Operation[]> {
        if (!ValidRegistries.includes(registry)) {
            throw new InvalidParameterError(`registry=${registry}`);
        }

        if (!this.supportedRegistries.includes(registry)) {
            this.supportedRegistries.push(registry);
        }

        return this.db.getQueue(registry);
    }

    async clearQueue(registry: string, events: Operation[]): Promise<boolean> {
        if (!ValidRegistries.includes(registry)) {
            throw new InvalidParameterError(`registry=${registry}`);
        }

        return this.db.clearQueue(registry, events);
    }

    async getBlock(registry: string, block?: BlockId): Promise<BlockInfo | null> {
        if (!ValidRegistries.includes(registry)) {
            throw new InvalidParameterError(`registry=${registry}`);
        }

        return this.db.getBlock(registry, block);
    }

    async addBlock(registry: string, block: BlockInfo): Promise<boolean> {
        if (!ValidRegistries.includes(registry)) {
            throw new InvalidParameterError(`registry=${registry}`);
        }

        return this.db.addBlock(registry, block)
    }

    async addText(text: string): Promise<string> {
        return this.ipfs.addText(text);
    }

    async getText(cid: string): Promise<string | null> {
        return this.ipfs.getText(cid);
    }

    async addData(data: Buffer): Promise<string> {
        return this.ipfs.addData(data);
    }

    async getData(cid: string): Promise<Buffer | null> {
        return this.ipfs.getData(cid);
    }

    async addJSON(json: object): Promise<string> {
        return this.ipfs.addJSON(json);
    }

    async getJSON(cid: string): Promise<object | null> {
        return this.ipfs.getJSON(cid);
    }
}
