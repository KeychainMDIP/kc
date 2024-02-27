import { json } from '@helia/json';
import { CID } from 'multiformats/cid';
import { base58btc } from 'multiformats/bases/base58';
import fs from 'fs';
import canonicalize from 'canonicalize';
import { createHelia } from 'helia';
import { FsBlockstore } from 'blockstore-fs';
import * as cipher from './cipher.js';

const dbName = 'mdip.json';

const validVersions = [1];
const validTypes = ['agent', 'asset'];
const validRegistries = ['peerbit', 'BTC', 'tBTC', 'local', 'hyperswarm'];

function loadDb() {
    if (fs.existsSync(dbName)) {
        return JSON.parse(fs.readFileSync(dbName));
    }
    else {
        return {}
    }
}

function writeDb(db) {
    fs.writeFileSync(dbName, JSON.stringify(db, null, 4));
}

let helia = null;
let ipfs = null;

export async function start() {
    if (!ipfs) {
        const blockstore = new FsBlockstore('./ipfs');
        helia = await createHelia({ blockstore });
        ipfs = json(helia);
    }
}

export async function stop() {
    helia.stop();
}

function submitTxn(did, registry, txn, time) {
    const db = loadDb();

    if (!time) {
        time = new Date().toISOString();
    }

    const update = {
        time: time,
        did: did,
        txn: txn,
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

export async function generateDID(txn) {
    const now = new Date();
    let created = now.toISOString();

    // If a created date is supplied in the txn and it is in the past, use it
    if (txn.created) {
        const txnCreated = new Date(txn.created);
        if (txnCreated < now) {
            created = txn.created;
        }
    }

    const seed = {
        anchor: txn,
        created: created,
    };

    const did = await anchorSeed(seed);

    submitTxn(did, txn.mdip.registry, txn, seed.created);

    return did;
}

async function createAgent(txn) {
    if (!txn.signature) {
        throw "Invalid txn";
    }

    if (!txn.publicJwk) {
        throw "Invalid txn";
    }

    const txnCopy = JSON.parse(JSON.stringify(txn));
    delete txnCopy.signature;

    const msgHash = cipher.hashJSON(txnCopy);
    const isValid = cipher.verifySig(msgHash, txn.signature, txn.publicJwk);

    if (!isValid) {
        throw "Invalid txn";
    }

    return generateDID(txn);
}

async function createAsset(txn) {
    if (txn.controller !== txn.signature.signer) {
        throw "Invalid txn";
    }

    const doc = await resolveDID(txn.controller);
    const txnCopy = JSON.parse(JSON.stringify(txn));
    delete txnCopy.signature;
    const msgHash = cipher.hashJSON(txnCopy);
    // TBD select the right key here, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const isValid = cipher.verifySig(msgHash, txn.signature.value, publicJwk);

    if (!isValid) {
        throw "Invalid txn";
    }

    return generateDID(txn);
}

export async function createDID(txn) {
    if (txn?.op !== "create") {
        throw "Invalid txn";
    }

    if (!txn.mdip) {
        throw "Invalid txn";
    }

    if (!validVersions.includes(txn.mdip.version)) {
        throw `Valid versions include: ${validVersions}`;
    }

    if (!validTypes.includes(txn.mdip.type)) {
        throw `Valid types include: ${validTypes}`;
    }

    if (!validRegistries.includes(txn.mdip.registry)) {
        throw `Valid registries include: ${validRegistries}`;
    }

    if (txn.mdip.type === 'agent') {
        return createAgent(txn);
    }

    if (txn.mdip.type === 'asset') {
        return createAsset(txn);
    }

    throw "Unknown type";
}

async function getDocSeed(did) {
    // const suffix = did.split(':').pop(); // everything after "did:mdip:"
    // const cid = CID.parse(suffix);
    // const docSeed = await ipfs.get(cid);

    const db = loadDb();
    const docSeed = db.anchors[did];

    return docSeed;
}

async function generateDoc(did, asofTime) {
    try {
        const docSeed = await getDocSeed(did);

        if (!docSeed?.anchor?.mdip) {
            return {};
        }

        if (asofTime && new Date(docSeed.created) < new Date(asofTime)) {
            return {}; // DID was not yet created
        }

        const anchor = docSeed.anchor;

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
                    "created": docSeed.created,
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
                    "created": docSeed.created,
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

async function verifyUpdate(txn, doc) {

    if (!doc?.didDocument) {
        return false;
    }

    if (doc.didDocument.controller) {
        const controllerDoc = await resolveDID(doc.didDocument.controller, txn.time);
        return verifyUpdate(txn, controllerDoc);
    }

    if (doc.didDocument.verificationMethod) {
        const jsonCopy = JSON.parse(JSON.stringify(txn));

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

export async function resolveDID(did, asOfTime = null) {
    let doc = await generateDoc(did);
    let mdip = doc?.didDocumentMetadata?.mdip;

    if (!mdip) {
        throw "Invalid DID";
    }

    if (asOfTime && new Date(mdip.created) > new Date(asOfTime)) {
        // TBD What to return if DID was created after specified time?
    }

    const updates = fetchUpdates(mdip.registry, did);

    for (const { time, txn } of updates) {
        if (asOfTime && new Date(time) > new Date(asOfTime)) {
            break;
        }

        if (txn.op === 'create') {
            // Proof-of-existence in the DID's registry
            continue;
        }

        const hash = cipher.hashJSON(doc);

        if (hash !== txn.prev) {
            // hash mismatch
            continue;
        }

        const valid = await verifyUpdate(txn, doc);

        if (!valid) {
            continue;
        }

        if (txn.op === 'update') {
            // Maintain mdip metadata across versions
            mdip = doc.didDocumentMetadata.mdip;

            // TBD if registry change in txn.doc.didDocumentMetadata.mdip,
            // fetch updates from new registry and search for same txn
            doc = txn.doc;
            doc.didDocumentMetadata.updated = time;
            doc.didDocumentMetadata.mdip = mdip;
        }
        else if (txn.op === 'delete') {
            doc.didDocument = {};
            doc.didDocumentMetadata.deactivated = true;
            doc.didDocumentMetadata.data = null; // in case of asset
            doc.didDocumentMetadata.updated = time;
        }
        else {
            console.error(`unknown op ${txn.op}`);
        }
    }

    return doc;
}

export async function updateDID(txn) {
    try {
        const doc = await resolveDID(txn.did);
        const updateValid = await verifyUpdate(txn, doc);

        if (!updateValid) {
            return false;
        }

        const registry = doc.didDocumentMetadata.mdip.registry;

        submitTxn(txn.did, registry, txn);
        return true;
    }
    catch (error) {
        console.error(error);
        return false;
    }
}

export async function deleteDID(txn) {
    return updateDID(txn);
}

export async function exportDID(did) {
    const doc = await generateDoc(did);
    const registry = doc?.didDocumentMetadata?.mdip?.registry;

    if (!registry) {
        throw "Invalid DID";
    }

    return fetchUpdates(registry, did);
}

export async function importDID(txns) {
    const create = txns[0];
    const did = create.did;
    const seed = {
        anchor: create.txn,
        created: create.time,
    };

    // TBD verify creeat txn
    const check = await anchorSeed(seed);

    //console.log(`${did} should be ${check}`);

    if (did !== check) {
        throw "Invalid import";
    }

    // !! Have to loadDb here so we don't overwrite anchorSeed's write
    const db = loadDb();
    const registry = create.txn.mdip.registry;

    if (!db.hasOwnProperty(registry)) {
        db[registry] = {};
    }

    db[registry][did] = txns;
    writeDb(db);

    return did;
}
