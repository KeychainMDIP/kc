import { createHelia, Helia } from 'helia';
import { json, JSON } from '@helia/json';
import { unixfs, UnixFS } from '@helia/unixfs';
import { FsBlockstore } from 'blockstore-fs';
import { CID } from 'multiformats';
import { base58btc } from 'multiformats/bases/base58';
import * as jsonCodec from 'multiformats/codecs/json';
import * as sha256 from 'multiformats/hashes/sha2';

interface IPFSConfig {
    minimal?: boolean;
    datadir?: string;
}

class IPFS {
    private config: IPFSConfig;
    private helia: Helia | null;
    private ipfs: JSON | null;
    private unixfs: UnixFS | null;

    constructor(config = {}) {
        this.config = config;
        this.helia = null;
        this.ipfs = null;
        this.unixfs = null;
    }

    async start(): Promise<void> {
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
        this.unixfs = unixfs(this.helia);
    }

    async stop(): Promise<void> {
        if (this.helia) {
            await this.helia.stop();
            this.helia = null;
            this.ipfs = null;
            this.unixfs = null;
        }
    }

    public async add<T>(data: T): Promise<string> {
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

    public async get<T>(b58cid: string): Promise<T | null> {
        if (this.ipfs) {
            const cid = CID.parse(b58cid);
            return this.ipfs.get(cid);
        }
        else {
            return null;
        }
    }

    public async addBytes(data: any): Promise<string> {
        let cid;

        if (this.unixfs) {
            cid = await this.unixfs.addBytes(data);
        }
        else {
            const buf = jsonCodec.encode(data)
            const hash = await sha256.sha256.digest(buf)
            cid = CID.createV1(jsonCodec.code, hash)
        }

        return cid.toString(base58btc);
    }

    public async getBytes(b58cid: string): Promise<any> {
        if (this.unixfs) {
            const cid = CID.parse(b58cid);
            const retrievedChunks = [];
            for await (const chunk of this.unixfs.cat(cid)) {
                retrievedChunks.push(chunk);
            }
            return Buffer.concat(retrievedChunks);
        }
        else {
            return null;
        }
    }

    // Factory method
    static async create(config: IPFSConfig = {}): Promise<IPFS> {
        const instance = new IPFS(config);
        await instance.start();
        return instance;
    }

    static isValidCID(cid: any): boolean {
        try {
            CID.parse(cid);
            return true;
        } catch (error) {
            return false;
        }
    }
}

export default IPFS;
