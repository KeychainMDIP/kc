import fs from 'fs';
import BtcClient from 'bitcoin-core';
import config from './config.js';

const FIRST = 816793;

const client = new BtcClient({
    network: 'mainnet',
    username: config.btcUser,
    password: config.btcPass,
    host: config.btcHost,
    port: config.btcPort,
});

const dbName = 'data/btc-mediator.json';

function loadDb() {
    if (fs.existsSync(dbName)) {
        return JSON.parse(fs.readFileSync(dbName));
    }
    else {
        return {
            height: 0,
            discovered: [],
        }
    }
}

function writeDb(db) {
    fs.writeFileSync(dbName, JSON.stringify(db, null, 4));
}

async function fetchTransaction(height, index, txnid) {
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

                const db = loadDb();
                db.discovered.push({
                    height: height,
                    index: index,
                    txnid: txnid,
                    did: textString,
                });
                writeDb(db);
            }
        }
    }
    catch (error) {
        console.error(`Error fetching txn: ${error}`);
    }
}

async function fetchBlock(height, blockCount) {
    try {
        const blockHash = await client.getBlockHash(height);
        const block = await client.getBlock(blockHash);

        for (let i = 0; i < block.nTx; i++) {
            const txnid = block.tx[i];
            console.log(height, i, txnid);
            await fetchTransaction(height, i, txnid);
        }

        const db = loadDb();
        db.height = height;
        db.time = new Date(block.time * 1000).toISOString();
        db.scanned = height - FIRST + 1;
        db.blockCount = blockCount;
        db.pending = blockCount - height;
        writeDb(db);

    } catch (error) {
        console.error(`Error fetching block: ${error}`);
    }
}

async function sync() {
    try {
        let start = FIRST;
        let blockCount = await client.getBlockCount();

        const db = loadDb();

        if (db.height) {
            start = db.height + 1;
        }

        for (let height = start; height <= blockCount; height++) {
            console.log(height);
            await fetchBlock(height, blockCount);
            blockCount = await client.getBlockCount();
        }
    } catch (error) {
        console.error(`Error fetching block: ${error}`);
    }
}

//fetchBlock(838932);

sync();
