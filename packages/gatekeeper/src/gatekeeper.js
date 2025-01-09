import canonicalize from 'canonicalize';
import * as cipher from '@mdip/cipher/node';
import { copyJSON } from '@mdip/common/utils';
import {
    InvalidDIDError,
    InvalidParameterError,
    InvalidOperationError
} from '@mdip/common/errors';
import IPFS from '@mdip/ipfs';
import config from './config.js';

const ValidVersions = [1];
const ValidTypes = ['agent', 'asset'];
// We'll leave TESS here so existing TESS DIDs are not deleted
// TBD? Remove TESS when we switch to did:mdip
const ValidRegistries = ['local', 'hyperswarm', 'TESS', 'TBTC', 'TFTC'];

export default class Gatekeeper {
    constructor(options = {}) {
        if (options.db) {
            this.db = options.db;
        }
        else {
            throw new InvalidParameterError('missing options.db');
        }

        // Only used for unit testing
        if (options.console) {
            // eslint-disable-next-line
            console = options.console;
        }

        this.supportedRegistries = null;
        this.eventsQueue = [];
        this.eventsSeen = {};
        this.verifiedDIDs = {};
        this.isProcessingEvents = false;
        this.ipfs = new IPFS({ minimal: true });
    }

    async verifyDb(options = {}) {
        const { chatty = true } = options;

        const dids = await this.getDIDs();
        const total = dids.length;
        let n = 0;
        let expired = 0;
        let invalid = 0;
        let verified = Object.keys(this.verifiedDIDs).length;

        if (chatty) {
            console.time('verifyDb');
        }

        for (const did of dids) {
            n += 1;

            if (this.verifiedDIDs[did]) {
                continue;
            }

            let validUntil = null;

            try {
                const doc = await this.resolveDID(did, { verify: true });
                validUntil = doc.mdip.validUntil;
            }
            catch (error) {
                if (chatty) {
                    console.log(`removing ${n}/${total} ${did} invalid`);
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
                        console.log(`removing ${n}/${total} ${did} expired`);
                    }
                    await this.db.deleteEvents(did);
                    expired += 1;
                }
                else {
                    const minutesLeft = Math.round((expires.getTime() - now.getTime()) / 60 / 1000);

                    if (chatty) {
                        console.log(`expiring ${n}/${total} ${did} in ${minutesLeft} minutes`);
                    }
                    verified += 1;
                }
            }
            else {
                if (chatty) {
                    console.log(`verifying ${n}/${total} ${did} OK`);
                }
                this.verifiedDIDs[did] = true;
                verified += 1;
            }
        }

        if (chatty) {
            console.timeEnd('verifyDb');
        }

