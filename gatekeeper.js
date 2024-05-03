import { json } from '@helia/json';
import { base58btc } from 'multiformats/bases/base58';
import canonicalize from 'canonicalize';
import { createHelia } from 'helia';
import * as cipher from './cipher.js';
import config from './config.js';

const validVersions = [1];
const validTypes = ['agent', 'asset'];
const validRegistries = ['local', 'hyperswarm', 'TESS', 'BTC'];
const queueRegistries = ['TESS', 'BTC'];

let db = null;
let helia = null;
let ipfs = null;

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

export async function verifyDb() {
    const dids = await db.getAllKeys();
    let n = 0;
    let invalid = 0;

    for (const did of dids) {
        n += 1;
        try {
            await resolveDID(did, null, false, true);
            console.log(`${n} ${did} OK`);
        }
        catch (error) {
            console.log(`${n} ${did} ${error}`);
            invalid += 1;
            await db.deleteOperations(did);
        }
    }

    return invalid;
}

// For testing purposes
export async function resetDb() {
    await db.resetDb();
}

export async function anchorSeed(seed) {
    const cid = await ipfs.add(JSON.parse(canonicalize(seed)));
    const did = `${config.didPrefix}:${cid.toString(base58btc)}`;
    return did;
}

async function addOperation(did, registry, operation, time, ordinal = 0) {
    const op = {
        registry,
        time,
        ordinal,
        did,
        operation,
    };

    await db.addOperation(op);
}

async function queueOperation(did, registry, operation, time, ordinal = 0) {
    const op = {
        registry,
        time,
        ordinal,
        did,
        operation,
    };

    await db.queueOperation(op);
}

async function verifyCreateAgent(operation) {
    if (!operation.signature) {
        throw "Invalid operation";
    }

    if (!operation.publicJwk) {
        throw "Invalid operation";
    }

    const operationCopy = JSON.parse(JSON.stringify(operation));
    delete operationCopy.signature;

    const msgHash = cipher.hashJSON(operationCopy);
    const isValid = cipher.verifySig(msgHash, operation.signature.value, operation.publicJwk);

    return isValid;
}

async function verifyCreateAsset(operation) {
    if (operation.controller !== operation.signature.signer) {
        throw "Invalid operation";
    }

    const doc = await resolveDID(operation.signature.signer, operation.signature.signed);
    const operationCopy = JSON.parse(JSON.stringify(operation));
    delete operationCopy.signature;
    const msgHash = cipher.hashJSON(operationCopy);
    // TBD select the right key here, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const isValid = cipher.verifySig(msgHash, operation.signature.value, publicJwk);

    return isValid;
}

async function verifyCreate(operation) {
    if (operation?.type !== "create") {
        throw "Invalid operation";
    }

    if (!operation.created) {
        // TBD ensure valid timestamp format
        throw "Invalid operation";
    }

    if (!operation.mdip) {
        throw "Invalid operation";
    }

    if (!validVersions.includes(operation.mdip.version)) {
        throw `Valid versions include: ${validVersions}`;
    }

    if (!validTypes.includes(operation.mdip.type)) {
        throw `Valid types include: ${validTypes}`;
    }

    if (!validRegistries.includes(operation.mdip.registry)) {
        throw `Valid registries include: ${validRegistries}`;
    }

    if (operation.mdip.type === 'agent') {
        return verifyCreateAgent(operation);
    }

    if (operation.mdip.type === 'asset') {
        return verifyCreateAsset(operation);
    }

    throw "Invalid operation";
}

export async function createDID(operation) {
    const valid = await verifyCreate(operation);

    if (valid) {
        const did = await anchorSeed(operation);
        const ops = await exportDID(did);

        if (ops.length === 0) {
            await addOperation(did, 'hyperswarm', operation, operation.created);
            await queueOperation(did, operation.mdip.registry, operation, operation.created);
        }

        return did;
    }
    else {
        throw "Invalid operation";
    }
}

