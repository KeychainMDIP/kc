import { base58btc } from 'multiformats/bases/base58';
import * as jsonCodec from 'multiformats/codecs/json';
import * as sha256 from 'multiformats/hashes/sha2';
import { FsBlockstore } from 'blockstore-fs';
import { createHelia, Helia } from 'helia';
import { CID } from 'multiformats';
import { json } from '@helia/json';

interface IPFSConfig {
  minimal?: boolean;
  datadir?: string;
}

interface IPFSInstance {
  add(data: any): Promise;
  get(cid: CID): Promise;
}

class IPFS {
  config: IPFSConfig;
  helia: Helia | null;
  ipfs: IPFSInstance | null;

  constructor(config: IPFSConfig = {}) {
    this.config = config;
    this.helia = null;
    this.ipfs = null;
  }

  async start(): Promise {
    if (this.helia || this.config.minimal) {
      return;
    }

    if (this.config.datadir) {
      const blockstore = new FsBlockstore(this.config.datadir);
      this.helia = await createHelia({ blockstore });
    } else {
      this.helia = await createHelia();
    }

    this.ipfs = json(this.helia);
  }

  async stop(): Promise {
    if (this.helia) {
      await this.helia.stop();
      this.helia = null;
      this.ipfs = null;
    }
  }

  async add(data: any): Promise {
    let cid: CID;

    if (this.ipfs) {
      cid = await this.ipfs.add(data);
    } else {
      const buf = jsonCodec.encode(data);
      const hash = await sha256.sha256.digest(buf);
      cid = CID.createV1(jsonCodec.code, hash);
    }

    return cid.toString(base58btc);
  }

  async get(b58cid: string): Promise {
    if (this.ipfs) {
      const cid = CID.parse(b58cid);
      return this.ipfs.get(cid);
    } else {
      return null;
    }
  }

  // Factory method
  static async create(config: IPFSConfig): Promise {
    const instance = new IPFS(config);
    await instance.start();
    return instance;
  }
}

export default IPFS;
