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
    keymaster.setURL('http://localhost:4226');
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
    const credential = await keymaster.createCredential(mockSchema, registry);
    console.timeEnd('createCredential');

    let vcs = [];
    let promises;
    const count = 10;

    console.time('issue credentials');
    promises = Array.from({ length: count }, async (_, i) => {
        keymaster.setCurrentId('Alice');
        const bc = await keymaster.bindCredential(credential, bob);
        const vc = await keymaster.issueCredential(bc, registry);
        vcs.push(vc);
        console.log(`${i} ${vc}`);
    });
    await Promise.all(promises);
    console.timeEnd('issue credentials');
    console.log(`${count} credentials issued`);

    console.time(`accept vcs`);
    keymaster.setCurrentId('Bob');
    for (const vc of vcs) {
        promises.push(keymaster.acceptCredential(vc));
    }
    await Promise.all(promises);
    console.timeEnd('accept vcs');
    console.log(`${vcs.length} accepted`);

    // console.time('verify 100 challenges');
    // const promises2 = Array.from({ length: 100 }, async (_, i) => {
    //     keymaster.setCurrentId('Alice');
    //     const challenge = await keymaster.createChallenge({ credentials: [{ schema: credential }] });

    //     keymaster.setCurrentId('Bob');
    //     const response = await keymaster.createResponse(challenge);

    //     keymaster.setCurrentId('Alice');
    //     const verify = await keymaster.verifyResponse(response, challenge);

    //     console.log(`${i} ${verify.match}`);
    // });
    // await Promise.all(promises2);
    // console.timeEnd('verify 100 challenges');
}

async function main() {
    // await setup1();
    // await setup2();
    await setup3();

    const walletFile = 'data/wallet.json';
    const backupFile = 'data/perf-backup.json';

    if (fs.existsSync(walletFile)) {
        fs.renameSync(walletFile, backupFile);
    }

    try {
        await runWorkflow();
    }
    catch (error) {
        console.log(error);
    }

    if (fs.existsSync(backupFile)) {
        fs.copyFileSync(backupFile, walletFile);
    }

    keymaster.stop();
    process.exit();
}

main();
