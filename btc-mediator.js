import fs from 'fs';
import BtcClient from 'bitcoin-core';
import * as gatekeeper from './gatekeeper-sdk.js';
import * as keymaster from './keymaster.js';
import config from './config.js';

const REGISTRY = 'BTC';
const FIRST = 841600;

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

async function fetchTransaction(height, index, timestamp, txid) {
    try {
        const txn = await client.getTransactionByHash(txid);
        const asm = txn.vout[0].scriptPubKey.asm;

        if (asm.startsWith('OP_RETURN')) {
            const hexString = asm.slice(10);
            const textString = Buffer.from(hexString, 'hex').toString('utf8');

            if (textString.startsWith('did:mdip:')) {
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
        db.scanned = height - FIRST + 1;
        db.blockCount = blockCount;
        db.pending = blockCount - height;
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

            const batch = await keymaster.resolveAsset(item.did);

            for (let i = 0; i < batch.length; i++) {
                if (batch[i].registry !== REGISTRY) {
                    throw "Invalid registry";
                }

                batch[i].time = item.time;
                batch[i].ordinal = [item.height, item.index, i];
                batch[i].txid = item.txid;
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

function checkAnchorInterval() {
    const db = loadDb();

    if (!db.lastAnchorTime) {
        db.lastAnchorTime = new Date().toISOString();
        writeDb(db);
        return true;
    }

    const lastAnchorTime = new Date(db.lastAnchorTime);
    const now = new Date();
    const elapsedMinutes = (now - lastAnchorTime) / (60 * 1000);

    return (elapsedMinutes < config.btcAnchorInterval);
}

async function anchorBatch() {

    if (checkAnchorInterval()) {
        return;
    }

    if (await replaceByFee()) {
        return;
    }

    const batch = await gatekeeper.getQueue(REGISTRY);
    console.log(JSON.stringify(batch, null, 4));

    if (batch.length > 0) {
        const saveName = keymaster.getCurrentIdName();
        keymaster.useId(config.nodeID);
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
                db.lastAnchorTime = new Date().toISOString();

                writeDb(db);
            }
        }

        keymaster.useId(saveName);
    }
    else {
        console.log('empty batch');
    }
}

async function importLoop() {
    try {
        await scanBlocks();
        await importBatch();
        console.log(`scan waiting ${config.btcScanInterval} minute(s)...`);
    } catch (error) {
        console.error(`Error in importLoop: ${error}`);
    }
    setTimeout(importLoop, config.btcScanInterval * 60 * 1000);
}

async function anchorLoop() {
    try {
        await anchorBatch();
        console.log(`anchor loop waiting ${config.btcAnchorInterval} minute(s)...`);
    } catch (error) {
        console.error(`Error in registerLoop: ${error}`);
    }
    setTimeout(anchorLoop, config.btcAnchorInterval * 60 * 1000);
}

async function main() {
    await gatekeeper.waitUntilReady();
    await keymaster.start(gatekeeper);

    console.log(`Connecting to BTC on ${config.btcHost} on port ${config.btcPort} using wallet '${config.btcWallet}'`);

    try {
        const walletInfo = await client.getWalletInfo();
        console.log(JSON.stringify(walletInfo, null, 4));
    }
    catch (error) {
        console.log('Cannot connect to BTC node', error);
        return;
    }

    if (!config.nodeID) {
        console.log('btc-mediator must have a KC_NODE_ID configured');
    }

    try {
        await keymaster.resolveDID(config.nodeID);
        console.log(`Using node ID '${config.nodeID}'`);
    }
    catch (error) {
        console.log(`Cannot resolve node ID '${config.nodeID}'`, error);
        return;
    }

    console.log(`Using keymaster ID ${config.nodeID}`);
    console.log(`Scanning blocks every ${config.btcScanInterval} minute(s)`);
    console.log(`Anchoring operations every ${config.btcAnchorInterval} minute(s)`);
    console.log(`Txn fee minimum: ${config.btcFeeMin} BTC, maximum: ${config.btcFeeMax} BTC, increment ${config.btcFeeInc} BTC`);

    importLoop();
    anchorLoop();

    await keymaster.stop();
}

main();

// await keymaster.start(gatekeeper);
// await registerBatch();
