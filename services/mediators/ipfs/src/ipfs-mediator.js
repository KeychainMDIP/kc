import canonicalize from 'canonicalize';
import GatekeeperClient from '@mdip/gatekeeper/client';
//import IPFS from '@mdip/ipfs';
import IPFSClient from '@mdip/ipfs/client';
import config from './config.js';

const gatekeeper = await GatekeeperClient.create({
    url: config.gatekeeperURL,
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true,
});

//const ipfs = await IPFS.create({ datadir: 'data/ipfs' });
const ipfs = await IPFSClient.create({
    url: config.ipfsURL,
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true,
});

async function addOperationToIPFS(operation, n, k) {
    const data = JSON.parse(canonicalize(operation));
    const cid = await ipfs.add(data);
    console.log(`DID:${n} op:${k} ${cid}`);
}

async function importOperations() {
    const dids = await gatekeeper.getDIDs();

    console.log(`DIDs count: ${dids.length}`);

    const batchSize = config.batchSize;
    let n = 0;
    let promises = [];
    for (let i = 0; i < dids.length; i += batchSize) {

        const didBatch = dids.slice(i, i + batchSize);
        const exports = await gatekeeper.exportDIDs(didBatch);

        for (const didEvents of exports) {
            console.log(`DID ${n} ${dids[n]}`);

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
                promises.push(addOperationToIPFS(event.operation, n, k));

                if (promises.length >= config.concurrency) {
                    await Promise.all(promises);
                    promises = [];
                }
            }

            n += 1;
        }
    }
    await Promise.all(promises);
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
