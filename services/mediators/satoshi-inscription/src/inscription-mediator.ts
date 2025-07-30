import BtcClient, {AddressInfo, MempoolEntry, RawTransactionVerbose} from 'bitcoin-core';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { encode as varuintEncode } from 'varuint-bitcoin';
import { gzipSync, gunzipSync } from 'zlib';
import { BIP32Factory } from 'bip32';
import GatekeeperClient from '@mdip/gatekeeper/client';
import KeymasterClient from '@mdip/keymaster/client';
import JsonFile from './db/jsonfile.js';
import JsonRedis from './db/redis.js';
import JsonMongo from './db/mongo.js';
import JsonSQLite from './db/sqlite.js';
import config from './config.js';
import {MediatorDb, MediatorDbInterface, DiscoveredItem, DiscoveredInscribedItem, HDInfo} from './types.js';
import { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import {witnessStackToScriptWitness} from "bitcoinjs-lib/src/psbt/psbtutils.js";

const CHAIN = config.chain;
const REGISTRY = CHAIN + "-Inscription";
const PROTOCOL_TAG = Buffer.from('MDIP', 'ascii');
const DUST = 546;

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

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

interface RpcError extends Error {
    code: number;
    error: { code: number; message: string };
}

let jsonPersister: MediatorDbInterface;
let exportRunning = false;
let walletXprv: string | null = null;

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

async function saveDb(db: MediatorDb): Promise<boolean> {
    return await jsonPersister.saveDb(db);
}

async function fetchTransaction(height: number, index: number, timestamp: string, txid: string): Promise<void> {
    try {
        const txn = await btcClient.getTransactionByHash(txid);
        const asm = txn.vout[0].scriptPubKey.asm;

        const hasMdipMarker = asm.startsWith('OP_RETURN 4d44495001'); // MDIP 0x01

        const vin = txn.vin[0];

        if (
            hasMdipMarker &&
            vin &&
            vin.txinwitness &&
            vin.txinwitness.length >= 3
        ) {

            const tapScriptHex = vin.txinwitness[vin.txinwitness.length - 2];
            const buf = Buffer.from(tapScriptHex, 'hex');
            if (!buf.includes(PROTOCOL_TAG)) {
                return;
            }

            const chunks = (() => {
                const decomp = bitcoin.script.decompile(buf) || [];
                const tagIdx = decomp.findIndex(
                    (el) => Buffer.isBuffer(el) && (el as Buffer).equals(PROTOCOL_TAG)
                );
                if (tagIdx === -1) {
                    return null;
                }

                console.log("inscription found");

                const result: Buffer[] = [];
                for (let j = tagIdx + 1; j < decomp.length; j++) {
                    const el = decomp[j];
                    if (typeof el === 'number') {
                        break;
                    }
                    result.push(el as Buffer);
                }
                return result;
            })();

            if (!chunks || chunks.length === 0) {
                return;
            }

            const payload = Buffer.concat(chunks);

            let ops: unknown;
            try {
                if (payload[0] !== 0x01) {
                    return;
                }
                const raw = gunzipSync(payload.subarray(1));
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

            console.log(ops);

            const events: GatekeeperEvent[] = ops.map((op, i) => ({
                registry : REGISTRY,
                time : timestamp,
                ordinal : [height, index, i],
                operation : op,
                blockchain : { height, index: index, txid, batch: '(witness)', opidx: i }
            }));

            const db = await loadDb();
            if (!db.discovered) {
                db.discovered = [];
            }
            db.discovered.push({events});
            await saveDb(db);
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

        const db = await loadDb();
        db.height = height;
        db.time = timestamp;
        db.blocksScanned = height - config.startBlock + 1;
        db.txnsScanned = db.txnsScanned + block.nTx;
        db.blockCount = blockCount;
        db.blocksPending = blockCount - height;
        await saveDb(db);
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

    // Recreate the same logging as non-inscribed mediator
    let logObj: DiscoveredItem = {
        height: events[0].ordinal![0],
        index: events[0].blockchain!.index!,
        time: events[0].time,
        txid: events[0].blockchain!.txid!,
    };

    try {
        item.imported  = await gatekeeper.importBatch(events);
        item.processed = await gatekeeper.processEvents();
        logObj = { ...logObj, imported: item.imported, processed: item.processed, error: item.error };
    } catch (error) {
        item.error = JSON.stringify(`Error importing inscribed batch: ${error}`);
    }

    console.log(JSON.stringify(logObj, null, 4));
}

async function importBatches(): Promise<boolean> {
    const db = await loadDb();

    for (const item of db.discovered ?? []) {
        await importBatch(item);
    }

    return await saveDb(db);
}

async function extractRevealContext(revealTxid: string) {
    const rawReveal = await btcClient.getRawTransaction(revealTxid, 0) as string;
    const revealTx = bitcoin.Transaction.fromHex(rawReveal);

    const commitTxid = revealTx.ins[0].hash.reverse().toString('hex');
    const rawCommit = await btcClient.getRawTransaction(commitTxid, 0) as string;
    const commitTx = bitcoin.Transaction.fromHex(rawCommit);

    const commitValueSat = commitTx.outs[0].value;

    const wstack = revealTx.ins[0].witness;
    const tScript = Buffer.from(wstack[wstack.length - 2]);
    const xonly = tScript.subarray(0, 32);

    const db = await loadDb();

    return { commitTx, commitValueSat, xonly, tScript, hdInfo: db.pendingTaproot!.hdInfo };
}

function tapLeafHash(script: Buffer, leafVer = 0xc0): Buffer {
    const verBuf = Buffer.from([leafVer]);
    const enc = varuintEncode(script.length);
    const lenBuf = Buffer.from(enc.buffer).subarray(0, enc.bytes);
    return bitcoin.crypto.taggedHash('TapLeaf', Buffer.concat([verBuf, lenBuf, script]));
}

function encodePayload(batch: Operation[]): Buffer {
    const raw = Buffer.from(JSON.stringify(batch), 'utf8');
    const gz = gzipSync(raw);
    return Buffer.concat([Buffer.from([0x01]), gz]);
}

function buildInscriptionScript(xonly: Buffer, payload: Buffer): Buffer {
    const { script, opcodes } = bitcoin;

    const chunks: Buffer[] = [];
    for (let i = 0; i < payload.length; i += 520) {
        chunks.push(payload.subarray(i, i + 520));
    }

    console.log("chunks:", chunks.length);

    return script.compile([
        xonly,
        opcodes.OP_CHECKSIG,
        opcodes.OP_FALSE,
        opcodes.OP_IF,
        PROTOCOL_TAG,
        ...chunks,
        opcodes.OP_ENDIF,
    ]);
}

function virtualSizeFromWitness(bytes: number): number {
    return Math.ceil((16 + bytes) / 4);
}

async function buildRevealHex(
    commitTx: bitcoin.Transaction,
    commitValueSat: number,
    commitScript: Buffer,
    xonly: Buffer,
    tScript: Buffer,
    hdInfo: HDInfo,
    extraInputs: {
        txid: string;
        vout: number;
        value: number;
        scriptPubKey: string
    }[] = []
) {
    const network = bitcoin.networks[config.network];
    const psbt = new bitcoin.Psbt({ network });

    const leafHash = tapLeafHash(tScript, 0xc0);
    const { parity } = tweakPubkey(xonly, leafHash);

    const controlByte = 0xc0 | parity;
    const controlBlock = Buffer.concat([Buffer.from([controlByte]), xonly]);

    psbt.addInput({
        hash: commitTx.getId(),
        index: 0,
        sequence: 0xfffffffd,
        witnessUtxo: {
            script: commitScript,
            value: commitValueSat,
        },
        tapLeafScript: [{
            controlBlock,
            script: tScript,
            leafVersion: 0xc0,
        }],
    });

    for (const inp of extraInputs) {
        psbt.addInput({
            hash: inp.txid,
            index: inp.vout,
            sequence: 0xfffffffd,
            witnessUtxo: {
                script: Buffer.from(inp.scriptPubKey, 'hex'),
                value : Math.round(inp.value * 1e8),
            },
        });
    }

    const marker = Buffer.concat([PROTOCOL_TAG, Buffer.from([0x01])]);
    psbt.addOutput({
        script: bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, marker]),
        value: 0,
    });

    const processed = await btcClient.walletProcessPsbt(psbt.toBase64(), true);
    const psbt2 = bitcoin.Psbt.fromBase64(processed.psbt, { network });
    const privKey = await derivePrivKey(hdInfo);

    const signer = {
        publicKey: Buffer.concat([Buffer.from([0x02]), xonly]),
        signSchnorr: (hash: Buffer) => ecc.signSchnorr(hash, privKey),
    } as bitcoin.Signer;

    psbt2.signInput(0, signer, [bitcoin.Transaction.SIGHASH_DEFAULT]);
    const sigWithHashType = psbt2.data.inputs[0].tapScriptSig![0].signature;
    const finalScriptWitness = witnessStackToScriptWitness([
        sigWithHashType,
        tScript,
        controlBlock
    ]);

    psbt2.finalizeInput(0, () => ({
        finalScriptWitness,
    }));

    if (extraInputs.length === 0) {
        return psbt2.extractTransaction().toHex();
    } else {
        const { psbt: ready } = await btcClient.walletProcessPsbt(psbt2.toBase64(), false);
        const { hex } = await btcClient.finalizePsbt(ready);
        return hex;
    }
}

function getXOnly(addr: AddressInfo): Buffer {
    if (addr.desc) {
        const match = addr.desc.match(/tr\((?:\[.+?])?([0-9a-fA-F]{64})/);

        if (match && match[1]) {
            return Buffer.from(match[1], 'hex');
        }
    }

    throw new Error('Could not extract taproot internal key from getAddressInfo');
}

function tweakPubkey(xonly: Buffer, leafHash: Buffer): {
    tweakedX: Buffer;
    parity: number;
} {
    const tweak = bitcoin.crypto.taggedHash('TapTweak', Buffer.concat([xonly, leafHash]));
    const P = Buffer.concat([Buffer.from([0x02]), xonly]);
    const tweaked = ecc.pointAddScalar(P, tweak, true);
    if (!tweaked) {
        throw new Error('tap tweak failed');
    }
    return { tweakedX: Buffer.from(tweaked.subarray(1)), parity: tweaked[0] & 1 };
}

async function getWalletXprv() {
    if (walletXprv) {
        return walletXprv;
    }

    const { descriptors } = await btcClient.listDescriptors(true);

    for (const d of descriptors) {
        const match = d.desc.match(/([xt]prv[A-HJ-NP-Za-km-z1-9]+)/);
        if (match) {
            walletXprv = match[1];
            return walletXprv;
        }
    }

    throw new Error('Could not locate wallet xprv in exportdescriptors');
}

function normalisePath(path: string): string {
    const withM = path.startsWith('m/') ? path : `m/${path}`;
    return withM.replace(/(\d+)h/g, "$1'");
}

async function derivePrivKey(hdInfo: HDInfo) {
    const xprv = await getWalletXprv();
    const node = bip32.fromBase58(xprv, bitcoin.networks[config.network]);
    const bip32Path = normalisePath(hdInfo.hdkeypath);
    const child = node.derivePath(bip32Path);
    if (!child.privateKey) {
        throw new Error('derived node has no private key');
    }
    return child.privateKey;
}

async function createTransactionPair(tScript: Buffer, payload: Buffer, tapAddr: string) {

    const feeResp = await btcClient.estimateSmartFee(1);
    const feeSatPerVbyte = feeResp.feerate ? Math.ceil(feeResp.feerate * 1e5) : 10;
    const revealVSize = virtualSizeFromWitness(tScript.length + payload.length + 128);
    const revealFeeSat = feeSatPerVbyte * revealVSize;

    const commitVSize = 200; // Actual size will be less, 153 in one commit transaction
    const commitFeeSat= feeSatPerVbyte * commitVSize;

    const utxos = await btcClient.listUnspent();
    const spend = utxos.find(u => u.amount * 1e8 > revealFeeSat + commitFeeSat);
    if (!spend) {
        throw new Error(`Could not find sufficient UTXOs to cover fee: ${revealFeeSat + commitFeeSat}`);
    }

    const inputSat = Math.round(spend.amount * 1e8);
    const changeSat = inputSat - revealFeeSat - commitFeeSat;

    const outputs: Record<string, string> = {};
    outputs[tapAddr] = (revealFeeSat / 1e8).toFixed(8);

    if (changeSat >= DUST) {
        const changeAddr = await btcClient.getNewAddress();
        outputs[changeAddr] = (changeSat / 1e8).toFixed(8);
    }

    const commitRaw = await btcClient.createRawTransaction(
        [{ txid: spend.txid, vout: spend.vout, sequence: 0xfffffffd }],
        outputs
    );

    const commitSigned = await btcClient.signRawTransactionWithWallet(commitRaw);
    const commitHex = commitSigned.hex;
    const commitTx = bitcoin.Transaction.fromHex(commitHex);

    return {
        commitTx,
        revealFeeSat,
        commitHex,
    };
}

async function createTaprootPair(batch: Operation[]) {
    const payload = encodePayload(batch);
    const walletAddr = await btcClient.getNewAddress('', 'bech32m');
    const addrInfo = await btcClient.getAddressInfo(walletAddr);
    const xonly = getXOnly(addrInfo);

    const tScript = buildInscriptionScript(xonly, payload);
    const leafHash = tapLeafHash(tScript, 0xc0);
    const { tweakedX } = tweakPubkey(xonly, leafHash);

    const tapAddr = bitcoin.payments.p2tr({
        pubkey: tweakedX,
        network: bitcoin.networks[config.network]
    }).address!;

    const { commitTx, revealFeeSat, commitHex } = await createTransactionPair(tScript, payload, tapAddr);

    const hdInfo: HDInfo = { hdkeypath: addrInfo.hdkeypath!, hdmasterfingerprint: addrInfo.hdmasterfingerprint! };

    const revealHex = await buildRevealHex(
        commitTx,
        revealFeeSat,
        commitTx.outs[0].script,
        xonly,
        tScript,
        hdInfo,
    );

    return {
        commitHex,
        revealHex,
        hdInfo,
    };
}

async function bumpFee(entry: MempoolEntry | undefined, txid: string) {
    // If we're already at the maximum fee, wait it out
    if (!entry || entry.fees.modified >= config.feeMax) {
        return true;
    }

    const targetFeeBtc = Math.min(entry.fees.modified + config.feeInc, config.feeMax);
    const currFeeSat = Math.floor(entry.fees.modified  * 1e8);
    const targetFeeSat = Math.floor(targetFeeBtc * 1e8);
    const currSatPerVb = Math.ceil(currFeeSat / entry.vsize);
    let targetSatPerVb = Math.floor(targetFeeSat / entry.vsize);
    targetSatPerVb = Math.max(targetSatPerVb, currSatPerVb + 1);

    if (targetSatPerVb * entry.vsize > config.feeMax * 1e8) {
        return true;
    }

    // Before version 0.21, fee_rate was in BTC/kvB. As of 0.21, fee_rate is in sat/vB
    const { version } = await btcClient.getNetworkInfo();
    const legacyRate = version < 210000;
    const feeRateParam = legacyRate
        ? (targetSatPerVb / 1e5).toFixed(8)
        : targetSatPerVb;

    return await btcClient.bumpFee(txid, {
        feeRate: feeRateParam,
        replaceable: true
    }).catch(
        (err: RpcError) => {
            console.error(`bumpFee failed (${err.code}): ${err.message}`);
            return true;
        });
}

async function replaceByFee(): Promise<boolean> {
    const db = await loadDb();

    if (!db.pendingTaproot) {
        return false;
    }

    if (db.pendingTaproot.commitTxid) {
        console.log('pendingTaproot commitTxid', db.pendingTaproot.commitTxid);

        const tx = await btcClient.getRawTransaction(db.pendingTaproot.commitTxid, 1) as RawTransactionVerbose;
        if (!tx.blockhash) {
            if (config.feeInc === 0) {
                return true;
            }

            const commitEntry = await btcClient.getMempoolEntry(db.pendingTaproot.commitTxid).catch(() => undefined);

            const bump = await bumpFee(commitEntry, db.pendingTaproot.commitTxid);
            if (bump === true) {
                return true;
            }

            if (bump && bump.txid) {
                console.log(`Transaction broadcasted with txid: ${bump.txid}`);

                const rawCommitHex = await btcClient.getRawTransaction(bump.txid, 0) as string;
                const newCommitTx = bitcoin.Transaction.fromHex(rawCommitHex);

                const ctx = await extractRevealContext(db.pendingTaproot.revealTxid!);

                const revealHex = await buildRevealHex(
                    newCommitTx,
                    newCommitTx.outs[0].value,
                    newCommitTx.outs[0].script,
                    ctx.xonly,
                    ctx.tScript,
                    ctx.hdInfo,
                );

                const newRevealTxid = await btcClient.sendRawTransaction(revealHex);
                db.pendingTaproot.commitTxid = bump.txid;
                db.pendingTaproot.revealTxid = newRevealTxid;
                await saveDb(db);
                return true;
            }
        } else {
            db.pendingTaproot.commitTxid = undefined;
        }
    }

    if (!db.pendingTaproot.commitTxid && db.pendingTaproot.revealTxid) {
        console.log('pendingTaproot revealTxid', db.pendingTaproot.revealTxid);

        const tx = await btcClient.getRawTransaction(db.pendingTaproot.revealTxid, 1) as RawTransactionVerbose;

        if (!tx.blockhash) {
            if (config.feeInc === 0) {
                return true;
            }

            const revealEntry = await btcClient.getMempoolEntry(db.pendingTaproot.revealTxid).catch(() => undefined);
            if (!revealEntry || revealEntry.fees.modified >= config.feeMax) {
                return true;
            }

            const extraUtxo = (await btcClient.listUnspent()).find(u => u.amount > config.feeInc);
            if (extraUtxo) {
                const ctx = await extractRevealContext(db.pendingTaproot.revealTxid);

                const revealHex = await buildRevealHex(
                    ctx.commitTx,
                    ctx.commitValueSat,
                    ctx.commitTx.outs[0].script,
                    ctx.xonly,
                    ctx.tScript,
                    ctx.hdInfo,
                    [{
                        txid: extraUtxo.txid,
                        vout: extraUtxo.vout,
                        value: extraUtxo.amount,
                        scriptPubKey: extraUtxo.scriptPubKey
                    }],
                );

                const txid = await btcClient.sendRawTransaction(revealHex).catch(
                    (err: RpcError) => {
                        console.error(`sendRawTransaction failed (${err.code}): ${err.message}`);
                        return null;
                    });
                if (txid) {
                    console.log(`Transaction broadcasted with txid: ${txid}`);

                    db.pendingTaproot.revealTxid = txid;
                    await saveDb(db);
                }

                return true;
            }
        } else {
            db.pendingTaproot.revealTxid = undefined;
        }
    }

    if (db.pendingTaproot && !db.pendingTaproot.commitTxid && !db.pendingTaproot.revealTxid) {
        db.pendingTaproot = undefined;
    }
    await saveDb(db);

    return false;
}

async function checkExportInterval(): Promise<boolean> {
    const db = await loadDb();

    if (!db.lastExport) {
        db.lastExport = new Date().toISOString();
        await saveDb(db);
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
        const address = await btcClient.getNewAddress('funds', 'bech32');
        console.log(`Wallet has insufficient funds (${walletInfo.balance}). Send ${config.chain} to ${address}`);
    }
}

async function anchorBatch(): Promise<void> {

    if (await replaceByFee()) {
        return;
    }

    try {
        await fundWalletMessage();
    } catch {
        console.log(`${config.chain} node not accessible`);
        return;
    }

    const batch = await gatekeeper.getQueue(REGISTRY);

    if (batch.length === 0) {
        console.log(`empty ${REGISTRY} queue`);
        return;
    }

    console.log(JSON.stringify(batch, null, 4));

    try {
        const taprootPair = await createTaprootPair(batch);
        if (!taprootPair) {
            return;
        }
        const { commitHex, revealHex, hdInfo } = taprootPair;

        const decodedCommitTx = await btcClient.decodeRawTransaction(commitHex);
        const decodedRevealTx = await btcClient.decodeRawTransaction(revealHex);

        console.log("Commit TX\n", JSON.stringify(decodedCommitTx, null, 2));
        console.log("Reveal TX\n", JSON.stringify(decodedRevealTx, null, 2));

        const commitTxid = await btcClient.sendRawTransaction(commitHex);
        const revealTxid = await btcClient.sendRawTransaction(revealHex);

        const ok = await gatekeeper.clearQueue(REGISTRY, batch);

        if (ok) {
            const db = await loadDb();
            db.pendingTaproot = {
                commitTxid,
                revealTxid,
                hdInfo,
            };
            db.lastExport = new Date().toISOString();
            await saveDb(db);
        }
    } catch (err) {
        console.error(`Taproot anchor error: ${err}`);
    }
}

async function importLoop(): Promise<void> {
    try {
        await scanBlocks();
        await importBatches();
        console.log(`import loop waiting ${config.importInterval} minute(s)...`);
    } catch (error: any) {
        console.error(`Error in importLoop: ${error.error || JSON.stringify(error)}`);
    }
    setTimeout(importLoop, config.importInterval * 60 * 1000);
}

async function exportLoop(): Promise<void> {
    if (exportRunning) {
        setTimeout(exportLoop, config.exportInterval * 60 * 1000);
        return;
    }

    exportRunning = true;

    try {
        if (await checkExportInterval()) {
            return;
        }

        await anchorBatch();
        console.log(`export loop waiting ${config.exportInterval} minute(s)...`);
    } catch (error) {
        console.error(`Error in exportLoop: ${error}`);
    } finally {
        exportRunning = false;
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
    await gatekeeper.addBlock(CHAIN, { hash, height, time });
}

async function syncBlocks(): Promise<void> {
    try {
        const latest = await gatekeeper.getBlock(CHAIN);
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
        db.discovered = [];
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

    await syncBlocks();

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
