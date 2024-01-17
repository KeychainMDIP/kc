import { createHelia } from 'helia';
import { json } from '@helia/json';
import { FsBlockstore } from 'blockstore-fs';
import { CID } from 'multiformats/cid';
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

async function verifySig(json) {
    if (!json.signature) {
        return false;
    }

    const jsonCopy = JSON.parse(JSON.stringify(json));

    const signature = jsonCopy.signature;
    delete jsonCopy.signature;
    const msg = JSON.stringify(canonicalize(jsonCopy));
    const msgHash = cipher.hashMessage(msg);

    if (signature.hash && signature.hash !== msgHash) {
        return false;
    }

    // TBD resolve DID as of signature timestamp
    const diddoc = await resolveDid(signature.signer);
    const doc = JSON.parse(diddoc);

    // TBD get the right signature, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const isValid = cipher.verifySig(msgHash, signature.value, publicJwk);

    return isValid;
}

async function generateDid(jsonData) {
    const helia = await createHelia({ blockstore });
    const j = json(helia);
    const cid = await j.add(jsonData);
    helia.stop();
    return `did:mdip:${cid.toV1().toString()}`;
}

async function generateDoc(did) {
    const helia = await createHelia({ blockstore });
    try {
        const suffix = did.split(':').pop(); // everything after "did:mdip:"
        const cid = CID.parse(suffix);
        const j = json(helia);
        const data = await j.get(cid);

        if (!data) {
            return '{}'; // not found error
        }

        if (data.ciphertext) {
            const template = fs.readFileSync('did-data.template');
            const doc = JSON.parse(template);

            doc.didDocument.id = did;
            doc.didDocument.controller = data.origin;
            doc.didDocumentMetadata.canonicalId = did;
            doc.didDocumentMetadata.data = data;

            return JSON.stringify(doc, null, 4);
        }

        if (data.kty) {
            const template = fs.readFileSync('did-doc.template');
            const doc = JSON.parse(template);

            doc.didDocument.id = did;
            doc.didDocument.verificationMethod[0].controller = did;
            doc.didDocument.verificationMethod[0].publicKeyJwk = data;
            doc.didDocumentMetadata.canonicalId = did;
            doc.didDocumentMetadata.manifest = await generateDid({ holder: did });

            return JSON.stringify(doc, null, 4);
        }

        if (data.holder) {
            const template = fs.readFileSync('did-data.template');
            const doc = JSON.parse(template);

            doc.didDocument.id = did;
            doc.didDocument.controller = data.holder;
            doc.didDocumentMetadata.canonicalId = did;
            doc.didDocumentMetadata.data = "";

            return JSON.stringify(doc, null, 4);
        }

        return '{}'; // unknown type error
    }
    catch (error) {
        console.log(error);
    }
    finally {
        helia.stop();
    }
}

async function resolveDid(did) {
    const db = loadDb();
    let doc = await generateDoc(did);

    if (db.hasOwnProperty(did)) {
        for (const txn of db[did]) {
            const valid = await verifySig(txn);
            // TBD verify txn matches doc controller
            if (valid) {
                if (txn.op === 'replace') {
                    doc = JSON.stringify(txn.doc, null, 4);
                }
            }
        }
    }

    return doc;
}

function updateDid(txn) {
    const db = loadDb();

    const did = txn.doc.didDocument.id;

    // TBD verify sig

    if (db.hasOwnProperty(did)) {
        db[did].push(txn);
    }
    else {
        db[did] = [txn];
    }

    writeDb(db);
    return true;
}

export {
    generateDid,
    resolveDid,
    updateDid,
    verifySig,
}

