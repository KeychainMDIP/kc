import fs from 'fs';
import BtcClient from 'bitcoin-core';
import config from './config.js';

//const FIRST = 816793;
const FIRST = 2587350;

const client = new BtcClient({
    network: 'testnet',
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

async function fetchTransaction(height, index, timestamp, txnid) {
    try {
        const txn = await client.getTransactionByHash(txnid);
        const asm = txn.vout[0].scriptPubKey.asm;

        if (asm.startsWith('OP_RETURN')) {
            const hexString = asm.slice(10);
            const textString = Buffer.from(hexString, 'hex').toString('utf8');

            if (textString.startsWith('did:mdip:')) {
                console.log(txnid);
                console.log(asm);
                console.log(textString);

                const db = loadDb();
                db.discovered.push({
                    height: height,
                    index: index,
                    time: timestamp,
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
        const timestamp = new Date(block.time * 1000).toISOString();

        for (let i = 0; i < block.nTx; i++) {
            const txnid = block.tx[i];
            console.log(height, i, txnid);
            await fetchTransaction(height, i, timestamp, txnid);
        }

        const db = loadDb();
        db.height = height;
        db.time = timestamp;
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

export async function createOpReturnTxn(opReturnData) {
    try {
        const utxos = await client.listUnspent();
        const utxo = utxos[0];
        const amountIn = utxo.amount;
        const txnfee = 0.00010000;
        const amountBack = amountIn - txnfee;

        // Convert the OP_RETURN data to a hex string
        const opReturnHex = Buffer.from(opReturnData, 'utf8').toString('hex');

        // Fetch a new address for the transaction output
        const address = await client.getNewAddress();

        const rawTxn = await client.createRawTransaction([{
            txid: utxo.txid,
            vout: utxo.vout
        }], {
            data: opReturnHex,
            [address]: amountBack.toFixed(8)
        });

        // Sign the raw transaction
        const signedTxn = await client.signRawTransactionWithWallet(rawTxn);

        console.log(JSON.stringify(signedTxn, null, 4));
        console.log(amountBack);

        // Broadcast the transaction
        const txid = await client.sendRawTransaction(signedTxn.hex);

        console.log(`Transaction broadcasted with txid: ${txid}`);
    } catch (error) {
        console.error(`Error creating OP_RETURN transaction: ${error}`);
    }
}

sync();

//createOpReturnTxn('did:mdip:test:z3v8AuaVMfPPDLy8kBQ8tJ4ytB5Kugbn9xd94ePgg9e199bEhuv');
