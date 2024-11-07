import { createHelia } from 'helia';
import { json } from '@helia/json';
import { FsBlockstore } from 'blockstore-fs';

class IPFS {
    constructor(config = {}) {
        this.config = config;
        this.helia = null;
        this.ipfs = null;
    }

    async start() {
        // Check if already started
        if (this.helia) {
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
        return this.ipfs.add(data);
    }

    async get(cid) {
        return this.ipfs.get(cid);
    }

    // Factory method
    static async create(config) {
        const instance = new IPFS(config);
        await instance.start();
        return instance;
    }
}

export default IPFS;
