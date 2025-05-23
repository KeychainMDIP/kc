import { program } from 'commander';
import fs from 'fs';
import dotenv from 'dotenv';

import GatekeeperClient from '@mdip/gatekeeper/client';
import CipherNode from '@mdip/cipher/node';

dotenv.config();

const gatekeeperURL = process.env.KC_GATEKEEPER_URL || 'http://localhost:4224';
const gatekeeper = new GatekeeperClient();
const cipher = new CipherNode();

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

            batch = [];
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

                batch = [];
                console.time('getDIDs({ dids: batch, verify: true, resolve: true })');
                for (const did of dids) {
                    batch.push(did);

                    if (batch.length > 99) {
                        await gatekeeper.getDIDs({ dids: batch, verify: true, resolve: true });
                        batch = [];
                    }
                }
                await gatekeeper.getDIDs({ dids: batch, verify: true, resolve: true });
                console.timeEnd('getDIDs({ dids: batch, verify: true, resolve: true })');
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
    .command('import-batch-file <file> [registry]')
    .description('Import batch of events')
    .action(async (file, registry) => {
        if (!registry) {
            registry = 'local';
        }

        try {
            const contents = fs.readFileSync(file).toString();
            let batch = JSON.parse(contents);
            let chunk = [];

            for (const event of batch) {
                event.registry = registry;

                chunk.push(event);

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
            const response = await gatekeeper.verifyDb();
            console.log(`${JSON.stringify(response)}`);
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

program
    .command('get-status')
    .description('Report gatekeeper status')
    .action(async () => {
        try {
            const response = await gatekeeper.getStatus();
            console.log(JSON.stringify(response, null, 4));
        }
        catch (error) {
            console.error(error);
        }
    });


program
    .command('cas-add-text <text>')
    .description('Add text to the CAS')
    .action(async (text) => {
        try {
            const cid = await gatekeeper.addText(text);
            console.log(cid);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('cas-get-text <cid>')
    .description('Get text from the CAS')
    .action(async (cid) => {
        try {
            const text = await gatekeeper.getText(cid);
            console.log(text);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('cas-add-file <file>')
    .description('Add a file to the CAS')
    .action(async (file) => {
        try {
            const data = fs.readFileSync(file);
            const cid = await gatekeeper.addData(data);
            console.log(cid);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('cas-get-file <cid> <file>')
    .description('Get a file from the CAS')
    .action(async (cid, file) => {
        try {
            const data = await gatekeeper.getData(cid);
            fs.writeFileSync(file, data);
            console.log(`Data written to ${file}`);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('cas-add-json <file>')
    .description('Add JSON file to the CAS')
    .action(async (file) => {
        try {
            const contents = fs.readFileSync(file);
            const json = JSON.parse(contents.toString());
            const cid = await gatekeeper.addJSON(json);
            console.log(cid);
        }
        catch (error) {
            console.error(error);
        }
    });

program
    .command('cas-get-json <cid>')
    .description('Get JSON from the CAS')
    .action(async (cid) => {
        try {
            const json = await gatekeeper.getJSON(cid);
            console.log(JSON.stringify(json, null, 2));
        } catch (error) {
            console.error(error);
        }
    });

program
    .command('get-block <registry> [blockHeightOrHash]')
    .description('Get block info for registry')
    .action(async (registry, blockHeightOrHash) => {
        try {
            const block = await gatekeeper.getBlock(registry, blockHeightOrHash);
            console.log(JSON.stringify(block, null, 2));
        } catch (error) {
            console.error(error);
        }
    });

async function run() {
    gatekeeper.connect({ url: gatekeeperURL });
    program.parse(process.argv);
}

run();
