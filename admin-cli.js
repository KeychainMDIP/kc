import { program } from 'commander';
import fs from 'fs';
import * as gatekeeper from './gatekeeper-sdk.js';

program
    .version('1.0.0')
    .description('Admin CLI tool')
    .configureHelp({ sortSubcommands: true });

program
    .command('get-dids')
    .description('Fetch all DIDs')
    .action(async () => {
        try {
            const dids = await gatekeeper.getDIDs();
            console.log(JSON.stringify(dids, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('export-all')
    .description('Export all DIDs')
    .action(async () => {
        try {
            const data = {};
            const dids = await gatekeeper.getDIDs();

            for (const did of dids) {
                data[did] = await gatekeeper.exportDID(did);
            }

            console.log(JSON.stringify(data, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('merge-batch <file>')
    .description('Import batch of DIDs')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const data = JSON.parse(contents);
            const batch = Object.values(data);

            console.time('mergeBatch');
            const { verified, updated, failed } = await gatekeeper.mergeBatch(batch);
            console.timeEnd('mergeBatch');
            console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
        }
        catch (error) {
            console.error(error);
        }
    });

async function run() {
    program.parse(process.argv);
}

run();
