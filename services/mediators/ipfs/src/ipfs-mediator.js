import canonicalize from 'canonicalize';
import { base58btc } from 'multiformats/bases/base58';
import * as gatekeeper from '@mdip/gatekeeper/sdk';
import IPFS from '@mdip/ipfs/obj';
import config from './config.js';

const ipfs = await IPFS.create({ datadir: 'data/ipfs' });

async function addOperationToIPFS(operation, n, k) {
    const data = JSON.parse(canonicalize(operation));
    const cid = await ipfs.add(data);
    console.log(`DID:${n} op:${k} ${cid.toString(base58btc)}`);
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

        for (const events of exports) {
            n += 1;
            const createEvent = events[0];
            console.log(`DID ${n} ${createEvent.did}`);

            const mdip = createEvent.operation.mdip;

            if (mdip.registry === 'local') {
                console.log("skipping local");
                continue;
            }

            if (mdip.validUntil) {
                console.log("skipping ephemeral");
                continue;
            }

            for (let k in events) {
                const event = events[k];
                promises.push(addOperationToIPFS(event.operation, n, k));

                if (promises.length >= config.concurrency) {
                    await Promise.all(promises);
                    promises = [];
                }
            }
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

async function main() {

    await gatekeeper.start({
        url: config.gatekeeperURL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    console.log(`Storing operations every ${config.interval} minute(s) with batch size ${config.batchSize} and concurrency ${config.concurrency}`);
    setTimeout(importLoop, config.interval * 60 * 1000);
}

main();
