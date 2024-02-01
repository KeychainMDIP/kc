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

export async function generateDid(anchor) {

    if (!anchor) {
        throw "Invalid anchor";
    }

    const helia = await createHelia({ blockstore });
    const j = json(helia);
    const seed = {
        mdip: {
            version: 1,
            created: new Date().toISOString(),
        },
        anchor: anchor,
    };
    const cid = await j.add(JSON.parse(canonicalize(seed)));
    const did = `did:mdip:${cid.toString(base58btc)}`;
    helia.stop();
    return did;
}

async function generateDoc(did, asof) {
    const helia = await createHelia({ blockstore });
    try {
        const suffix = did.split(':').pop(); // everything after "did:mdip:"
        const cid = CID.parse(suffix);
        const j = json(helia);
        const docSeed = await j.get(cid);

        if (!docSeed) {
            return {}; // not found error
        }

        if (!docSeed.mdip) {
            return {}; // not an MDIP seed
        }

        if (docSeed.mdip.version != 1) {
            return {}; // unknown version
        }

        if (asof && new Date(docSeed.mdip.created) < new Date(asof)) {
            return {}; // DID was not yet created
        }

        if (docSeed.anchor.kty) { // Agent DID
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
                            "publicKeyJwk": docSeed.anchor,
                        }
                    ],
                    "authentication": [
                        "#key-1"
                    ],
                },
                "didDocumentMetadata": {
                    "mdip": docSeed.mdip,
                }
            };

            return doc;
        }

        if (docSeed.anchor.data) { // Data DID
            const doc = {
                "@context": "https://w3id.org/did-resolution/v1",
                "didDocument": {
                    "@context": ["https://www.w3.org/ns/did/v1"],
                    "id": did,
                    "controller": docSeed.anchor.controller,
                },
                "didDocumentMetadata": {
                    "mdip": docSeed.mdip,
                    "data": docSeed.anchor.data,
                }
            };

            return doc;
        }

        return {}; // TBD unknown type error
    }
    catch (error) {
        console.log(error);
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
                if (txn.op === 'update') {
                    doc = txn.doc;
                }
            }
            else {
                console.error(`txn not valid: ${JSON.stringify(txn)}`);
            }
        }
    }

    return JSON.stringify(doc);
}

export async function updateDoc(txn) {
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
