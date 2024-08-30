import * as keymaster_lib from '../src/keymaster-lib.js';
import * as keymaster_sdk from '../src/keymaster-sdk.js';
import * as gatekeeper_lib from '../src/gatekeeper-lib.js';
import * as gatekeeper_sdk from '../src/gatekeeper-sdk.js';
import * as db_redis from '../src/db-redis.js';
import * as db_wallet from '../src/db-wallet-json.js';
import * as ipfs_lib from '../src/helia-lib.js';

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

// eslint-disable-next-line
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

    let credentials = [];
    let vcs = [];
    let promises;
    const count = 10;

    for (let i = 0; i < 1; i++) {
        console.time('resolve id');
        promises = Array.from({ length: 1000 }, async (_, i) => {
            await keymaster.resolveDID(alice, { confirm: true });
            await keymaster.resolveDID(bob, { confirm: true });
            //console.log(`doc ${i} ${alice}`);
        });
        await Promise.all(promises);
        console.timeEnd('resolve id');
        console.log(`1000 DIDs resolved`);
    }

    console.time('create assets');
    promises = Array.from({ length: count }, async (_, i) => {
        const did = await keymaster.createAsset({ title: 'mock' });
        console.log(`asset ${i} ${did}`);
    });
    await Promise.all(promises);
    console.timeEnd('create assets');
    console.log(`${count} assets issued`);

    keymaster.setCurrentId('Alice');

    console.time('encrypt message');
    promises = Array.from({ length: count }, async (_, i) => {
        const did = await keymaster.encrypt("howdy", bob);
        console.log(`cipher ${i} ${did}`);
    });
    await Promise.all(promises);
    console.timeEnd('encrypt message');
    console.log(`${count} messages encrypted`);

    console.time('setCurrentId');
    keymaster.setCurrentId('Alice');
    console.timeEnd('setCurrentId');

    console.time('issue credentials');
    promises = Array.from({ length: count }, async (_, i) => {
        const credential = await keymaster.createCredential(mockSchema, registry);
        credentials.push(credential);
        console.log(`credential ${i} ${credential}`);

        const bc = await keymaster.bindCredential(credential, bob);
        const vc = await keymaster.issueCredential(bc, registry);
        vcs.push(vc);
        console.log(`vc ${i} ${vc}`);
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

    console.time(`verify responses`);
    promises = Array.from({ length: count }, async (_, i) => {
        keymaster.setCurrentId('Alice');
        const challenge = await keymaster.createChallenge({ credentials: [{ schema: credentials[i] }] });

        keymaster.setCurrentId('Bob');
        const response = await keymaster.createResponse(challenge);

        keymaster.setCurrentId('Alice');
        const verify = await keymaster.verifyResponse(response, challenge);

        console.log(`${i} ${verify.match}`);
    });
    await Promise.all(promises);
    console.timeEnd(`verify responses`);
    console.log(`${count} responses verified`);
}

async function main() {
    // await setup1();
    await setup2();
    // await setup3();

    const backup = await keymaster.loadWallet();
    await keymaster.newWallet(null, true);

    try {
        console.time('runWorkflow');
        await runWorkflow();
        console.timeEnd('runWorkflow');
    }
    catch (error) {
        console.log(error);
    }

    await keymaster.saveWallet(backup);

    keymaster.stop();
    process.exit();
}

main();
