
import { create } from 'kubo-rpc-client'
import { CID } from 'multiformats/cid';
import { base58btc } from 'multiformats/bases/base58';
import * as jsonCodec from 'multiformats/codecs/json';
import * as sha256 from 'multiformats/hashes/sha2';

class KuboClient {
    // Factory method
    static async create(options) {
        const ipfs = new KuboClient();
        await ipfs.connect(options);
        return ipfs;
    }

    async connect(options = {}) {
        this.ipfs = new create(options);

        if (options.waitUntilReady) {
            await this.waitUntilReady(options);
        }
    }

    async waitUntilReady(options = {}) {
        let { intervalSeconds = 5, chatty = false, becomeChattyAfter = 0, maxRetries = 0 } = options;
        let ready = false;
        let retries = 0;

        if (chatty) {
            console.log(`Connecting to IPFS at ${options.url}`);
        }

        while (!ready) {
            ready = await this.isReady();

            if (!ready) {
                if (chatty) {
                    console.log('Waiting for IPFS to be ready...');
                }
                // wait for 1 second before checking again
                await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
            }

            retries += 1;

            if (maxRetries > 0 && retries > maxRetries) {
                return;
            }

            if (!chatty && becomeChattyAfter > 0 && retries > becomeChattyAfter) {
                console.log(`Connecting to IPFS at ${options.url}`);
                chatty = true;
            }
        }

        if (chatty) {
            console.log('IPFS service is ready!');
        }
    }

    async isReady() {
        try {
            await this.ipfs.id();
            return true;
        }
        catch (error) {
            return false;
        }
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

        // !!! No need to await since we pre-generated the cid?
        await this.ipfs.block.put(buf, { cid });

        return cid.toString(base58btc);
    }

    async getJSON(cid) {
        // Retrieve the data using ipfs.block.get instead of ipfs.cat
        const block = await this.ipfs.block.get(cid);
        return jsonCodec.decode(block);
    }

    async generateCID(json) {
        // Encode the JSON data using jsonCodec
        const buf = jsonCodec.encode(json);
        const hash = await sha256.sha256.digest(buf);
        const cid = CID.createV1(jsonCodec.code, hash);

        return cid.toString(base58btc);
    }

    async getID() {
        return this.ipfs.id();
    }

    async addPeer(peer) {
        return this.ipfs.swarm.connect(peer);
    }
}

export default KuboClient
