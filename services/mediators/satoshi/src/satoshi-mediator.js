import BtcClient from 'bitcoin-core';
import GatekeeperClient from '@mdip/gatekeeper/client';
import KeymasterClient from '@mdip/keymaster/client';
import JsonFile from './db/jsonfile.js';
import JsonRedis from './db/redis.js';
import JsonMongo from './db/mongo.js';
import JsonSQLite from './db/sqlite.js';
import config from './config.js';
import { isValidDID } from '@mdip/ipfs/utils';
import { InvalidParameterError } from '@mdip/common/errors';

const REGISTRY = config.chain;

const gatekeeper = new GatekeeperClient();
const keymaster = new KeymasterClient();
const btcClient = new BtcClient({
    network: config.network,
    username: config.user,
    password: config.pass,
    host: config.host,
    port: config.port,
    wallet: config.wallet,
});

let jsonPersister;

async function loadDb() {
    const newDb = {
        height: 0,
        time: "",
        blockCount: 0,
        blocksScanned: 0,
        blocksPending: 0,
        txnsScanned: 0,
        registered: [],
        discovered: [],
    };

    const db = await jsonPersister.loadDb();

    return db || newDb;
}

async function saveDb(db) {
    return jsonPersister.saveDb(db);
}

async function fetchTransaction(height, index, timestamp, txid) {
    try {
        const txn = await btcClient.getTransactionByHash(txid);
        const asm = txn.vout[0].scriptPubKey.asm;

        if (asm.startsWith('OP_RETURN')) {
            const hexString = asm.slice(10);
            const textString = Buffer.from(hexString, 'hex').toString('utf8');

            if (isValidDID(textString)) {
                const db = await loadDb();
                db.discovered.push({
                    height: height,
                    index: index,
                    time: timestamp,
                    txid: txid,
                    did: textString,
                });
                await saveDb(db);
            }
        }
    }
    catch (error) {
        console.error(`Error fetching txn: ${error}`);
    }
}

async function fetchBlock(height, blockCount) {
    try {
        const blockHash = await btcClient.getBlockHash(height);
        const block = await btcClient.getBlock(blockHash);
        const timestamp = new Date(block.time * 1000).toISOString();

        for (let i = 0; i < block.nTx; i++) {
            const txid = block.tx[i];
            console.log(height, String(i).padStart(4), txid);
            await fetchTransaction(height, i, timestamp, txid);
        }

        const db = await loadDb();
        db.height = height;
        db.time = timestamp;
        db.blocksScanned = height - config.startBlock + 1;
        db.txnsScanned = db.txnsScanned + block.nTx;
        db.blockCount = blockCount;
        db.blocksPending = blockCount - height;
        await saveDb(db);

    } catch (error) {
        console.error(`Error fetching block: ${error}`);
    }
}

async function scanBlocks() {
    let start = config.startBlock;
    let blockCount = await btcClient.getBlockCount();

    console.log(`current block height: ${blockCount}`);

    const db = await loadDb();

    if (db.height) {
        start = db.height + 1;
    }

    for (let height = start; height <= blockCount; height++) {
        console.log(`${height}/${blockCount} blocks (${(100 * height / blockCount).toFixed(2)}%)`);
        await fetchBlock(height, blockCount);
        blockCount = await btcClient.getBlockCount();
    }
}

async function importBatch(item) {
    if (item.error) {
        return;
    }

    if (item.imported && item.processed) {
        return;
    }

    const asset = await keymaster.resolveAsset(item.did);
    const queue = asset.batch || asset;

    // Skip badly formatted batches
    if (!queue || !Array.isArray(queue) || queue.length === 0) {
        return;
    }

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

    try {
        item.imported = await gatekeeper.importBatch(batch);
        item.processed = await gatekeeper.processEvents();
    }
    catch (error) {
        item.error = JSON.stringify(error);
    }

    console.log(JSON.stringify(item, null, 4));
}

async function importBatches() {
    const db = await loadDb();

    for (const item of db.discovered) {
        try {
            await importBatch(item);
        }
        catch (error) {
            // OK if DID not found, we'll just try again later
            if (error.error !== 'DID not found') {
                console.error(`Error importing ${item.did}: ${error.error || JSON.stringify(error)}`);
            }
        }
    }

    return saveDb(db);
}

