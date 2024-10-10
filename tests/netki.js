import * as gatekeeper_lib from '@mdip/gatekeeper/lib';
import * as gatekeeper_sdk from '@mdip/gatekeeper/sdk';
import * as keymaster_lib from '@mdip/keymaster/lib';
import * as keymaster_sdk from '@mdip/keymaster/sdk';
import * as wallet from '@mdip/keymaster/db/json';
import * as db_json from '@mdip/gatekeeper/db/json';
import * as db_redis from '@mdip/gatekeeper/db/redis';
import * as cipher from '@mdip/cipher/node';

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

let gatekeeper;
let keymaster;

// eslint-disable-next-line
async function setup1() {
    //await db_json.start('mdip');
    await db_redis.start('mdip');
    await gatekeeper_lib.start({ db: db_redis, primeCache: true });
    await keymaster_lib.start({ gatekeeper: gatekeeper_lib, wallet, cipher });

    gatekeeper = gatekeeper_lib;
    keymaster = keymaster_lib;
}

// eslint-disable-next-line
async function setup2() {
    await gatekeeper_sdk.start({ url: 'http://localhost:4224' });
    await keymaster_lib.start({ gatekeeper: gatekeeper_sdk, wallet, cipher });

    gatekeeper = gatekeeper_sdk;
    keymaster = keymaster_lib;
}

// eslint-disable-next-line
async function setup3() {
    await gatekeeper_sdk.start({ url: 'http://localhost:4224' });
    await keymaster_sdk.start({ url: 'http://localhost:4226' });

    gatekeeper = gatekeeper_sdk;
    keymaster = keymaster_sdk;
}

async function perfTest() {
    console.time('getDIDs');
    const dids = await gatekeeper.getDIDs();
    console.timeEnd('getDIDs');

    console.log(`${dids.length} DIDs`);

    let n = 0;
    console.time('resolveDID(did, { confirm: true })');
    for (const did of dids) {
        n += 1;
        await gatekeeper.resolveDID(did, { confirm: true });
        console.log(`${n} ${did}`);
    }
    console.timeEnd('resolveDID(did, { confirm: true })');
}

async function runWorkflow() {

    //await perfTest();
    //await perfTest();

    const registry = 'local';

    console.time('createId');
    const alice = await keymaster.createId('Alice', { registry });
    console.timeEnd('createId');
    const bob = await keymaster.createId('Bob', { registry });

    console.log(`Created Alice  ${alice}`);
    console.log(`Created Bob    ${bob}`);

    await keymaster.setCurrentId('Alice');

    //await perfTest();

    for (let i = 0; i < 5; i++) {
        console.time('resolveId');
        await keymaster.resolveId(alice);
        console.timeEnd('resolveId');
    }

    for (let i = 0; i < 5; i++) {
        console.time('createSchema');
        await keymaster.createSchema(mockSchema, { registry });
        console.timeEnd('createSchema');
    }

    //await perfTest();

    console.time('createSchema');
    const schema1 = await keymaster.createSchema(mockSchema, { registry });
    console.timeEnd('createSchema');
    console.log(`Alice created schema1 ${schema1}`);

    const bc1 = await keymaster.bindCredential(schema1, bob);

    for (let i = 0; i < 10; i++) {
        console.time('issueCredential');
        const vc1 = await keymaster.issueCredential(bc1, { registry });
        console.timeEnd('issueCredential');
        console.log(`Alice issued vc ${i} for Bob ${vc1}`);
    }
    
    await keymaster.stop();
}

async function main() {
    await setup1();
    // await setup2();
    // await setup3();

    const backup = await keymaster.loadWallet();
    await keymaster.newWallet(null, true);

    try {
        await runWorkflow();
    }
    catch (error) {
        console.log(error);
    }

    await keymaster.saveWallet(backup);
    process.exit();
}

main();
