import { createHelia } from 'helia';
import { json } from '@helia/json';
import { FsBlockstore } from 'blockstore-fs';
import { CID } from 'multiformats/cid';
import fs from 'fs';

const blockstore = new FsBlockstore('./ipfs');

async function generateDid(jsonData) {
    const helia = await createHelia({ blockstore });
    const j = json(helia);
    const cid = await j.add(jsonData);
    helia.stop();
    return `did:mdip:${cid.toV1().toString()}`;
}

async function resolveDid(did) {
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

export {
    generateDid,
    resolveDid,
}