        return { total, verified, expired, invalid };
    }

    async checkDIDs(options = {}) {
        let { chatty = false, dids } = options;

        if (!dids) {
            dids = await this.getDIDs();
        }

        const total = dids.length;
        let n = 0;
        let agents = 0;
        let assets = 0;
        let confirmed = 0;
        let unconfirmed = 0;
        let ephemeral = 0;
        let invalid = 0;
        const byRegistry = {};
        const byVersion = {};

        for (const did of dids) {
            n += 1;
            try {
                const doc = await this.resolveDID(did);
                if (chatty) {
                    console.log(`resolved ${n}/${total} ${did} OK`);
                }

                if (doc.mdip.type === 'agent') {
                    agents += 1;
                }

                if (doc.mdip.type === 'asset') {
                    assets += 1;
                }

                if (doc.didDocumentMetadata.confirmed) {
                    confirmed += 1;
                }
                else {
                    unconfirmed += 1;
                }

                if (doc.mdip.validUntil) {
                    ephemeral += 1;
                }

                const registry = doc.mdip.registry;
                byRegistry[registry] = (byRegistry[registry] || 0) + 1;

                const version = doc.didDocumentMetadata.version;
                byVersion[version] = (byVersion[version] || 0) + 1;
            }
            catch (error) {
                invalid += 1;
                if (chatty) {
                    console.log(`can't resolve ${n}/${total} ${did} ${error}`);
                }
            }
        }

        const byType = { agents, assets, confirmed, unconfirmed, ephemeral, invalid };
        return { total, byType, byRegistry, byVersion };
    }

    async initRegistries(csvRegistries) {
        if (!csvRegistries) {
            this.supportedRegistries = ValidRegistries;
        }
        else {
            const registries = csvRegistries.split(',').map(registry => registry.trim());
            this.supportedRegistries = [];

            for (const registry of registries) {
                if (ValidRegistries.includes(registry)) {
                    this.supportedRegistries.push(registry);
                }
                else {
                    throw new InvalidParameterError(`registry=${registry}`);
                }
            }
        }

        return this.supportedRegistries;
    }

    async listRegistries() {
        return this.supportedRegistries || ValidRegistries;
    }

    // For testing purposes
    async resetDb() {
        await this.db.resetDb();
        this.verifiedDIDs = {};
    }

    async generateCID(operation) {
        return this.ipfs.add(JSON.parse(canonicalize(operation)));
    }

    async generateDID(operation) {
        const cid = await this.generateCID(operation);
        return `${config.didPrefix}:${cid}`;
    }

    async verifyOperation(operation) {
        try {
            if (operation.type === 'create') {
                return this.verifyCreateOperation(operation);
            }

            if (operation.type === 'update' || operation.type === 'delete') {
                const doc = await this.resolveDID(operation.did);
                return this.verifyUpdateOperation(operation, doc);
            }
        }
        catch (error) {
            return false;
        }
    }

    verifyDIDFormat(did) {
        return did && typeof did === 'string' && did.startsWith('did:');
    }

    verifyDateFormat(time) {
        const date = new Date(time);
        return !isNaN(date.getTime());
    }

    verifyHashFormat(hash) {
        // Check if hash is a hexadecimal string of length 64
        const hex64Regex = /^[a-f0-9]{64}$/i;
        return hex64Regex.test(hash);
    }

    verifySignatureFormat(signature) {
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

    async verifyCreateOperation(operation) {
        if (!operation) {
            throw new InvalidOperationError('missing');
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

            const msgHash = cipher.hashJSON(operationCopy);
            return cipher.verifySig(msgHash, operation.signature.value, operation.publicJwk);
        }

        if (operation.mdip.type === 'asset') {
            if (operation.controller !== operation.signature?.signer) {
                throw new InvalidOperationError('signer is not controller');
            }

            const doc = await this.resolveDID(operation.signature.signer, { confirm: true, atTime: operation.signature.signed });

            if (doc.mdip.registry === 'local' && operation.mdip.registry !== 'local') {
                throw new InvalidOperationError(`non-local registry=${operation.mdip.registry}`);
            }

            const operationCopy = copyJSON(operation);
            delete operationCopy.signature;
            const msgHash = cipher.hashJSON(operationCopy);
            // TBD select the right key here, not just the first one
            const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
            return cipher.verifySig(msgHash, operation.signature.value, publicJwk);
        }

        throw new InvalidOperationError(`mdip.type=${operation.mdip.type}`);
    }

    async verifyUpdateOperation(operation, doc) {
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
            const controllerDoc = await this.resolveDID(doc.didDocument.controller, { confirm: true, atTime: operation.signature.signed });
            return this.verifyUpdateOperation(operation, controllerDoc);
        }

        if (!doc.didDocument.verificationMethod) {
            throw new InvalidOperationError('doc.didDocument.verificationMethod');
        }

        const signature = operation.signature;
        const jsonCopy = copyJSON(operation);
        delete jsonCopy.signature;
        const msgHash = cipher.hashJSON(jsonCopy);

        if (signature.hash && signature.hash !== msgHash) {
            return false;
        }

        // TBD get the right signature, not just the first one
        const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
        return cipher.verifySig(msgHash, signature.value, publicJwk);
    }

    async createDID(operation) {
        const valid = await this.verifyCreateOperation(operation);

        if (valid) {
            const did = await this.generateDID(operation);
            const ops = await this.exportDID(did);

            // Check to see if we already have this DID in the db
            if (ops.length === 0) {
                await this.db.addEvent(did, {
                    registry: 'local',
                    time: operation.created,
                    ordinal: 0,
                    operation,
                    did
                });

                // Create events are distributed only by hyperswarm
                // (because the DID's registry specifies where to look for *update* events)
                // Don't distribute local DIDs
                if (operation.mdip.registry !== 'local') {
                    await this.db.queueOperation('hyperswarm', operation);
                }
            }

            return did;
        }
        else {
            throw new InvalidOperationError('signature');
        }
    }

    async generateDoc(anchor) {
        let doc = {};
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

            const did = await this.generateDID(anchor);

            if (anchor.mdip.type === 'agent') {
                // TBD support different key types?
                doc = {
                    "@context": "https://w3id.org/did-resolution/v1",
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
                    "@context": "https://w3id.org/did-resolution/v1",
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
        }
        catch (error) {
            // console.error(error);
        }

        return doc;
    }

    async resolveDID(did, options = {}) {
        const { atTime, atVersion, confirm = false, verify = false } = options;

        const events = await this.db.getEvents(did);

        if (events.length === 0) {
            throw new InvalidDIDError();
        }

        const anchor = events[0];
        let doc = await this.generateDoc(anchor.operation);

        if (atTime && new Date(doc.mdip.created) > new Date(atTime)) {
            // TBD What to return if DID was created after specified time?
        }

        let version = 1; // initial version is version 1 by definition
        let confirmed = true; // create event is always confirmed by definition

        doc.didDocumentMetadata.version = version;
        doc.didDocumentMetadata.confirmed = confirmed;

        for (const { time, operation, registry, blockchain } of events) {
            const opid = await this.generateCID(operation);

            if (operation.type === 'create') {
                if (verify) {
                    const valid = await this.verifyCreateOperation(operation);

                    if (!valid) {
                        throw new InvalidOperationError('signature');
                    }
                }
                doc.mdip.opid = opid;
                continue;
            }

            if (atTime && new Date(time) > new Date(atTime)) {
                break;
            }

            if (atVersion && version === atVersion) {
                break;
            }

            confirmed = confirmed && doc.mdip.registry === registry;

            if (confirm && !confirmed) {
                break;
            }

            if (verify) {
                const valid = await this.verifyUpdateOperation(operation, doc);

                if (!valid) {
                    throw new InvalidOperationError('signature');
                }

                // TEMP during did:test, operation.previd is optional
                if (operation.previd && operation.previd !== doc.mdip.opid) {
                    throw new InvalidOperationError('previd');
                }
            }

            if (operation.type === 'update') {
                // Increment version
                version += 1;

                // TBD if registry change in operation.doc.didDocumentMetadata.mdip,
                // fetch updates from new registry and search for same operation
                doc = operation.doc;
                doc.didDocumentMetadata.updated = time;
                doc.didDocumentMetadata.version = version;
                doc.didDocumentMetadata.confirmed = confirmed;
                doc.mdip.opid = opid;

                if (blockchain) {
                    doc.mdip.registration = blockchain;
                }
                else {
                    delete doc.mdip.registration;
                }
            }
            else if (operation.type === 'delete') {
                doc.didDocument = {};
                doc.didDocumentData = {};
                doc.didDocumentMetadata.deactivated = true;
                doc.didDocumentMetadata.deleted = time;
                doc.didDocumentMetadata.confirmed = confirmed;
                doc.mdip.opid = opid;

                if (blockchain) {
                    doc.mdip.registration = blockchain;
                }
                else {
                    delete doc.mdip.registration;
                }
            }
            else {
                if (verify) {
                    throw new InvalidOperationError('signature');
                }

                // console.error(`unknown type ${operation.type}`);
            }
        }

        return copyJSON(doc);
    }

    async updateDID(operation) {
        const doc = await this.resolveDID(operation.did);
        const updateValid = await this.verifyUpdateOperation(operation, doc);

        if (!updateValid) {
            return false;
        }

        const registry = doc.mdip.registry;

        await this.db.addEvent(operation.did, {
            registry: 'local',
            time: operation.signature.signed,
            ordinal: 0,
            operation,
            did: operation.did
        });

        if (registry === 'local') {
            return true;
        }

        await this.db.queueOperation(registry, operation);

        if (registry !== 'hyperswarm') {
            await this.db.queueOperation('hyperswarm', operation);
        }

        return true;
    }

    async deleteDID(operation) {
        return this.updateDID(operation);
    }

    async getDIDs(options = {}) {
        let { dids, updatedAfter, updatedBefore, confirm, verify, resolve } = options;
        if (!dids) {
            const keys = await this.db.getAllKeys();
            dids = keys.map(key => `${config.didPrefix}:${key}`);
        }

        if (updatedAfter || updatedBefore || resolve) {
            const start = updatedAfter ? new Date(updatedAfter) : null;
            const end = updatedBefore ? new Date(updatedBefore) : null;
            const response = [];

            for (const did of dids) {
                const doc = await this.resolveDID(did, { confirm, verify });
                const updated = new Date(doc.didDocumentMetadata.updated || doc.didDocumentMetadata.created);

                if (start && updated <= start) {
                    continue;
                }

                if (end && updated >= end) {
                    continue;
                }

                response.push(resolve ? doc : did);
            }

            return response;
        }

        return dids;
    }

    async exportDID(did) {
        return this.db.getEvents(did);
    }

    async exportDIDs(dids) {
        if (!dids) {
            dids = await this.getDIDs();
        }

        const batch = [];

        for (const did of dids) {
            batch.push(await this.exportDID(did));
        }

        return batch;
    }

    async importDIDs(dids) {
        return this.importBatch(dids.flat());
    }

    async removeDIDs(dids) {
        if (!Array.isArray(dids)) {
            throw new InvalidParameterError('dids');
        }

        for (const did of dids) {
            await this.db.deleteEvents(did);
        }

        return true;
    }

    async importEvent(event) {
        if (!event.did) {
            if (event.operation.did) {
                event.did = event.operation.did;
            }
            else {
                event.did = await this.generateDID(event.operation);
            }
        }

        const did = event.did;
        const currentEvents = await this.db.getEvents(did);

        const match = currentEvents.find(item => item.operation.signature.value === event.operation.signature.value);

        if (match) {
            const first = currentEvents[0];
            const nativeRegistry = first.operation.mdip.registry;

            if (match.registry === nativeRegistry) {
                // If this event is already confirmed on the native registry, no need to update
                return false;
            }

            if (event.registry === nativeRegistry) {
                // If this import is on the native registry, replace the current one
                const index = currentEvents.indexOf(match);
                currentEvents[index] = event;
                await this.db.setEvents(did, currentEvents);
                return true;
            }

            return false;
        }
        else {
            const ok = await this.verifyOperation(event.operation);

            if (ok) {
                // TEMP during did:test, operation.previd is optional
                if (currentEvents.length > 0 && event.operation.previd) {
                    const lastEvent = currentEvents[currentEvents.length - 1];
                    const opid = await this.generateCID(lastEvent.operation);

                    if (opid !== event.operation.previd) {
                        throw new InvalidOperationError('previd');
                    }
                }

                await this.db.addEvent(did, event);
                return true;
            }
            else {
                throw new InvalidOperationError('signature');
            }
        }
    }

    async importEvents() {
        let tempQueue = this.eventsQueue;
        const total = tempQueue.length;
        let event = tempQueue.shift();
        let i = 0;
        let added = 0;
        let merged = 0;

        this.eventsQueue = [];

        while (event) {
            //console.time('importEvent');
            i += 1;
            try {
                const imported = await this.importEvent(event);

                if (imported) {
                    added += 1;
                    console.log(`import ${i}/${total}: added event for ${event.did}`);
                }
                else {
                    merged += 1;
                    console.log(`import ${i}/${total}: merged event for ${event.did}`);
                }
            }
            catch (error) {
                this.eventsQueue.push(event);
                console.log(`import ${i}/${total}: deferred event for ${event.did}`);
            }
            //console.timeEnd('importEvent');
            event = tempQueue.shift();
        }

        return { added, merged };
    }

    async processEvents() {
        if (this.isProcessingEvents) {
            return { busy: true };
        }

        let added = 0;
        let merged = 0;
        let done = false;

        try {
            this.isProcessingEvents = true;

            while (!done) {
                //console.time('importEvents');
                const response = await this.importEvents();
                //console.timeEnd('importEvents');

                added += response.added;
                merged += response.merged;

                done = (response.added === 0 && response.merged === 0);
            }
        }
        catch (error) {
            console.log(error);
        }
        finally {
            this.isProcessingEvents = false;
        }

        //console.log(JSON.stringify(eventsQueue, null, 4));
        const pending = this.eventsQueue.length;
        const response = { added, merged, pending };

        console.log(`processEvents: ${JSON.stringify(response)}`);

        return response;
    }

    async verifyEvent(event) {
        if (!event.registry || !event.time || !event.operation) {
            return false;
        }

        const eventTime = new Date(event.time).getTime();

        if (isNaN(eventTime)) {
            return false;
        }

        const operation = event.operation;

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

    async importBatch(batch) {
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
                const eventKey = `${event.registry}/${event.operation.signature.hash}`;
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

    async exportBatch(dids) {
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
        return events.sort((a, b) => new Date(a.operation.signature.signed) - new Date(b.operation.signature.signed));
    }

    async getQueue(registry) {
        if (!ValidRegistries.includes(registry)) {
            throw new InvalidParameterError(`registry=${registry}`);
        }

        return this.db.getQueue(registry);
    }

    async clearQueue(registry, events) {
        if (!ValidRegistries.includes(registry)) {
            throw new InvalidParameterError(`registry=${registry}`);
        }

        return this.db.clearQueue(registry, events);
    }
}
