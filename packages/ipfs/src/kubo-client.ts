
import { create, KuboRPCClient } from 'kubo-rpc-client'
import { CID } from 'multiformats/cid';
import { base58btc } from 'multiformats/bases/base58';
import * as jsonCodec from 'multiformats/codecs/json';
import * as sha256 from 'multiformats/hashes/sha2';
import ip from 'ip';
import { IPFSClient } from './types.js';

interface KuboClientConfig {
    url: string;
    waitUntilReady?: boolean;
    intervalSeconds?: number;
    chatty?: boolean;
    becomeChattyAfter?: number;
    maxRetries?: number;
}

class KuboClient implements IPFSClient {
    private ipfs: KuboRPCClient | any;

    // Factory method
    static async create(options: KuboClientConfig): Promise<KuboClient> {
        const ipfs = new KuboClient();
        await ipfs.connect(options);
        return ipfs;
    }

    async connect(options: KuboClientConfig): Promise<void> {
        this.ipfs = create(options);

        if (options.waitUntilReady) {
            await this.waitUntilReady(options);
        }
    }

    async waitUntilReady(options: KuboClientConfig): Promise<void> {
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

    async isReady(): Promise<boolean> {
        try {
            await this.ipfs.id();
            return true;
        }
        catch (error) {
            return false;
        }
    }

    async addText(text: string): Promise<string> {
        const { cid } = await this.ipfs.add(text, { cidVersion: 1 });
        return cid.toString(base58btc);
    }

    async getText(cid: string): Promise<string> {
        const chunks = [];
        for await (const chunk of this.ipfs.cat(cid, { timeout: 10000 })) {
            chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        return data.toString();
    }

    async addData(data: Buffer): Promise<string> {
        const { cid } = await this.ipfs.add(data, { cidVersion: 1 });
        return cid.toString(base58btc);
    }

    async getData(cid: string): Promise<Buffer> {
        const chunks = [];
        for await (const chunk of this.ipfs.cat(cid, { timeout: 10000 })) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }

    async addJSON(json: any): Promise<string> {
        // Encode the JSON data using jsonCodec
        const buf = jsonCodec.encode(json);
        const hash = await sha256.sha256.digest(buf);
        const cid = CID.createV1(jsonCodec.code, hash);

        // !!! No need to await since we pre-generated the cid?
        await this.ipfs.block.put(buf, { cid });

        return cid.toString(base58btc);
    }

    async getJSON(cid: string): Promise<any> {
        // Retrieve the data using ipfs.block.get instead of ipfs.cat
        const block = await this.ipfs.block.get(cid, { timeout: 10000 });
        return jsonCodec.decode(block);
    }

    async getID(): Promise<any> {
        return this.ipfs.id();
    }

    async getPeerID(): Promise<string> {
        const id = await this.ipfs.id();
        return id.id.toString();
    }

    async getAddresses(): Promise<string[]> {
        const id = await this.ipfs.id();
        const publicAddresses = [];

        for (const addr of id.addresses) {
            const address = addr.toString();
            // Match both IPv4 and IPv6 addresses
            const match = address.match(/\/ip[46]\/([a-fA-F\d.:]+)/);
            if (match) {
                const ipAddress = match[1];
                // Check if the IP address is private
                if (!ip.isPrivate(ipAddress)) {
                    publicAddresses.push(addr);
                }
            }
        }

        return publicAddresses;
    }

    async addPeer(peer: string): Promise<boolean> {
        try {
            // Match both IPv4 and IPv6 addresses
            const match = peer.match(/\/ip[46]\/([a-fA-F\d.:]+)/);
            //const match = peer.match(/\/ip4\/([\d.]+)/);

            if (!match) {
                console.warn(`Invalid peer address format: ${peer}`);
                return false;
            }

            const ipAddress = match[1];

            // Check if the IP address is private
            if (ip.isPrivate(ipAddress)) {
                console.warn(`Skipping private IP address: ${ipAddress}`);
                return false;
            }

            // Attempt to connect to the peer
            const response = await this.ipfs.swarm.connect(peer);

            // Validate the response (assuming it's a list containing a single string)
            if (Array.isArray(response) && response.length === 1 && typeof response[0] === 'string') {
                const responseString = response[0];
                if (responseString.includes('success')) {
                    console.log(`Successfully connected to peer: ${peer}`);
                    return true;
                }

                console.warn(`Unexpected response from swarm.connect: ${responseString}`);
                return false;
            }

            console.warn(`Unexpected response from swarm.connect: ${response}`);
            return false;
        } catch (error) {
            console.error(`Failed to connect to peer ${peer}:`, error);
            return false;
        }
    }

    async addPeers(peers: string[]): Promise<any> {
        const addedPeers: string[] = [];

        for (const peer of peers) {
            const ok = await this.addPeer(peer);

            if (ok) {
                console.log(`Added peer ${peer}`);
                addedPeers.push(peer);
            }
        }

        return addedPeers;
    }

    async getPeers(): Promise<any> {
        return this.ipfs.swarm.peers();
    }
}

export default KuboClient
