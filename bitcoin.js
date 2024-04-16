import BtcClient from 'bitcoin-core';
import config from './config.js';

const client = new BtcClient({
    network: 'mainnet',
    username: config.btcUser,
    password: config.btcPass,
    host: config.btcHost,
    port: config.btcPort,
});

async function fetchLatestBlock() {
    try {
        // Get block count (height)
        const blockCount = await client.getBlockCount();

        // Get block hash
        const blockHash = await client.getBlockHash(blockCount);

        // Get block details
        const block = await client.getBlock(blockHash);

        console.log(JSON.stringify(block, null, 4));
    } catch (error) {
        console.error(`Error fetching block: ${error}`);
    }
}

fetchLatestBlock();
