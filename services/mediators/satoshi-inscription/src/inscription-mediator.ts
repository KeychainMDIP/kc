import BtcClient, {BlockVerbose, BlockTxVerbose} from 'bitcoin-core';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { gunzipSync } from 'zlib';
import { BIP32Factory } from 'bip32';
import GatekeeperClient from '@mdip/gatekeeper/client';
import JsonFile from './db/jsonfile.js';
import JsonRedis from './db/redis.js';
import JsonMongo from './db/mongo.js';
import JsonSQLite from './db/sqlite.js';
import config from './config.js';
import { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import Inscription from '@mdip/inscription';
import {
    AccountKeys,
    MediatorDb,
    MediatorDbInterface,
    DiscoveredItem,
    DiscoveredInscribedItem,
    FundInput,
    InscribedKey,
    BlockVerbosity,
} from './types.js';

const REGISTRY = config.chain + "-Inscription";
const PROTOCOL_TAG = Buffer.from('MDIP', 'ascii');
const SMART_FEE_MODE = "CONSERVATIVE";

const READ_ONLY = config.exportInterval === 0;

const gatekeeper = new GatekeeperClient();
const btcClient = new BtcClient({
    username: config.user,
    password: config.pass,
    host: `http://${config.host}:${config.port}`,
    ...(READ_ONLY ? {} : { wallet: config.wallet }),
});
const inscription = new Inscription({
    feeMax: config.feeMax,
    network: config.network,
});

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

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
        discovered: [],
    };

    const db = await jsonPersister.loadDb();

    return db || newDb;
}

async function extractOperations(txn: BlockTxVerbose, height: number, index: number, timestamp: string): Promise<void> {
    try {
        const txid = txn.txid;
        const slices: Buffer[] = [];

        txn.vin.forEach((vin, vinIdx) => {
            if (!vin.txinwitness || vin.txinwitness.length < 3) {
                return;
            }

            const tapScriptHex = vin.txinwitness[vin.txinwitness.length - 2];
            const buf = Buffer.from(tapScriptHex, 'hex');
            if (!buf.includes(PROTOCOL_TAG)) {
                return;
            }

            const decomp = bitcoin.script.decompile(buf) || [];
            const tagIdx = decomp.findIndex(
                el => Buffer.isBuffer(el) && (el as Buffer).equals(PROTOCOL_TAG)
            );
            if (tagIdx === -1) {
                return;
            }

            const chunkBufs: Buffer[] = [];
            for (let j = tagIdx + 1; j < decomp.length; j++) {
                const el = decomp[j];
                if (typeof el === 'number') {
                    break;
                }
                chunkBufs.push(el as Buffer);
            }

            if (chunkBufs.length) {
                slices[vinIdx] = Buffer.concat(chunkBufs);
            }
        });

        const orderedSlices = slices.filter(Boolean);
        if (orderedSlices.length === 0) {
            return;
        }

        const payload = Buffer.concat(orderedSlices);
        if (!payload.length) {
            return;
        }

        let ops: unknown;
        try {
            const marker = payload[0];
            let raw: Buffer;

            if (marker === 0x01) {
                // gzip(JSON)
                raw = gunzipSync(payload.subarray(1));
            } else if (marker === 0x00) {
                // plain JSON (utf8)
                raw = payload.subarray(1);
            } else {
                return;
            }

            ops = JSON.parse(raw.toString('utf8'));
        } catch (e) {
            console.warn(`bad payload at ${txid}:${index} – ${e}`);
            return;
        }

        const isOp = (o: any): o is Operation =>
            o && typeof o === 'object' &&
            ['create', 'update', 'delete'].includes(o.type);

        if (!Array.isArray(ops) || ops.some(o => !isOp(o))) {
            console.warn(`invalid Operation array at ${txid}:${index}`);
            return;
        }

        const events: GatekeeperEvent[] = ops.map((op, i) => ({
            registry : REGISTRY,
            time : timestamp,
            ordinal : [height, index, i],
            operation : op,
            blockchain : {
                height,
                index: index,
                txid,
                batch: '(witness)',
                opidx: i
            }
        }));

        await jsonPersister.updateDb((db) => {
            (db.discovered ??= []).push({ events });
        });
    }
    catch (error) {
        console.error(`Error fetching txn: ${error}`);
    }
}

