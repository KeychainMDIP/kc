import { createHelia } from 'helia';
import { json } from '@helia/json';
import { FsBlockstore } from 'blockstore-fs';
import { CID } from 'multiformats/cid';
import { base58btc } from 'multiformats/bases/base58';
import fs from 'fs';
import canonicalize from 'canonicalize';
import * as cipher from './cipher.js';

const blockstore = new FsBlockstore('./ipfs');
const dbName = 'mdip.json';

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

export async function generateDid(txn) {
    const helia = await createHelia({ blockstore });
    const j = json(helia);
    const seed = {
        anchor: txn,
        created: new Date().toISOString(),
    };
    const cid = await j.add(JSON.parse(canonicalize(seed)));
    const did = `did:mdip:${cid.toString(base58btc)}`;

    helia.stop();

    return did;
}

export async function createAgent(txn) {
    if (!txn.signature) {
        throw "Invalid txn";
    }

    if (!txn.mdip.publicJwk) {
        throw "Invalid txn";
    }

    const msg = canonicalize(txn.mdip);
    const msgHash = cipher.hashMessage(msg);
    const isValid = cipher.verifySig(msgHash, txn.signature, txn.mdip.publicJwk);

    if (!isValid) {
        throw "Invalid txn";
    }

    return generateDid(txn);
}

export async function createAsset(txn) {
    if (txn.mdip.controller !== txn.signature.signer) {
        throw "Invalid txn";
    }

    const doc = JSON.parse(await resolveDid(txn.mdip.controller));
    const msg = canonicalize({ mdip: txn.mdip });
    const msgHash = cipher.hashMessage(msg);
    // TBD select the right key here, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const isValid = cipher.verifySig(msgHash, txn.signature.value, publicJwk);

    if (!isValid) {
        throw "Invalid txn";
    }

    return generateDid(txn);
}

export async function createDid(txn) {
    if (!txn?.mdip?.type) {
        throw "Invalid txn";
    }

    if (txn.mdip.op !== "create") {
        throw "Invalid txn";
    }

    if (txn.mdip.type === 'agent') {
        return createAgent(txn);
    }

    if (txn.mdip.type === 'asset') {
        return createAsset(txn);
    }

    throw "Unknown type";
}

async function generateDoc(did, asof) {
    const helia = await createHelia({ blockstore });
    try {
        const suffix = did.split(':').pop(); // everything after "did:mdip:"
        const cid = CID.parse(suffix);
        const j = json(helia);
        const docMetadata = await j.get(cid);

        if (!docMetadata?.anchor?.mdip) {
            return {};
        }

        if (asof && new Date(docMetadata.created) < new Date(asof)) {
            return {}; // DID was not yet created
        }

        const mdip = docMetadata.anchor.mdip;
        const validVersions = [1];
        const validTypes = ['agent', 'asset'];
        const validRegistries = ['peerbit', 'BTC', 'tBTC'];

        if (!validVersions.includes(mdip.version)) {
            return {};
        }

        if (!validTypes.includes(mdip.type)) {
            return {};
        }

        if (!validRegistries.includes(mdip.registry)) {
            return {};
        }

        if (mdip.type === 'agent') {
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
                            "publicKeyJwk": mdip.publicJwk,
                        }
                    ],
                    "authentication": [
                        "#key-1"
                    ],
                },
                "didDocumentMetadata": {
                    "created": docMetadata.created,
                    "mdip": {
                        "type": mdip.type,
                        "version": mdip.version,
                        "registry": mdip.registry,
                    }
                },
            };

            return doc;
        }

        if (mdip.type === 'asset') {
            const doc = {
                "@context": "https://w3id.org/did-resolution/v1",
                "didDocument": {
                    "@context": ["https://www.w3.org/ns/did/v1"],
                    "id": did,
                    "controller": mdip.controller,
                },
                "didDocumentMetadata": {
                    "created": docMetadata.created,
                    "mdip": {
                        "type": mdip.type,
                        "version": mdip.version,
                        "registry": mdip.registry,
                    },
                    "data": mdip.data,
                },
            };

            return doc;
        }

        return {}; // TBD unknown type error
    }
    catch (error) {
        console.error(error);
    }
    finally {
        helia.stop();
    }
}

async function verifyUpdate(txn, doc) {

    if (!doc?.didDocument) {
        return false;
    }

    if (doc.didDocument.controller) {
        const controllerDoc = await resolveDid(doc.didDocument.controller, txn.time);
        return verifyUpdate(txn, JSON.parse(controllerDoc));
    }

    if (doc.didDocument.verificationMethod) {
        const jsonCopy = JSON.parse(JSON.stringify(txn));

        const signature = jsonCopy.signature;
        delete jsonCopy.signature;
        const msg = canonicalize(jsonCopy);
        const msgHash = cipher.hashMessage(msg);

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

export async function resolveDid(did, asof = null) {
    const db = loadDb();
    let doc = await generateDoc(did);

    if (db.hasOwnProperty(did)) {
        for (const txn of db[did]) {
            if (asof && new Date(txn.time) > new Date(asof)) {
                break;
            }

            const valid = await verifyUpdate(txn, doc);

            if (valid) {
                if (txn.op === 'create') {
                    // Proof-of-existence in the DID's registry
                    continue;
                }
                else if (txn.op === 'update') {
                    doc = txn.doc;
                    //doc.didDocumentMetadata.anchor = txn;
                    doc.didDocumentMetadata.deactivated = false;
                    doc.didDocumentMetadata.updated = txn.signature.created;
                }
                else if (txn.op === 'delete') {
                    doc.didDocument = {};
                    doc.didDocumentMetadata.anchor = txn;
                    doc.didDocumentMetadata.deactivated = true;
                    doc.didDocumentMetadata.updated = txn.signature.created;
                }
                else {
                    console.error(`unknown op ${txn.op}`);
                }
            }
            else {
                console.error(`txn not valid: ${JSON.stringify(txn)}`);
            }
        }
    }

    return JSON.stringify(doc);
}

export async function updateDid(txn) {
    try {
        const doc = JSON.parse(await resolveDid(txn.did));
        const updateValid = await verifyUpdate(txn, doc);

        if (!updateValid) {
            return false;
        }

        const db = loadDb();

        if (db.hasOwnProperty(txn.did)) {
            db[txn.did].push(txn);
        }
        else {
            db[txn.did] = [txn];
        }

        writeDb(db);
        return true;
    }
    catch (error) {
        return false;
    }
}

export async function deleteDid(txn) {
    return updateDid(txn);
}
