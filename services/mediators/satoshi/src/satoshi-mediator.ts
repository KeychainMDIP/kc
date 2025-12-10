import BtcClient, {FundRawTransactionOptions, MempoolEntry, RawTransactionVerbose} from 'bitcoin-core';
import GatekeeperClient from '@mdip/gatekeeper/client';
import KeymasterClient from '@mdip/keymaster/client';
import JsonFile from './db/jsonfile.js';
import JsonRedis from './db/redis.js';
import JsonMongo from './db/mongo.js';
import JsonSQLite from './db/sqlite.js';
import config from './config.js';
import { isValidDID } from '@mdip/ipfs/utils';
import { MediatorDb, MediatorDbInterface, DiscoveredItem } from './types.js';
import { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';

const REGISTRY = config.chain;
const SMART_FEE_MODE = "CONSERVATIVE";

const gatekeeper = new GatekeeperClient();
const keymaster = new KeymasterClient();
const btcClient = new BtcClient({
    username: config.user,
    password: config.pass,
    host: `http://${config.host}:${config.port}`,
    wallet: config.wallet,
});

let jsonPersister: MediatorDbInterface;
let importRunning = false;
let exportRunning = false;

async function loadDb(): Promise<MediatorDb> {
    const newDb: MediatorDb = {
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

async function fetchTransaction(height: number, index: number, timestamp: string, txid: string): Promise<void> {
    try {
        const txn = await btcClient.getTransactionByHash(txid);
        const asm = txn.vout[0].scriptPubKey.asm;

        if (asm.startsWith('OP_RETURN')) {
            const hexString = asm.slice(10);
            const textString = Buffer.from(hexString, 'hex').toString('utf8');

            if (isValidDID(textString)) {
                await jsonPersister.updateDb((db) => {
                    db.discovered.push({ height, index, time: timestamp, txid, did: textString });
                });
            }
        }
    }
    catch (error) {
        console.error(`Error fetching txn: ${error}`);
    }
}

async function fetchBlock(height: number, blockCount: number): Promise<void> {
    try {
        const blockHash = await btcClient.getBlockHash(height);
        const block = await btcClient.getBlock(blockHash);
        const timestamp = new Date(block.time * 1000).toISOString();

        for (let i = 0; i < block.nTx; i++) {
            const txid = block.tx[i];
            console.log(height, String(i).padStart(4), txid);
            await fetchTransaction(height, i, timestamp, txid);
        }

        await jsonPersister.updateDb((db) => {
            db.height = height;
            db.time = timestamp;
            db.blocksScanned = height - config.startBlock + 1;
            db.txnsScanned += block.nTx;
            db.blockCount = blockCount;
            db.blocksPending = blockCount - height;
        });
        await addBlock(height, blockHash, block.time);

    } catch (error) {
        console.error(`Error fetching block: ${error}`);
    }
}

async function scanBlocks(): Promise<void> {
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

async function importBatch(item: DiscoveredItem) {
    if (item.error) {
        return;
    }

    if (item.imported && item.processed) {
        return;
    }

    const asset = await keymaster.resolveAsset(item.did);
    const queue = (asset as { batch?: Operation[] }).batch || asset;

    // Skip badly formatted batches
    if (!queue || !Array.isArray(queue) || queue.length === 0) {
        return;
    }

    const batch: GatekeeperEvent[] = [];

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
                opidx: i,
            }
        });
    }

    let update: DiscoveredItem = { ...item };

    try {
        update.imported = await gatekeeper.importBatch(batch);
        update.processed = await gatekeeper.processEvents();
    } catch (error) {
        update.error = JSON.stringify(error);
    }

    console.log(JSON.stringify(update, null, 4));
    return update;
}

function sameItem(a: DiscoveredItem, b: DiscoveredItem) {
    return a.height === b.height && a.index === b.index && a.txid === b.txid && a.did === b.did;
}

async function importBatches(): Promise<boolean> {
    const db = await loadDb();

    for (const item of db.discovered) {
        try {
            const update = await importBatch(item);
            if (!update) {
                continue;
            }

            await jsonPersister.updateDb((db) => {
                const list = db.discovered ?? [];
                const idx = list.findIndex(d => sameItem(d, update));
                if (idx >= 0) {
                    list[idx] = update;
                }
            });
        }
        catch (error: any) {
            // OK if DID not found, we'll just try again later
            if (error.error !== 'DID not found') {
                console.error(`Error importing ${item.did}: ${error.error || JSON.stringify(error)}`);
            }
        }
    }

    return true;
}

