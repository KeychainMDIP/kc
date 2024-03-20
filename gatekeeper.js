import { json } from '@helia/json';
import { base58btc } from 'multiformats/bases/base58';
import fs from 'fs';
import canonicalize from 'canonicalize';
import { createHelia } from 'helia';
import { FsBlockstore } from 'blockstore-fs';
import { performance } from 'perf_hooks';

import * as cipher from './cipher.js';

const dataFolder = 'data';
export const dbName = `${dataFolder}/mdip.json`;

const validVersions = [1];
const validTypes = ['agent', 'asset'];
const validRegistries = ['peerbit', 'BTC', 'tBTC', 'local', 'hyperswarm'];

export function loadDb() {
    if (fs.existsSync(dbName)) {
        return JSON.parse(fs.readFileSync(dbName));
    }
    else {
        return {}
    }
}

export function writeDb(db) {
    if (!fs.existsSync(dataFolder)) {
        fs.mkdirSync(dataFolder, { recursive: true });
    }

    fs.writeFileSync(dbName, JSON.stringify(db, null, 4));
}

export async function verifyDb() {
    const db = loadDb();

    if (!db.anchors) {
        return 0;
    }

    const dids = Object.keys(db.anchors);
    let n = 0;
    let invalid = 0;

    for (const did of dids) {
        n += 1;
        try {
            const doc = await resolveDID(did, null, true);
            console.log(`${n} ${did} OK`);
        }
        catch (error) {
            console.log(`${n} ${did} ${error}`);
            invalid += 1;
        }
    }

    return invalid;
}

let helia = null;
let ipfs = null;

export async function start() {
    if (!ipfs) {
        const blockstore = new FsBlockstore(`${dataFolder}/ipfs`);
        //helia = await createHelia({ blockstore });
        helia = await createHelia();
        ipfs = json(helia);
    }
}

export async function stop() {
    helia.stop();
}

function submitTxn(did, registry, operation, time, ordinal = 0) {
    const db = loadDb();

    const update = {
        time: time,
        ordinal: ordinal,
        did: did,
        operation: operation,
    };

    if (!db.hasOwnProperty(registry)) {
        db[registry] = {};
    }

    if (db[registry].hasOwnProperty(did)) {
        db[registry][did].push(update);
    }
    else {
        db[registry][did] = [update];
    }

    writeDb(db);
}

export async function anchorSeed(seed) {
    // let t0, t1;

    // t0 = performance.now();
    // const cid = await ipfs.add(JSON.parse(canonicalize(seed)));
    // t1 = performance.now();
    // console.log("Adding seed to IPFS took " + (t1 - t0) + " milliseconds.");

    const cid = await ipfs.add(JSON.parse(canonicalize(seed)));
    const did = `did:mdip:${cid.toString(base58btc)}`;
    const db = loadDb();

    if (!db.anchors) {
        db.anchors = {};
    }

    const anchor = await ipfs.get(cid);
    db.anchors[did] = anchor;

    writeDb(db);
    return did;
}

export async function generateDID(operation) {
    const did = await anchorSeed(operation);
    const ops = await exportDID(did);

    if (ops.length === 0) {
        submitTxn(did, operation.mdip.registry, operation, operation.created);
    }

    return did;
}

async function createAgent(operation) {
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

    if (!isValid) {
        throw "Invalid operation";
    }

    return generateDID(operation);
}

async function createAsset(operation) {
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

    if (!isValid) {
        throw "Invalid operation";
    }

    return generateDID(operation);
}

export async function createDID(operation) {
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
        return createAgent(operation);
    }

    if (operation.mdip.type === 'asset') {
        return createAsset(operation);
    }

    throw "Unknown type";
}

async function getAnchor(did) {
    // const suffix = did.split(':').pop(); // everything after "did:mdip:"
    // const cid = CID.parse(suffix);
    // const docSeed = await ipfs.get(cid);

    const db = loadDb();
    const docSeed = db.anchors[did];

    return docSeed;
}

async function generateDoc(did, asofTime) {
    try {
        const anchor = await getAnchor(did);

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
                    "mdip": anchor.mdip,
                },
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
                    "mdip": anchor.mdip,
                    "data": anchor.data,
                },
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

    if (doc.didDocument.verificationMethod) {
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

    return false;
}

export function fetchUpdates(registry, did) {
    const db = loadDb();

    if (db.hasOwnProperty(registry)) {
        if (db[registry].hasOwnProperty(did)) {
            return db[registry][did];
        }
    }

    return [];
}

export async function resolveDID(did, asOfTime = null, verify = false) {
    let doc = await generateDoc(did);
    let mdip = doc?.didDocumentMetadata?.mdip;

    if (!mdip) {
        throw "Invalid DID";
    }

    if (asOfTime && new Date(mdip.created) > new Date(asOfTime)) {
        // TBD What to return if DID was created after specified time?
    }

    const updates = fetchUpdates(mdip.registry, did);

    for (const { time, operation } of updates) {
        if (asOfTime && new Date(time) > new Date(asOfTime)) {
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
            // Maintain mdip metadata across versions
            mdip = doc.didDocumentMetadata.mdip;

            // TBD if registry change in operation.doc.didDocumentMetadata.mdip,
            // fetch updates from new registry and search for same operation
            doc = operation.doc;
            doc.didDocumentMetadata.updated = time;
            doc.didDocumentMetadata.mdip = mdip;
        }
        else if (operation.type === 'delete') {
            doc.didDocument = {};
            doc.didDocumentMetadata.deactivated = true;
            doc.didDocumentMetadata.data = null; // in case of asset
            doc.didDocumentMetadata.updated = time;
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

        const registry = doc.didDocumentMetadata.mdip.registry;

        // TBD figure out time for blockchain registries
        submitTxn(operation.did, registry, operation, operation.signature.signed);
        return true;
    }
    catch (error) {
        console.error(error);
        return false;
    }
}

export async function deleteDID(operation) {
    return updateDID(operation);
}

export async function exportDID(did) {
    const doc = await generateDoc(did);
    const registry = doc?.didDocumentMetadata?.mdip?.registry;

    if (!registry) {
        return [];
    }

    return fetchUpdates(registry, did);
}

export async function importDID(ops) {

    if (!ops || !Array.isArray(ops) || ops.length < 1) {
        throw "Invalid import";
    }

    const create = ops[0];
    const did = create.did;
    const current = await exportDID(did);

    if (current.length === 0) {
        const check = await createDID(create.operation);

        if (did !== check) {
            throw "Invalid import";
        }
    }
    else {
        if (create.operation.signature.value !== current[0].operation.signature.value) {
            throw "Invalid import";
        }
    }

    for (let i = 1; i < ops.length; i++) {
        if (i < current.length) {
            // Verify previous update ops
            if (ops[i].operation.signature.value !== current[i].operation.signature.value) {
                throw "Invalid import";
            }
        }
        else {
            // Add new updates
            const ok = await updateDID(ops[i].operation);

            if (!ok) {
                throw "Invalid import";
            }
        }
    }

    const after = await exportDID(did);
    const diff = after.length - current.length;

    return diff;
}

export async function mergeBatch(batch) {
    let verified = 0;
    let updated = 0;
    let failed = 0;

    for (const ops of batch) {
        try {
            const diff = await importDID(ops);

            if (diff > 0) {
                updated += 1;
            }
            else {
                verified += 1;
            }
        }
        catch {
            failed += 1;
        }
    }

    return {
        verified: verified,
        updated: updated,
        failed: failed,
    };
}