async function fetchBlock(height: number, blockCount: number): Promise<void> {
    try {
        const blockHash = await btcClient.getBlockHash(height);
        const block = await btcClient.getBlock(blockHash, BlockVerbosity.JSON_TX_DATA) as BlockVerbose;
        const timestamp = new Date(block.time * 1000).toISOString();

        for (let i = 0; i < block.tx.length; i++) {
            const tx = block.tx[i];

            console.log(height, String(i).padStart(4), tx.txid);

            const asm: string | undefined = tx.vout?.[0]?.scriptPubKey?.asm;
            if (!asm || !asm.startsWith('OP_RETURN 4d44495001')) {
                continue;
            }

            await extractOperations(tx, height, i, timestamp);
        }

        await jsonPersister.updateDb((db) => {
            db.height = height;
            db.time = timestamp;
            db.blocksScanned = height - config.startBlock + 1;
            db.txnsScanned += block.tx.length;
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

async function importBatch(item: DiscoveredInscribedItem) {
    if (item.imported && item.processed) {
        return;
    }

    const events = item.events;
    if (events.length === 0) {
        return;
    }

    let logObj: DiscoveredItem = {
        height: item.events[0].ordinal![0],
        index: item.events[0].blockchain!.index!,
        time: item.events[0].time,
        txid: item.events[0].blockchain!.txid!,
    };

    let update: DiscoveredInscribedItem = { ...item };

    try {
        update.imported  = await gatekeeper.importBatch(events);
        update.processed = await gatekeeper.processEvents();
        logObj = { ...logObj, imported: update.imported, processed: update.processed };
    } catch (error) {
        update.error = JSON.stringify(`Error importing inscribed batch: ${error}`);
        logObj = { ...logObj, error: update.error };
    }

    console.log(JSON.stringify(logObj, null, 4));
    return update;
}

function sameItem(a: InscribedKey, b: InscribedKey) {
    return a.height === b.height && a.index === b.index && a.txid === b.txid;
}

function keyFromItem(item: DiscoveredInscribedItem): InscribedKey {
    return {
        height: item.events[0]!.blockchain!.height!,
        index: item.events[0]!.blockchain!.index!,
        txid: item.events[0]!.blockchain!.txid!,
    };
}

async function importBatches(): Promise<boolean> {
    const db = await loadDb();

    for (const item of db.discovered ?? []) {
        const update = await importBatch(item);
        if (!update) {
            continue;
        }

        await jsonPersister.updateDb((db) => {
            const list = db.discovered ?? [];
            const idx = list.findIndex(d => sameItem(keyFromItem(d), keyFromItem(update)));
            if (idx >= 0) {
                list[idx] = update;
            }
        });
    }

    return true;
}

async function extractCommitHex(revealHex: string) {

    const revealTx = bitcoin.Transaction.fromHex(revealHex);

    let commitTxid: string | undefined;

    for (const inp of revealTx.ins) {
        const w = inp.witness;
        if (!w || w.length < 3) {
            continue;
        }

        const tScript = Buffer.from(w[w.length - 2]);
        if (!tScript.includes(PROTOCOL_TAG)) {
            continue;
        }

        if (!commitTxid) {
            commitTxid = inp.hash.subarray().reverse().toString('hex');
            break;
        }
    }

    if (!commitTxid) {
        throw new Error('no Taproot-inscription inputs found in reveal tx');
    }

    const wtx = await btcClient.getTransaction(commitTxid).catch(() => undefined);
    if (wtx?.hex) {
        return wtx.hex;
    }

    return await btcClient.getRawTransaction(commitTxid, 0) as string;
}

async function getAccountXprvsFromCore(): Promise<AccountKeys> {
    const { descriptors } = await btcClient.listDescriptors(true);

    let rootXprv: string | undefined;
    let parsedCoin: number | undefined;
    let parsedAccount: number | undefined;

    for (const { desc } of descriptors) {
        const xprvMatch = desc.match(/\((?:\[.*?])?([xt]prv[1-9A-HJ-NP-Za-km-z]+)(?:\/(\d+)h\/(\d+)h\/(\d+)h)?/);
        if (!xprvMatch) {
            continue;
        }

        rootXprv = xprvMatch[1];

        if (xprvMatch[2] && xprvMatch[3] && xprvMatch[4]) {
            parsedCoin    = parseInt(xprvMatch[3], 10);
            parsedAccount = parseInt(xprvMatch[4], 10);
        }
        break;
    }

    if (!rootXprv) {
        throw new Error('Could not locate any xprv/tprv in wallet descriptors.');
    }

    const isTestnet = ['testnet', 'signet', 'regtest'].includes(String(config.network));
    const coin = parsedCoin ?? (isTestnet ? 1 : 0);
    const account = parsedAccount ?? 0;

    const net = bitcoin.networks[config.network];
    const root = bip32.fromBase58(rootXprv, net);

    const bip86Node = root.derivePath(`m/86'/${coin}'/${account}'`);
    const bip84Node = root.derivePath(`m/84'/${coin}'/${account}'`);

    return {
        bip86: bip86Node.toBase58(),
        bip84: bip84Node.toBase58(),
    };
}

async function getUnspentOutputs() {
    const unspentOutputs = (await btcClient.listUnspent()).sort((a, b) => a.amount - b.amount);

    const utxos: FundInput[] = [];
    for (const unspent of unspentOutputs) {
        if (!unspent.address) {
            continue;
        }
        const addrInfo = await btcClient.getAddressInfo(unspent.address);
        if (!addrInfo.hdkeypath || !addrInfo.desc) {
            continue;
        }
        if (addrInfo.desc.startsWith('wpkh(')) {
            utxos.push({
                type: 'p2wpkh',
                txid: unspent.txid,
                vout: unspent.vout,
                amount: Math.round(unspent.amount * 1e8),
                hdkeypath: addrInfo.hdkeypath,
            });
        } else if (addrInfo.desc.startsWith('tr(')) {
            utxos.push({
                type: 'p2tr',
                txid: unspent.txid,
                vout: unspent.vout,
                amount: Math.round(unspent.amount * 1e8),
                hdkeypath: addrInfo.hdkeypath,
            });
        }
    }

    return utxos;
}

async function getEntryFromMempool(txids: string[]) {
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

async function checkPendingTransactions(): Promise<boolean> {
    const db = await loadDb();
    if (!db.pendingTaproot) {
        return false;
    }

    const isMined = async (txid: string) => {
        const tx = await btcClient.getTransaction(txid).catch(() => undefined);
        return !!(tx && tx.blockhash);
    };

    const checkPendingTxs = async (txids: string[]) => {
        for (let i = 0; i < txids.length; i++) {
            if (await isMined(txids[i])) {
                return i;
            }
        }
        return -1;
    }

    if (db.pendingTaproot.commitTxid) {
        const mined = await checkPendingTxs([db.pendingTaproot.commitTxid]);
        if (mined >= 0) {
            await jsonPersister.updateDb((db) => {
                if (db.pendingTaproot) {
                    db.pendingTaproot.commitTxid = undefined;
                }
            });
        } else {
            console.log('pendingTaproot commitTxid', db.pendingTaproot.commitTxid);
        }
    }

    if (db.pendingTaproot.revealTxids?.length) {
        const mined = await checkPendingTxs(db.pendingTaproot.revealTxids);
        if (mined >= 0) {
            await jsonPersister.updateDb((db) => {
                db.pendingTaproot = undefined;
            });
            return false;
        } else {
            console.log('pendingTaproot revealTxid', db.pendingTaproot.revealTxids.at(-1));
        }
    }

    return true;
}

async function replaceByFee(): Promise<boolean> {
    const db = await loadDb();

    if (!db.pendingTaproot?.revealTxids || !(await checkPendingTransactions())) {
        return false;
    }

    if (!config.rbfEnabled) {
        return true;
    }

    const blockCount = await btcClient.getBlockCount();
    if (db.pendingTaproot.blockCount + config.feeConf >= blockCount) {
        return true;
    }

    const { entry: revealEntry, txid: revealTxid } = await getEntryFromMempool(db.pendingTaproot.revealTxids);
    const revealHex = await btcClient.getRawTransaction(revealTxid, 0) as string;
    const commitHex = await extractCommitHex(revealHex);

    const feeResp = await btcClient.estimateSmartFee(config.feeConf, SMART_FEE_MODE);
    const estSatPerVByte = feeResp.feerate ? Math.ceil(feeResp.feerate * 1e5) : config.feeFallback;

    const currFeeSat = Math.round(revealEntry.fees.modified * 1e8);
    const curSatPerVb = Math.floor(currFeeSat / revealEntry.vsize);

    const utxos = await getUnspentOutputs();
    const keys = await getAccountXprvsFromCore();

    console.log("Bump Fees");

    const newRevealHex = await inscription.bumpTransactionFee(
        db.pendingTaproot.hdkeypath,
        utxos,
        curSatPerVb,
        estSatPerVByte,
        keys,
        commitHex,
        revealHex
    );
    const newRevealTxid = await btcClient.sendRawTransaction(newRevealHex);

    await jsonPersister.updateDb((db) => {
        if (db.pendingTaproot?.revealTxids?.length) {
            db.pendingTaproot.revealTxids.push(newRevealTxid);
            db.blockCount = blockCount;
        }
    });

    console.log(`Reveal TXID: ${newRevealTxid}`);

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

async function fundWalletMessage() {
    const walletInfo = await btcClient.getWalletInfo();

    if (walletInfo.balance < config.feeMax) {
        const address = await btcClient.getNewAddress('funds', 'bech32m');
        console.log(`Wallet has insufficient funds (${walletInfo.balance}). Send ${config.chain} to ${address}`);
    }
}

async function anchorBatch(): Promise<void> {

    if (await checkExportInterval()) {
        return;
    }

    if (await replaceByFee()) {
        return;
    }

    try {
        await fundWalletMessage();
    } catch (error) {
        console.error("Error generating new address:", error);
        return;
    }

    const queue = await gatekeeper.getQueue(REGISTRY);

    if (queue.length === 0) {
        console.log(`empty ${REGISTRY} queue`);
        return;
    }

    try {
        const taprootAddr = await btcClient.getNewAddress('', 'bech32m');
        const tapInfo = await btcClient.getAddressInfo(taprootAddr);
        if (!tapInfo.hdkeypath) {
            throw new Error("Taproot information missing hdkeypath");
        }
        const feeResp = await btcClient.estimateSmartFee(config.feeConf, SMART_FEE_MODE);
        const estSatPerVByte = feeResp.feerate ? Math.ceil(feeResp.feerate * 1e5) : config.feeFallback;
        const utxos = await getUnspentOutputs();
        const keys = await getAccountXprvsFromCore();
        const payload = Buffer.from(JSON.stringify(queue), 'utf8');

        const { commitHex, revealHex, batch } = await inscription.createTransactions(
            payload,
            tapInfo.hdkeypath,
            utxos,
            estSatPerVByte,
            keys,
        );

        console.log(JSON.stringify(batch, null, 4));

        const commitTxid = await btcClient.sendRawTransaction(commitHex);
        const revealTxid = await btcClient.sendRawTransaction(revealHex);

        console.log("Commit TXID", commitTxid);
        console.log("Reveal TXID", revealTxid);

        const ok = await gatekeeper.clearQueue(REGISTRY, batch);

        if (ok) {
            const blockCount = await btcClient.getBlockCount();
            await jsonPersister.updateDb(async (db) => {
                db.pendingTaproot = {
                    commitTxid: commitTxid,
                    revealTxids: [revealTxid],
                    hdkeypath: tapInfo.hdkeypath!,
                    blockCount
                };
                db.lastExport = new Date().toISOString();
            });
        }
    } catch (err) {
        console.error(`Taproot anchor error: ${err}`);
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

    if (READ_ONLY) {
        return true;
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
        await fundWalletMessage();
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
    if (!READ_ONLY && !config.nodeID) {
        console.log('inscription-mediator must have a KC_NODE_ID configured');
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

    await syncBlocks();

    if (config.importInterval > 0) {
        console.log(`Importing operations every ${config.importInterval} minute(s)`);
        setTimeout(importLoop, config.importInterval * 60 * 1000);
    }

    if (!READ_ONLY) {
        console.log(`Exporting operations every ${config.exportInterval} minute(s)`);
        console.log(`Txn fees (${REGISTRY}): conf target: ${config.feeConf}, maximum: ${config.feeMax}, fallback Sat/Byte: ${config.feeFallback}`);
        setTimeout(exportLoop, config.exportInterval * 60 * 1000);
    }
}

main();
