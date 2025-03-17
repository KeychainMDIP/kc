
import { create } from 'kubo-rpc-client'
import { CID } from 'multiformats/cid';
import { base58btc } from 'multiformats/bases/base58';
import * as jsonCodec from 'multiformats/codecs/json';
import * as sha256 from 'multiformats/hashes/sha2';

class KuboClient {
    async connect(options = {}) {
        this.ipfs = new create();
    }

    async addText(text) {
        const { cid } = await this.ipfs.add(text, { cidVersion: 1 });
        return cid.toString(base58btc);
    }

    async getText(cid) {
        const chunks = [];
        for await (const chunk of this.ipfs.cat(cid)) {
            chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        return data.toString();
    }

    async addData(data) {
        const { cid } = await this.ipfs.add(data, { cidVersion: 1 });
        return cid.toString(base58btc);
    }

    async getData(cid) {
        const chunks = [];
        for await (const chunk of this.ipfs.cat(cid)) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }

    async addJSON(json) {
        // Encode the JSON data using jsonCodec
        const buf = jsonCodec.encode(json);
        const hash = await sha256.sha256.digest(buf);
        const cid = CID.createV1(jsonCodec.code, hash);

        // Add the encoded data to IPFS
        await this.ipfs.block.put(buf, { cid });

        return cid.toString(base58btc);
    }

    async getJSON(cid) {
        // Retrieve the data using ipfs.block.get instead of ipfs.cat
        const block = await this.ipfs.block.get(cid);
        return jsonCodec.decode(block);
    }
}

export default KuboClient