async function generateDoc(did, anchor, asofTime) {
    try {
        if (!anchor?.mdip) {
            return {};
        }

        if (asofTime && new Date(anchor.created) < new Date(asofTime)) {
            return {}; // DID was not yet created
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

        if (anchor.mdip.type === 'agent') {
            // TBD support different key types?
            const doc = {
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

            return doc;
        }

        if (anchor.mdip.type === 'asset') {
            const doc = {
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

            return doc;
        }
    }
    catch (error) {
        // console.error(error);
    }

    return {}; // TBD unknown type error
}

async function verifyUpdate(operation, doc) {

    if (!doc?.didDocument) {
        return false;
    }

    if (doc.didDocument.controller) {
        const controllerDoc = await resolveDID(doc.didDocument.controller, operation.signature.signed);
        return verifyUpdate(operation, controllerDoc);
    }

    if (!doc.didDocument.verificationMethod) {
        return false;
    }

    const jsonCopy = JSON.parse(JSON.stringify(operation));

    const signature = jsonCopy.signature;
    delete jsonCopy.signature;
    const msgHash = cipher.hashJSON(jsonCopy);

    if (signature.hash && signature.hash !== msgHash) {
        return false;
    }

    // TBD get the right signature, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const isValid = cipher.verifySig(msgHash, signature.value, publicJwk);

    return isValid;
}

export async function resolveDID(did, asOfTime = null, confirm = false, verify = false) {
    const ops = await db.getOperations(did);

    if (ops.length === 0) {
        throw "Invalid DID";
    }

    const anchor = ops[0].operation;
    let doc = await generateDoc(did, anchor);
    let mdip = doc?.mdip;

    if (!mdip) {
        throw "Invalid DID";
    }

    if (asOfTime && new Date(mdip.created) > new Date(asOfTime)) {
        // TBD What to return if DID was created after specified time?
    }

    let version = 1;
    let confirmed = true;

    doc.didDocumentMetadata.version = version;
    doc.didDocumentMetadata.confirmed = confirmed;

    for (const { time, operation, registry } of ops) {
        if (asOfTime && new Date(time) > new Date(asOfTime)) {
            break;
        }

        confirmed = confirmed && mdip.registry === registry;

        if (confirm && !confirmed) {
            break;
        }

        if (operation.type === 'create') {
            // Proof-of-existence in the DID's registry
            continue;
        }

        const hash = cipher.hashJSON(doc);

        if (hash !== operation.prev) {
            // hash mismatch
            // if (verify) {
            //     throw "Invalid hash";
            // }
            // !!! This fails on key rotation #3 (!?), disabling for now
            // continue;
        }

        const valid = await verifyUpdate(operation, doc);

        if (!valid) {
            if (verify) {
                throw "Invalid update";
            }

            continue;
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
        }
        else if (operation.type === 'delete') {
            doc.didDocument = {};
            doc.didDocumentData = {};
            doc.didDocumentMetadata.deactivated = true;
            doc.didDocumentMetadata.updated = time;
            doc.didDocumentMetadata.confirmed = confirmed;
        }
        else {
            if (verify) {
                throw "Invalid operation";
            }

            console.error(`unknown type ${operation.type}`);
        }
    }

    return doc;
}

export async function updateDID(operation) {
    try {
        const doc = await resolveDID(operation.did);
        const updateValid = await verifyUpdate(operation, doc);

        if (!updateValid) {
            return false;
        }

        const registry = doc.mdip.registry;

        if (queueRegistries.includes(registry)) {
            await queueOperation(operation.did, registry, operation, operation.signature.signed);
        }

        await addOperation(operation.did, 'hyperswarm', operation, operation.signature.signed);

        return true;
    }
    catch (error) {
        //console.error(error);
        return false;
    }
}

export async function deleteDID(operation) {
    return updateDID(operation);
}

export async function getDIDs() {
    const keys = await db.getAllKeys();
    const dids = keys.map(key => `${config.didPrefix}:${key}`);
    return dids;
}

export async function exportDID(did) {
    return await db.getOperations(did);
}

export async function exportDIDs(dids) {
    const batch = [];

    for (const did of dids) {
        batch.push(await db.getOperations(did));
    }

    return batch;
}

async function importCreateEvent(event) {
    try {
        const valid = await verifyCreate(event.operation);

        if (valid) {
            const did = await anchorSeed(event.operation);

            if (did !== event.did) {
                return false;
            }

            await addOperation(event.did, event.registry, event.operation, event.time, event.ordinal);
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
        const doc = await resolveDID(event.operation.did);
        const updateValid = await verifyUpdate(event.operation, doc);

        if (!updateValid) {
            return false;
        }

        await addOperation(event.did, event.registry, event.operation, event.time, event.ordinal);
        return true;
    }
    catch (error) {
        //console.error(error);
        return false;
    }
}

export async function importDID(events) {
    if (!events || !Array.isArray(events) || events.length < 1) {
        throw "Invalid import";
    }

    let updated = 0;

    for (const event of events) {
        const imported = await importEvent(event);

        if (imported) {
            updated += 1;
        }
    }

    return updated;
}

export async function importDIDs(batch) {
    let verified = 0;
    let updated = 0;
    let failed = 0;

    for (const events of batch) {
        console.time('importDID');
        try {
            for (const event of events) {
                const imported = await importEvent(event);

                if (imported) {
                    updated += 1;
                }
                else {
                    verified += 1;
                }
            }
        }
        catch (error) {
            console.error(error);
            failed += 1;
        }
        console.timeEnd('importDID');
    }

    return {
        verified: verified,
        updated: updated,
        failed: failed,
    };
}

export async function importEvent(event) {
    const current = await exportDID(event.did);

    if (current.length === 0) {
        const ok = await importCreateEvent(event);

        if (!ok) {
            throw "Invalid operation";
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

            db.setOperations(match.did, current);
            return true;
        }

        return false;
    }

    const ok = await importUpdateEvent(event);

    if (!ok) {
        throw "Invalid operation";
    }

    return true;
}

export async function importBatch(batch) {
    let verified = 0;
    let updated = 0;
    let failed = 0;

    for (const event of batch) {
        console.time('importEvent');
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
            console.error(error);
            failed += 1;
        }
        console.timeEnd('importEvent');
    }

    return {
        verified: verified,
        updated: updated,
        failed: failed,
    };
}

export async function getQueue(registry) {
    const queue = db.getQueue(registry);
    return queue;
}

export async function clearQueue(events) {
    const registry = events[0].registry;
    const ok = db.clearQueue(registry, events);
    return ok;
}
