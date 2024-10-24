import { program } from 'commander';
import fs from 'fs';
import dotenv from 'dotenv';

import * as gatekeeper from '@mdip/gatekeeper/sdk';
import * as keymaster from '@mdip/keymaster/lib';
import * as wallet from '@mdip/keymaster/db/json';
import * as cipher from '@mdip/cipher/node';

dotenv.config();
const gatekeeperURL = process.env.KC_CLI_GATEKEEPER_URL || 'http://localhost:4224';

program
    .version('1.0.0')
    .description('Admin CLI tool')
    .configureHelp({ sortSubcommands: true });

program
    .command('resolve-did <did> [confirm]')
    .description('Return document associated with DID')
    .action(async (did, confirm) => {
        try {
            const doc = await gatekeeper.resolveDID(did, { confirm: !!confirm });
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(`cannot resolve ${did}`);
        }
    });

program
    .command('verify-did <did>')
    .description('Return verified document associated with DID')
    .action(async (did, confirm) => {
        try {
            const doc = await gatekeeper.resolveDID(did, { verify: true });
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(`cannot verify ${did}`);
        }
    });

program
    .command('get-dids [updatedAfter] [updatedBefore] [confirm] [resolve]')
    .description('Fetch all DIDs')
    .action(async (updatedAfter, updatedBefore, confirm, resolve) => {
        try {
            let options = {};

            const after = new Date(updatedAfter);

            if (!isNaN(after.getTime())) {
                options.updatedAfter = after.toISOString();
            }

            const before = new Date(updatedBefore);

            if (!isNaN(before.getTime())) {
                options.updatedBefore = before.toISOString();
            }

            if (confirm) {
                options.confirm = confirm === 'true';
            }

            if (resolve) {
                options.resolve = resolve === 'true';
            }

            const dids = await gatekeeper.getDIDs(options);
            console.log(JSON.stringify(dids, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('perf-test [full]')
    .description('DID resolution performance test')
    .action(async (full) => {
        try {
            console.time('getDIDs');
            const dids = await gatekeeper.getDIDs();
            console.timeEnd('getDIDs');

            console.log(`${dids.length} DIDs`);

            console.time('resolveDID(did, { confirm: true })');
            for (const did of dids) {
                await gatekeeper.resolveDID(did, { confirm: true });
            }
            console.timeEnd('resolveDID(did, { confirm: true })');

            let batch = [];
            console.time('getDIDs({ dids: batch, confirm: true, resolve: true })');
            for (const did of dids) {
                batch.push(did);

                if (batch.length > 99) {
                    await gatekeeper.getDIDs({ dids: batch, confirm: true, resolve: true });
                    batch = [];
                }
            }
            await gatekeeper.getDIDs({ dids: batch, confirm: true, resolve: true });
            console.timeEnd('getDIDs({ dids: batch, confirm: true, resolve: true })');

            console.time('resolveDID(did, { confirm: false })');
            for (const did of dids) {
                await gatekeeper.resolveDID(did, { confirm: false });
            }
            console.timeEnd('resolveDID(did, { confirm: false })');

            console.time('getDIDs({ dids: batch, confirm: false, resolve: true })');
            for (const did of dids) {
                batch.push(did);

                if (batch.length > 99) {
                    await gatekeeper.getDIDs({ dids: batch, confirm: false, resolve: true });
                    batch = [];
                }
            }
            await gatekeeper.getDIDs({ dids: batch, confirm: false, resolve: true });
            console.timeEnd('getDIDs({ dids: batch, confirm: false, resolve: true })');

            console.time('exportDIDs');
            await gatekeeper.exportDIDs(dids);
            console.timeEnd('exportDIDs');

            if (full) {
                console.time('resolveDID(did, { verify: true })');
                for (const did of dids) {
                    await gatekeeper.resolveDID(did, { verify: true });
                }
                console.timeEnd('resolveDID(did, { verify: true })');
            }
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('export-did <did>')
    .description('Export DID to file')
    .action(async (did) => {
        try {
            const ops = await gatekeeper.exportDIDs([did]);
            console.log(JSON.stringify(ops, null, 4));
        }
        catch (error) {
            console.error(error.message);
        }
    });

program
    .command('import-did <file>')
    .description('Import DID from file')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const did = JSON.parse(contents);
            const response = await gatekeeper.importDIDs(did);
            console.log(response);
        }
        catch (error) {
            console.error(error.message);
        }
    });

program
    .command('export-dids')
    .description('Export all DIDs')
    .action(async () => {
        try {
            const response = await gatekeeper.exportDIDs();
            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('import-dids <file>')
    .description('Import DIDs from file')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const dids = JSON.parse(contents);
            let chunk = [];

            for (const did of dids) {
                chunk.push(did);

                if (chunk.length > 100) {
                    const response = await gatekeeper.importDIDs(chunk);
                    console.log(response);
                    chunk = [];
                }
            }

            const response = await gatekeeper.importDIDs(chunk);
            console.log(response);
        }
        catch (error) {
            console.error(error.message);
        }
    });

program
    .command('export-batch')
    .description('Export all events in a batch')
    .action(async () => {
        try {
            const response = await gatekeeper.exportBatch();
            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('import-batch <file>')
    .description('Import batch of events')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file).toString();
            const batch = JSON.parse(contents);
            let chunk = [];

            for (const events of batch) {
                chunk.push(events);

                if (chunk.length >= 100) {
                    const response = await gatekeeper.importBatch(chunk);
                    console.log(response);
                    chunk = [];
                }
            }
            const response = await gatekeeper.importBatch(chunk);
            console.log(response);
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
    .command('clear-queue <registry> <batch>')
    .description('Clear a registry queue')
    .action(async (registry, batch) => {
        try {
            const events = await keymaster.resolveAsset(batch);
            console.log(JSON.stringify(events, null, 4));
            const ok = await gatekeeper.clearQueue(registry, events);

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
    .command('import-batch <did> [registry]')
    .description('Import a batch')
    .action(async (did, registry) => {
        try {
            if (!registry) {
                registry = 'local';
            }

            const queue = await keymaster.resolveAsset(did);
            const batch = [];
            const now = new Date();

            for (let i = 0; i < queue.length; i++) {
                batch.push({
                    registry: registry,
                    time: now.toISOString(),
                    ordinal: [now.getTime(), i],
                    operation: queue[i],
                });
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

program
    .command('verify-db')
    .description('Verify all the DIDs in the db')
    .action(async () => {
        try {
            const invalid = await gatekeeper.verifyDb();
            console.log(`${invalid} invalid DIDs removed from MDIP db`);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('resolve-seed-bank')
    .description('Resolves the seed bank ID')
    .action(async () => {
        try {
            const doc = await keymaster.resolveSeedBank();
            console.log(JSON.stringify(doc, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('list-registries')
    .description('List supported registries')
    .action(async () => {
        try {
            const response = await gatekeeper.listRegistries();
            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('process-events')
    .description('Process events queue')
    .action(async () => {
        try {
            const response = await gatekeeper.processEvents();
            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });

async function run() {
    gatekeeper.start({ url: gatekeeperURL });
    await keymaster.start({ gatekeeper, wallet, cipher });
    program.parse(process.argv);
    await keymaster.stop();
}

run();
