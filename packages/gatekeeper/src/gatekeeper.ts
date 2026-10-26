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
import {
    generateDIDFromOperation,
    generateDocFromOperation,
    isValidDIDPrefix,
    resolveDIDFromEvents,
    ValidRegistries,
    ValidTypes,
    ValidVersions,
} from './did-resolver.js';

export {
    generateDIDFromOperation,
    generateDocFromOperation,
    generateOperationCID,
    resolveDIDFromEvents,
} from './did-resolver.js';

enum ImportStatus {
    ADDED = 'added',
    MERGED = 'merged',
    REJECTED = 'rejected',
    DEFERRED = 'deferred',
}

const MAX_PENDING_EVENT_COUNT = 10_000;
const MAX_PENDING_EVENT_BYTES = 64 * 1024 * 1024;
const MAX_EVENT_PAGE_COUNT = 300;
const MAX_EVENT_PAGE_BYTES = 512 * 1024;
// A full operation page needs bounded headroom for canonical DID/opid envelope fields.
const MAX_TRANSIENT_EVENT_BYTES = 1280 * 1024;
// Longer controller chains stay valid but use one conservative mutation watch.
const MAX_PENDING_DEPENDENCIES = 32;
const MAX_HISTORY_CID_CACHE_ENTRIES = 10_000;
const MAX_HISTORY_CID_CACHE_BYTES = 64 * 1024 * 1024;

interface QueuedGatekeeperEvent {
    event: GatekeeperEvent;
    key: string;
    bytes: number;
}

type EventQueueState = 'staged' | 'processing' | 'pending';

interface EventQueueRecord {
    entry: QueuedGatekeeperEvent;
    state: EventQueueState;
}

interface PendingEventRetry {
    dependencies: string[];
    ready: boolean;
}

const retryableResolutionErrors = new WeakSet<object>();
const resolutionDependencies = new WeakMap<object, string[]>();

