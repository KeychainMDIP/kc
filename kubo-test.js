import { program } from 'commander';
import fs from 'fs';
import { create } from 'kubo-rpc-client'
import { CID } from 'multiformats/cid';
import { base58btc } from 'multiformats/bases/base58';
import * as jsonCodec from 'multiformats/codecs/json';
import * as sha256 from 'multiformats/hashes/sha2';

const ipfs = new create();

program
    .version('1.0.0')
    .description('Kubo CLI tool')
    .configureHelp({ sortSubcommands: true });

program
    .command('add-string <data>')
    .description('Add string to IPFS')
    .action(async (data) => {
        try {
            const { cid } = await ipfs.add(data);
            console.log(cid.toString(base58btc));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('get-string <cid>')
    .description('Get content from IPFS')
    .action(async (cid) => {
        try {
            const chunks = [];
            for await (const chunk of ipfs.cat(cid)) {
                chunks.push(chunk);
            }
            const data = Buffer.concat(chunks);
            console.log(data.toString());
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
            const { cid } = await ipfs.add(data);
            console.log(cid.toString(base58btc));
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
            const chunks = [];
            for await (const chunk of ipfs.cat(cid)) {
                chunks.push(chunk);
            }
            const data = Buffer.concat(chunks);
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
            console.log(json);

            // Encode the JSON data using jsonCodec
            const buf = jsonCodec.encode(json);
            const hash = await sha256.sha256.digest(buf);
            const cid = CID.createV1(jsonCodec.code, hash);

            // Add the encoded data to IPFS
            await ipfs.block.put(buf, { cid });

            const b58cid = cid.toString(base58btc);
            console.log(b58cid);
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
            // Retrieve the data using ipfs.block.get instead of ipfs.cat
            const block = await ipfs.block.get(cid);
            const json = jsonCodec.decode(block);
            console.log(JSON.stringify(json, null, 2));
        } catch (error) {
            console.error(error);
        }
    });

program.parse(process.argv);
