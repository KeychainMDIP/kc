import BtcClient from 'bitcoin-core';
import config from './config.js';

const client = new BtcClient({
    network: 'mainnet',
    username: config.btcUser,
    password: config.btcPass,
    host: config.btcHost,
    port: config.btcPort,
});

async function fetchTransaction(txnid) {
    try {
        const txn = await client.getTransactionByHash(txnid);
        const asm = txn.vout[0].scriptPubKey.asm;

        if (asm.startsWith('OP_RETURN')) {
            const hexString = asm.slice(10);
            const textString = Buffer.from(hexString, 'hex').toString('utf8');

            if (textString.startsWith('Qm')) {
                console.log(txnid);
                console.log(asm);
                console.log(textString);
            }
        }
    }
    catch (error) {
        console.error(`Error fetching txn: ${error}`);
    }
}

async function fetchBlock(height) {
    try {
        // Get block hash
        const blockHash = await client.getBlockHash(height);

        // Get block details
        const block = await client.getBlock(blockHash);

        //console.log(JSON.stringify(block, null, 4));

        console.log(height);

        for (let txnid of block.tx) {
            await fetchTransaction(txnid);
        }
    } catch (error) {
        console.error(`Error fetching block: ${error}`);
    }
}

async function sync() {
    try {
        const start = 816793;
        const blockCount = await client.getBlockCount();

        for (let height = start; height <= blockCount; height++) {
            await fetchBlock(height);
        }
    } catch (error) {
        console.error(`Error fetching block: ${error}`);
    }
}

//fetchBlock(838932);

sync();
