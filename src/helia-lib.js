import { createHelia } from 'helia';
import { json } from '@helia/json';

let helia;
let ipfs;

export async function start() {
    helia = await createHelia();
    ipfs = json(helia);
}

export async function stop() {
    await helia.stop();
}

export async function add(data) {
    return ipfs.add(data);
}

export async function get(cid) {
    return ipfs.get(cid);
}
