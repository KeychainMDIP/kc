import BtcClient, {AddressInfo, MempoolEntry, RawTransactionVerbose, UnspentOutput} from 'bitcoin-core';
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
const MAX_LEAF_BYTES = 10 * 1024;
const MAX_LEAVES = 38;
const HARD_LIMIT = MAX_LEAF_BYTES * MAX_LEAVES;
const SMART_FEE_MODE = "conservative";

const gatekeeper = new GatekeeperClient();
const keymaster = new KeymasterClient();
const btcClient = new BtcClient({
    username: config.user,
    password: config.pass,
    host: 'http://' + config.host + ':' + config.port,
    wallet: config.wallet,
});

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

interface RevealContext {
    commitTx: bitcoin.Transaction;
    tapScripts: Buffer[];
    xonly: Buffer;
    hdInfo: HDInfo;
}

let jsonPersister: MediatorDbInterface;
let importRunning = false;
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

        if (!asm.startsWith('OP_RETURN 4d44495001')) { // MDIP 0x01
            return;
        }

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
        if (payload[0] !== 0x01) {
            return;
        }

        let ops: unknown;
        try {
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

        const db = await loadDb();
        db.discovered ??= [];
        db.discovered.push({events});
        await saveDb(db);
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

async function extractRevealContext(revealTxid: string): Promise<RevealContext> {

    const rawReveal = await btcClient.getRawTransaction(revealTxid, 0) as string;
    const revealTx = bitcoin.Transaction.fromHex(rawReveal);

    const tapScripts: Buffer[] = [];
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
        tapScripts.push(tScript);

        if (!commitTxid) {
            commitTxid = inp.hash.subarray().reverse().toString('hex');
        }
    }

    if (tapScripts.length === 0 || !commitTxid) {
        throw new Error('no Taproot-inscription inputs found in reveal tx');
    }

    const rawCommit = await btcClient.getRawTransaction(commitTxid, 0) as string;
    const commitTx = bitcoin.Transaction.fromHex(rawCommit);

    const dec = bitcoin.script.decompile(tapScripts[0]);
    if (!dec || !Buffer.isBuffer(dec[0]) || (dec[0] as Buffer).length !== 32) {
        throw new Error('could not parse x-only pubkey from tapscript');
    }
    const xonly = dec[0] as Buffer;

    const db = await loadDb();

    return {
        commitTx,
        tapScripts,
        xonly,
        hdInfo: db.pendingTaproot!.hdInfo
    };
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

function splitPayload(payload: Buffer): Buffer[] {
    const out: Buffer[] = [];
    for (let i = 0; i < payload.length; i += MAX_LEAF_BYTES) {
        out.push(payload.subarray(i, i + MAX_LEAF_BYTES));
    }
    return out;
}

function buildInscriptionScript(xonly: Buffer, payload: Buffer): Buffer {
    const { script, opcodes } = bitcoin;

    const chunks: Buffer[] = [];
    for (let i = 0; i < payload.length; i += 520) {
        chunks.push(payload.subarray(i, i + 520));
    }

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
    xonly: Buffer,
    tapScripts: Buffer[],
    hdInfo: HDInfo,
    extra?: {
        inputs: {
            txid: string;
            vout: number;
            valueSat: number;
            scriptPubKey: string;
        }[];
        extraFeeSat: number;
        changeAddr?: string;
    }
) {
    const network = bitcoin.networks[config.network];
    const psbt = new bitcoin.Psbt({ network });

    tapScripts.forEach((tScript, idx) => {
        const commitOut = commitTx.outs[idx];
        const leafHash = tapLeafHash(tScript, 0xc0);
        const { parity } = tweakPubkey(xonly, leafHash);

        const controlByte = 0xc0 | parity;
        const controlBlock = Buffer.concat([Buffer.from([controlByte]), xonly]);

        psbt.addInput({
            hash: commitTx.getId(),
            index: idx,
            sequence: 0xfffffffd,
            witnessUtxo: {
                script: commitOut.script,
                value: commitOut.value
            },
            tapLeafScript: [{
                controlBlock,
                script: tScript,
                leafVersion: 0xc0,
            }],
        });
    });

    if (extra && extra.inputs && extra.inputs.length > 0) {
        for (const inp of extra.inputs) {
            psbt.addInput({
                hash: inp.txid,
                index: inp.vout,
                sequence: 0xfffffffd,
                witnessUtxo: {
                    script: Buffer.from(inp.scriptPubKey, 'hex'),
                    value : inp.valueSat,
                },
            });
        }
    }

    const marker = Buffer.concat([PROTOCOL_TAG, Buffer.from([0x01])]);
    psbt.addOutput({
        script: bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, marker]),
        value: 0,
    });

    if (extra && extra.inputs && extra.inputs.length > 0) {
        const sumExtra = extra.inputs.reduce((s, i) => s + i.valueSat, 0);
        const changeSat = sumExtra - extra.extraFeeSat;

        if (extra.changeAddr && changeSat >= DUST) {
            psbt.addOutput({
                address: extra.changeAddr,
                value  : changeSat,
            });
        }
    }

    const privKey = await derivePrivKey(hdInfo);
    const signer = {
        publicKey: Buffer.concat([Buffer.from([0x02]), xonly]),
        signSchnorr: (hash: Buffer) => ecc.signSchnorr(hash, privKey),
    } as bitcoin.Signer;

    tapScripts.forEach((tScript, idx) => {
        const leafHash = tapLeafHash(tScript, 0xc0);
        const { parity } = tweakPubkey(xonly, leafHash);
        const controlBlock = Buffer.concat([Buffer.from([0xc0 | parity]), xonly]);

        psbt.signInput(idx, signer);
        const sigWithHashType = psbt.data.inputs[idx].tapScriptSig![0].signature;

        const finalScriptWitness = witnessStackToScriptWitness([
            sigWithHashType,
            tScript,
            controlBlock,
        ]);

        psbt.finalizeInput(idx, () => ({
            finalScriptWitness
        }));
    });

    const { psbt: signedByWallet } = await btcClient.walletProcessPsbt(psbt.toBase64(), true);
    const { psbt: ready } = await btcClient.walletProcessPsbt(signedByWallet, false);
    const { hex } = await btcClient.finalizePsbt(ready);

    return hex;
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

