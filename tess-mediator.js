import fs from 'fs';
import BtcClient from 'bitcoin-core';
import * as gatekeeper from './gatekeeper-sdk.js';
import * as keymaster from './keymaster.js';
import config from './config.js';

const REGISTRY = 'TESS';
const FIRST = 137100;
const TESS_ID = config.tessID;

const client = new BtcClient({
    network: 'mainnet',
    username: config.tessUser,
    password: config.tessPass,
    host: config.tessHost,
    port: config.tessPort,
});

const dbName = 'data/tess-mediator.json';

function loadDb() {
    if (fs.existsSync(dbName)) {
        return JSON.parse(fs.readFileSync(dbName));
    }
    else {
        return {
            height: 0,
            time: "",
            blockCount: 0,
            scanned: 0,
            pending: 0,
            registered: [],
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
            console.log(height, String(i).padStart(4), txnid);
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
    let start = FIRST;
    let blockCount = await client.getBlockCount();

    console.log(`current block height: ${blockCount}`);

    const db = loadDb();

    if (db.height) {
        start = db.height + 1;
    }

    for (let height = start; height <= blockCount; height++) {
        console.log(height);
        await fetchBlock(height, blockCount);
        blockCount = await client.getBlockCount();
    }
}

async function importBatch() {
    const db = loadDb();

    for (const item of db.discovered) {
        if (!item.imported) {
            console.log(JSON.stringify(item, null, 4));

            const batch = await keymaster.resolveAsset(item.did);

            for (const i in batch) {
                if (batch[i].registry !== REGISTRY) {
                    throw "Invalid registry";
                }

                batch[i].time = item.time;
                batch[i].ordinal = i;
            }

            console.log(JSON.stringify(batch, null, 4));
            const imported = await gatekeeper.importBatch(batch);
            item.imported = imported;
            writeDb(db);
            console.log(JSON.stringify(item, null, 4));
        }
    }
}

async function registerBatch() {
    const batch = await gatekeeper.getQueue(REGISTRY);
    console.log(JSON.stringify(batch, null, 4));

    if (batch.length > 0) {
        const saveName = keymaster.getCurrentIdName();
        keymaster.useId(TESS_ID);
        const did = await keymaster.createData(batch);
        const txid = await createOpReturnTxn(did);
        const ok = await gatekeeper.clearQueue(batch);

        if (ok) {
            const db = loadDb();

            if (!db.registered) {
                db.registered = [];
            }

            db.registered.push({
                did,
                txid,
            })

            writeDb(db);
        }

        keymaster.useId(saveName);
    }
    else {
        console.log('empty batch');
    }
}

async function importLoop() {
    try {
        await sync();
        await importBatch();
        console.log('waiting 60s...');
    } catch (error) {
        console.error(`Error in importLoop: ${error}`);
    }
    setTimeout(importLoop, 60 * 1000);
}

async function registerLoop() {
    try {
        await registerBatch();
        console.log('waiting 5m...');
    } catch (error) {
        console.error(`Error in registerLoop: ${error}`);
    }
    setTimeout(registerLoop, 5 * 60 * 1000);
}

async function main() {
    console.log(`Connecting to TESS on ${config.tessHost} on port ${config.tessPort}`);
    console.log(`Using keymaster ID ${TESS_ID}`);

    await keymaster.start(gatekeeper);
    importLoop();
    registerLoop();
    await keymaster.stop();
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
        //const signedTxn = await client.signRawTransactionWithWallet(rawTxn);
        // Old method name for Tesseract
        const signedTxn = await client.signRawTransaction(rawTxn);

        console.log(JSON.stringify(signedTxn, null, 4));
        console.log(amountBack);

        // Broadcast the transaction
        const txid = await client.sendRawTransaction(signedTxn.hex);

        console.log(`Transaction broadcasted with txid: ${txid}`);
        return txid;
    } catch (error) {
        console.error(`Error creating OP_RETURN transaction: ${error}`);
    }
}

main();

//createOpReturnTxn('did:mdip:test:z3v8Auaish14RTNpxseGqUJg938eqVP32SXadHhuifhWn2bjYQs');
