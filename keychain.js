import { createHelia } from 'helia';
import { json } from '@helia/json';
import { FsBlockstore } from 'blockstore-fs';
import { CID } from 'multiformats/cid';
import fs from 'fs';

const blockstore = new FsBlockstore('./ipfs');

async function generateDid(jwkPubkey) {
    const helia = await createHelia({ blockstore });
    const j = json(helia);
    const cid = await j.add(jwkPubkey);
    helia.stop();
    return `did:mdip:${cid.toV1().toString()}`;
}

async function resolveDid(did) {
    const helia = await createHelia({ blockstore });
    try {
        const suffix = did.split(':').pop(); // everything after "did:mdip:"
        const cid = CID.parse(suffix);
        const j = json(helia);
        const keys = await j.get(cid);
        const template = fs.readFileSync('did-doc.template');
        const doc = JSON.parse(template);

        doc.didDocument.id = did;
        doc.didDocument.verificationMethod[0].controller = did;
        doc.didDocument.verificationMethod[0].publicKeyJwk = keys;
        doc.didDocumentMetadata.canonicalId = did;

        return JSON.stringify(doc, null, 4);
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