async function createCommitTransaction(outputMap: Record<string, number>) {

    const feeResp = await btcClient.estimateSmartFee(config.feeConf, SMART_FEE_MODE);
    console.log("Estimated Smart Fee Rate:", JSON.stringify(feeResp, null, 4));
    const feeSatPerVbyte = feeResp.feerate ? Math.ceil(feeResp.feerate * 1e5) : config.feeFallback;

    const nTapOuts = Object.keys(outputMap).length;
    const totalOutputsSat = Object.values(outputMap).reduce((a, b) => a + b, 0);

    const BASE_COMMIT_VSIZE = 200;
    const PER_TAP_OUT_VSIZE = 43;
    const PER_INPUT_VSIZE = 68;

    const utxos = (await btcClient.listUnspent()).sort((a, b) => a.amount - b.amount);

    let selected: UnspentOutput[] = [];
    let selectedSat = 0;
    let requiredSat = Infinity;

    for (const u of utxos) {
        selected.push(u);
        selectedSat += Math.round(u.amount * 1e8);

        const nInputs = selected.length;
        const commitVSize = BASE_COMMIT_VSIZE
            + PER_TAP_OUT_VSIZE * (nTapOuts - 1)
            + PER_INPUT_VSIZE * (nInputs - 1);

        const commitFeeSat = feeSatPerVbyte * commitVSize;
        requiredSat = totalOutputsSat + commitFeeSat;

        if (selectedSat >= requiredSat) {
            break;
        }
    }

    const requiredBtc = requiredSat / 1e8;
    if (selectedSat < requiredSat) {
        throw new Error(`insufficient UTXOs for commit + reveal fees: ${requiredBtc.toFixed(8)}`);
    }

    if (requiredBtc > config.feeMax) {
        throw new Error(`Fee above maximum allowed. Required: ${requiredBtc} feeMax: ${config.feeMax}`);
    }

    const changeSat = selectedSat - requiredSat;
    if (changeSat >= DUST) {
        const changeAddr = await btcClient.getNewAddress('', 'bech32');
        outputMap[changeAddr] = changeSat;
    }

    const outputs: Record<string, string> = {};
    for (const [address, sat] of Object.entries(outputMap)) {
        outputs[address] = (sat / 1e8).toFixed(8);
    }

    const inputs = selected.map(u => ({
        txid : u.txid,
        vout : u.vout,
        sequence: 0xfffffffd,
    }));

    const commitRaw = await btcClient.createRawTransaction(inputs, outputs);
    const commitSigned = await btcClient.signRawTransactionWithWallet(commitRaw);

    return bitcoin.Transaction.fromHex(commitSigned.hex);
}

