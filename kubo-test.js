import { program } from 'commander';
import fs from 'fs';
import { create } from 'kubo-rpc-client'

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
            console.log(cid);
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
            const { cid } = await ipfs.add(JSON.stringify(json));
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
            const chunks = [];
            for await (const chunk of ipfs.cat(cid)) {
                chunks.push(chunk);
            }
            const data = Buffer.concat(chunks);
            const json = JSON.parse(data.toString());
            console.log(JSON.stringify(json, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program.parse(process.argv);