export async function createOpReturnTxn(opReturnData: string): Promise<string | undefined> {
    const opReturnHex = Buffer.from(opReturnData, 'utf8').toString('hex');

    const raw = await btcClient.createRawTransaction([], { data: opReturnHex });

    const { version } = await btcClient.getNetworkInfo();

    const feeResp = await btcClient.estimateSmartFee(config.feeConf, SMART_FEE_MODE);
    const estSatPerVByte = feeResp.feerate ? Math.ceil(feeResp.feerate * 1e5) : config.feeFallback;

    const fundOpts: FundRawTransactionOptions = {
        changeAddress: await btcClient.getNewAddress('change'),
        changePosition: 1,
        replaceable: true,
    };

    if (version >= 210000) {
        fundOpts.fee_rate = estSatPerVByte;
    } else {
        fundOpts.feeRate = estSatPerVByte * 1e-5;
    }

    const funded = await btcClient.fundRawTransaction(raw, fundOpts);

    let signedTxn;
    try {
        signedTxn = await btcClient.signRawTransactionWithWallet(funded.hex);
    } catch {
        signedTxn = await btcClient.signRawTransaction(funded.hex);
    }

    console.log(JSON.stringify(signedTxn, null, 4));

    // Broadcast the transaction
    const txid = await btcClient.sendRawTransaction(signedTxn.hex);

    console.log(`Transaction broadcast with txid: ${txid}`);
    return txid;
}

async function checkPendingTransactions(txids: string[]): Promise<boolean> {
    const isMined = async (txid: string) => {
        const tx = await btcClient.getRawTransaction(txid, 1).catch(() => undefined) as RawTransactionVerbose | undefined;
        return !!(tx && tx.blockhash);
    };

    const checkPendingTxs = async (txids: string[]): Promise<number> => {
        for (let i = 0; i < txids.length; i++) {
            if (await isMined(txids[i])) {
                return i;
            }
        }
        return -1;
    }

    if (txids.length) {
        const mined = await checkPendingTxs(txids);
        if (mined >= 0) {
            await jsonPersister.updateDb((db) => { db.pending = undefined; });
            return false;
        } else {
            console.log('pending txid', txids.at(-1));
        }
    }

    return true;
}

async function getEntryFromMempool(txids: string[]): Promise<{ entry: MempoolEntry, txid: string }>  {
    if (!txids.length) {
        throw new Error('RBF: empty array');
    }

    for (let i = txids.length - 1; i >= 0; i--) {
        const txid = txids[i];
        const entry = await btcClient.getMempoolEntry(txid).catch(() => undefined);
        if (entry) {
            if (entry.fees.modified >= config.feeMax) {
                throw new Error('RBF: Pending reveal transaction already at max fee');
            }
            return { entry, txid };
        }
    }

    throw new Error('RBF: Cannot find pending reveal transaction in mempool');
}

function toEightDpCeil(x: number): number {
    return Math.ceil(x * 1e8) / 1e8;
}

async function replaceByFee(): Promise<boolean> {
    const db = await loadDb();

    if (!db.pending?.txids || !(await checkPendingTransactions(db.pending.txids))) {
        return false;
    }

    if (!config.rbfEnabled) {
        return true;
    }

    const blockCount = await btcClient.getBlockCount();
    if (db.pending.blockCount + config.feeConf >= blockCount) {
        return true;
    }

    const { entry, txid } = await getEntryFromMempool(db.pending.txids);
    const { version } = await btcClient.getNetworkInfo();

    const feeResp = await btcClient.estimateSmartFee(config.feeConf, SMART_FEE_MODE);
    const estSatPerVByte = feeResp.feerate ? Math.ceil(feeResp.feerate * 1e5) : config.feeFallback;
    const currFeeSat = Math.round(entry.fees.modified * 1e8);
    const curSatPerVb = Math.floor(currFeeSat / entry.vsize);
    const targetSatPerVb = Math.max(estSatPerVByte, curSatPerVb + 1);
    const fee_rate = version < 210000 ? toEightDpCeil(targetSatPerVb * 1e-5) : targetSatPerVb;

    const result = await btcClient.bumpFee(txid, { fee_rate });

    if (result.txid) {
        const txid = result.txid;
        console.log(`RBF: Transaction broadcast with txid: ${txid}`);
        await jsonPersister.updateDb((db) => {
            if (db.pending?.txids) {
                db.pending.txids.push(txid);
            }
        });
    }

    return true;
}

