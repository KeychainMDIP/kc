import fs from 'fs';
import BtcClient from 'bitcoin-core';
import * as gatekeeper from '@macterra/gatekeeper/sdk';
import * as keymaster from '@macterra/keymaster/lib';
import * as db_wallet from '@macterra/keymaster/wallet/json';
import mainConfig from './config.js';

const config = {
    chain: process.env.KC_SAT_CHAIN || 'BTC',
    network: process.env.KC_SAT_NETWORK || 'mainnet',
    host: process.env.KC_SAT_HOST || 'localhost',
    port: process.env.KC_SAT_PORT ? parseInt(process.env.KC_SAT_PORT) : 8332,
    wallet: process.env.KC_SAT_WALLET,
    user: process.env.KC_SAT_USER,
    pass: process.env.KC_SAT_PASS,
    importInterval: process.env.KC_SAT_IMPORT_INTERVAL ? parseInt(process.env.KC_SAT_IMPORT_INTERVAL) : 0,
    exportInterval: process.env.KC_SAT_EXPORT_INTERVAL ? parseInt(process.env.KC_SAT_EXPORT_INTERVAL) : 0,
    feeMin: process.env.KC_SAT_FEE_MIN ? parseFloat(process.env.KC_SAT_FEE_MIN) : 0.00002,
    feeMax: process.env.KC_SAT_FEE_MAX ? parseFloat(process.env.KC_SAT_FEE_MAX) : 0.00002,
    feeInc: process.env.KC_SAT_FEE_INC ? parseFloat(process.env.KC_SAT_FEE_INC) : 0.00000,
    startBlock: process.env.KC_SAT_START_BLOCK ? parseInt(process.env.KC_SAT_START_BLOCK) : 0,
};

const REGISTRY = config.chain;

const client = new BtcClient({
    network: config.network,
    username: config.user,
    password: config.pass,
    host: config.host,
    port: config.port,
    wallet: config.wallet,
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
        db.blocksScanned = height - config.startBlock + 1;
        db.txnsScanned = db.txnsScanned + block.nTx;
        db.blockCount = blockCount;
        db.blocksPending = blockCount - height;
        writeDb(db);

    } catch (error) {
        console.error(`Error fetching block: ${error}`);
    }
}

async function scanBlocks() {
    let start = config.startBlock;
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
    const txnfee = config.feeMin;
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
    let signedTxn;
    try {
        signedTxn = await client.signRawTransactionWithWallet(rawTxn);
    }
    catch {
        // fall back to older version of the method
        signedTxn = await client.signRawTransaction(rawTxn);
    }

    console.log(JSON.stringify(signedTxn, null, 4));
    console.log(amountBack);

    // Broadcast the transaction
    const txid = await client.sendRawTransaction(signedTxn.hex);

    console.log(`Transaction broadcast with txid: ${txid}`);
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

    // Assigning zero to the fee increment will disable RBF
    if (config.feeInc === 0) {
        return true;
    }

    console.log(JSON.stringify(tx, null, 4));

    const mempoolEntry = await client.getMempoolEntry(db.pendingTxid);

    // If we're already at the maximum fee, wait it out
    if (mempoolEntry && mempoolEntry.fee >= config.feeMax) {
        return true;
    }

    const inputs = tx.vin.map(vin => ({ txid: vin.txid, vout: vin.vout, sequence: vin.sequence }));
    const opReturnHex = tx.vout[0].scriptPubKey.hex;
    // TESS has an addresses array here instead
    const address = tx.vout[1].scriptPubKey.address || tx.vout[1].scriptPubKey.addresses[0];
    const amountBack = tx.vout[1].value - config.feeInc;

    if (amountBack < 0) {
        // TBD add additional inputs and continue if possible
        return true;
    }

    const rawTxn = await client.createRawTransaction(inputs, {
        data: opReturnHex.substring(4),
        [address]: amountBack.toFixed(8)
    });

    let signedTxn;
    try {
        signedTxn = await client.signRawTransactionWithWallet(rawTxn);
    }
    catch {
        // fall back to older version of the method
        signedTxn = await client.signRawTransaction(rawTxn);
    }

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

    return (elapsedMinutes < config.exportInterval);
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

        if (walletInfo.balance < config.feeMax) {
            const address = await client.getNewAddress('funds', 'bech32');
            console.log(`Wallet has insufficient funds (${walletInfo.balance}). Send ${config.chain} to ${address}`);
            return;
        }
    }
    catch {
        console.log(`${config.chain} node not accessible`);
        return;
    }

    const batch = await gatekeeper.getQueue(REGISTRY);
    console.log(JSON.stringify(batch, null, 4));

    if (batch.length > 0) {
        const did = await keymaster.createAsset(batch, REGISTRY, mainConfig.nodeID);
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
        console.log(`import loop waiting ${config.importInterval} minute(s)...`);
    } catch (error) {
        console.error(`Error in importLoop: ${error}`);
    }
    setTimeout(importLoop, config.importInterval * 60 * 1000);
}

async function exportLoop() {
    try {
        await anchorBatch();
        console.log(`export loop waiting ${config.exportInterval} minute(s)...`);
    } catch (error) {
        console.error(`Error in exportLoop: ${error}`);
    }
    setTimeout(exportLoop, config.exportInterval * 60 * 1000);
}

async function waitForChain() {
    let isReady = false;

    console.log(`Connecting to ${config.chain} node on ${config.host}:${config.port} using wallet '${config.wallet}'`);

    while (!isReady) {
        try {
            const walletInfo = await client.getWalletInfo();
            console.log(JSON.stringify(walletInfo, null, 4));

            const address = await client.getNewAddress('funds', 'bech32');
            console.log(`Send ${config.chain} to ${address}`);

            isReady = true;
        }
        catch {
            console.log(`Waiting for ${config.chain} node...`);
        }

        if (!isReady) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

async function main() {
    if (!mainConfig.nodeID) {
        console.log('sat-mediator must have a KC_NODE_ID configured');
        return;
    }

    await waitForChain();

    gatekeeper.setURL(`${mainConfig.gatekeeperURL}:${mainConfig.gatekeeperPort}`);

    await gatekeeper.waitUntilReady();
    await keymaster.start(gatekeeper, db_wallet);

    try {
        await keymaster.resolveDID(mainConfig.nodeID);
        console.log(`Using node ID '${mainConfig.nodeID}'`);
    }
    catch {
        try {
            await keymaster.createId(mainConfig.nodeID);
            console.log(`Created node ID '${mainConfig.nodeID}'`);
        }
        catch (error) {
            console.log(`Cannot create node ID '${mainConfig.nodeID}'`, error);
            return;
        }
    }

    console.log(`Using keymaster ID ${mainConfig.nodeID}`);

    if (config.importInterval > 0) {
        console.log(`Importing operations every ${config.importInterval} minute(s)`);
        importLoop();
    }

    if (config.exportInterval > 0) {
        console.log(`Exporting operations every ${config.exportInterval} minute(s)`);
        console.log(`Txn fees (${config.chain}): minimum: ${config.feeMin}, maximum: ${config.feeMax}, increment ${config.feeInc}`);
        exportLoop();
    }

    await keymaster.stop();
}

main();
