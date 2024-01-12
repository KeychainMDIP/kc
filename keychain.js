import { createHelia } from 'helia';
import { json } from '@helia/json';
import { CID } from 'multiformats/cid';

async function generateDid(jwkPubkey) {
    const helia = await createHelia();
    const j = json(helia);
    const cid = await j.add(jwkPubkey);
    helia.stop();
    return `did:mdip:${cid.toString()}`;
}

export {
    generateDid,
}
