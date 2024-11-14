import { createHelia } from 'helia';
import { json } from '@helia/json';
import { FsBlockstore } from 'blockstore-fs';
import { CID } from 'multiformats';
import { base58btc } from 'multiformats/bases/base58';
import * as jsonCodec from 'multiformats/codecs/json';
import * as sha256 from 'multiformats/hashes/sha2';

class IPFS {
    constructor(config = {}) {
        this.config = config;
        this.helia = null;
        this.ipfs = null;
    }

    async start() {
        if (this.helia || this.config.minimal) {
            return;
        }

        if (this.config.datadir) {
            const blockstore = new FsBlockstore(this.config.datadir);
            this.helia = await createHelia({ blockstore });
        }
        else {
            this.helia = await createHelia();
        }

        this.ipfs = json(this.helia);
    }

    async stop() {
        if (this.helia) {
            await this.helia.stop();
            this.helia = null;
            this.ipfs = null;
        }
    }

    async add(data) {
        let cid;

        if (this.ipfs) {
            cid = await this.ipfs.add(data);
        }
        else {
            const buf = jsonCodec.encode(data)
            const hash = await sha256.sha256.digest(buf)
            cid = CID.createV1(jsonCodec.code, hash)
        }

        return cid.toString(base58btc);
    }

    async get(b58cid) {
        if (this.ipfs) {
            const cid = CID.parse(b58cid);
            return this.ipfs.get(cid);
        }
        else {
            return null;
        }
    }

    // Factory method
    static async create(config) {
        const instance = new IPFS(config);
        await instance.start();
        return instance;
    }
}

export default IPFS;
