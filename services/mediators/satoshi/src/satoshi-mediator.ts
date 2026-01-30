import BtcClient, {Block, BlockVerbose, BlockHeader, FundRawTransactionOptions, MempoolEntry} from 'bitcoin-core';
import GatekeeperClient from '@mdip/gatekeeper/client';
import KeymasterClient from '@mdip/keymaster/client';
import JsonFile from './db/jsonfile.js';
import JsonRedis from './db/redis.js';
import JsonMongo from './db/mongo.js';
import JsonSQLite from './db/sqlite.js';
import config from './config.js';
import { isValidDID } from '@mdip/ipfs/utils';
import { MediatorDb, MediatorDbInterface, DiscoveredItem, BlockVerbosity } from './types.js';
import { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import { childLogger } from '@mdip/common/logger';

const REGISTRY = config.chain;
const SMART_FEE_MODE = "CONSERVATIVE";

const READ_ONLY = config.exportInterval === 0;
const log = childLogger({ service: 'satoshi-mediator' });

const gatekeeper = new GatekeeperClient();
const keymaster = new KeymasterClient();
const btcClient = new BtcClient({
    username: config.user,
    password: config.pass,
    host: `http://${config.host}:${config.port}`,
    ...(READ_ONLY ? {} : { wallet: config.wallet }),
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

async function getBlockTxCount(hash: string, header?: BlockHeader): Promise<number> {
    if (typeof header?.nTx === 'number') {
        return header.nTx;
    }

    const block = await btcClient.getBlock(hash, BlockVerbosity.JSON) as Block;
    return Array.isArray(block.tx) ? block.tx.length : 0;
}

async function resolveScanStart(blockCount: number): Promise<number> {
    const db = await loadDb();

    if (!db.hash) {
        return db.height ? db.height + 1 : config.startBlock;
    }

    let header: BlockHeader | undefined;
    try {
        header = await btcClient.getBlockHeader(db.hash) as BlockHeader;
    } catch { }

    if ((header?.confirmations ?? 0) > 0) {
        return db.height + 1;
    }

    log.warn(`Reorg detected at height ${db.height}, rewinding to a confirmed block...`);

    let height = db.height;
    let hash = db.hash;
    let txnsToSubtract = 0;

    while (hash && height >= config.startBlock) {
        let currentHeader: BlockHeader;
        try {
            currentHeader = await btcClient.getBlockHeader(hash) as BlockHeader;
        } catch {
            break;
        }

        if ((currentHeader.confirmations ?? 0) > 0) {
            const resolvedHeight = currentHeader.height ?? height;
            const resolvedTime = currentHeader.time ? new Date(currentHeader.time * 1000).toISOString() : '';
            const resolvedHash = hash;
            const resolvedBlocksPending = blockCount - resolvedHeight;
            const resolvedTxnsToSubtract = txnsToSubtract;
            await jsonPersister.updateDb((data) => {
                data.height = resolvedHeight;
                data.hash = resolvedHash;
                data.time = resolvedTime;
                data.blocksScanned = Math.max(0, resolvedHeight - config.startBlock + 1);
                data.txnsScanned = Math.max(0, data.txnsScanned - resolvedTxnsToSubtract);
                data.blockCount = blockCount;
                data.blocksPending = resolvedBlocksPending;
            });
            return resolvedHeight + 1;
        }

        txnsToSubtract += await getBlockTxCount(hash, currentHeader);

        if (!currentHeader.previousblockhash) {
            break;
        }

        hash = currentHeader.previousblockhash;
        height = (currentHeader.height ?? height) - 1;
    }

    const fallbackHeight = config.startBlock;
    let fallbackHash = '';
    let fallbackTime = '';

    try {
        fallbackHash = await btcClient.getBlockHash(fallbackHeight);
        const fallbackHeader = await btcClient.getBlockHeader(fallbackHash) as BlockHeader;
        fallbackTime = fallbackHeader.time ? new Date(fallbackHeader.time * 1000).toISOString() : '';
    } catch {
        fallbackHash = '';
    }

    await jsonPersister.updateDb((data) => {
        data.height = fallbackHeight;
        if (fallbackHash) {
            data.hash = fallbackHash;
        }
        data.time = fallbackTime;
        data.blocksScanned = 0;
        data.txnsScanned = 0;
        data.blockCount = blockCount;
        data.blocksPending = blockCount - fallbackHeight;
    });

    return fallbackHeight + 1;
}

async function fetchBlock(height: number, blockCount: number): Promise<void> {
    try {
        const blockHash = await btcClient.getBlockHash(height);
        const block = await btcClient.getBlock(blockHash, BlockVerbosity.JSON_TX_DATA) as BlockVerbose;
        const timestamp = new Date(block.time * 1000).toISOString();

        for (let i = 0; i < block.tx.length; i++) {
            const tx = block.tx[i];
            const txid = tx.txid;

            log.debug(`${height} ${String(i).padStart(4)} ${txid}`);

            const asm = tx.vout?.[0]?.scriptPubKey?.asm;
            if (!asm) {
                continue;
            }

            const parts = asm.split(' ');
            if (parts[0] !== 'OP_RETURN' || !parts[1]) {
                continue;
            }

            try {
                const textString = Buffer.from(parts[1], 'hex').toString('utf8');
                if (isValidDID(textString)) {
                    await jsonPersister.updateDb((db) => {
                        db.discovered.push({ height, index: i, time: timestamp, txid, did: textString });
                    });
                }
            } catch (error: any) {
                log.error({ error }, 'Error decoding OP_RETURN or updating DB');
            }
        }

        await jsonPersister.updateDb((db) => {
            db.height = height;
            db.hash = blockHash;
            db.time = timestamp;
            db.blocksScanned = height - config.startBlock + 1;
            db.txnsScanned += block.tx.length;
            db.blockCount = blockCount;
            db.blocksPending = blockCount - height;
        });
        await addBlock(height, blockHash, block.time);

    } catch (error) {
        log.error({ error }, 'Error fetching block');
    }
}

async function scanBlocks(): Promise<void> {
    let blockCount = await btcClient.getBlockCount();

    log.info(`current block height: ${blockCount}`);

    let start = await resolveScanStart(blockCount);

    for (let height = start; height <= blockCount; height++) {
        log.debug(`${height}/${blockCount} blocks (${(100 * height / blockCount).toFixed(2)}%)`);
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

    log.debug({ update }, 'importBatch update');
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
                log.error({ error }, `Error importing ${item.did}`);
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

    log.debug({ signedTxn }, 'signed transaction');

    // Broadcast the transaction
    const txid = await btcClient.sendRawTransaction(signedTxn.hex);

    log.info(`Transaction broadcast with txid: ${txid}`);
    return txid;
}

async function checkPendingTransactions(txids: string[]): Promise<boolean> {
    const isMined = async (txid: string) => {
        const tx = await btcClient.getTransaction(txid).catch(() => undefined);
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
            log.debug(`pending txid ${txids.at(-1)}`);
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
        log.info(`RBF: Transaction broadcast with txid: ${txid}`);
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
            log.warn(`Wallet has insufficient funds (${walletInfo.balance}). Send ${config.chain} to ${address}`);
            return;
        }
    }
    catch {
        log.warn(`${config.chain} node not accessible`);
        return;
    }

    const batch = await gatekeeper.getQueue(REGISTRY);

    if (batch.length > 0) {
        log.debug({ batch }, 'export batch');

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
        log.debug(`empty ${REGISTRY} queue`);
    }
}

async function importLoop(): Promise<void> {
    if (importRunning) {
        setTimeout(importLoop, config.importInterval * 60 * 1000);
        log.debug(`import loop busy, waiting ${config.importInterval} minute(s)...`);
        return;
    }

    importRunning = true;

    try {
        await scanBlocks();
        await importBatches();
    } catch (error: any) {
        log.error({ error }, 'Error in importLoop');
    } finally {
        importRunning = false;
        log.debug(`import loop waiting ${config.importInterval} minute(s)...`);
        setTimeout(importLoop, config.importInterval * 60 * 1000);
    }
}

async function exportLoop(): Promise<void> {
    if (exportRunning) {
        setTimeout(exportLoop, config.exportInterval * 60 * 1000);
        log.debug(`Export loop busy, waiting ${config.exportInterval} minute(s)...`);
        return;
    }

    exportRunning = true;

    try {
        await anchorBatch();
    } catch (error) {
        log.error({ error }, 'Error in exportLoop');
    } finally {
        exportRunning = false;
        log.debug(`export loop waiting ${config.exportInterval} minute(s)...`);
        setTimeout(exportLoop, config.exportInterval * 60 * 1000);
    }
}

async function waitForChain() {
    let isReady = false;

    log.info(`Connecting to ${config.chain} node on ${config.host}:${config.port} using wallet '${config.wallet}'`);

    while (!isReady) {
        try {
            const blockchainInfo = await btcClient.getBlockchainInfo();
            log.debug({ blockchainInfo }, 'Blockchain Info');
            isReady = true;
        } catch (error) {
            log.debug(`Waiting for ${config.chain} node...`);
        }

        if (!isReady) {
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    if (READ_ONLY) {
        return true;
    }

    try {
        await btcClient.createWallet(config.wallet!);
        log.info(`Wallet '${config.wallet}' created successfully.`);
    } catch (error: any) {
        // If wallet already exists, log a message
        if (error.message.includes("already exists")) {
            log.info(`Wallet '${config.wallet}' already exists.`);
        } else {
            log.error({ error }, 'Error creating wallet');
            return false;
        }
    }

    try {
        const walletInfo = await btcClient.getWalletInfo();
        log.debug({ walletInfo }, 'Wallet Info');
    } catch (error) {
        log.error({ error }, 'Error fetching wallet info');
        return false;
    }

    try {
        const address = await btcClient.getNewAddress('funds', 'bech32');
        log.info(`Send ${config.chain} to address: ${address}`);
    } catch (error) {
        log.error({ error }, 'Error generating new address');
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

        log.info(`current block height: ${blockCount}`);

        for (let height = currentMax; height <= blockCount; height++) {
            const blockHash = await btcClient.getBlockHash(height);
            const block = await btcClient.getBlock(blockHash) as Block;
            log.debug(`${height}/${blockCount} blocks (${(100 * height / blockCount).toFixed(2)}%)`);
            await addBlock(height, blockHash, block.time);
        }
    } catch (error) {
        log.error({ error }, 'Error syncing blocks');
    }
}

async function main() {
    if (!READ_ONLY && !config.nodeID) {
        log.error('satoshi-mediator must have a KC_NODE_ID configured');
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
            log.info(`Database upgraded to ${config.db}`);
        }
        else {
            log.info(`Persisting to ${config.db}`);
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
        log.info(`Importing operations every ${config.importInterval} minute(s)`);
        setTimeout(importLoop, config.importInterval * 60 * 1000);
    }

    if (!READ_ONLY) {
        log.info(`Exporting operations every ${config.exportInterval} minute(s)`);
        log.info(`Txn fees (${config.chain}): conf target: ${config.feeConf}, maximum: ${config.feeMax}, fallback Sat/Byte: ${config.feeFallback}`);
        setTimeout(exportLoop, config.exportInterval * 60 * 1000);
    }
}

main();
