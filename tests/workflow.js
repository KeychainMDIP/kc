import Keymaster from '@mdip/keymaster';
import WalletJson from '@mdip/keymaster/wallet/json';
import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJson from '@mdip/gatekeeper/db/json';

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

async function runWorkflow(keymaster) {

    const alice = await keymaster.createId('Alice', { registry: 'local' });
    const bob = await keymaster.createId('Bob', { registry: 'local' });
    const carol = await keymaster.createId('Carol', { registry: 'local' });
    const victor = await keymaster.createId('Victor', { registry: 'local' });

    console.log(`Created Alice  ${alice}`);
    console.log(`Created Bob    ${bob}`);
    console.log(`Created Carol  ${carol}`);
    console.log(`Created Victor ${victor}`);

    await keymaster.setCurrentId('Alice');

    const schema1 = await keymaster.createSchema(mockSchema, { registry: 'local' });
    const schema2 = await keymaster.createSchema(mockSchema, { registry: 'local' });

    console.log(`Alice created schema1 ${schema1}`);
    console.log(`Alice created schema2 ${schema2}`);

    const bc1 = await keymaster.bindCredential(schema1, carol);
    const bc2 = await keymaster.bindCredential(schema2, carol);

    const vc1 = await keymaster.issueCredential(bc1, { registry: 'local' });
    const vc2 = await keymaster.issueCredential(bc2, { registry: 'local' });

    console.log(`Alice issued vc1 for Carol ${vc1}`);
    console.log(`Alice issued vc2 for Carol ${vc2}`);

    await keymaster.setCurrentId('Bob');

    const schema3 = await keymaster.createSchema(mockSchema, { registry: 'local' });
    const schema4 = await keymaster.createSchema(mockSchema, { registry: 'local' });

    console.log(`Bob created schema3 ${schema3}`);
    console.log(`Bob created schema4 ${schema4}`);

    const bc3 = await keymaster.bindCredential(schema3, carol);
    const bc4 = await keymaster.bindCredential(schema4, carol);

    const vc3 = await keymaster.issueCredential(bc3, { registry: 'local' });
    const vc4 = await keymaster.issueCredential(bc4, { registry: 'local' });

    console.log(`Bob issued vc3 for Carol ${vc3}`);
    console.log(`Bob issued vc4 for Carol ${vc4}`);

    await keymaster.setCurrentId('Carol');

    await keymaster.acceptCredential(vc1);
    await keymaster.acceptCredential(vc2);
    await keymaster.acceptCredential(vc3);
    await keymaster.acceptCredential(vc4);

    console.log(`Carol accepted all 4 VCs`);

    await keymaster.setCurrentId('Victor');

    const mockChallenge = {
        credentials: [
            {
                schema: schema1,
                issuers: [alice]
            },
            {
                schema: schema2,
                issuers: [alice]
            },
            {
                schema: schema3,
                issuers: [bob]
            },
            {
                schema: schema4,
                issuers: [bob]
            },
        ]
    };
    const challengeDid = await keymaster.createChallenge(mockChallenge, { registry: 'local' });
    console.log(`Victor created challenge ${challengeDid}`);

    await keymaster.setCurrentId('Carol');
    const vpDid = await keymaster.createResponse(challengeDid, { registry: 'local' });
    console.log(`Carol created response for Victor ${vpDid}`);

    await keymaster.setCurrentId('Victor');

    const verify1 = await keymaster.verifyResponse(vpDid);
    console.log(`Victor verified response ${verify1.vps.length} valid credentials`);

    await keymaster.setCurrentId('Alice');
    await keymaster.rotateKeys();

    await keymaster.setCurrentId('Bob');
    await keymaster.rotateKeys();

    await keymaster.setCurrentId('Carol');
    await keymaster.rotateKeys();

    await keymaster.setCurrentId('Victor');
    await keymaster.rotateKeys();

    console.log(`All agents rotated their keys`);

    const verify2 = await keymaster.verifyResponse(vpDid);
    console.log(`Victor verified response ${verify2.vps.length} valid credentials`);

    await keymaster.setCurrentId('Alice');
    await keymaster.revokeCredential(vc1);
    console.log(`Alice revoked vc1`);

    await keymaster.setCurrentId('Victor');
    const verify3 = await keymaster.verifyResponse(vpDid);
    console.log(`Victor verified response ${verify3.vps.length} valid credentials`);

    await keymaster.setCurrentId('Bob');
    await keymaster.revokeCredential(vc3);
    console.log(`Bob revoked vc3`);

    await keymaster.setCurrentId('Victor');
    const verify4 = await keymaster.verifyResponse(vpDid);
    console.log(`Victor verified response ${verify4.vps.length} valid credentials`);
}

async function main() {
    const db = new DbJson('mdip-workflow');
    const gatekeeper = new Gatekeeper({ db });

    const wallet = new WalletJson();
    const cipher = new CipherNode();
    const keymaster = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'passphrase' });

    const backup = await keymaster.loadWallet();
    await keymaster.newWallet(null, true);

    try {
        await runWorkflow(keymaster);
    }
    catch (error) {
        console.log(error);
    }

    await keymaster.saveWallet(backup);
    process.exit();
}

main();