export default class Gatekeeper implements GatekeeperInterface {
    private db: GatekeeperDb;
    private stagedEvents: QueuedGatekeeperEvent[];
    private pendingEvents: QueuedGatekeeperEvent[];
    private readonly eventStates: Map<string, EventQueueRecord>;
    private transientEventCount: number;
    private transientEventBytes: number;
    private pendingEventCount: number;
    private pendingEventBytes: number;
    private pendingPassRemaining: number;
    private pendingPassProgress: boolean;
    private preferStagedEvents: boolean;
    private verifiedDIDs: Record<string, boolean>;
    private mutationRevision: number;
    private isProcessingEvents: boolean;
    private ipfs?: IPFSClient;
    private cipher: CipherNode;
    readonly didPrefix: string;
    private log: LoggerLike;
    private readonly maxOpBytes: number;
    private readonly maxQueueSize: number;
    private readonly ipfsEnabled: boolean;
    private maxPendingEventCount = MAX_PENDING_EVENT_COUNT;
    private maxPendingEventBytes = MAX_PENDING_EVENT_BYTES;
    private maxEventPageCount = MAX_EVENT_PAGE_COUNT;
    private maxEventPageBytes = MAX_EVENT_PAGE_BYTES;
    private maxTransientEventBytes = MAX_TRANSIENT_EVENT_BYTES;
    supportedRegistries: string[];
    private didLocks = new Map<string, Promise<void>>();
    private controllerGraphLock: Promise<void> = Promise.resolve();
    private activeMutations = new Set<string>();
    private pendingExpiredControllers = new Map<string, string>();
    private verifyDbInFlight?: Promise<VerifyDbResult>;
    private eventQueueBarrier: Promise<void> = Promise.resolve();
    private eventQueueWork = new Set<Promise<unknown>>();
    private pendingRetryStates = new Map<string, PendingEventRetry>();
    private pendingDependents = new Map<string, Set<string>>();
    private deferredDependencies = new WeakMap<GatekeeperEvent, string[]>();
    private historicalOperationCids = new Map<string, string>();
    private historicalOperationCidBytes = 0;
    private maxHistoryCidCacheEntries = MAX_HISTORY_CID_CACHE_ENTRIES;
    private maxHistoryCidCacheBytes = MAX_HISTORY_CID_CACHE_BYTES;
    constructor(options: GatekeeperOptions) {
        if (!options || !options.db) {
            throw new InvalidParameterError('missing options.db');
        }
        this.db = options.db;

        this.log = options.console
            ? createConsoleLogger(options.console)
            : childLogger({ service: 'gatekeeper' });

        this.stagedEvents = [];
        this.pendingEvents = [];
        this.eventStates = new Map();
        this.transientEventCount = 0;
        this.transientEventBytes = 0;
        this.pendingEventCount = 0;
        this.pendingEventBytes = 0;
        this.pendingPassRemaining = 0;
        this.pendingPassProgress = false;
        this.preferStagedEvents = true;
        this.verifiedDIDs = {};
        this.mutationRevision = 0;
        this.isProcessingEvents = false;
        this.ipfsEnabled = options.ipfsEnabled ?? true;
        if (this.ipfsEnabled) {
            if (!options.ipfs) {
                throw new InvalidParameterError('missing options.ipfs');
            }
            this.ipfs = options.ipfs;
        }
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

    private clearEventQueues(): void {
        this.stagedEvents = [];
        this.pendingEvents = [];
        this.eventStates.clear();
        this.transientEventCount = 0;
        this.transientEventBytes = 0;
        this.pendingEventCount = 0;
        this.pendingEventBytes = 0;
        this.pendingPassRemaining = 0;
        this.pendingPassProgress = false;
        this.preferStagedEvents = true;
        this.pendingRetryStates.clear();
        this.pendingDependents.clear();
    }

    private clearPendingRetry(key: string): void {
        const retry = this.pendingRetryStates.get(key);
        if (retry) {
            for (const dependency of retry.dependencies) {
                const dependents = this.pendingDependents.get(dependency)!;
                dependents.delete(key);
                if (dependents.size === 0) {
                    this.pendingDependents.delete(dependency);
                }
            }
            this.pendingRetryStates.delete(key);
        }
    }

    private setPendingRetry(key: string, dependencies: string[], ready: boolean): void {
        this.clearPendingRetry(key);
        this.pendingRetryStates.set(key, { dependencies, ready });
        for (const dependency of dependencies) {
            const dependents = this.pendingDependents.get(dependency) ?? new Set<string>();
            dependents.add(key);
            this.pendingDependents.set(dependency, dependents);
        }
        this.pendingPassProgress ||= ready;
    }

    private dependencyError(detail: string, did?: string, visited?: Set<string>): InvalidOperationError {
        const error = new InvalidOperationError(detail);
        if (did) {
            const dependencies = visited && visited.size > MAX_PENDING_DEPENDENCIES
                ? new Set(['*'])
                : new Set(visited);
            dependencies.add(this.didKey(did));
            resolutionDependencies.set(error, dependencies.has('*') || dependencies.size > MAX_PENDING_DEPENDENCIES
                ? ['*']
                : Array.from(dependencies));
        }
        return error;
    }

    private withEventQueueWork<T>(fn: () => Promise<T>): Promise<T> {
        const work = this.eventQueueBarrier.then(fn).finally(() => {
            this.eventQueueWork.delete(work);
        });
        this.eventQueueWork.add(work);
        return work;
    }

    private didKey(did: string): string {
        return did.split(':').pop() || did;
    }

    private async didMatchesOperation(did: string, operation: Operation): Promise<boolean> {
        const operationDID = operation.type === 'create'
            ? await this.generateDID(operation)
            : operation.did;

        return !!operationDID && this.didKey(did) === this.didKey(operationDID);
    }

    private async readForResolution<T>(read: () => Promise<T>): Promise<T> {
        try {
            return await read();
        }
        catch (error) {
            if (typeof error === 'object' && error !== null) {
                retryableResolutionErrors.add(error);
            }
            throw error;
        }
    }

    private invalidateVerifiedDID(did: string): void {
        this.mutationRevision += 1;
        delete this.verifiedDIDs[this.didKey(did)];
    }

    private async mutateDID<T>(
        did: string,
        fn: () => Promise<T>,
        operationCid?: string,
        historyChanged = false,
    ): Promise<T> {
        const key = this.didKey(did);
        this.activeMutations.add(key);
        this.invalidateVerifiedDID(did);
        let persisted = false;
        try {
            const result = await fn();
            persisted = true;
            return result;
        }
        finally {
            this.invalidateVerifiedDID(did);
            this.activeMutations.delete(key);
            const dependencies = [key, '*'];
            if (persisted && operationCid) {
                dependencies.push(`op:${operationCid}`);
            }
            // Replacements, removals and partially failed writes can change earlier history.
            if (!persisted || !operationCid || historyChanged) {
                dependencies.push(`history:${key}`);
            }
            for (const dependency of dependencies) {
                for (const eventKey of this.pendingDependents.get(dependency) ?? []) {
                    if (this.eventStates.get(eventKey)?.state === 'pending') {
                        this.pendingRetryStates.get(eventKey)!.ready = true;
                        this.pendingPassProgress = true;
                    }
                }
            }
        }
    }

    private async withDidLock<T>(did: string, fn: () => Promise<T>): Promise<T> {
        const key = this.didKey(did);
        const prev = this.didLocks.get(key) ?? Promise.resolve();
        let release: () => void = () => { };
        const gate = new Promise<void>(r => (release = r));
        const current = prev.then(() => gate, () => gate);

        this.didLocks.set(key, current);

        try {
            await prev;
            return await fn();
        } finally {
            release();
            if (this.didLocks.get(key) === current) {
                this.didLocks.delete(key);
            }
        }
    }

    // Controller edges span DIDs, so validate and persist graph changes serially.
    private async withControllerGraphLock<T>(fn: () => Promise<T>): Promise<T> {
        const prev = this.controllerGraphLock;
        let release: () => void = () => { };
        const gate = new Promise<void>(r => (release = r));
        const current = prev.then(() => gate, () => gate);

        this.controllerGraphLock = current;

        try {
            await prev;
            return await fn();
        } finally {
            release();
            if (this.controllerGraphLock === current) {
                this.controllerGraphLock = Promise.resolve();
            }
        }
    }

    verifyDb(options?: { chatty?: boolean }): Promise<VerifyDbResult> {
        this.verifyDbInFlight ??= this.runVerifyDb(options).finally(() => {
            this.verifyDbInFlight = undefined;
        });
        return this.verifyDbInFlight;
    }

    private async runVerifyDb(options?: { chatty?: boolean }): Promise<VerifyDbResult> {
        const chatty = options?.chatty ?? true;
        const dids = await this.getDIDs() as string[];
        const total = dids.length;
        const snapshotKeys = new Set(dids.map(did => this.didKey(did)));
        const now = Date.now();
        const inspectedDIDs = new Set<string>();
        const expiredDIDs = new Set<string>();
        const expiredAgents = new Set<string>();
        const failedDIDs = new Set<string>();
        const dependents = new Map<string, string[]>();
        const verifyStart = chatty ? Date.now() : 0;
        const resolveCurrent = async (did: string): Promise<{
            doc?: MdipDocument;
            expiresAt?: number;
            invalid: boolean;
            notFound?: boolean;
            retryable?: boolean;
            error?: unknown;
        }> => {
            try {
                const doc = await this.resolveDID(did);
                if (doc.didResolutionMetadata?.error) {
                    return {
                        invalid: true,
                        notFound: doc.didResolutionMetadata.error === 'notFound',
                        error: doc.didResolutionMetadata.error,
                    };
                }

                const validUntil = doc.mdip?.validUntil;
                if (!validUntil) {
                    return { doc, invalid: false };
                }

                const expiresAt = new Date(validUntil).getTime();
                return isNaN(expiresAt)
                    ? { doc, invalid: false }
                    : { doc, expiresAt, invalid: false };
            }
            catch (error) {
                const retryable = typeof error === 'object'
                    && error !== null
                    && retryableResolutionErrors.has(error);
                return { invalid: !retryable, retryable, error };
            }
        };

        const inspectDID = async (did: string, n: number): Promise<void> => {
            inspectedDIDs.add(did);
            const key = this.didKey(did);
            const revision = this.mutationRevision;
            try {
                const { doc, expiresAt, invalid, retryable, error } = await resolveCurrent(did);
                if (invalid || retryable || !doc) {
                    throw error ?? new InvalidOperationError('DID resolution failed');
                }

                const controller = doc.didDocument?.controller;
                if (controller) {
                    const controllerKey = this.didKey(controller);
                    const controlledDIDs = dependents.get(controllerKey) ?? [];
                    controlledDIDs.push(did);
                    dependents.set(controllerKey, controlledDIDs);
                }

                if (expiresAt !== undefined) {
                    if (expiresAt < now) {
                        if (chatty) {
                            this.log.warn(`${n}/${total} ${did} expired`);
                        }
                        expiredDIDs.add(did);
                        if (doc.mdip?.type === 'agent') {
                            expiredAgents.add(did);
                        }
                    }
                    else if (chatty) {
                        const minutesLeft = Math.round((expiresAt - now) / 60 / 1000);
                        this.log.debug(`expiring ${n}/${total} ${did} in ${minutesLeft} minutes`);
                    }
                    return;
                }

                if (chatty) {
                    this.log.debug(`resolved ${n}/${total} ${did} OK`);
                }
                if (revision === this.mutationRevision && !this.activeMutations.has(key)) {
                    this.verifiedDIDs[key] = true;
                }
            }
            catch (error) {
                if (chatty) {
                    this.log.warn({ error, did }, `${n}/${total} ${did} invalid`);
                }
                failedDIDs.add(did);
            }
        };

        for (let n = 0; n < dids.length; n += 1) {
            const did = dids[n];
            if (!this.verifiedDIDs[this.didKey(did)]) {
                await inspectDID(did, n + 1);
            }
        }

        if (expiredAgents.size > 0 || failedDIDs.size > 0 || this.pendingExpiredControllers.size > 0) {
            for (let n = 0; n < dids.length; n += 1) {
                const did = dids[n];
                if (!inspectedDIDs.has(did)) {
                    await inspectDID(did, n + 1);
                }
            }
        }

        const removedExpiredDIDs = new Set<string>();
        const removedInvalidDIDs = new Set<string>();
        let dependencyDiscoveryFailed = false;

        for (const did of failedDIDs) {
            await this.withDidLock(did, async () => {
                const current = await resolveCurrent(did);
                if (current.retryable) {
                    dependencyDiscoveryFailed = true;
                    return;
                }
                if (current.invalid || !current.doc) {
                    await this.removeDIDUnlocked(did);
                    removedInvalidDIDs.add(did);
                    return;
                }

                const controller = current.doc.didDocument?.controller;
                if (controller) {
                    const controllerKey = this.didKey(controller);
                    const controlledDIDs = dependents.get(controllerKey) ?? [];
                    controlledDIDs.push(did);
                    dependents.set(controllerKey, controlledDIDs);
                }

                if (current.expiresAt !== undefined && current.expiresAt < Date.now()) {
                    expiredDIDs.add(did);
                    if (current.doc.mdip?.type === 'agent') {
                        expiredAgents.add(did);
                    }
                }
            });
        }

        const expiredControllers = new Map(this.pendingExpiredControllers);
        for (const agentDID of expiredAgents) {
            expiredControllers.set(this.didKey(agentDID), agentDID);
        }

        for (const [agentKey, agentDID] of expiredControllers) {
            await this.withDidLock(agentDID, async () => {
                const agent = await resolveCurrent(agentDID);
                if (agent.retryable) {
                    this.pendingExpiredControllers.set(agentKey, agentDID);
                    return;
                }
                if (agent.notFound) {
                    this.pendingExpiredControllers.set(agentKey, agentDID);
                    if (snapshotKeys.has(agentKey)) {
                        removedExpiredDIDs.add(agentDID);
                    }
                }
                else if (agent.invalid) {
                    this.pendingExpiredControllers.set(agentKey, agentDID);
                    return;
                }
                else if (agent.doc?.mdip?.type !== 'agent'
                    || agent.expiresAt === undefined
                    || agent.expiresAt >= Date.now()) {
                    this.pendingExpiredControllers.delete(agentKey);
                    return;
                }
                if (dependencyDiscoveryFailed) {
                    this.pendingExpiredControllers.set(agentKey, agentDID);
                    return;
                }

                let revalidationFailed = false;
                for (const assetDID of dependents.get(agentKey) ?? []) {
                    await this.withDidLock(assetDID, async () => {
                        const asset = await resolveCurrent(assetDID);
                        const controller = asset.doc?.didDocument?.controller;
                        if (asset.notFound) {
                            removedExpiredDIDs.add(assetDID);
                            return;
                        }
                        if (asset.invalid || asset.retryable) {
                            revalidationFailed = true;
                        }
                        else if (asset.doc?.mdip?.type === 'asset'
                            && controller
                            && this.didKey(controller) === agentKey) {
                            await this.removeDIDUnlocked(assetDID);
                            removedExpiredDIDs.add(assetDID);
                        }
                    });
                    if (revalidationFailed) {
                        this.pendingExpiredControllers.set(agentKey, agentDID);
                        return;
                    }
                }

                if (!agent.notFound) {
                    await this.removeDIDUnlocked(agentDID);
                    removedExpiredDIDs.add(agentDID);
                }
                this.pendingExpiredControllers.delete(agentKey);
            });
        }

        for (const did of expiredDIDs) {
            if (expiredAgents.has(did) || removedExpiredDIDs.has(did) || removedInvalidDIDs.has(did)) {
                continue;
            }

            await this.withDidLock(did, async () => {
                const current = await resolveCurrent(did);
                if (current.retryable) {
                    return;
                }
                if (current.notFound) {
                    removedExpiredDIDs.add(did);
                }
                else if (current.invalid) {
                    await this.removeDIDUnlocked(did);
                    removedInvalidDIDs.add(did);
                }
                else if (current.expiresAt !== undefined && current.expiresAt < Date.now()) {
                    await this.removeDIDUnlocked(did);
                    removedExpiredDIDs.add(did);
                }
            });
        }

        const invalidKeys = new Set([...removedInvalidDIDs].map(did => this.didKey(did)));
        const expired = new Set([...removedExpiredDIDs]
            .map(did => this.didKey(did))
            .filter(key => !invalidKeys.has(key))).size;
        const invalid = invalidKeys.size;
        const verified = total - expired - invalid;

        if (chatty) {
            const durationMs = Date.now() - verifyStart;
            this.log.info({ durationMs }, 'verifyDb');
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
            catch {
            }
        }

        const byType = { agents, assets, confirmed, unconfirmed, ephemeral, invalid };
        const eventsQueue = Array.from(this.eventStates.values(), record => record.entry.event);
        return { total, byType, byRegistry, byVersion, eventsQueue };
    }

    async listRegistries(): Promise<string[]> {
        return this.supportedRegistries;
    }

    // For testing purposes
    async resetDb(): Promise<boolean> {
        // Drain admitted work and keep new admissions behind the reset boundary.
        const reset = Promise.allSettled([this.eventQueueBarrier, ...this.eventQueueWork])
            .then(() => this.withControllerGraphLock(async () => {
                this.mutationRevision += 1;
                this.verifiedDIDs = {};
                await this.db.resetDb();
                this.historicalOperationCids.clear();
                this.historicalOperationCidBytes = 0;
                this.pendingExpiredControllers.clear();
                this.clearEventQueues();
                return true;
            }));
        this.eventQueueBarrier = reset.then(() => {}, () => {});
        return reset;
    }

    async generateCID(operation: unknown): Promise<string> {
        const canonical = this.cipher.canonicalizeJSON(operation);
        return generateCID(JSON.parse(canonical));
    }

    private async historicalOperationCID(operation: Operation): Promise<string> {
        // Key by contents, never by an unverified stored opid or mutable object identity.
        const contents = JSON.stringify(operation);
        const cached = this.historicalOperationCids.get(contents);
        if (cached !== undefined) {
            this.historicalOperationCids.delete(contents);
            this.historicalOperationCids.set(contents, cached);
            return cached;
        }

        const cid = await this.generateCID(operation);
        const bytes = 2 * (contents.length + cid.length);
        if (bytes <= this.maxHistoryCidCacheBytes) {
            while (this.historicalOperationCids.size >= this.maxHistoryCidCacheEntries
                || this.historicalOperationCidBytes + bytes > this.maxHistoryCidCacheBytes) {
                const [oldContents, oldCid] = this.historicalOperationCids.entries().next().value!;
                this.historicalOperationCids.delete(oldContents);
                this.historicalOperationCidBytes -= 2 * (oldContents.length + oldCid.length);
            }
            this.historicalOperationCids.set(contents, cid);
            this.historicalOperationCidBytes += bytes;
        }
        return cid;
    }

    async generateDID(operation: Operation): Promise<string> {
        return generateDIDFromOperation(operation, {
            didPrefix: this.didPrefix,
            generateCID: (operation) => this.generateCID(operation),
        });
    }

    async verifyOperation(operation: Operation): Promise<boolean> {
        return this.verifyOperationWithHistory(operation);
    }

    private async verifyOperationWithHistory(operation: Operation, events?: GatekeeperEvent[]): Promise<boolean> {
        if (operation.type === 'create') {
            const valid = await this.verifyCreateOperation(operation);
            return valid && !(await this.operationIntroducesControllerCycle(operation));
        }

        if (operation.type === 'update' || operation.type === 'delete') {
            const doc = events === undefined
                ? await this.resolveDID(operation.did)
                : await this.resolveHistory(operation.did, copyJSON(events));
            const valid = await this.verifyUpdateOperation(operation, doc);
            return valid && !(await this.operationIntroducesControllerCycle(operation));
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

    private verifySignature(msgHash: string, value: string, publicJwk: NonNullable<Operation['publicJwk']>): boolean {
        try {
            return this.cipher.verifySig(msgHash, value, publicJwk);
        }
        catch {
            return false;
        }
    }

    private getVerifiedOperationHash(operation: Operation): string | null {
        const operationCopy = copyJSON(operation);
        delete operationCopy.signature;
        const msgHash = this.cipher.hashJSON(operationCopy);
        return operation.signature?.hash === msgHash ? msgHash : null;
    }

    private operationExceedsMaxBytes(operation: Operation): boolean {
        return Buffer.byteLength(JSON.stringify(operation), 'utf8') > this.maxOpBytes;
    }

    private async resolveControllerForVerification(did: string, versionTime: string): Promise<MdipDocument> {
        const confirmed = await this.resolveDID(did, { confirm: true, versionTime });
        // The immutable create key remains usable locally while registry confirmation is pending.
        return confirmed.didResolutionMetadata?.error === 'notFound'
            ? this.resolveDID(did, { versionSequence: 1, versionTime })
            : confirmed;
    }

    async verifyCreateOperation(operation: Operation): Promise<boolean> {
        if (!operation) {
            throw new InvalidOperationError('missing');
        }

        if (this.operationExceedsMaxBytes(operation)) {
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

        if (operation.mdip.prefix !== undefined && !isValidDIDPrefix(operation.mdip.prefix)) {
            throw new InvalidOperationError(`mdip.prefix=${operation.mdip.prefix}`);
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

            const msgHash = this.getVerifiedOperationHash(operation);
            if (!msgHash) {
                return false;
            }
            return this.verifySignature(msgHash, operation.signature!.value, operation.publicJwk);
        }

        if (operation.mdip.type === 'asset') {
            const controllerDid = operation.signature?.signer;
            if (!controllerDid) {
                throw new InvalidOperationError('signature.signer');
            }

            if (operation.controller !== controllerDid) {
                throw new InvalidOperationError('signer is not controller');
            }

            const doc = await this.resolveControllerForVerification(
                controllerDid,
                operation.signature!.signed
            );

            if (doc.mdip && doc.mdip.registry === 'local' && operation.mdip.registry !== 'local') {
                throw new InvalidOperationError(`non-local registry=${operation.mdip.registry}`);
            }

            const msgHash = this.getVerifiedOperationHash(operation);
            if (!msgHash) {
                return false;
            }
            if (!doc.didDocument ||
                !doc.didDocument.verificationMethod ||
                doc.didDocument.verificationMethod.length === 0 ||
                !doc.didDocument.verificationMethod[0].publicKeyJwk) {
                throw this.dependencyError('didDocument missing verificationMethod', controllerDid);
            }
            // TBD select the right key here, not just the first one
            const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
            return this.verifySignature(msgHash, operation.signature!.value, publicJwk);
        }

        throw new InvalidOperationError(`mdip.type=${operation.mdip.type}`);
    }

    private async controllerChainHasCycle(
        did: string,
        visited: Set<string>
    ): Promise<boolean> {
        const key = this.didKey(did);
        if (visited.has(key)) {
            return true;
        }
        visited.add(key);

        const doc = await this.resolveDID(did);
        const controller = doc.didDocument?.controller;
        return controller
            ? this.controllerChainHasCycle(controller, visited)
            : false;
    }

    private async operationIntroducesControllerCycle(operation: Operation): Promise<boolean> {
        const did = operation.type === 'create'
            ? await this.generateDID(operation)
            : operation.did;
        const nextController = operation.type === 'create' && operation.mdip?.type === 'asset'
            ? operation.controller
            : operation.type === 'update'
                ? operation.doc?.didDocument?.controller
                : undefined;
        if (!did || !nextController) {
            return false;
        }

        // Check whether the proposed controller chain would introduce a cycle.
        const visited = new Set([this.didKey(did)]);
        return this.controllerChainHasCycle(nextController, visited);
    }

    private async verifyUpdateOperationSignature(
        operation: Operation,
        doc: MdipDocument,
        visited: Set<string>,
        did?: string
    ): Promise<boolean> {
        const currentDid = did ?? doc?.didDocument?.id;
        if (this.operationExceedsMaxBytes(operation)) {
            throw new InvalidOperationError('size');
        }

        if (!this.verifySignatureFormat(operation.signature)) {
            throw new InvalidOperationError('signature');
        }

        if (!doc?.didDocument) {
            throw this.dependencyError('doc.didDocument', currentDid, visited);
        }

        if (doc.didDocumentMetadata?.deactivated) {
            throw this.dependencyError('DID deactivated', currentDid, visited);
        }

        if (currentDid) {
            const key = this.didKey(currentDid);
            if (visited.has(key)) {
                return false;
            }
            visited.add(key);
        }

        if (doc.didDocument.controller) {
            // This DID is an asset, verify with controller's keys
            const controllerDoc = await this.resolveControllerForVerification(
                doc.didDocument.controller,
                operation.signature!.signed
            );
            return this.verifyUpdateOperationSignature(
                operation,
                controllerDoc,
                visited,
                doc.didDocument.controller
            );
        }

        if (!doc.didDocument.verificationMethod) {
            throw this.dependencyError('doc.didDocument.verificationMethod', currentDid, visited);
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
            throw this.dependencyError('didDocument missing verificationMethod', currentDid, visited);
        }

        // TBD get the right signature, not just the first one
        const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
        return this.verifySignature(msgHash, signature.value, publicJwk);
    }

    private verifyUpdateOperationStructure(operation: Operation, doc: MdipDocument): boolean {
        if ((operation.type !== 'update' && operation.type !== 'delete') || !operation.did || !doc.mdip) {
            return false;
        }

        const currentDid = doc.didDocument?.id;
        if (currentDid && this.didKey(currentDid) !== this.didKey(operation.did)) {
            return false;
        }

        if (operation.type === 'delete') {
            return true;
        }

        const replacement = operation.doc;
        if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement) ||
            !replacement.didDocument || typeof replacement.didDocument !== 'object' ||
            Array.isArray(replacement.didDocument) ||
            !replacement.mdip || typeof replacement.mdip !== 'object' || Array.isArray(replacement.mdip) ||
            !ValidVersions.includes(replacement.mdip.version) ||
            !Object.hasOwn(replacement, 'didDocumentData') || replacement.didDocumentData === undefined) {
            return false;
        }

        const replacementDid = replacement.didDocument.id;
        return typeof replacementDid === 'string' &&
            isValidDID(replacementDid) &&
            this.didKey(replacementDid) === this.didKey(operation.did) &&
            replacement.mdip.type === doc.mdip.type &&
            replacement.mdip.registry === doc.mdip.registry;
    }

    async verifyUpdateOperation(operation: Operation, doc: MdipDocument): Promise<boolean> {
        if (!doc?.didDocument || doc.didResolutionMetadata?.error) {
            throw this.dependencyError('doc.didDocument', operation.did);
        }

        if (!this.verifyUpdateOperationStructure(operation, doc)) {
            return false;
        }

        // Verify authorization against the existing controller chain.
        return this.verifyUpdateOperationSignature(
            operation,
            doc,
            new Set(),
            doc.didDocument?.id ?? operation.did
        );
    }

    private publicationRegistries(registry: string): string[] {
        if (registry === 'local') {
            return [];
        }
        return registry === 'hyperswarm'
            ? ['hyperswarm']
            : ['hyperswarm', registry];
    }

    private async checkQueueCapacity(registry: string, queueSize?: number): Promise<void> {
        if (registry === 'local' || registry === 'hyperswarm') {
            return;
        }
        const size = queueSize ?? (await this.db.getQueue(registry)).length;
        if (size >= this.maxQueueSize) {
            this.supportedRegistries = this.supportedRegistries.filter(reg => reg !== registry);
        }
    }

    async queueOperation(registry: string, operation: Operation) {
        for (const target of this.publicationRegistries(registry)) {
            const queueSize = await this.db.queueOperation(target, operation);
            if (target === registry) {
                await this.checkQueueCapacity(registry, queueSize);
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

        return this.withDidLock(did, () => this.withControllerGraphLock(async () => {
            const ops = await this.exportDID(did);

            // Check to see if we already have this DID in the db
            if (ops.length > 0) {
                return did;
            }

            if (await this.operationIntroducesControllerCycle(operation)) {
                throw new InvalidOperationError('controller cycle');
            }

            await this.mutateDID(did, () => this.db.addEventAndQueue(did, {
                registry: 'local',
                time: operation.created!,
                ordinal: [0],
                operation,
                did
            }, this.publicationRegistries(registry)), this.didKey(did));
            await this.checkQueueCapacity(registry);
            return did;
        }));
    }

    async generateDoc(anchor: Operation, defaultDID?: string): Promise<MdipDocument> {
        return generateDocFromOperation(anchor, {
            defaultDID,
            didPrefix: this.didPrefix,
            generateDID: (operation) => this.generateDID(operation),
        });
    }

    async resolveDID(
        did?: string,
        options?: ResolveDIDOptions
    ): Promise<MdipDocument> {
        const events = did && isValidDID(did)
            ? await this.readForResolution(() => this.db.getEvents(did))
            : [];

        return this.resolveHistory(did, events, options);
    }

    private async resolveHistory(
        did: string | undefined,
        events: GatekeeperEvent[],
        options?: ResolveDIDOptions,
    ): Promise<MdipDocument> {
        return resolveDIDFromEvents({
            did,
            events,
            options,
            didPrefix: this.didPrefix,
            generateCID: (operation) => this.generateCID(operation),
            generateDID: (operation) => this.generateDID(operation),
            getBlock: (registry, block) => this.readForResolution(() => this.db.getBlock(registry, block)),
            verifyCreateOperation: (operation) => this.verifyCreateOperation(operation),
            verifyUpdateOperation: (operation, doc) => this.verifyUpdateOperation(operation, doc),
        });
    }

    async updateDID(operation: Operation): Promise<boolean> {
        if (!operation.did) {
            throw new InvalidOperationError('missing operation.did')
        }

        return this.withDidLock(operation.did, () => this.withControllerGraphLock(async () => {
            const doc = await this.resolveDID(operation.did);

            const updateValid = await this.verifyUpdateOperation(operation, doc);

            if (!updateValid) {
                return false;
            }

            // Legacy compatibility: updates without previd cannot be checked for staleness.
            if (operation.previd !== undefined && operation.previd !== doc.didDocumentMetadata?.versionId) {
                return false;
            }

            if (await this.operationIntroducesControllerCycle(operation)) {
                return false;
            }

            const registry = doc.mdip?.registry;

            // Reject operations with unsupported registries
            if (!registry || !this.supportedRegistries.includes(registry)) {
                throw new InvalidOperationError(`registry ${registry} not supported`);
            }

            await this.mutateDID(operation.did!, () => this.db.addEventAndQueue(operation.did!, {
                registry: 'local',
                time: operation.signature?.signed || '',
                ordinal: [0],
                operation,
                did: operation.did
            }, this.publicationRegistries(registry)), await this.generateCID(operation));
            await this.checkQueueCapacity(registry);

            return true;
        }));
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
                    if (confirm && doc.didResolutionMetadata?.error === 'notFound') {
                        continue;
                    }
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

    private async removeDIDUnlocked(did: string): Promise<void> {
        await this.mutateDID(did, () => this.db.deleteEvents(did));
    }

    async removeDIDs(dids: string[]): Promise<boolean> {
        if (!Array.isArray(dids)) {
            throw new InvalidParameterError('dids');
        }

        for (const did of dids) {
            await this.withDidLock(did, () => this.removeDIDUnlocked(did));
        }

        return true;
    }

    async importEvent(event: GatekeeperEvent): Promise<ImportStatus> {
        this.deferredDependencies.delete(event);
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
            if (!did || !(await this.didMatchesOperation(did, event.operation))) {
                return ImportStatus.REJECTED;
            }

            return await this.withDidLock(did, () => this.withControllerGraphLock(async () => {
                const lockedDid = did;
                const currentEvents = await this.db.getEvents(lockedDid);

                const eventOperationCid = await this.generateCID(event.operation);
                if (event.opid !== undefined && event.opid !== eventOperationCid) {
                    return ImportStatus.REJECTED;
                }
                event.opid = eventOperationCid;
                let opMatchIndex = -1;

                for (let i = 0; i < currentEvents.length; i++) {
                    const e = currentEvents[i];
                    const operationCid = await this.historicalOperationCID(e.operation);

                    if (!e.opid) {
                        e.opid = operationCid;
                    }

                    if (opMatchIndex === -1 && operationCid === eventOperationCid) {
                        opMatchIndex = i;
                    }
                }

                const opMatch = currentEvents[opMatchIndex];

                if (opMatch) {
                    const valid = event.operation.type === 'create'
                        ? await this.verifyCreateOperation(event.operation)
                        : await this.verifyUpdateOperation(
                            event.operation,
                            await this.resolveHistory(lockedDid, copyJSON(currentEvents), { versionSequence: opMatchIndex })
                        );

                    if (!valid || !(await this.didMatchesOperation(lockedDid, event.operation))) {
                        return ImportStatus.REJECTED;
                    }

                    const first = currentEvents[0];
                    const nativeRegistry = first.operation.mdip?.registry;

                    if (opMatch.registry === nativeRegistry) {
                        // If this event is already confirmed on the native registry, no need to update
                        return ImportStatus.MERGED;
                    }

                    if (event.registry === nativeRegistry) {
                        // If this import is on the native registry, merge its confirmation metadata
                        currentEvents[opMatchIndex] = {
                            ...event,
                            did: lockedDid,
                            opid: eventOperationCid,
                            operation: opMatch.operation,
                        };
                        await this.mutateDID(lockedDid, () => this.db.setEvents(lockedDid, currentEvents),
                            eventOperationCid, true);
                        return ImportStatus.ADDED;
                    }

                    return ImportStatus.MERGED;
                } else {
                    const ok = await this.verifyOperationWithHistory(event.operation, currentEvents);

                    if (!ok || !(await this.didMatchesOperation(lockedDid, event.operation))) {
                        return ImportStatus.REJECTED;
                    }

                    if (currentEvents.length === 0) {
                        await this.mutateDID(lockedDid, () => this.db.addEvent(lockedDid, event), eventOperationCid);
                        return ImportStatus.ADDED;
                    }

                    // TEMP during did:test, operation.previd is optional
                    if (!event.operation.previd) {
                        await this.mutateDID(lockedDid, () => this.db.addEvent(lockedDid, event), eventOperationCid);
                        return ImportStatus.ADDED;
                    }

                    const idMatch = currentEvents.find(item => item.opid === event.operation.previd);

                    if (!idMatch) {
                        this.deferredDependencies.set(event, [`op:${event.operation.previd}`, `history:${this.didKey(lockedDid)}`]);
                        return ImportStatus.DEFERRED;
                    }

                    const index = currentEvents.indexOf(idMatch);

                    if (index === currentEvents.length - 1) {
                        await this.mutateDID(lockedDid, () => this.db.addEvent(lockedDid, event), eventOperationCid);
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
                            await this.mutateDID(lockedDid, () => this.db.setEvents(lockedDid, newSequence, {
                                operationEvents: [event],
                            }), eventOperationCid, true);
                            return ImportStatus.ADDED;
                        }
                    }
                }

                return ImportStatus.REJECTED;
            }));
        } catch (error: any) {
            if (error.type === 'Invalid operation') {
                // Could be an event with a controller DID that hasn't been imported yet
                this.deferredDependencies.set(event, resolutionDependencies.get(error) ?? ['*']);
                return ImportStatus.DEFERRED;
            }
            throw error;
        }
    }

    async processEvents(): Promise<ProcessEventsResult> {
        return this.withEventQueueWork(() => this.processQueuedEvents());
    }

    private async processQueuedEvents(): Promise<ProcessEventsResult> {
        if (this.isProcessingEvents) {
            return { busy: true };
        }

        let added = 0;
        let merged = 0;
        let rejected = 0;
        let capacityDeferred = 0;
        const acceptedHashes = new Set<string>();
        const acceptedEventsByHash = new Map<string, GatekeeperEvent>();
        const rejectedOperations: Operation[] = [];
        const capacityDeferredHashes = new Set<string>();
        const newlyDeferred = new Map<string, {
            entry: QueuedGatekeeperEvent;
            hash: string;
        }>();
        const terminalEntries: Array<{
            entry: QueuedGatekeeperEvent;
            lane: 'staged' | 'pending';
        }> = [];
        let processingEntry: QueuedGatekeeperEvent | undefined;
        let snapshot: {
            stagedEvents: QueuedGatekeeperEvent[];
            pendingEvents: QueuedGatekeeperEvent[];
            eventStates: Map<string, EventQueueRecord>;
            transientEventCount: number;
            transientEventBytes: number;
            pendingEventCount: number;
            pendingEventBytes: number;
            pendingPassRemaining: number;
            pendingPassProgress: boolean;
            preferStagedEvents: boolean;
            pendingRetryStates: Map<string, PendingEventRetry>;
        } | undefined;

        try {
            this.isProcessingEvents = true;

            snapshot = {
                stagedEvents: [...this.stagedEvents],
                pendingEvents: [...this.pendingEvents],
                eventStates: new Map(Array.from(this.eventStates, ([key, record]) => [
                    key,
                    { entry: record.entry, state: record.state },
                ])),
                transientEventCount: this.transientEventCount,
                transientEventBytes: this.transientEventBytes,
                pendingEventCount: this.pendingEventCount,
                pendingEventBytes: this.pendingEventBytes,
                pendingPassRemaining: this.pendingPassRemaining,
                pendingPassProgress: this.pendingPassProgress,
                preferStagedEvents: this.preferStagedEvents,
                pendingRetryStates: new Map(Array.from(this.pendingRetryStates, ([key, retry]) => [
                    key, { ...retry },
                ])),
            };

            let stagedRemaining = this.stagedEvents.length;
            if (this.pendingPassRemaining === 0 && this.pendingEvents.length > 0) {
                this.pendingPassRemaining = this.pendingEvents.length;
                this.pendingPassProgress = false;
            }

            let attempted = 0;
            let attemptedBytes = 0;
            let preferStaged = this.preferStagedEvents;

            while (attempted < this.maxEventPageCount) {
                if (this.pendingPassRemaining === 0 && this.pendingPassProgress) {
                    if (this.pendingEvents.length > 0) {
                        this.pendingPassRemaining = this.pendingEvents.length;
                    }
                    this.pendingPassProgress = false;
                }
                const stagedAvailable = stagedRemaining > 0 && this.stagedEvents.length > 0;
                const pendingAvailable = this.pendingPassRemaining > 0 && this.pendingEvents.length > 0;
                if (!stagedAvailable && !pendingAvailable) {
                    break;
                }

                const laneOrder = preferStaged
                    ? ['staged', 'pending'] as const
                    : ['pending', 'staged'] as const;
                let lane: 'staged' | 'pending' | undefined;
                for (const candidateLane of laneOrder) {
                    const entry = candidateLane === 'staged'
                        ? (stagedAvailable ? this.stagedEvents[0] : undefined)
                        : (pendingAvailable ? this.pendingEvents[0] : undefined);
                    if (entry && attemptedBytes + entry.bytes <= this.maxEventPageBytes) {
                        lane = candidateLane;
                        break;
                    }
                }
                if (!lane) {
                    break;
                }

                const entry = lane === 'staged'
                    ? this.stagedEvents.shift()!
                    : this.pendingEvents.shift()!;
                if (lane === 'staged') {
                    stagedRemaining -= 1;
                }
                else {
                    this.pendingPassRemaining -= 1;
                }
                preferStaged = lane !== 'staged';

                processingEntry = entry;
                const record = this.eventStates.get(entry.key);
                if (!record) {
                    throw new Error(`missing queued event state for ${entry.key}`);
                }
                if (lane === 'pending' && this.pendingRetryStates.get(entry.key)?.ready === false) {
                    this.pendingEvents.push(entry);
                    processingEntry = undefined;
                    continue;
                }
                record.state = 'processing';
                attempted += 1;
                attemptedBytes += entry.bytes;

                const attemptRevision = this.mutationRevision;
                const status = await this.importEvent(entry.event);
                processingEntry = undefined;
                if (status === ImportStatus.ADDED || status === ImportStatus.MERGED) {
                    terminalEntries.push({
                        entry,
                        lane: newlyDeferred.has(entry.key) ? 'staged' : lane,
                    });
                    newlyDeferred.delete(entry.key);
                    const hash = entry.event.operation.signature?.hash?.toLowerCase();
                    if (hash) {
                        acceptedHashes.add(hash);
                        if (!acceptedEventsByHash.has(hash)) {
                            acceptedEventsByHash.set(hash, entry.event);
                        }
                    }
                    if (status === ImportStatus.ADDED) {
                        added += 1;
                    }
                    else {
                        merged += 1;
                    }
                    this.log.debug(`import ${attempted}: ${status} event for ${entry.event.did}`);
                }
                else if (status === ImportStatus.REJECTED) {
                    terminalEntries.push({
                        entry,
                        lane: newlyDeferred.has(entry.key) ? 'staged' : lane,
                    });
                    newlyDeferred.delete(entry.key);
                    rejected += 1;
                    rejectedOperations.push(entry.event.operation);
                    this.log.debug(`import ${attempted}: rejected event for ${entry.event.did}`);
                }
                else if (lane === 'staged') {
                    const verifiedHash = this.getVerifiedOperationHash(entry.event.operation);
                    if (!verifiedHash) {
                        terminalEntries.push({ entry, lane });
                        rejected += 1;
                        rejectedOperations.push(entry.event.operation);
                        continue;
                    }
                    newlyDeferred.set(entry.key, {
                        entry,
                        hash: verifiedHash.toLowerCase(),
                    });
                    this.setPendingRetry(entry.key, this.deferredDependencies.get(entry.event) ?? ['*'],
                        this.mutationRevision !== attemptRevision);
                    record.state = 'pending';
                    this.pendingEvents.push(entry);
                }
                else {
                    this.setPendingRetry(entry.key, this.deferredDependencies.get(entry.event) ?? ['*'],
                        this.mutationRevision !== attemptRevision);
                    record.state = 'pending';
                    this.pendingEvents.push(entry);
                    this.log.debug(`import ${attempted}: deferred event for ${entry.event.did}`);
                }
            }

            // Keep states and admission capacity reserved until every awaited page attempt succeeds.
            for (const { entry, lane } of terminalEntries) {
                if (lane === 'staged') {
                    this.transientEventCount -= 1;
                    this.transientEventBytes -= entry.bytes;
                }
                else {
                    this.pendingEventCount -= 1;
                    this.pendingEventBytes -= entry.bytes;
                }
                this.eventStates.delete(entry.key);
                this.clearPendingRetry(entry.key);
            }

            let unattemptedDeferredAdmitted = false;
            const capacityDeferredEntries = new Set<QueuedGatekeeperEvent>();
            for (const { entry, hash } of newlyDeferred.values()) {
                const pendingFits = this.pendingEventCount < this.maxPendingEventCount
                    && this.pendingEventBytes + entry.bytes <= this.maxPendingEventBytes;
                this.transientEventCount -= 1;
                this.transientEventBytes -= entry.bytes;
                if (pendingFits) {
                    const record = this.eventStates.get(entry.key)!;
                    record.state = 'pending';
                    this.pendingEventCount += 1;
                    this.pendingEventBytes += entry.bytes;
                    unattemptedDeferredAdmitted ||= this.pendingRetryStates.get(entry.key)!.ready;
                }
                else {
                    capacityDeferredEntries.add(entry);
                    this.eventStates.delete(entry.key);
                    this.clearPendingRetry(entry.key);
                    capacityDeferred += 1;
                    capacityDeferredHashes.add(hash);
                }
            }
            if (capacityDeferredEntries.size > 0) {
                const unattempted = new Set(this.pendingEvents.slice(0, this.pendingPassRemaining));
                for (const entry of capacityDeferredEntries) {
                    if (unattempted.has(entry)) {
                        this.pendingPassRemaining -= 1;
                    }
                }
                this.pendingEvents = this.pendingEvents.filter(
                    entry => !capacityDeferredEntries.has(entry)
                );
            }

            let hasMore = this.stagedEvents.length > 0 || this.pendingPassRemaining > 0;
            if (this.pendingPassRemaining === 0) {
                if ((this.pendingPassProgress || unattemptedDeferredAdmitted)
                    && this.pendingEvents.length > 0) {
                    this.pendingPassRemaining = this.pendingEvents.length;
                    hasMore = true;
                }
                this.pendingPassProgress = false;
            }
            this.preferStagedEvents = !snapshot.preferStagedEvents;

            const pending = this.pendingEventCount;
            const response = {
                added,
                merged,
                rejected,
                pending,
                acceptedHashes: Array.from(acceptedHashes),
                acceptedEvents: Array.from(acceptedEventsByHash.values()),
                ...(rejectedOperations.length > 0 && { rejectedOperations }),
                hasMore,
                capacityDeferred,
                capacityDeferredHashes: Array.from(capacityDeferredHashes),
            };

            const { acceptedEvents, rejectedOperations: rejectedOperationList, ...logResponseBase } = response;
            const logResponse = {
                ...logResponseBase,
                acceptedEventsCount: acceptedEvents.length,
                rejectedOperationsCount: rejectedOperationList?.length ?? 0,
            };
            this.log.debug(`processEvents: ${JSON.stringify(logResponse)}`);

            return response;
        }
        catch (error) {
            if (snapshot) {
                const concurrentEntries = this.stagedEvents.filter(entry => !snapshot!.eventStates.has(entry.key));
                this.stagedEvents = [...snapshot.stagedEvents, ...concurrentEntries];
                this.pendingEvents = [...snapshot.pendingEvents];
                this.eventStates.clear();
                for (const [key, record] of snapshot.eventStates) {
                    this.eventStates.set(key, { entry: record.entry, state: record.state });
                }
                for (const entry of concurrentEntries) {
                    this.eventStates.set(entry.key, { entry, state: 'staged' });
                }
                this.transientEventCount = snapshot.transientEventCount + concurrentEntries.length;
                this.transientEventBytes = snapshot.transientEventBytes
                    + concurrentEntries.reduce((total, entry) => total + entry.bytes, 0);
                this.pendingEventCount = snapshot.pendingEventCount;
                this.pendingEventBytes = snapshot.pendingEventBytes;
                this.pendingPassRemaining = snapshot.pendingPassRemaining;
                this.pendingPassProgress = snapshot.pendingPassProgress;
                this.preferStagedEvents = snapshot.preferStagedEvents;
                this.pendingRetryStates.clear();
                this.pendingDependents.clear();
                // A failed page may have persisted dependencies before rollback.
                for (const [key, retry] of snapshot.pendingRetryStates) {
                    this.setPendingRetry(key, retry.dependencies, true);
                }
            }
            this.log.error({
                error,
                eventKey: processingEntry?.key,
                did: processingEntry?.event.did,
                operationType: processingEntry?.event.operation.type,
                previd: processingEntry?.event.operation.previd,
                staged: this.transientEventCount,
                pending: this.pendingEventCount,
            }, 'processEvents error');
            throw error;
        }
        finally {
            this.isProcessingEvents = false;
        }
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

        if (this.operationExceedsMaxBytes(operation)) {
            return false;
        }

        if (!this.verifySignatureFormat(operation.signature)) {
            return false;
        }

        if (operation.type === 'create' && !this.getVerifiedOperationHash(operation)) {
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

            if (operation.mdip.prefix !== undefined && !isValidDIDPrefix(operation.mdip.prefix)) {
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

            if (!doc || !doc.didDocument || !doc.didDocumentData || !doc.mdip) {
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

        return !event.did || this.didMatchesOperation(event.did, event.operation);
    }

    async importBatch(batch: GatekeeperEvent[]): Promise<ImportBatchResult> {
        return this.withEventQueueWork(() => this.queueBatch(batch));
    }

    private async queueBatch(batch: GatekeeperEvent[]): Promise<ImportBatchResult> {
        if (!batch || !Array.isArray(batch) || batch.length < 1) {
            throw new InvalidParameterError('batch');
        }

        let queued = 0;
        let processed = 0;
        let capacityDeferred = 0;
        const rejectedIndices: number[] = [];
        const processedIndices: number[] = [];
        const capacityDeferredIndices: number[] = [];

        for (let i = 0; i < batch.length; i++) {
            const event = batch[i];
            let serialized: string | undefined;
            try {
                serialized = JSON.stringify(event);
            }
            catch {
                rejectedIndices.push(i);
                continue;
            }
            if (serialized === undefined
                || Buffer.byteLength(serialized, 'utf8') > this.maxEventPageBytes) {
                rejectedIndices.push(i);
                continue;
            }

            const ok = await this.verifyEvent(event);

            if (ok) {
                let operationCid: string;
                try {
                    operationCid = await this.generateCID(event.operation);
                }
                catch {
                    rejectedIndices.push(i);
                    continue;
                }
                const eventKey = `${event.registry}/${operationCid}`;
                if (this.eventStates.has(eventKey)) {
                    processed += 1;
                    processedIndices.push(i);
                    continue;
                }

                try {
                    // importEvent adds these fields, so admission must account for the retained shape.
                    const did = event.did || event.operation.did || await this.generateDID(event.operation);
                    const normalizedEvent = {
                        ...event,
                        ...(did ? { did } : {}),
                        ...(event.opid === undefined ? { opid: operationCid } : {}),
                    };
                    serialized = JSON.stringify(normalizedEvent);
                }
                catch {
                    rejectedIndices.push(i);
                    continue;
                }
                if (serialized === undefined
                    || Buffer.byteLength(serialized, 'utf8') > this.maxEventPageBytes) {
                    rejectedIndices.push(i);
                    continue;
                }

                // DID normalization may yield, so another import can reserve this key first.
                if (this.eventStates.has(eventKey)) {
                    processed += 1;
                    processedIndices.push(i);
                    continue;
                }

                const bytes = Buffer.byteLength(serialized, 'utf8');
                const fits = this.transientEventCount < this.maxEventPageCount
                    && this.transientEventBytes + bytes <= this.maxTransientEventBytes;
                if (fits) {
                    const entry = { event, key: eventKey, bytes };
                    this.eventStates.set(eventKey, { entry, state: 'staged' });
                    this.stagedEvents.push(entry);
                    this.transientEventCount += 1;
                    this.transientEventBytes += bytes;
                    queued += 1;
                }
                else {
                    capacityDeferred += 1;
                    capacityDeferredIndices.push(i);
                }
            }
            else {
                rejectedIndices.push(i);
            }
        }

        return {
            queued,
            processed,
            rejected: rejectedIndices.length,
            total: this.eventStates.size,
            rejectedIndices,
            capacityDeferred,
            capacityDeferredIndices,
            processedIndices,
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

    async clearQueue(registry: string, events: Operation[] | string[]): Promise<boolean> {
        if (!ValidRegistries.includes(registry)) {
            throw new InvalidParameterError(`registry=${registry}`);
        }

        if (!Array.isArray(events) || events.length === 0) {
            return true;
        }

        const isHashArray = events.every(item => typeof item === 'string');
        if (isHashArray) {
            const hashes = new Set((events as string[]).filter(Boolean));
            if (hashes.size === 0) {
                return true;
            }

            const queue = await this.db.getQueue(registry);
            const toClear = queue.filter(op => {
                const hash = op.signature?.hash;
                return hash ? hashes.has(hash) : false;
            });

            if (toClear.length === 0) {
                return true;
            }

            return this.db.clearQueue(registry, toClear);
        }

        return this.db.clearQueue(registry, events as Operation[]);
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
        if (!this.ipfs) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.addText(text);
    }

    async getText(cid: string): Promise<string | null> {
        if (!this.ipfs) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.getText(cid);
    }

    async addData(data: Buffer): Promise<string> {
        if (!this.ipfs) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.addData(data);
    }

    async getData(cid: string): Promise<Buffer | null> {
        if (!this.ipfs) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.getData(cid);
    }

    async addJSON(json: object): Promise<string> {
        if (!this.ipfs) {
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.addJSON(json);
    }

    async getJSON(cid: string): Promise<object | null> {
        if (!this.ipfs) {
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.getJSON(cid);
    }
}
