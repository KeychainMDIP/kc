import { createHelia, Helia } from 'helia';
import { json, JSON } from '@helia/json';
import { unixfs, UnixFS } from '@helia/unixfs';
import { FsBlockstore } from 'blockstore-fs';
import { CID } from 'multiformats';
import { base58btc } from 'multiformats/bases/base58';
import * as jsonCodec from 'multiformats/codecs/json';
import * as rawCodec from 'multiformats/codecs/raw';
import * as sha256 from 'multiformats/hashes/sha2';
import { IPFSClient } from './types.js';
import { MDIPError } from '@mdip/common/errors';

interface HeliaConfig {
    minimal?: boolean;
    datadir?: string;
}

export class NotConnectedError extends MDIPError {
    static type = 'Not connected';

    constructor() {
        super(NotConnectedError.type);
    }
}

class HeliaClient implements IPFSClient {
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

    public async addJSON(data: any): Promise<string> {
        if (this.ipfs) {
            const cid = await this.ipfs.add(data);
            return cid.toString(base58btc);
        }

        return this.generateCID(data);
    }

    public async getJSON(b58cid: string): Promise<any> {
        if (!this.ipfs) {
            throw new NotConnectedError();
        }

        const cid = CID.parse(b58cid);
        return this.ipfs.get(cid);
    }

    public async addText(data: string): Promise<string> {
        if (this.unixfs) {
            const buf = new TextEncoder().encode(data);
            const cid = await this.unixfs.addBytes(buf);
            return cid.toString(base58btc);
        }

        return this.generateCID(data);
    }

    public async getText(b58cid: string): Promise<string> {
        if (!this.unixfs) {
            throw new NotConnectedError();
        }

        const cid = CID.parse(b58cid);
        const chunks = [];
        for await (const chunk of this.unixfs.cat(cid)) {
            chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        return data.toString();
    }

    public async addData(data: Buffer): Promise<string> {
        if (this.unixfs) {
            const cid = await this.unixfs.addBytes(data);
            return cid.toString(base58btc);
        }

        return this.generateCID(data);
    }

    public async getData(b58cid: string): Promise<Buffer> {
        if (!this.unixfs) {
            throw new NotConnectedError();
        }

        const cid = CID.parse(b58cid);
        const chunks = [];
        for await (const chunk of this.unixfs.cat(cid)) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
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
}

export default HeliaClient;
