import fs from 'fs';
import BtcClient from 'bitcoin-core';
import * as gatekeeper from './gatekeeper-sdk.js';
import * as keymaster from './keymaster-lib.js';
import * as db_wallet from './db-wallet-json.js';
import config from './config.js';

const localConfig = {
    satChain: process.env.KC_SAT_CHAIN || 'BTC',
    satHost: process.env.KC_SAT_HOST || 'localhost',
    satPort: process.env.KC_SAT_PORT ? parseInt(process.env.KC_SAT_PORT) : 8332,
    satWallet: process.env.KC_SAT_WALLET,
    satUser: process.env.KC_SAT_USER,
    satPass: process.env.KC_SAT_PASS,
    satImportInterval: process.env.KC_SAT_IMPORT_INTERVAL ? parseInt(process.env.KC_SAT_IMPORT_INTERVAL) : 1,
    satExportInterval: process.env.KC_SAT_EXPORT_INTERVAL ? parseInt(process.env.KC_SAT_EXPORT_INTERVAL) : 60,
    satFeeMin: process.env.KC_SAT_FEE_MIN ? parseFloat(process.env.KC_SAT_FEE_MIN) : 0.00002,
    satFeeMax: process.env.KC_SAT_FEE_MAX ? parseFloat(process.env.KC_SAT_FEE_MAX) : 0.00010,
    satFeeInc: process.env.KC_SAT_FEE_INC ? parseFloat(process.env.KC_SAT_FEE_INC) : 0.00002,
};

const REGISTRY = localConfig.satChain;
const FIRST = 5290000;

const client = new BtcClient({
    network: 'mainnet',
    username: localConfig.satUser,
    password: localConfig.satPass,
    host: localConfig.satHost,
    port: localConfig.satPort,
    wallet: localConfig.satWallet,
});

const dbName = `data/${REGISTRY}-mediator.json`;

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
                    registry: REGISTRY,
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
    const txnfee = localConfig.satFeeMin;
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

    if (mempoolEntry && mempoolEntry.fee >= localConfig.satFeeMax) {
        return true;
    }

    const inputs = tx.vin.map(vin => ({ txid: vin.txid, vout: vin.vout, sequence: vin.sequence }));
    const opReturnHex = tx.vout[0].scriptPubKey.hex;
    const address = tx.vout[1].scriptPubKey.address;
    const amountBack = tx.vout[1].value - localConfig.satFeeInc;

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

    return (elapsedMinutes < localConfig.satExportInterval);
}

async function anchorBatch() {

    if (checkExportInterval()) {
        return;
    }

    if (await replaceByFee()) {
        return;
    }

    try {
        const walletInfo = await client.getWalletInfo();

        if (walletInfo.balance < localConfig.satFeeMax) {
            const address = await client.getNewAddress('funds', 'bech32');
            console.log(`Wallet has insufficient funds (${walletInfo.balance}). Send ${localConfig.satChain} to ${address}`);
            return;
        }
    }
    catch {
        console.log(`${localConfig.satChain} node not accessible`);
        return;
    }

    const batch = await gatekeeper.getQueue(REGISTRY);
    console.log(JSON.stringify(batch, null, 4));

    if (batch.length > 0) {
        const did = await keymaster.createAsset(batch, REGISTRY, config.nodeID);
        const txid = await createOpReturnTxn(did);

        if (txid) {
            const ok = await gatekeeper.clearQueue(REGISTRY, batch);

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
    }
    else {
        console.log('empty batch');
    }
}

async function importLoop() {
    try {
        await scanBlocks();
        await importBatch();
        console.log(`import loop waiting ${localConfig.satImportInterval} minute(s)...`);
    } catch (error) {
        console.error(`Error in importLoop: ${error}`);
    }
    setTimeout(importLoop, localConfig.satImportInterval * 60 * 1000);
}

async function exportLoop() {
    try {
        await anchorBatch();
        console.log(`export loop waiting ${localConfig.satExportInterval} minute(s)...`);
    } catch (error) {
        console.error(`Error in exportLoop: ${error}`);
    }
    setTimeout(exportLoop, localConfig.satExportInterval * 60 * 1000);
}

async function waitForChain() {
    let isReady = false;

    console.log(`Connecting to ${localConfig.satChain} node on ${localConfig.satHost}:${localConfig.satPort} using wallet '${localConfig.satWallet}'`);

    while (!isReady) {
        try {
            const walletInfo = await client.getWalletInfo();
            console.log(JSON.stringify(walletInfo, null, 4));

            const address = await client.getNewAddress('funds', 'bech32');
            console.log(`Send ${localConfig.satChain} to ${address}`);

            isReady = true;
        }
        catch {
            console.log(`Waiting for ${localConfig.satChain} node...`);
        }

        if (!isReady) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function main() {
    if (!config.nodeID) {
        console.log('sat-mediator must have a KC_NODE_ID configured');
        return;
    }

    await waitForChain();

    gatekeeper.setURL(`${config.gatekeeperURL}:${config.gatekeeperPort}`);

    await gatekeeper.waitUntilReady();
    await keymaster.start(gatekeeper, db_wallet);

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
    console.log(`Importing operations every ${localConfig.satImportInterval} minute(s)`);
    console.log(`Exporting operations every ${localConfig.satExportInterval} minute(s)`);
    console.log(`Txn fee minimum: ${localConfig.satFeeMin} SAT, maximum: ${localConfig.satFeeMax} SAT, increment ${localConfig.satFeeInc} SAT`);

    importLoop();
    exportLoop();

    await keymaster.stop();
}

main();
