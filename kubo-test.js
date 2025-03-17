import { program } from 'commander';
import fs from 'fs';
import dotenv from 'dotenv';
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
        const json = jsonCodec.decode(block);
        return json;
    }
}

dotenv.config();
const ipfs = new KuboClient();
await ipfs.connect({ url: process.env.KC_KUBO_URL || undefined });

program
    .version('1.0.0')
    .description('Kubo CLI tool')
    .configureHelp({ sortSubcommands: true });

program
    .command('add-text <text>')
    .description('Add text to IPFS')
    .action(async (text) => {
        try {
            const cid = await ipfs.addText(text);
            console.log(cid);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('get-text <cid>')
    .description('Get text from IPFS')
    .action(async (cid) => {
        try {
            const text = await ipfs.getText(cid);
            console.log(text);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('add-file <file>')
    .description('Add file to IPFS')
    .action(async (file) => {
        try {
            const data = fs.readFileSync(file);
            const cid = await ipfs.addData(data);
            console.log(cid);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('get-file <cid> <file>')
    .description('Get content from IPFS')
    .action(async (cid, file) => {
        try {
            const data = await ipfs.getData(cid);
            fs.writeFileSync(file, data);
            console.log(`Data written to ${file}`);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('add-json <file>')
    .description('Add JSON file')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file);
            const json = JSON.parse(contents.toString());
            const cid = await ipfs.addJSON(json);
            console.log(cid);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('get-json <cid>')
    .description('Get JSON from IPFS')
    .action(async (cid) => {
        try {
            const json = await ipfs.getJSON(cid);
            console.log(JSON.stringify(json, null, 2));
        } catch (error) {
            console.error(error);
        }
    });

program.parse(process.argv);