export async function createOpReturnTxn(opReturnData) {
    const txnfee = config.feeMin;
    const utxos = await btcClient.listUnspent();
    const utxo = utxos.find(utxo => utxo.amount > txnfee);

    if (!utxo) {
        return;
    }

    const amountIn = utxo.amount;
    const amountBack = amountIn - txnfee;

    // Convert the OP_RETURN data to a hex string
    const opReturnHex = Buffer.from(opReturnData, 'utf8').toString('hex');

    // Fetch a new address for the transaction output
    const address = await btcClient.getNewAddress();

    const rawTxn = await btcClient.createRawTransaction([{
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
        signedTxn = await btcClient.signRawTransactionWithWallet(rawTxn);
    }
    catch {
        // fall back to older version of the method
        signedTxn = await btcClient.signRawTransaction(rawTxn);
    }

    console.log(JSON.stringify(signedTxn, null, 4));
    console.log(amountBack);

    // Broadcast the transaction
    const txid = await btcClient.sendRawTransaction(signedTxn.hex);

    console.log(`Transaction broadcast with txid: ${txid}`);
    return txid;
}

async function replaceByFee() {
    const db = await loadDb();

    if (!db.pendingTxid) {
        return false;
    }

    console.log('pendingTxid', db.pendingTxid);

    const tx = await btcClient.getRawTransaction(db.pendingTxid, 1);

    if (tx.blockhash) {
        db.pendingTxid = null;
        await saveDb(db);
        return false;
    }

    // Assigning zero to the fee increment will disable RBF
    if (config.feeInc === 0) {
        return true;
    }

    console.log(JSON.stringify(tx, null, 4));

    const mempoolEntry = await btcClient.getMempoolEntry(db.pendingTxid);

    // If we're already at the maximum fee, wait it out
    if (mempoolEntry && mempoolEntry.fee >= config.feeMax) {
        return true;
    }

    const inputs = tx.vin.map(vin => ({ txid: vin.txid, vout: vin.vout, sequence: vin.sequence }));
    const opReturnHex = tx.vout[0].scriptPubKey.hex;
    const address = tx.vout[1].scriptPubKey.address;
    const amountBack = tx.vout[1].value - config.feeInc;

    if (amountBack < 0) {
        // TBD add additional inputs and continue if possible
        return true;
    }

    const rawTxn = await btcClient.createRawTransaction(inputs, {
        data: opReturnHex.substring(4),
        [address]: amountBack.toFixed(8)
    });

    let signedTxn;
    try {
        signedTxn = await btcClient.signRawTransactionWithWallet(rawTxn);
    }
    catch {
        // fall back to older version of the method
        signedTxn = await btcClient.signRawTransaction(rawTxn);
    }

    console.log(JSON.stringify(signedTxn, null, 4));
    console.log(amountBack);

    const txid = await btcClient.sendRawTransaction(signedTxn.hex);

    console.log(`Transaction broadcasted with txid: ${txid}`);

    db.pendingTxid = txid;
    await saveDb(db);

    return true;
}

async function checkExportInterval() {
    const db = await loadDb();

    if (!db.lastExport) {
        db.lastExport = new Date().toISOString();
        await saveDb(db);
        return true;
    }

    const lastExport = new Date(db.lastExport);
    const now = new Date();
    const elapsedMinutes = (now - lastExport) / (60 * 1000);

    return (elapsedMinutes < config.exportInterval);
}

async function anchorBatch() {

    if (await checkExportInterval()) {
        return;
    }

    if (await replaceByFee()) {
        return;
    }

    try {
        const walletInfo = await btcClient.getWalletInfo();

        if (walletInfo.balance < config.feeMax) {
            const address = await btcClient.getNewAddress('funds', 'bech32');
            console.log(`Wallet has insufficient funds (${walletInfo.balance}). Send ${config.chain} to ${address}`);
            return;
        }
    }
    catch {
        console.log(`${config.chain} node not accessible`);
        return;
    }

    const batch = await gatekeeper.getQueue(REGISTRY);

    if (batch.length > 0) {
        console.log(JSON.stringify(batch, null, 4));

        const did = await keymaster.createAsset({ batch }, { registry: 'hyperswarm', controller: config.nodeID });
        const txid = await createOpReturnTxn(did);

        if (txid) {
            const ok = await gatekeeper.clearQueue(REGISTRY, batch);

            if (ok) {
                const db = await loadDb();

                if (!db.registered) {
                    db.registered = [];
                }

                db.registered.push({
                    did,
                    txid,
                })

                db.pendingTxid = txid;
                db.lastExport = new Date().toISOString();

                await saveDb(db);
            }
        }
    }
    else {
        console.log(`empty ${REGISTRY} queue`);
    }
}

async function importLoop() {
    try {
        await scanBlocks();
        await importBatches();
        console.log(`import loop waiting ${config.importInterval} minute(s)...`);
    } catch (error) {
        console.error(`Error in importLoop: ${error.error || JSON.stringify(error)}`);
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
            const blockchainInfo = await btcClient.getBlockchainInfo();
            console.log("Blockchain Info:", JSON.stringify(blockchainInfo, null, 4));
            isReady = true;
        } catch (error) {
            console.log(`Waiting for ${config.chain} node...`);
        }

        if (!isReady) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    try {
        await btcClient.createWallet(config.wallet);
        console.log(`Wallet '${config.wallet}' created successfully.`);
    } catch (error) {
        // If wallet already exists, log a message
        if (error.message.includes("already exists")) {
            console.log(`Wallet '${config.wallet}' already exists.`);
        } else {
            console.error("Error creating wallet:", error);
            return false;
        }
    }

    try {
        const walletInfo = await btcClient.getWalletInfo();
        console.log("Wallet Info:", JSON.stringify(walletInfo, null, 4));
    } catch (error) {
        console.error("Error fetching wallet info:", error);
        return false;
    }

    try {
        const address = await btcClient.getNewAddress('funds', 'bech32');
        console.log(`Send ${config.chain} to address: ${address}`);
    } catch (error) {
        console.error("Error generating new address:", error);
        return false;
    }

    return true;
}

async function waitForNodeID() {
    let isReady = false;

    while (!isReady) {
        try {
            await keymaster.resolveDID(config.nodeID);
            console.log(`Using node ID '${config.nodeID}'`);
            isReady = true;
        }
        catch {
            try {
                await keymaster.createId(config.nodeID);
                console.log(`Created node ID '${config.nodeID}'`);
                isReady = true;
            }
            catch (error) {
                if (error.type === InvalidParameterError.type) {
                    console.log(`Waiting for gatekeeper to sync...`);
                }
            }
        }

        if (!isReady) {
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }
}

async function main() {
    if (!config.nodeID) {
        console.log('satoshi-mediator must have a KC_NODE_ID configured');
        return;
    }

    const jsonFile = new JsonFile(REGISTRY);

    if (config.db === 'redis') {
        jsonPersister = await JsonRedis.create(REGISTRY);
    }
    else if (config.db === 'mongodb') {
        jsonPersister = await JsonMongo.create(REGISTRY);
    }
    else if (config.db === 'sqlite') {
        jsonPersister = await JsonSQLite.create(REGISTRY);;
    }
    else {
        jsonPersister = jsonFile;
    }

    if (config.db !== 'json') {
        const jsonDb = await jsonPersister.loadDb();
        const fileDb = await jsonFile.loadDb();

        if (!jsonDb && fileDb) {
            await jsonPersister.saveDb(fileDb);
            console.log(`Database upgraded to ${config.db}`);
        }
        else {
            console.log(`Persisting to ${config.db}`);
        }
    }

    if (config.reimport) {
        const db = await loadDb();

        for (const item of db.discovered) {
            delete item.imported;
            delete item.processed;
            delete item.error;
        }

        await saveDb(db);
    }

    const ok = await waitForChain();

    if (!ok) {
        return;
    }

    await gatekeeper.connect({
        url: config.gatekeeperURL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    await keymaster.connect({
        url: config.keymasterURL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    await waitForNodeID();

    if (config.importInterval > 0) {
        console.log(`Importing operations every ${config.importInterval} minute(s)`);
        setTimeout(importLoop, config.importInterval * 60 * 1000);
    }

    if (config.exportInterval > 0) {
        console.log(`Exporting operations every ${config.exportInterval} minute(s)`);
        console.log(`Txn fees (${config.chain}): minimum: ${config.feeMin}, maximum: ${config.feeMax}, increment ${config.feeInc}`);
        setTimeout(exportLoop, config.exportInterval * 60 * 1000);
    }
}

main();
