import canonicalize from 'canonicalize';
import GatekeeperClient from '@mdip/gatekeeper/client';
import KuboClient from '@mdip/ipfs/client';
import IPFS from '@mdip/ipfs';
import config from './config.js';

const gatekeeper = await GatekeeperClient.create({
    url: config.gatekeeperURL,
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true,
});

const ipfs = await KuboClient.create({
    url: config.ipfsURL,
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true,
});

const mini = await IPFS.create({ minimal: true });

async function addOperationToIPFS(operation, n, k) {
    const data = JSON.parse(canonicalize(operation));
    const cid = await ipfs.addJSON(data);
    const cid2 = await mini.add(data);
    console.log(`DID:${n} op:${k} ${cid}`);
    console.log(`MIN:${n} op:${k} ${cid2}`);
}

async function importOperations() {
    const dids = await gatekeeper.getDIDs();

    console.log(`DIDs count: ${dids.length}`);

    for (let i = 0; i < dids.length; i++) {
        console.log(`DID ${i} ${dids[i]}`);

        const exports = await gatekeeper.exportDIDs([dids[i]]);
        const didEvents = exports[0];
        const mdip = didEvents[0].operation.mdip;

        if (mdip.registry === 'local') {
            console.log("skipping local");
            continue;
        }

        if (mdip.validUntil) {
            console.log("skipping ephemeral");
            continue;
        }

        for (let k in didEvents) {
            const event = didEvents[k];
            await addOperationToIPFS(event.operation, i, k);
        }
    }
}

async function importLoop() {
    try {
        console.time('importOperations');
        await importOperations();
        console.timeEnd('importOperations');
        console.log(`import loop waiting ${config.interval} minute(s)...`);
    } catch (error) {
        console.error(`Error in importLoop: ${error.error || JSON.stringify(error)}`);
    }
    setTimeout(importLoop, config.interval * 60 * 1000);
}

process.on('uncaughtException', (error) => {
    console.error('Unhandled exception caught', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

async function main() {
    console.log(`Storing operations every ${config.interval} minute(s) with batch size ${config.batchSize} and concurrency ${config.concurrency}`);
    setTimeout(importLoop, config.interval * 60 * 1000);
}

main();
