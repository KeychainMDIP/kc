import { program } from 'commander';
import fs from 'fs';
import dotenv from 'dotenv';
import KuboClient from '@mdip/ipfs/client';

dotenv.config();
const ipfs = new KuboClient();
await ipfs.connect({ url: process.env.KC_IPFS_URL });

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
