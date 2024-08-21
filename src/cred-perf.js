import fs from 'fs';
import * as keymaster_lib from './keymaster-lib.js';
import * as keymaster_sdk from './keymaster-sdk.js';
import * as gatekeeper_lib from './gatekeeper-lib.js';
import * as gatekeeper_sdk from './gatekeeper-sdk.js';
import * as db_redis from './db-redis.js';
import * as db_wallet from './db-wallet-json.js';
import * as ipfs_lib from './helia-lib.js';

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

    await db_redis.start('mdip');
    await gatekeeper.start(db_redis, ipfs_lib);
    await keymaster.start(gatekeeper, db_wallet);
}


// eslint-disable-next-line
async function setup2() {
    gatekeeper = gatekeeper_sdk;
    keymaster = keymaster_lib;

    gatekeeper.setURL('http://localhost:4224');
    await gatekeeper.waitUntilReady();
    await keymaster.start(gatekeeper, db_wallet);
}

// eslint-disable-next-line
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
    console.timeEnd('create IDs');

    console.log(`Created Alice  ${alice}`);
    console.log(`Created Bob    ${bob}`);

    console.time('setCurrentId');
    keymaster.setCurrentId('Alice');
    console.timeEnd('setCurrentId');

    console.time('createCredential');
    const credential1 = await keymaster.createCredential(mockSchema, registry);
    console.timeEnd('createCredential');

    console.time('loop');
    for (let i = 0; i < 100; i++) {

        console.time('bindCredential');
        const bc = await keymaster.bindCredential(credential1, bob);
        console.timeEnd('bindCredential');

        console.time('fetchKeyPair');
        const keypair = await keymaster.fetchKeyPair();
        console.timeEnd('fetchKeyPair');

        const operation = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                version: 1,
                type: "asset",
                registry: registry,
            },
            controller: alice,
            data: { keypair },
        };

        console.time('addSignature');
        const signed = await keymaster.addSignature(operation);
        console.timeEnd('addSignature');

        console.time('createDID');
        const did = await gatekeeper.createDID(signed);
        console.timeEnd('createDID');


        // console.time('createAsset');
        // const asset = await keymaster.createAsset({ keypair });
        // console.timeEnd('createAsset');

        // console.time('issueCredential');
        // const vc = await keymaster.issueCredential(bc, registry);
        // console.timeEnd('issueCredential');
        // console.log(`${i} ${vc}`);
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