async function createTaprootPair(batch: Operation[]) {
    const slices = splitPayload(encodePayload(batch));

    const walletAddr = await btcClient.getNewAddress('', 'bech32m');
    const addrInfo = await btcClient.getAddressInfo(walletAddr);
    const xonly = getXOnly(addrInfo);

    const feeResp = await btcClient.estimateSmartFee(config.feeConf, SMART_FEE_MODE);
    const feeSatPerVbyte = feeResp.feerate ? Math.ceil(feeResp.feerate * 1e5) : 10;

    const outputMap: Record<string, number> = {};
    const tapScripts: Buffer[] = [];

    for (const slice of slices) {
        const tScript = buildInscriptionScript(xonly, slice);
        tapScripts.push(tScript);

        const leafHash = tapLeafHash(tScript, 0xc0);
        const { tweakedX } = tweakPubkey(xonly, leafHash);

        const tapAddr = bitcoin.payments.p2tr({
            pubkey: tweakedX,
            network: bitcoin.networks[config.network]
        }).address!;

        const WITNESS_FIXED_OVERHEAD = 128;
        const revealVSize = virtualSizeFromWitness(tScript.length + WITNESS_FIXED_OVERHEAD);
        outputMap[tapAddr] = feeSatPerVbyte * revealVSize;
    }

    const commitTx = await createCommitTransaction(outputMap);

    const hdInfo: HDInfo = {
        hdkeypath: addrInfo.hdkeypath!,
        hdmasterfingerprint: addrInfo.hdmasterfingerprint!
    };

    const revealHex = await buildRevealHex(
        commitTx,
        xonly,
        tapScripts,
        hdInfo,
    );

    return {
        commitHex: commitTx.toHex(),
        revealHex,
        hdInfo,
    };
}

async function bumpCommitFee(entry: MempoolEntry, txid: string) {

    const currFeeSat = Math.floor(entry.fees.modified * 1e8);
    const currSatPerVb = Math.ceil(currFeeSat / entry.vsize);

    const est = await btcClient.estimateSmartFee(config.feeConf, SMART_FEE_MODE);
    let estSatPerVb = est.feerate ? Math.ceil(est.feerate * 1e5) : 0;
    const targetSatPerVb = Math.max(estSatPerVb, currSatPerVb + 1);
    const targetFeeSat = targetSatPerVb * entry.vsize;

    if (targetFeeSat > config.feeMax * 1e8) {
        throw new Error(`RBF: New fee exceeds max fee. Required: ${(targetSatPerVb * entry.vsize) / 1e8} feeMax: ${config.feeMax}`);
    }

    // Before version 0.21, fee_rate was in BTC/kvB. As of 0.21, fee_rate is in sat/vB
    const { version } = await btcClient.getNetworkInfo();
    const legacyRate = version < 210000;

    const feeRateParam = legacyRate
        ? (targetSatPerVb / 1e5).toFixed(8)
        : targetSatPerVb;

    console.log("Bump Commit Fee");
    console.log("Current Fee Sat/vB:", currSatPerVb);
    console.log("New Fee Sat/vB: ", targetSatPerVb);

    // We use psbtBumpFee instead of bumpFee to not immediately send
    // the transaction until we are sure we can also create the
    // reveal transaction.
    const { psbt } = await btcClient.psbtBumpFee(txid, {
        feeRate: feeRateParam,
        replaceable: true,
        estimateMode: SMART_FEE_MODE,
    });

    const { psbt: signedPsbt } = await btcClient.walletProcessPsbt(psbt, true);
    const { hex, complete } = await btcClient.finalizePsbt(signedPsbt);

    if (!complete || !hex) {
        throw new Error('Commit PSBT not fully signed—cannot produce final hex.');
    }

    return hex;
}

