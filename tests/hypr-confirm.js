import GatekeeperClient from '@mdip/gatekeeper/sdk';
import * as keymaster from '@mdip/keymaster/lib';
import * as wallet from '@mdip/keymaster/db/json';
import * as cipher from '@mdip/cipher/node';

const gatekeeper = new GatekeeperClient();

async function runTest() {
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 1);
    const testOptions = { registry: 'hyperswarm', validUntil: expires.toISOString() };

    const alice = await keymaster.createId('Alice', testOptions);
    console.log(`alice: ${alice}`);

    const asset = await keymaster.createAsset({ version: 1 }, testOptions);
    const doc1 = await keymaster.resolveDID(asset);
    console.log(JSON.stringify(doc1, null, 4));

    await keymaster.updateAsset(asset, { version: 2 });
    let doc2 = await keymaster.resolveDID(asset);
    console.log(JSON.stringify(doc2, null, 4));

    while (doc2.didDocumentMetadata.confirmed === false) {
        // wait for 1 second before checking again
        await new Promise(resolve => setTimeout(resolve, 1000));

        doc2 = await keymaster.resolveDID(asset);
        console.log(JSON.stringify(doc2, null, 4));
    }
}

async function main() {
    await gatekeeper.start({
        url: 'http://localhost:4224',
        waitUntilReady: true,
    });

    await keymaster.start({
        gatekeeper,
        wallet,
        cipher,
    });

    const backup = await keymaster.loadWallet();
    await keymaster.newWallet(null, true);

    try {
        await runTest();
    }
    catch (error) {
        console.log(error);
    }

    await keymaster.saveWallet(backup);
    await keymaster.stop();
    process.exit();
}

main();
