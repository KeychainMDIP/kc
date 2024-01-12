import { createHelia } from 'helia';
import { json } from '@helia/json';
import { FsBlockstore } from 'blockstore-fs';
import { CID } from 'multiformats/cid';

const blockstore = new FsBlockstore('./ipfs');

async function generateDid(jwkPubkey) {
    const helia = await createHelia({ blockstore });
    const j = json(helia);
    const cid = await j.add(jwkPubkey);
    helia.stop();
    return `did:mdip:${cid.toString()}`;
}

async function resolveDid(did) {
    const helia = await createHelia({ blockstore });
    try {
        const suffix = did.split(':').pop(); // everything after "did:mdip:"
        const cid = CID.parse(suffix);
        console.log(cid.toString());
        const j = json(helia);
        const obj = await j.get(cid);
        return obj;
    }
    catch (error) {
        console.log(error);
    }
    helia.stop();
}

export {
    generateDid,
    resolveDid,
}

