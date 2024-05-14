import fs from 'fs';
import BtcClient from 'bitcoin-core';
import * as gatekeeper from './gatekeeper-sdk.js';
import * as keymaster from './keymaster.js';
import config from './config.js';

const REGISTRY = 'BTC';
const FIRST = 842880;

const client = new BtcClient({
    network: 'mainnet',
    username: config.btcUser,
    password: config.btcPass,
    host: config.btcHost,
    port: config.btcPort,
    wallet: config.btcWallet,
});

const dbName = 'data/btc-mediator.json';

function loadDb() {
    if (fs.existsSync(dbName)) {
        return JSON.parse(fs.readFileSync(dbName));
    }
    else {
        return {
            height: 0,
            time: "",
            blockCount: 0,
            blocksScanned: 0,
            blocksPending: 0,
            txnsScanned: 0,
            registered: [],
            discovered: [],
        }
    }
}

function writeDb(db) {
    fs.writeFileSync(dbName, JSON.stringify(db, null, 4));
}

async function fetchTransaction(height, index, timestamp, txid) {
    try {
        const txn = await client.getTransactionByHash(txid);
        const asm = txn.vout[0].scriptPubKey.asm;

        if (asm.startsWith('OP_RETURN')) {
            const hexString = asm.slice(10);
            const textString = Buffer.from(hexString, 'hex').toString('utf8');

            if (textString.startsWith('did:test:')) {
                const db = loadDb();
                db.discovered.push({
                    height: height,
                    index: index,
                    time: timestamp,
                    txid: txid,
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
            const txid = block.tx[i];
            console.log(height, String(i).padStart(4), txid);
            await fetchTransaction(height, i, timestamp, txid);
        }

        const db = loadDb();
        db.height = height;
        db.time = timestamp;
        db.blocksScanned = height - FIRST + 1;
        db.txnsScanned = db.txnsScanned + block.nTx;
        db.blockCount = blockCount;
        db.blocksPending = blockCount - height;
        writeDb(db);

    } catch (error) {
        console.error(`Error fetching block: ${error}`);
    }
}

async function scanBlocks() {
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

            const queue = await keymaster.resolveAsset(item.did);
            const batch = [];

            for (let i = 0; i < queue.length; i++) {
                batch.push({
                    registry: 'BTC',
                    time: item.time,
                    ordinal: [item.height, item.index, i],
                    operation: queue[i],
                    blockchain: {
                        height: item.height,
                        index: item.index,
                        txid: item.txid,
                        batch: item.did,
                    }
                });
            }

            console.log(JSON.stringify(batch, null, 4));
            const imported = await gatekeeper.importBatch(batch);
            item.imported = imported;
            writeDb(db);
            console.log(JSON.stringify(item, null, 4));
        }
    }
}

export async function createOpReturnTxn(opReturnData) {
    const txnfee = config.btcFeeMin;
    const utxos = await client.listUnspent();
    const utxo = utxos.find(utxo => utxo.amount > txnfee);

    if (!utxo) {
        return;
    }

    const amountIn = utxo.amount;
    const amountBack = amountIn - txnfee;

    // Convert the OP_RETURN data to a hex string
    const opReturnHex = Buffer.from(opReturnData, 'utf8').toString('hex');

    // Fetch a new address for the transaction output
    const address = await client.getNewAddress();

    const rawTxn = await client.createRawTransaction([{
        txid: utxo.txid,
        vout: utxo.vout,
        sequence: 0xffffffff - 2  // Make this transaction RBF
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
    return txid;
}

async function replaceByFee() {
    const db = loadDb();

    if (!db.pendingTxid) {
        return false;
    }

    console.log('pendingTxid', db.pendingTxid);

    const tx = await client.getRawTransaction(db.pendingTxid, 1);

    if (tx.blockhash) {
        db.pendingTxid = null;
        writeDb(db);
        return false;
    }

    console.log(JSON.stringify(tx, null, 4));

    const mempoolEntry = await client.getMempoolEntry(db.pendingTxid);

    if (mempoolEntry && mempoolEntry.fee >= config.btcFeeMax) {
        return true;
    }

    const inputs = tx.vin.map(vin => ({ txid: vin.txid, vout: vin.vout, sequence: vin.sequence }));
    const opReturnHex = tx.vout[0].scriptPubKey.hex;
    const address = tx.vout[1].scriptPubKey.address;
    const amountBack = tx.vout[1].value - config.btcFeeInc;

    if (amountBack < 0) {
        // TBD add additional inputs and continue if possible
        return true;
    }

    const rawTxn = await client.createRawTransaction(inputs, {
        data: opReturnHex.substring(4),
        [address]: amountBack.toFixed(8)
    });

    const signedTxn = await client.signRawTransactionWithWallet(rawTxn);

    console.log(JSON.stringify(signedTxn, null, 4));
    console.log(amountBack);

    const txid = await client.sendRawTransaction(signedTxn.hex);

    console.log(`Transaction broadcasted with txid: ${txid}`);

    db.pendingTxid = txid;
    writeDb(db);

    return true;
}

function checkExportInterval() {
    const db = loadDb();

    if (!db.lastExport) {
        db.lastExport = new Date().toISOString();
        writeDb(db);
        return true;
    }

    const lastExport = new Date(db.lastExport);
    const now = new Date();
    const elapsedMinutes = (now - lastExport) / (60 * 1000);

    return (elapsedMinutes < config.btcExportInterval);
}

async function anchorBatch() {

    if (checkExportInterval()) {
        return;
    }

    if (await replaceByFee()) {
        return;
    }

    const batch = await gatekeeper.getQueue(REGISTRY);
    console.log(JSON.stringify(batch, null, 4));

    if (batch.length > 0) {
        const saveName = keymaster.getCurrentId();
        keymaster.setCurrentId(config.nodeID);
        const did = await keymaster.createAsset(batch);
        const txid = await createOpReturnTxn(did);

        if (txid) {
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

                db.pendingTxid = txid;
                db.lastExport = new Date().toISOString();

                writeDb(db);
            }
        }

        keymaster.setCurrentId(saveName);
    }
    else {
        console.log('empty batch');
    }
}

async function importLoop() {
    try {
        await scanBlocks();
        await importBatch();
        console.log(`import loop waiting ${config.btcImportInterval} minute(s)...`);
    } catch (error) {
        console.error(`Error in importLoop: ${error}`);
    }
    setTimeout(importLoop, config.btcImportInterval * 60 * 1000);
}

async function exportLoop() {
    try {
        await anchorBatch();
        console.log(`export loop waiting ${config.btcExportInterval} minute(s)...`);
    } catch (error) {
        console.error(`Error in exportLoop: ${error}`);
    }
    setTimeout(exportLoop, config.btcExportInterval * 60 * 1000);
}

// eslint-disable-next-line no-unused-vars
async function main() {
    console.log(`Connecting to BTC on ${config.btcHost} on port ${config.btcPort} using wallet '${config.btcWallet}'`);

    try {
        const walletInfo = await client.getWalletInfo();
        console.log(JSON.stringify(walletInfo, null, 4));
    }
    catch (error) {
        console.log('Cannot connect to BTC node', error);
        return;
    }

    await gatekeeper.waitUntilReady();
    await keymaster.start(gatekeeper);

    if (!config.nodeID) {
        console.log('btc-mediator must have a KC_NODE_ID configured');
    }

    try {
        await keymaster.resolveDID(config.nodeID);
        console.log(`Using node ID '${config.nodeID}'`);
    }
    catch {
        try {
            await keymaster.createId(config.nodeID);
            console.log(`Created node ID '${config.nodeID}'`);
        }
        catch (error) {
            console.log(`Cannot create node ID '${config.nodeID}'`, error);
            return;
        }
    }

    console.log(`Using keymaster ID ${config.nodeID}`);
    console.log(`Importing operations every ${config.btcImportInterval} minute(s)`);
    console.log(`Exporting operations every ${config.btcExportInterval} minute(s)`);
    console.log(`Txn fee minimum: ${config.btcFeeMin} BTC, maximum: ${config.btcFeeMax} BTC, increment ${config.btcFeeInc} BTC`);

    importLoop();
    exportLoop();

    await keymaster.stop();
}

//main();

console.log('BTC support disabled until further notice');