async function checkExportInterval(): Promise<boolean> {
    const db = await loadDb();

    if (!db.lastExport) {
        await jsonPersister.updateDb((data) => {
            if (!data.lastExport) {
                data.lastExport = new Date().toISOString();
            }
        });
        return true;
    }

    const lastExport = new Date(db.lastExport).getTime();
    const now = Date.now();
    const elapsedMinutes = (now - lastExport) / (60 * 1000);

    return (elapsedMinutes < config.exportInterval);
}

async function anchorBatch(): Promise<void> {

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
                const blockCount = await btcClient.getBlockCount();
                await jsonPersister.updateDb(async (db) => {
                    (db.registered ??= []).push({
                        did,
                        txid: txid!
                    });
                    db.pending = {
                        txids: [txid!],
                        blockCount
                    };
                    db.lastExport = new Date().toISOString();
                });
            }
        }
    }
    else {
        console.log(`empty ${REGISTRY} queue`);
    }
}

async function importLoop(): Promise<void> {
    if (importRunning) {
        setTimeout(importLoop, config.importInterval * 60 * 1000);
        console.log(`import loop busy, waiting ${config.importInterval} minute(s)...`);
        return;
    }

    importRunning = true;

    try {
        await scanBlocks();
        await importBatches();
    } catch (error: any) {
        console.error(`Error in importLoop: ${error.error || JSON.stringify(error)}`);
    } finally {
        importRunning = false;
        console.log(`import loop waiting ${config.importInterval} minute(s)...`);
        setTimeout(importLoop, config.importInterval * 60 * 1000);
    }
}

async function exportLoop(): Promise<void> {
    if (exportRunning) {
        setTimeout(exportLoop, config.exportInterval * 60 * 1000);
        console.log(`Export loop busy, waiting ${config.exportInterval} minute(s)...`);
        return;
    }

    exportRunning = true;

    try {
        await anchorBatch();
    } catch (error) {
        console.error(`Error in exportLoop: ${error}`);
    } finally {
        exportRunning = false;
        console.log(`export loop waiting ${config.exportInterval} minute(s)...`);
        setTimeout(exportLoop, config.exportInterval * 60 * 1000);
    }
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
        await btcClient.createWallet(config.wallet!);
        console.log(`Wallet '${config.wallet}' created successfully.`);
    } catch (error: any) {
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

async function addBlock(height: number, hash: string, time: number): Promise<void> {
    await gatekeeper.addBlock(REGISTRY, { hash, height, time });
}

async function syncBlocks(): Promise<void> {
    try {
        const latest = await gatekeeper.getBlock(REGISTRY);
        const currentMax = latest ? latest.height : config.startBlock;
        const blockCount = await btcClient.getBlockCount();

        console.log(`current block height: ${blockCount}`);

        for (let height = currentMax; height <= blockCount; height++) {
            const blockHash = await btcClient.getBlockHash(height);
            const block = await btcClient.getBlock(blockHash);
            console.log(`${height}/${blockCount} blocks (${(100 * height / blockCount).toFixed(2)}%)`);
            await addBlock(height, blockHash, block.time);
        }
    } catch (error) {
        console.error(`Error syncing blocks: ${error}`);
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
        jsonPersister = await JsonSQLite.create(REGISTRY);
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
        await jsonPersister.saveDb(db);
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

    await syncBlocks();

    if (config.importInterval > 0) {
        console.log(`Importing operations every ${config.importInterval} minute(s)`);
        setTimeout(importLoop, config.importInterval * 60 * 1000);
    }

    if (config.exportInterval > 0) {
        console.log(`Exporting operations every ${config.exportInterval} minute(s)`);
        console.log(`Txn fees (${config.chain}): conf target: ${config.feeConf}, maximum: ${config.feeMax}, fallback Sat/Byte: ${config.feeFallback}`);
        setTimeout(exportLoop, config.exportInterval * 60 * 1000);
    }
}

main();
