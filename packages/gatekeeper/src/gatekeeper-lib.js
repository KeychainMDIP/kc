import { json } from '@helia/json';
import { base58btc } from 'multiformats/bases/base58';
import canonicalize from 'canonicalize';
import { createHelia } from 'helia';
import * as cipher from '@mdip/cipher/node';
import * as exceptions from '@mdip/exceptions';
import config from './config.js';

const validVersions = [1];
const validTypes = ['agent', 'asset'];
// We'll leave TESS here so existing TESS DIDs are not deleted
// Remove TESS when we switch to did:mdip
const validRegistries = ['local', 'hyperswarm', 'TESS', 'TBTC', 'TFTC'];
let supportedRegistries = null;

let db = null;
let helia = null;
let ipfs = null;
let eventsCache = {};
let eventsQueue = [];

export function copyJSON(json) {
    return JSON.parse(JSON.stringify(json))
}

export async function start(options = {}) {
    if (options.db) {
        db = options.db;

        if (options.primeCache) {
            await primeCache();
        }
    }
    else {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    // Only used for unit testing
    if (options.console) {
        // eslint-disable-next-line
        console = options.console;
    }

    if (!ipfs) {
        helia = await createHelia();
        ipfs = json(helia);
    }
}

export async function stop() {
    if (helia) {
        helia.stop();
    }

    if (db) {
        await db.stop();
    }
}

async function primeCache() {
    try {
        const allEvents = await db.getAllEvents();
        for (const key of Object.keys(allEvents)) {
            eventsCache[`${config.didPrefix}:${key}`] = allEvents[key];
        }
    }
    catch (error) {
    }
}

export async function verifyDID(did) {
    const doc = await resolveDID(did, { verify: true });
    const isoDate = doc?.mdip?.validUntil;

    if (isoDate) {
        const validUntil = new Date(isoDate);
        const now = new Date();

        // Check if validUntil is a valid date
        if (isNaN(validUntil.getTime())) {
            throw new Error(exceptions.INVALID_DID);
        }

        if (validUntil < now) {
            // eslint-disable-next-line
            throw 'Expired';
        }

        const minutesLeft = Math.round((validUntil.getTime() - now.getTime()) / 60 / 1000);
        return `Expires in ${minutesLeft} minutes`;
    }

    return "OK";
}

export async function verifyDb(chatty = true) {
    if (chatty) {
        console.time('verifyDb');
    }

    const keys = await db.getAllKeys();
    const dids = keys.map(key => `${config.didPrefix}:${key}`);
    let n = 0;
    let invalid = 0;

    for (const did of dids) {
        n += 1;
        try {
            const status = await verifyDID(did);
            if (chatty) {
                console.log(`${n} ${did} ${status}`);
            }
        }
        catch (error) {
            if (chatty) {
                console.log(`${n} ${did} ${error}`);
            }
            invalid += 1;
            await db.deleteEvents(did);
            delete eventsCache[did];
        }
    }

    if (chatty) {
        console.timeEnd('verifyDb');
    }

    return invalid;
}

export async function initRegistries(csvRegistries) {
    if (!csvRegistries) {
        supportedRegistries = validRegistries;
    }
    else {
        const registries = csvRegistries.split(',').map(registry => registry.trim());
        supportedRegistries = [];

        for (const registry of registries) {
            if (validRegistries.includes(registry)) {
                supportedRegistries.push(registry);
            }
            else {
                throw new Error(exceptions.INVALID_REGISTRY);
            }
        }
    }

    return supportedRegistries;
}

export async function listRegistries() {
    return supportedRegistries || validRegistries;
}

// For testing purposes
export async function resetDb() {
    await db.resetDb();
    eventsCache = {};
}

export async function anchorSeed(seed) {
    const cid = await ipfs.add(JSON.parse(canonicalize(seed)));
    return `${config.didPrefix}:${cid.toString(base58btc)}`;
}

async function verifyCreateAgent(operation, verifySig) {
    if (!operation.signature) {
        throw new Error(exceptions.INVALID_OPERATION);
    }

    if (!operation.publicJwk) {
        throw new Error(exceptions.INVALID_OPERATION);
    }

    if (verifySig) {
        const operationCopy = copyJSON(operation);
        delete operationCopy.signature;

        const msgHash = cipher.hashJSON(operationCopy);
        return cipher.verifySig(msgHash, operation.signature.value, operation.publicJwk);
    }

    return true;
}

async function verifyCreateAsset(operation, verifySig) {
    if (operation.controller !== operation.signature?.signer) {
        throw new Error(exceptions.INVALID_OPERATION);
    }

    if (verifySig) {
        const doc = await resolveDID(operation.signature.signer, { confirm: true, atTime: operation.signature.signed });

        if (doc.mdip.registry === 'local' && operation.mdip.registry !== 'local') {
            throw new Error(exceptions.INVALID_REGISTRY);
        }

        const operationCopy = copyJSON(operation);
        delete operationCopy.signature;
        const msgHash = cipher.hashJSON(operationCopy);
        // TBD select the right key here, not just the first one
        const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
        return cipher.verifySig(msgHash, operation.signature.value, publicJwk);
    }

    return true;
}

async function verifyOperation(operation) {
    try {
        if (operation.type === 'create') {
            return verifyCreateOperation(operation, { verifySig: true });
        }

        if (operation.type === 'update' || operation.type === 'delete') {
            const doc = await resolveDID(operation.did);
            return verifyUpdateOperation(operation, doc, { verifySig: true });
        }
    }
    catch (error) {
        return false;
    }
}

async function verifyCreateOperation(operation, options) {
    const { verifySig } = options;

    if (operation?.type !== "create") {
        throw new Error(exceptions.INVALID_OPERATION);
    }

    if (!operation.created) {
        // TBD ensure valid timestamp format
        throw new Error(exceptions.INVALID_OPERATION);
    }

    if (!operation.mdip) {
        throw new Error(exceptions.INVALID_OPERATION);
    }

    if (!validVersions.includes(operation.mdip.version)) {
        throw new Error(exceptions.INVALID_VERSION);
    }

    if (!validTypes.includes(operation.mdip.type)) {
        throw new Error(exceptions.INVALID_TYPE);
    }

    if (!validRegistries.includes(operation.mdip.registry)) {
        throw new Error(exceptions.INVALID_REGISTRY);
    }

    if (operation.mdip.type === 'agent') {
        return verifyCreateAgent(operation, verifySig);
    }

    if (operation.mdip.type === 'asset') {
        return verifyCreateAsset(operation, verifySig);
    }

    throw new Error(exceptions.INVALID_OPERATION);
}

export async function createDID(operation) {
    const valid = await verifyCreateOperation(operation, { verifySig: true });

    if (valid) {
        const did = await anchorSeed(operation);
        const ops = await exportDID(did);

        // Check to see if we already have this DID in the db
        if (ops.length === 0) {
            await db.addEvent(did, {
                registry: 'local',
                time: operation.created,
                ordinal: 0,
                operation: operation
            });

            // Create events are distributed only by hyperswarm
            // (because the DID's registry specifies where to look for *update* events)
            // Don't distribute local DIDs
            if (operation.mdip.registry !== 'local') {
                await db.queueOperation('hyperswarm', operation);
            }
        }

        return did;
    }
    else {
        throw new Error(exceptions.INVALID_OPERATION);
    }
}

export async function generateDoc(anchor) {
    let doc = {};
    try {
        if (!anchor?.mdip) {
            return {};
        }

        if (!validVersions.includes(anchor.mdip.version)) {
            return {};
        }

        if (!validTypes.includes(anchor.mdip.type)) {
            return {};
        }

        if (!validRegistries.includes(anchor.mdip.registry)) {
            return {};
        }

        const did = await anchorSeed(anchor);

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

async function verifyUpdateOperation(operation, doc, options) {
    const { verifySig } = options;

    if (!doc?.didDocument) {
        return false;
    }

    if (doc.didDocument.controller) {
        // This DID is an asset, verify with controller's keys
        const controllerDoc = await resolveDID(doc.didDocument.controller, { confirm: true, atTime: operation.signature.signed });
        return verifyUpdateOperation(operation, controllerDoc, options);
    }

    if (!doc.didDocument.verificationMethod) {
        return false;
    }

    const jsonCopy = copyJSON(operation);

    const signature = jsonCopy.signature;
    delete jsonCopy.signature;
    const msgHash = cipher.hashJSON(jsonCopy);

    if (signature.hash && signature.hash !== msgHash) {
        return false;
    }

    if (verifySig) {
        // TBD get the right signature, not just the first one
        const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
        return cipher.verifySig(msgHash, signature.value, publicJwk);
    }

    return true;
}

async function getEvents(did) {
    let events = eventsCache[did];

    if (!events) {
        events = await db.getEvents(did);

        if (events.length > 0) {
            eventsCache[did] = events;
        }
    }

    return copyJSON(events);
}

export async function resolveDID(did, options = {}) {
    const { atTime, atVersion, confirm, verify } = options;
    const events = await getEvents(did);

    if (events.length === 0) {
        throw new Error(exceptions.INVALID_DID);
    }

    const anchor = events[0];
    let doc = await generateDoc(anchor.operation);
    let mdip = doc?.mdip;

    if (!mdip) {
        throw new Error(exceptions.INVALID_DID);
    }

    if (atTime && new Date(mdip.created) > new Date(atTime)) {
        // TBD What to return if DID was created after specified time?
    }

    let version = 1; // initial version is version 1 by definition
    let confirmed = true; // create event is always confirmed by definition

    doc.didDocumentMetadata.version = version;
    doc.didDocumentMetadata.confirmed = confirmed;

    for (const { time, operation, registry, blockchain } of events) {
        if (operation.type === 'create') {
            continue;
        }

        if (atTime && new Date(time) > new Date(atTime)) {
            break;
        }

        confirmed = confirmed && mdip.registry === registry;

        if (confirm && !confirmed) {
            break;
        }

        if (verify) {
            const valid = await verifyUpdateOperation(operation, doc, { verifySig: true });

            if (!valid) {
                throw new Error(exceptions.INVALID_OPERATION);
            }
        }

        if (operation.type === 'update') {
            // Increment version
            version += 1;

            // Maintain mdip metadata across versions
            mdip = doc.mdip;

            // TBD if registry change in operation.doc.didDocumentMetadata.mdip,
            // fetch updates from new registry and search for same operation
            doc = operation.doc;
            doc.didDocumentMetadata.updated = time;
            doc.didDocumentMetadata.version = version;
            doc.didDocumentMetadata.confirmed = confirmed;
            doc.mdip = mdip;

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
        }
        else {
            if (verify) {
                throw new Error(exceptions.INVALID_OPERATION);
            }

            // console.error(`unknown type ${operation.type}`);
        }

        if (atVersion && version === atVersion) {
            break;
        }
    }

    return copyJSON(doc);
}

export async function updateDID(operation) {
    try {
        const doc = await resolveDID(operation.did);
        const updateValid = await verifyUpdateOperation(operation, doc, { verifySig: true });

        if (!updateValid) {
            return false;
        }

        const registry = doc.mdip.registry;

        await db.addEvent(operation.did, {
            registry: 'local',
            time: operation.signature.signed,
            ordinal: 0,
            operation: operation
        });

        delete eventsCache[operation.did];

        if (registry === 'local') {
            return true;
        }

        await db.queueOperation(registry, operation);

        if (registry !== 'hyperswarm') {
            await db.queueOperation('hyperswarm', operation);
        }

        return true;
    }
    catch (error) {
        // console.error(error);
        return false;
    }
}

export async function deleteDID(operation) {
    return updateDID(operation);
}

export async function getDIDs({ dids, updatedAfter, updatedBefore, confirm, resolve } = {}) {
    if (!dids) {
        const keys = await db.getAllKeys();
        dids = keys.map(key => `${config.didPrefix}:${key}`);
    }

    if (updatedAfter || updatedBefore || resolve) {
        const start = updatedAfter ? new Date(updatedAfter) : null;
        const end = updatedBefore ? new Date(updatedBefore) : null;
        const response = [];

        for (const did of dids) {
            const doc = await resolveDID(did, { confirm: confirm });
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

export async function exportDID(did) {
    return getEvents(did);
}

export async function exportDIDs(dids) {
    if (!dids) {
        dids = await getDIDs();
    }

    const batch = [];

    for (const did of dids) {
        batch.push(await exportDID(did));
    }

    return batch;
}

export async function importDIDs(dids) {
    return importBatch(dids.flat());
}

export async function removeDIDs(dids) {
    if (!Array.isArray(dids)) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    for (const did of dids) {
        await db.deleteEvents(did);
        delete eventsCache[did];
    }

    return true;
}

async function importEvent(event) {
    const did = event.did;
    const currentEvents = await db.getEvents(did);
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
            await db.setEvents(did, currentEvents);
            delete eventsCache[did];
            return true;
        }

        return false;
    }
    else {
        const ok = await verifyOperation(event.operation);

        if (ok) {
            db.addEvent(did, event);
            return true;
        }
        else {
            throw new Error(exceptions.INVALID_OPERATION);
        }
    }
}

export async function getEventsQueue() {
    return eventsQueue;
}

export async function processEvents() {
    const newQueue = [];
    let imported = 0;
    let deferred = 0;
    let event = eventsQueue.shift();

    while (event) {
        console.time('importEvent');
        try {
            await importEvent(event);
            imported += 1;
            console.log(`imported event for ${event.did}`);
        }
        catch (error) {
            newQueue.push(event);
            deferred += 1;
            console.log(`deferred event for ${event.did}`);

        }
        console.timeEnd('importEvent');
        event = eventsQueue.shift();
    }

    eventsQueue = newQueue;
    await primeCache();

    return { imported, deferred };
}

export async function verifyEvent(event) {
    let did;

    if (!event.registry || !event.time || !event.operation) {
        return { ok: false };
    }

    const eventTime = new Date(event.time).getTime();

    if (isNaN(eventTime)) {
        return { ok: false };
    }

    const operation = event.operation;

    if (!operation.signature?.value) {
        return { ok: false };
    }

    if (operation.type === 'create') {
        if (!operation.created) {
            return { ok: false };
        }

        if (!operation.mdip) {
            return { ok: false };
        }

        if (!validVersions.includes(operation.mdip.version)) {
            return { ok: false };
        }

        if (!validTypes.includes(operation.mdip.type)) {
            return { ok: false };
        }

        if (!validRegistries.includes(operation.mdip.registry)) {
            return { ok: false };
        }

        if (operation.mdip.type === 'agent') {
            if (!operation.signature) {
                return { ok: false };
            }

            if (!operation.publicJwk) {
                return { ok: false };
            }
        }

        // eslint-disable-next-line
        if (operation.mdip.type === 'asset') {
            if (operation.controller !== operation.signature?.signer) {
                return { ok: false };
            }
        }

        console.time('anchorSeed');
        did = await anchorSeed(event.operation);
        console.timeEnd('anchorSeed');
    }
    else if (operation.type === 'update') {
        const doc = operation.doc;

        if (!doc || !doc.didDocument || !doc.didDocumentMetadata || !doc.didDocumentData || !doc.mdip) {
            return { ok: false };
        }

        did = operation.did;
    }
    else if (operation.type === 'delete') {
        did = operation.did;
    }
    else {
        return { ok: false };
    }

    if (!did) {
        return { ok: false };
    }

    event.did = did;

    return { ok: true, did };
}

export async function importBatch(batch) {
    if (!batch || !Array.isArray(batch) || batch.length < 1) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    let queued = 0;
    let rejected = 0;

    for (let i = 0; i < batch.length; i++) {
        const event = batch[i];
        console.time('verifyEvent');
        const { ok, did } = await verifyEvent(event);
        console.timeEnd('verifyEvent');

        if (ok) {
            eventsQueue.push(event);
            queued += 1;
        }
        else {
            rejected += 1;
        }
    }

    //console.log(JSON.stringify({ updated, verified, failed }, null, 4));

    return {
        queued,
        rejected
    };
}

export async function exportBatch(dids) {
    const allDIDs = await exportDIDs(dids);
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

export async function getQueue(registry) {
    if (!validRegistries.includes(registry)) {
        throw new Error(exceptions.INVALID_REGISTRY);
    }

    return db.getQueue(registry);
}

export async function clearQueue(registry, events) {
    if (!validRegistries.includes(registry)) {
        throw new Error(exceptions.INVALID_REGISTRY);
    }

    return db.clearQueue(registry, events);
}
