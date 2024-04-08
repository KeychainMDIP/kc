import fs from 'fs';
import * as keymaster from './keymaster.js';
import * as gatekeeper from './gatekeeper.js';
import * as db_json from './db-json.js';

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
    const walletFile = 'data/wallet.json';
    const backupFile = 'data/workflow-backup.json';

    if (fs.existsSync(walletFile)) {
        fs.renameSync(walletFile, backupFile);
    }

    await db_json.start('mdip-workflow');
    await gatekeeper.start(db_json);
    await keymaster.start(gatekeeper);

    const alice = await keymaster.createId('Alice');
    const bob = await keymaster.createId('Bob');
    const carol = await keymaster.createId('Carol');
    const victor = await keymaster.createId('Victor');

    console.log(`Created Alice  ${alice}`);
    console.log(`Created Bob    ${bob}`);
    console.log(`Created Carol  ${carol}`);
    console.log(`Created Victor ${victor}`);

    keymaster.useId('Alice');

    const credential1 = await keymaster.createCredential(mockSchema);
    const credential2 = await keymaster.createCredential(mockSchema);

    console.log(`Alice created credential1  ${credential1}`);
    console.log(`Alice created credential2  ${credential2}`);

    const bc1 = await keymaster.bindCredential(credential1, carol);
    const bc2 = await keymaster.bindCredential(credential2, carol);

    const vc1 = await keymaster.attestCredential(bc1);
    const vc2 = await keymaster.attestCredential(bc2);

    console.log(`Alice attested vc1 for Carol ${vc1}`);
    console.log(`Alice attested vc2 for Carol ${vc2}`);

    keymaster.useId('Bob');

    const credential3 = await keymaster.createCredential(mockSchema);
    const credential4 = await keymaster.createCredential(mockSchema);

    console.log(`Bob created credential3  ${credential3}`);
    console.log(`Bob created credential4  ${credential4}`);

    const bc3 = await keymaster.bindCredential(credential3, carol);
    const bc4 = await keymaster.bindCredential(credential4, carol);

    const vc3 = await keymaster.attestCredential(bc3);
    const vc4 = await keymaster.attestCredential(bc4);

    console.log(`Bob attested vc3 for Carol ${vc3}`);
    console.log(`Bob attested vc4 for Carol ${vc4}`);

    keymaster.useId('Carol');

    await keymaster.acceptCredential(vc1);
    await keymaster.acceptCredential(vc2);
    await keymaster.acceptCredential(vc3);
    await keymaster.acceptCredential(vc4);

    console.log(`Carol accepted all 4 VCs`);

    keymaster.useId('Victor');

    const mockChallenge = {
        credentials: [
            {
                schema: credential1,
                attestors: [alice]
            },
            {
                schema: credential2,
                attestors: [alice]
            },
            {
                schema: credential3,
                attestors: [bob]
            },
            {
                schema: credential4,
                attestors: [bob]
            },
        ]
    };
    const challengeDid = await keymaster.createChallenge(mockChallenge);
    console.log(`Victor created challenge ${challengeDid}`);

    keymaster.useId('Carol');
    const vpDid = await keymaster.createResponse(challengeDid);
    console.log(`Carol created response for Victor ${vpDid}`);

    keymaster.useId('Victor');

    const vcList = await keymaster.verifyResponse(vpDid);
    console.log(`Victor verified response ${vcList.length} valid credentials`);

    keymaster.useId('Alice');
    await keymaster.rotateKeys();

    keymaster.useId('Bob');
    await keymaster.rotateKeys();

    keymaster.useId('Carol');
    await keymaster.rotateKeys();

    keymaster.useId('Victor');
    await keymaster.rotateKeys();

    console.log(`All agents rotated their keys`);

    const vcList2 = await keymaster.verifyResponse(vpDid);
    console.log(`Victor verified response ${vcList2.length} valid credentials`);

    keymaster.useId('Alice');
    await keymaster.revokeCredential(vc1);
    console.log(`Alice revoked vc1`);

    keymaster.useId('Victor');
    const vcList3 = await keymaster.verifyResponse(vpDid);
    console.log(`Victor verified response ${vcList3.length} valid credentials`);

    keymaster.useId('Bob');
    await keymaster.revokeCredential(vc3);
    console.log(`Bob revoked vc3`);

    keymaster.useId('Victor');
    const vcList4 = await keymaster.verifyResponse(vpDid);
    console.log(`Victor verified response ${vcList4.length} valid credentials`);

    keymaster.stop();

    fs.rmSync(walletFile);

    if (fs.existsSync(backupFile)) {
        fs.renameSync(backupFile, walletFile);
    }

    process.exit();
}

runWorkflow();
