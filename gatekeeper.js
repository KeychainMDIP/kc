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

async function generateDid(jsonData) {
    const helia = await createHelia({ blockstore });
    const j = json(helia);
    const cid = await j.add(JSON.parse(canonicalize(jsonData)));
    const did = `did:mdip:${cid.toString(base58btc)}`;
    helia.stop();
    return did;
}

async function generateDoc(did) {
    const helia = await createHelia({ blockstore });
    try {
        const suffix = did.split(':').pop(); // everything after "did:mdip:"
        const cid = CID.parse(suffix);
        const j = json(helia);
        const data = await j.get(cid);

        if (!data) {
            return {}; // not found error
        }

        if (data.kty) {
            const template = fs.readFileSync('did-doc.template');
            const doc = JSON.parse(template);

            doc.didDocument.id = did;
            doc.didDocument.verificationMethod[0].controller = did;
            doc.didDocument.verificationMethod[0].publicKeyJwk = data;
            doc.didDocumentMetadata.canonicalId = did;
            doc.didDocumentMetadata.manifest = await generateDid({ holder: did });

            return doc;
        }

        if (data.cipher_hash) {
            const template = fs.readFileSync('did-data.template');
            const doc = JSON.parse(template);

            doc.didDocument.id = did;
            doc.didDocument.controller = data.sender;
            doc.didDocumentMetadata.canonicalId = did;
            doc.didDocumentMetadata.data = data;

            return doc;
        }

        if (data.holder) {
            const template = fs.readFileSync('did-data.template');
            const doc = JSON.parse(template);

            doc.didDocument.id = did;
            doc.didDocument.controller = data.holder;
            doc.didDocumentMetadata.canonicalId = did;
            doc.didDocumentMetadata.data = "";

            return doc;
        }

        if (data.schema) {
            const template = fs.readFileSync('did-data.template');
            const doc = JSON.parse(template);

            doc.didDocument.id = did;
            doc.didDocument.controller = data.controller;
            doc.didDocumentMetadata.canonicalId = did;
            doc.didDocumentMetadata.data = data;

            return doc;
        }

        if (data.vp) {
            const template = fs.readFileSync('did-data.template');
            const doc = JSON.parse(template);

            doc.didDocument.id = did;
            doc.didDocument.controller = data.controller;
            doc.didDocumentMetadata.canonicalId = did;
            doc.didDocumentMetadata.data = data;

            return doc;
        }

        return {}; // unknown type error
    }
    catch (error) {
        console.log(error);
    }
    finally {
        helia.stop();
    }
}

async function verifyUpdate(txn, doc) {

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

async function resolveDid(did, asof = null) {
    //console.log(`resolveDid(${did},${asof})`);

    const db = loadDb();
    let doc = await generateDoc(did);

    if (db.hasOwnProperty(did)) {
        for (const txn of db[did]) {
            if (asof && new Date(txn.time) > new Date(asof)) {
                break;
            }

            const valid = await verifyUpdate(txn, doc);

            if (valid) {
                if (txn.op === 'replace') {
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

async function saveUpdateTxn(txn) {
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

export {
    generateDid,
    resolveDid,
    saveUpdateTxn,
}

