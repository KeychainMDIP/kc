import { createHelia, Helia } from 'helia';
import { json, JSON } from '@helia/json';
import { unixfs, UnixFS } from '@helia/unixfs';
import { FsBlockstore } from 'blockstore-fs';
import { CID } from 'multiformats';
import { base58btc } from 'multiformats/bases/base58';
import * as jsonCodec from 'multiformats/codecs/json';
import * as rawCodec from 'multiformats/codecs/raw';
import * as sha256 from 'multiformats/hashes/sha2';

interface HeliaConfig {
    minimal?: boolean;
    datadir?: string;
}

class HeliaClient {
    private config: HeliaConfig;
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
        }
    }

    public async addJSON<T>(data: T): Promise<string> {
        let cid;

        if (this.ipfs) {
            cid = await this.ipfs.add(data);
            return cid.toString(base58btc);
        }

        return this.generateCID(data);
    }

    public async getJSON<T>(b58cid: string): Promise<T | null> {
        if (this.ipfs) {
            const cid = CID.parse(b58cid);
            return this.ipfs.get(cid);
        }
        else {
            return null;
        }
    }

    public async addText(data: string): Promise<string> {
        let cid;

        if (this.unixfs) {
            const buf = new TextEncoder().encode(data);
            cid = await this.unixfs.addBytes(buf);
            return cid.toString(base58btc);
        }

        return this.generateCID(data);
    }

    public async getText(b58cid: string): Promise<string | null> {
        if (this.unixfs) {
            const cid = CID.parse(b58cid);
            const chunks = [];
            for await (const chunk of this.unixfs.cat(cid)) {
                chunks.push(chunk);
            }
            const data = Buffer.concat(chunks);
            return data.toString();
        }
        else {
            return null;
        }
    }

    public async addData(data: Buffer): Promise<string> {
        let cid;

        if (this.unixfs) {
            cid = await this.unixfs.addBytes(data);
            return cid.toString(base58btc);
        }

        return this.generateCID(data);
    }

    public async getData(b58cid: string): Promise<Buffer | null> {
        if (this.unixfs) {
            const cid = CID.parse(b58cid);
            const chunks = [];
            for await (const chunk of this.unixfs.cat(cid)) {
                chunks.push(chunk);
            }
            return Buffer.concat(chunks);
        }
        else {
            return null;
        }
    }

    public async generateCID<T>(data: T): Promise<string> {
        if (typeof data === 'string') {
            const buf = new TextEncoder().encode(data);
            const hash = await sha256.sha256.digest(buf);
            const cid = CID.createV1(rawCodec.code, hash);
            return cid.toString(base58btc);
        } else if (data instanceof Buffer) {
            const buf = data;
            const hash = await sha256.sha256.digest(buf);
            const cid = CID.createV1(rawCodec.code, hash);
            return cid.toString(base58btc);
        } else {
            const buf = jsonCodec.encode(data);
            const hash = await sha256.sha256.digest(buf);
            const cid = CID.createV1(jsonCodec.code, hash);
            return cid.toString(base58btc);
        }
    }

    // Factory method
    static async create(config: HeliaConfig = {}): Promise<HeliaClient> {
        const instance = new HeliaClient(config);
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

export default HeliaClient;
