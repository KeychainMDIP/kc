import { program } from 'commander';
import fs from 'fs';
import * as gatekeeper from './gatekeeper-sdk.js';
import * as keymaster from './keymaster.js';
import * as cipher from './cipher.js';

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
    .command('export-dids')
    .description('Export all DIDs')
    .action(async () => {
        try {
            const dids = await gatekeeper.getDIDs();
            const data = await gatekeeper.exportDIDs(dids);
            console.log(JSON.stringify(data, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('import-dids <file>')
    .description('Import batch of DIDs')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const batch = JSON.parse(contents);

            // Import DIDs by creation time order to avoid dependency errors
            batch.sort((a, b) => a[0].time - b[0].time);

            let chunk = [];
            for (const events of batch) {
                chunk.push(events);

                if (chunk.length >= 10) {
                    console.time('importDIDs');
                    const { verified, updated, failed } = await gatekeeper.importDIDs(chunk);
                    console.timeEnd('importDIDs');
                    console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
                    chunk = [];
                }
            }

            console.time('importDIDs');
            const { verified, updated, failed } = await gatekeeper.importDIDs(chunk);
            console.timeEnd('importDIDs');
            console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('hash-dids <file>')
    .description('Compute hash of batch')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const batch = JSON.parse(contents);

            // Have to sort before the hash
            //batch.sort((a, b) => a[0].time - b[0].time);
            batch.sort((a, b) => new Date(a[0].operation.signature.signed) - new Date(b[0].operation.signature.signed));

            const hash = cipher.hashJSON(batch);
            console.log(hash);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('show-queue <registry>')
    .description('Show queue for a registry')
    .action(async (registry) => {
        try {
            const batch = await gatekeeper.getQueue(registry);
            console.log(JSON.stringify(batch, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('create-batch <registry>')
    .description('Create a batch for a registry')
    .action(async (registry) => {
        try {
            const batch = await gatekeeper.getQueue(registry);
            console.log(JSON.stringify(batch, null, 4));

            if (batch.length > 0) {
                const did = await keymaster.createAsset(batch);
                console.log(did);
            }
            else {
                console.log('empty batch');
            }
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('clear-queue <batch>')
    .description('Clear a registry queue')
    .action(async (batch) => {
        try {
            const events = await keymaster.resolveAsset(batch);
            console.log(JSON.stringify(events, null, 4));
            const ok = await gatekeeper.clearQueue(events);

            if (ok) {
                console.log("Batch cleared");
            }
            else {
                console.log("Error: batch not cleared");
            }
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('import-batch <did> <registry>')
    .description('Import a batch')
    .action(async (did, registry) => {
        try {
            const batch = await keymaster.resolveAsset(did);
            const now = new Date().toISOString();

            for (const i in batch) {
                batch[i].registry = registry;
                batch[i].time = now;
                batch[i].ordinal = i;
            }

            console.log(JSON.stringify(batch, null, 4));
            console.time('importBatch');
            const { verified, updated, failed } = await gatekeeper.importBatch(batch);
            console.timeEnd('importBatch');
            console.log(`* ${verified} verified, ${updated} updated, ${failed} failed`);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('reset-db')
    .description('Reset the database to empty')
    .action(async () => {
        try {
            const response = await gatekeeper.resetDb();
            console.log(response);
        }
        catch (error) {
            console.error(error);
        }
    });

async function run() {
    await keymaster.start(gatekeeper);
    program.parse(process.argv);
    await keymaster.stop();
}

run();
