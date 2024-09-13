import * as keymaster from './keymaster-lib.js';
import * as gatekeeper from './gatekeeper-lib.js';
import * as db_json from './db-json.js';
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

async function runWorkflow() {

    const alice = await keymaster.createId('Alice', 'local');
    const bob = await keymaster.createId('Bob', 'local');
    const carol = await keymaster.createId('Carol', 'local');
    const victor = await keymaster.createId('Victor', 'local');

    console.log(`Created Alice  ${alice}`);
    console.log(`Created Bob    ${bob}`);
    console.log(`Created Carol  ${carol}`);
    console.log(`Created Victor ${victor}`);

    keymaster.setCurrentId('Alice');

    const credential1 = await keymaster.createCredential(mockSchema, 'local');
    const credential2 = await keymaster.createCredential(mockSchema, 'local');

    console.log(`Alice created credential1  ${credential1}`);
    console.log(`Alice created credential2  ${credential2}`);

    const bc1 = await keymaster.bindCredential(credential1, carol);
    const bc2 = await keymaster.bindCredential(credential2, carol);

    const vc1 = await keymaster.issueCredential(bc1, 'local');
    const vc2 = await keymaster.issueCredential(bc2, 'local');

    console.log(`Alice issued vc1 for Carol ${vc1}`);
    console.log(`Alice issued vc2 for Carol ${vc2}`);

    keymaster.setCurrentId('Bob');

    const credential3 = await keymaster.createCredential(mockSchema, 'local');
    const credential4 = await keymaster.createCredential(mockSchema, 'local');

    console.log(`Bob created credential3  ${credential3}`);
    console.log(`Bob created credential4  ${credential4}`);

    const bc3 = await keymaster.bindCredential(credential3, carol);
    const bc4 = await keymaster.bindCredential(credential4, carol);

    const vc3 = await keymaster.issueCredential(bc3, 'local');
    const vc4 = await keymaster.issueCredential(bc4, 'local');

    console.log(`Bob issued vc3 for Carol ${vc3}`);
    console.log(`Bob issued vc4 for Carol ${vc4}`);

    keymaster.setCurrentId('Carol');

    await keymaster.acceptCredential(vc1);
    await keymaster.acceptCredential(vc2);
    await keymaster.acceptCredential(vc3);
    await keymaster.acceptCredential(vc4);

    console.log(`Carol accepted all 4 VCs`);

    keymaster.setCurrentId('Victor');

    const mockChallenge = {
        challenge: {
            credentials: [
                {
                    schema: credential1,
                    issuers: [alice]
                },
                {
                    schema: credential2,
                    issuers: [alice]
                },
                {
                    schema: credential3,
                    issuers: [bob]
                },
                {
                    schema: credential4,
                    issuers: [bob]
                },
            ]
        }
    };
    const challengeDid = await keymaster.createChallenge(mockChallenge, 'local');
    console.log(`Victor created challenge ${challengeDid}`);

    keymaster.setCurrentId('Carol');
    const vpDid = await keymaster.createResponse(challengeDid, 'local');
    console.log(`Carol created response for Victor ${vpDid}`);

    keymaster.setCurrentId('Victor');

    const verify1 = await keymaster.verifyResponse(vpDid, challengeDid);
    console.log(`Victor verified response ${verify1.vps.length} valid credentials`);

    keymaster.setCurrentId('Alice');
    await keymaster.rotateKeys();

    keymaster.setCurrentId('Bob');
    await keymaster.rotateKeys();

    keymaster.setCurrentId('Carol');
    await keymaster.rotateKeys();

    keymaster.setCurrentId('Victor');
    await keymaster.rotateKeys();

    console.log(`All agents rotated their keys`);

    const verify2 = await keymaster.verifyResponse(vpDid, challengeDid);
    console.log(`Victor verified response ${verify2.vps.length} valid credentials`);

    keymaster.setCurrentId('Alice');
    await keymaster.revokeCredential(vc1);
    console.log(`Alice revoked vc1`);

    keymaster.setCurrentId('Victor');
    const verify3 = await keymaster.verifyResponse(vpDid, challengeDid);
    console.log(`Victor verified response ${verify3.vps.length} valid credentials`);

    keymaster.setCurrentId('Bob');
    await keymaster.revokeCredential(vc3);
    console.log(`Bob revoked vc3`);

    keymaster.setCurrentId('Victor');
    const verify4 = await keymaster.verifyResponse(vpDid, challengeDid);
    console.log(`Victor verified response ${verify4.vps.length} valid credentials`);

    keymaster.stop();
}

async function main() {
    await db_json.start('mdip-workflow');
    await gatekeeper.start(db_json);
    await keymaster.start(gatekeeper, db_wallet);

    const backup = keymaster.loadWallet();
    keymaster.newWallet(null, true);

    try {
        await runWorkflow();
    }
    catch (error) {
        console.log(error);
    }

    keymaster.saveWallet(backup);
    process.exit();
}

main();
