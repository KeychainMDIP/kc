import fs from 'fs';
import * as keymaster_lib from './keymaster-lib.js';
import * as keymaster_sdk from './keymaster-sdk.js';
import * as gatekeeper_lib from './gatekeeper-lib.js';
import * as gatekeeper_sdk from './gatekeeper-sdk.js';
import * as db_json from './db-json.js';
import * as db_redis from './db-redis.js';
import * as db_wallet from './db-wallet-json.js';

const mockSchema = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "properties": {
        "email": {
            "format": "email",
            "type": "string"
        }
    },
    "required": [
        "email"
    ],
    "type": "object"
};

let keymaster;
let gatekeeper;

async function setup1() {
    gatekeeper = gatekeeper_lib;
    keymaster = keymaster_lib;

    await db_redis.start();
    await gatekeeper.start(db_redis);
    await keymaster.start(gatekeeper, db_wallet);
}

async function setup2() {
    gatekeeper = gatekeeper_sdk;
    keymaster = keymaster_lib;

    gatekeeper.setURL('http://localhost:4224');
    await gatekeeper.waitUntilReady();
    await keymaster.start(gatekeeper, db_wallet);
}

async function setup3() {
    keymaster = keymaster_sdk;
    keymaster.setURL('http://localhost:4224');
    await keymaster.waitUntilReady();
}

async function runWorkflow() {
    const registry = 'hyperswarm';

    console.time('create IDs');
    const alice = await keymaster.createId('Alice', registry);
    const bob = await keymaster.createId('Bob', registry);
    const carol = await keymaster.createId('Carol', registry);
    const victor = await keymaster.createId('Victor', registry);
    console.timeEnd('create IDs');

    console.log(`Created Alice  ${alice}`);
    console.log(`Created Bob    ${bob}`);
    console.log(`Created Carol  ${carol}`);
    console.log(`Created Victor ${victor}`);

    console.time('loop');
    for (let i = 0; i < 10; i++) {
        console.time('setCurrentId');
        keymaster.setCurrentId('Alice');
        console.timeEnd('setCurrentId');

        console.time('createCredential');
        const credential1 = await keymaster.createCredential(mockSchema, registry);
        console.timeEnd('createCredential');

        console.time('bindCredential');
        const bc1 = await keymaster.bindCredential(credential1, carol);
        console.timeEnd('bindCredential');

        console.time('issueCredential');
        const vc1 = await keymaster.issueCredential(bc1, registry);
        console.timeEnd('issueCredential');

        // console.time('setCurrentId');
        // keymaster.setCurrentId('Carol');
        // console.timeEnd('setCurrentId');

        // console.time('acceptCredential');
        // await keymaster.acceptCredential(vc1);
        // console.timeEnd('acceptCredential');
    }
    console.timeEnd('loop');

    keymaster.stop();
}

async function main() {
    await setup1();
    // await setup2();
    // await setup3();

    const walletFile = 'data/wallet.json';
    const backupFile = 'data/workflow-backup.json';

    if (fs.existsSync(walletFile)) {
        fs.renameSync(walletFile, backupFile);
    }

    try {
        await runWorkflow();
    }
    catch (error) {
        console.log(error);
    }

    fs.rmSync(walletFile);

    if (fs.existsSync(backupFile)) {
        fs.renameSync(backupFile, walletFile);
    }

    process.exit();
}

main();
