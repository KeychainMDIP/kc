import { json } from '@helia/json';
import { base58btc } from 'multiformats/bases/base58';
import canonicalize from 'canonicalize';
import { createHelia } from 'helia';
import * as cipher from '@macterra/cipher';
import * as exceptions from '@macterra/exceptions';
import config from './config.js';

const validVersions = [1];
const validTypes = ['agent', 'asset'];
const validRegistries = ['local', 'hyperswarm', 'TESS', 'TBTC', 'TFTC'];
let supportedRegistries = null;

let db = null;
let helia = null;
let ipfs = null;
let eventsCache = {};

export function copyJSON(json) {
    return JSON.parse(JSON.stringify(json))
}

export async function start(injectedDb) {
    if (!ipfs) {
        helia = await createHelia();
        ipfs = json(helia);
    }

    db = injectedDb;
}

export async function stop() {
    helia.stop();
    await db.stop();
}

export async function verifyDID(did) {
    await resolveDID(did, { verify: true });
}

export async function verifyDb(chatty = true) {
    if (chatty) {
        console.time('verifyDb');
    }

    const keys = await db.getAllKeys();
    const dids = keys.map(key => `${config.didPrefix}:${key}`);
    let n = 0;
    let invalid = 0;

    // prime the cache
    try {
        const allEvents = await db.getAllEvents();
        for (const key of Object.keys(allEvents)) {
            eventsCache[`${config.didPrefix}:${key}`] = allEvents[key];
        }
    }
    catch (error) {
        if (chatty) {
            console.error(error);
        }
    }

    for (const did of dids) {
        n += 1;
        try {
            await verifyDID(did);
            if (chatty) {
                console.log(`${n} ${did} OK`);
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

async function verifyCreateAgent(operation) {
    if (!operation.signature) {
        throw new Error(exceptions.INVALID_OPERATION);
    }

    if (!operation.publicJwk) {
        throw new Error(exceptions.INVALID_OPERATION);
    }

    const operationCopy = copyJSON(operation);
    delete operationCopy.signature;

    const msgHash = cipher.hashJSON(operationCopy);
    return cipher.verifySig(msgHash, operation.signature.value, operation.publicJwk);
}

async function verifyCreateAsset(operation) {
    if (operation.controller !== operation.signature?.signer) {
        throw new Error(exceptions.INVALID_OPERATION);
    }

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

async function verifyCreate(operation) {
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
        return verifyCreateAgent(operation);
    }

    if (operation.mdip.type === 'asset') {
        return verifyCreateAsset(operation);
    }

    throw new Error(exceptions.INVALID_OPERATION);
}

export async function createDID(operation) {
    const valid = await verifyCreate(operation);

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

async function verifyUpdate(operation, doc) {

    if (!doc?.didDocument) {
        return false;
    }

    if (doc.didDocument.controller) {
        const controllerDoc = await resolveDID(doc.didDocument.controller, { confirm: true, atTime: operation.signature.signed });
        return verifyUpdate(operation, controllerDoc);
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

    // TBD get the right signature, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    return cipher.verifySig(msgHash, signature.value, publicJwk);
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

export async function resolveDID(did, { atTime, atVersion, confirm, verify } = {}) {
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
            const valid = await verifyUpdate(operation, doc);

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
        const updateValid = await verifyUpdate(operation, doc);

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

async function importCreateEvent(event) {
    try {
        const valid = await verifyCreate(event.operation);

        if (valid) {
            const did = await anchorSeed(event.operation);
            await db.addEvent(did, event);
            return true;
        }

        return false;
    }
    catch {
        return false;
    }
}

async function importUpdateEvent(event) {
    try {
        const did = event.operation.did;
        const doc = await resolveDID(did);
        const updateValid = await verifyUpdate(event.operation, doc);

        if (!updateValid) {
            return false;
        }

        await db.addEvent(did, event);
        return true;
    }
    catch (error) {
        // console.error(error);
        return false;
    }
}

export async function importEvent(event) {

    if (!event.registry || !event.time || !event.operation) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    let did;

    try {
        if (event.operation.type === 'create') {
            did = await anchorSeed(event.operation);
        }
        else {
            did = event.operation.did;
        }

        if (!did) {
            throw new Error(exceptions.INVALID_OPERATION);
        }
    }
    catch {
        throw new Error(exceptions.INVALID_OPERATION);
    }

    const current = await exportDID(did);

    if (current.length === 0) {
        const ok = await importCreateEvent(event);

        if (!ok) {
            throw new Error(exceptions.INVALID_OPERATION);
        }

        return true;
    }

    const create = current[0];
    const registry = create.operation.mdip.registry;
    const match = current.find(item => item.operation.signature.value === event.operation.signature.value);

    if (match) {
        if (match.registry === registry) {
            // Don't update if this op has already been validated on its native registry
            return false;
        }

        if (event.registry === registry) {
            // If this import is on the native registry, replace the current one
            const index = current.indexOf(match);
            current[index] = event;

            db.setEvents(did, current);
            delete eventsCache[did];
            return true;
        }

        return false;
    }

    const ok = await importUpdateEvent(event);

    if (!ok) {
        throw new Error(exceptions.INVALID_OPERATION);
    }

    delete eventsCache[did];

    return true;
}

export async function importBatch(batch) {
    if (!batch || !Array.isArray(batch) || batch.length < 1) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    let verified = 0;
    let updated = 0;
    let failed = 0;

    for (const event of batch) {
        try {
            const imported = await importEvent(event);

            if (imported) {
                updated += 1;
            }
            else {
                verified += 1;
            }
        }
        catch (error) {
            failed += 1;
        }
    }

    return {
        verified: verified,
        updated: updated,
        failed: failed,
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