async function bumpRevealFee(entry: MempoolEntry, txid: string, ctx: RevealContext) {

    const EXTRA_INPUT_VBYTES = 69;
    const CHANGE_VBYTES = 31;

    const revealTx = await btcClient.getRawTransaction(txid, 1) as RawTransactionVerbose;
    let hasChange = revealTx.vout.length > 1;

    const baseFeeSat = ctx.tapScripts.reduce((sum, _t, idx) => {
        return sum + ctx.commitTx.outs[idx].value;
    }, 0);
    const baseSize = hasChange ? entry.vsize - CHANGE_VBYTES : entry.vsize;
    const currFeeSat = Math.floor(entry.fees.modified * 1e8);
    const currSatPerVb = Math.ceil(currFeeSat / entry.vsize);

    const est = await btcClient.estimateSmartFee(config.feeConf, SMART_FEE_MODE);
    const estSatPerVb = est.feerate ? Math.ceil(est.feerate * 1e5) : 0;
    const targetSatPerVb = Math.max(estSatPerVb, currSatPerVb + 1);

    console.log("Bump Reveal Fee");
    console.log("Current Fee Sat/vB:", currSatPerVb);
    console.log("New Fee Sat/vB: ", targetSatPerVb);

    const spendables = (await btcClient.listUnspent())
        .sort((a, b) => a.amount - b.amount);

    const chosen: UnspentOutput[] = [];
    let chosenSat = 0;
    let requiredExtraSat = 0;
    let newVsize = baseSize;
    const changeOutputSat = CHANGE_VBYTES * targetSatPerVb;

    for (const utxo of spendables) {
        chosen.push(utxo);
        chosenSat += utxo.amount * 1e8;
        newVsize += EXTRA_INPUT_VBYTES;

        const newFeeSat = newVsize * targetSatPerVb;
        requiredExtraSat = newFeeSat - baseFeeSat;
        const changeSat = chosenSat - requiredExtraSat;

        if (!hasChange && changeSat - changeOutputSat >= DUST) {
            hasChange = true;
            newVsize += CHANGE_VBYTES;
            requiredExtraSat += changeOutputSat;
        }

        if (hasChange && changeSat + changeOutputSat < DUST) {
            hasChange = false;
            newVsize -= CHANGE_VBYTES;
            requiredExtraSat -= changeOutputSat;
        }

        if (chosenSat >= requiredExtraSat) {
            break;
        }
    }

    const newTotalFeeSat = currFeeSat + requiredExtraSat;

    if (chosenSat < requiredExtraSat) {
        throw new Error(`RBF: insufficient UTXOs to bump fee to ~${(newTotalFeeSat / 1e8).toFixed(8)} BTC`);
    }

    if (newTotalFeeSat > config.feeMax * 1e8) {
        throw new Error(`RBF: New fee exceeds max fee. Required: ${(newTotalFeeSat / 1e8).toFixed(8)} feeMax: ${config.feeMax}`);
    }

    const changeSat = chosenSat - requiredExtraSat;
    const changeAddr = hasChange && changeSat >= DUST ? await btcClient.getNewAddress('funds', 'bech32') : undefined;

    return await buildRevealHex(
        ctx.commitTx,
        ctx.xonly,
        ctx.tapScripts,
        ctx.hdInfo,
        {
            inputs: chosen.map(u => ({
                txid: u.txid,
                vout: u.vout,
                valueSat: Math.round(u.amount * 1e8),
                scriptPubKey: u.scriptPubKey,
            })),
            extraFeeSat: requiredExtraSat,
            changeAddr,
        },
    );
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

async function checkPendingTransactions(db: MediatorDb) {
    if (!db.pendingTaproot) {
        return false;
    }

    const isMined = async (txid: string) => {
        const tx = await btcClient.getRawTransaction(txid, 1).catch(() => undefined) as RawTransactionVerbose | undefined;
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

    if (db.pendingTaproot.commitTxids?.length) {
        const mined = await checkPendingTxs(db.pendingTaproot.commitTxids);
        if (mined >= 0) {
            db.pendingTaproot.commitTxids = undefined;
            await saveDb(db);
        } else {
            console.log('pendingTaproot commitTxid', db.pendingTaproot.commitTxids.at(-1));
        }
    }

    if (db.pendingTaproot.revealTxids?.length) {
        const mined = await checkPendingTxs(db.pendingTaproot.revealTxids);
        if (mined >= 0) {
            db.pendingTaproot.revealTxids = undefined;
            await saveDb(db);
            return false;
        } else {
            console.log('pendingTaproot commitTxid', db.pendingTaproot.revealTxids.at(-1));
        }
    }

    return true;
}

async function replaceByFee(): Promise<boolean> {
    const db = await loadDb();

    if (!db.pendingTaproot || !(await checkPendingTransactions(db))) {
        return false;
    }

    const blockCount = await btcClient.getBlockCount();
    if (db.pendingTaproot.blockCount + config.feeConf >= blockCount) {
        return true;
    }

    if (db.pendingTaproot.commitTxids?.length && db.pendingTaproot.revealTxids?.length) {
        if (!config.rbfEnabled) {
            return true;
        }

        const { entry: commitEntry, txid: commitTxid } = await getEntryFromMempool(db.pendingTaproot.commitTxids);
        const { entry: revealEntry, txid: revealTxid } = await getEntryFromMempool(db.pendingTaproot.revealTxids);

        const commitHex = await bumpCommitFee(commitEntry, commitTxid);
        const newCommitTx = bitcoin.Transaction.fromHex(commitHex);

        let ctx = await extractRevealContext(revealTxid);
        ctx.commitTx = newCommitTx;
        const revealHex = await bumpRevealFee(revealEntry, revealTxid, ctx);

        const newCommitTxid = await btcClient.sendRawTransaction(commitHex);
        const newRevealTxid = await btcClient.sendRawTransaction(revealHex);

        db.pendingTaproot.commitTxids.push(newCommitTxid);
        db.pendingTaproot.revealTxids.push(newRevealTxid);
        db.blockCount = blockCount;
        await saveDb(db);

        console.log(`Commit TXID: ${newCommitTxid}`);
        console.log(`Reveal TXID: ${newRevealTxid}`);
    } else if (db.pendingTaproot.revealTxids?.length) {
        if (!config.rbfEnabled) {
            return true;
        }

        const { entry: revealEntry, txid: revealTxid } = await getEntryFromMempool(db.pendingTaproot.revealTxids);

        const ctx = await extractRevealContext(revealTxid);
        const revealHex = await bumpRevealFee(revealEntry, revealTxid, ctx);

        const newRevealTxid = await btcClient.sendRawTransaction(revealHex);

        db.pendingTaproot.revealTxids.push(newRevealTxid);
        db.blockCount = blockCount;
        await saveDb(db);

        console.log(`Reveal TXID: ${newRevealTxid}`);
    }

    return true;
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

    const queue = await gatekeeper.getQueue(REGISTRY);

    if (queue.length === 0) {
        console.log(`empty ${REGISTRY} queue`);
        return;
    }

    const batch: Operation[] = [];
    for (const op of queue) {
        const candidate = encodePayload([...batch, op]);
        if (candidate.length > HARD_LIMIT) {
            break;
        }
        batch.push(op);
    }

    console.log(JSON.stringify(batch, null, 4));

    try {
        const taprootPair = await createTaprootPair(batch);
        if (!taprootPair) {
            return;
        }
        const { commitHex, revealHex, hdInfo } = taprootPair;

        const commitTxid = await btcClient.sendRawTransaction(commitHex);
        const revealTxid = await btcClient.sendRawTransaction(revealHex);

        console.log("Commit TXID", commitTxid);
        console.log("Reveal TXID", revealTxid);

        const ok = await gatekeeper.clearQueue(REGISTRY, batch);

        if (ok) {
            const blockCount = await btcClient.getBlockCount();
            const db = await loadDb();
            db.pendingTaproot = {
                commitTxids: [commitTxid],
                revealTxids: [revealTxid],
                hdInfo,
                blockCount,
            };
            db.lastExport = new Date().toISOString();
            await saveDb(db);
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
        console.log(`Export loop busy, waiting ${config.importInterval} minute(s)...`);
        return;
    }

    exportRunning = true;

    try {
        if (await checkExportInterval()) {
            return;
        }

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
        console.log(`Txn fees (${config.chain}-Inscription): conf target: ${config.feeConf}, maximum: ${config.feeMax}, fallback Sat/Byte: ${config.feeFallback}`);
        setTimeout(exportLoop, config.exportInterval * 60 * 1000);
    }
}

main();
