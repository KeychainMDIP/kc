import dotenv from "dotenv";
import Inscription from "@mdip/inscription";
import GatekeeperClient from '@mdip/gatekeeper/client';
import JsonFile from "./db/jsonfile.js";
import {
    AccountKeys,
    FundInput,
    MediatorDb,
    NetworkName
} from "./types.js";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from 'tiny-secp256k1';

dotenv.config();
bitcoin.initEccLib(ecc);

const REGISTRY = (process.env.CHAIN || "Signet") + "-Inscription";
const NETWORK = (process.env.NETWORK || "testnet") as NetworkName;
const BIP86_XPRV = process.env.BIP86_XPRV || "";
const TAPROOT_HDKEYPATH = process.env.TAPROOT_HDKEYPATH || "";
const MEMPOOL_API_BASE = process.env.MEMPOOL_API_BASE || "https://mempool.space/signet/api";
const GATEKEEPER_URL = process.env.GATEKEEPER_URL || 'http://localhost:4224';

const FEE_MAX_BTC = Number(process.env.FEE_MAX_BTC ?? 0.002);
const POLL_INTERVAL_SEC = Number(process.env.POLL_INTERVAL_SEC ?? 60);
const BUMP_BLOCK_TARGET = Number(process.env.BUMP_BLOCK_TARGET ?? 1);

const gatekeeper = new GatekeeperClient();
const jsonDb = new JsonFile(REGISTRY);
const inscription = new Inscription({ feeMax: FEE_MAX_BTC, network: NETWORK });
const accountKeys: AccountKeys = { bip86: BIP86_XPRV };
let exportRunning = false;
let taprootAddress = "";

async function httpJSON<T>(path: string): Promise<T> {
    const r = await fetch(`${MEMPOOL_API_BASE}${path}`);
    if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status} ${r.statusText}: ${txt}`);
    }
    return (await r.json()) as T;
}

async function httpText(path: string): Promise<string> {
    const r = await fetch(`${MEMPOOL_API_BASE}${path}`);
    if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status} ${r.statusText}: ${txt}`);
    }
    return await r.text();
}

async function getTipHeight(): Promise<number> {
    const txt = await httpText("/blocks/tip/height");
    return Number(txt);
}

async function getRecommendedFee(): Promise<number> {
    const f = await httpJSON<{ fastestFee: number }>("/v1/fees/recommended");
    return Math.ceil(f.fastestFee);
}

async function getAddressUtxos(addr: string): Promise<FundInput[]> {
    type U = {
        txid: string;
        vout: number;
        value: number;
    };
    const utxos = await httpJSON<U[]>(`/address/${addr}/utxo`);
    return utxos.map(u => ({
        type: "p2tr",
        txid: u.txid,
        vout: u.vout,
        amount: u.value,
        hdkeypath: TAPROOT_HDKEYPATH,
    }));
}

async function getTxMeta(txid: string): Promise<{ confirmed: boolean; vsize: number; fee?: number } | undefined> {
    try {
        const j = await httpJSON<any>(`/tx/${txid}`);
        const confirmed = Boolean(j?.status?.confirmed);
        const fee = typeof j?.fee === 'number' ? j.fee : 0;
        let vsize = Number(j?.vsize ?? 0);

        if (!vsize) {
            const hex = await getTxHex(txid);
            if (!hex) {
                return undefined;
            }
            const tx = bitcoin.Transaction.fromHex(hex);
            vsize = Math.ceil(tx.weight() / 4);
        }

        return { confirmed, vsize, fee };
    } catch {
        return undefined;
    }
}

async function getTxHex(txid: string): Promise<string | undefined> {
    try {
        return await httpText(`/tx/${txid}/hex`);
    } catch {
        return undefined;
    }
}

async function broadcast(hex: string): Promise<string> {
    const r = await fetch(`${MEMPOOL_API_BASE}/tx`, {
        method: "POST",
        body: hex,
        headers: { "content-type": "text/plain" },
    });
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`Broadcast failed: ${r.status} ${r.statusText} ${t}`);
    }
    return (await r.text()).trim();
}

async function getTxStatus(txid: string) {
    const r = await fetch(`${MEMPOOL_API_BASE}/tx/${txid}/status`);
    if (!r.ok) {
        return null;
    }
    return (await r.json()) as { confirmed: boolean; block_height?: number };
}

function isMissingOrSpent(err: unknown) {
    const msg = typeof err === 'string' ? err : (err as any)?.message ?? '';
    return /bad-txns-inputs-missingorspent/i.test(msg);
}

async function waitUntilSeen(txid: string) {
    while (true) {
        await new Promise(r => setTimeout(r, 1000));
        const st = await getTxStatus(txid);
        if (st) {
            return;
        }
    }
}

export async function broadcastChain(
    commitHex: string,
    revealHex: string
) {
    const commitTxid = await broadcast(commitHex);

    await waitUntilSeen(commitTxid);

    const maxTries = 5;
    let lastErr: any;
    for (let i = 0; i < maxTries; i++) {
        try {
            const revealTxid = await broadcast(revealHex);
            return { commitTxid, revealTxid };
        } catch (e) {
            lastErr = e;
            if (!isMissingOrSpent(e)) {
                throw e;
            }
            await new Promise(r => setTimeout(r, 500));
        }
    }
    throw lastErr;
}

async function replaceByFee(db: MediatorDb) {
    if (!db.pendingTaproot?.commitTxid || !db.pendingTaproot.revealTxids?.length) {
        return false;
    }

    const revealTxid = db.pendingTaproot.revealTxids.at(-1)!;
    const revealMeta = await getTxMeta(revealTxid);
    if (!revealMeta) {
        console.log(`[bump] ${revealTxid} not found, it or one in the RBF chain is mined`);
        db.pendingTaproot = undefined;
        await jsonDb.saveDb(db);
        return false;
    }
    
    if (revealMeta.confirmed) {
        console.log(`[bump] ${revealTxid} confirmed`);
        db.pendingTaproot = undefined;
        await jsonDb.saveDb(db);
        return false;
    }

    const tip = await getTipHeight();
    if (tip - db.pendingTaproot.blockCount < BUMP_BLOCK_TARGET) {
        return true;
    }

    console.log(JSON.stringify(revealMeta, null, 4));

    if (!revealMeta.fee || !revealMeta.vsize) {
        console.log(`[bump] missing fee/vsize for ${revealTxid}, skipping this round.`);
        return true;
    }
    
    const curSatPerVb = Math.floor(revealMeta.fee / revealMeta.vsize);
    const estSatPerVByte = await getRecommendedFee();

    const commitTxid = db.pendingTaproot.commitTxid;
    const commitHex = await getTxHex(commitTxid);
    const revealHex = await getTxHex(revealTxid);
    if (!commitHex || !revealHex) {
        console.log(`[bump] could not fetch commit/reveal hex; skipping.`);
        return true;
    }

    const utxos = await getAddressUtxos(taprootAddress);
    if (!utxos.length) {
        console.log(`[bump] no UTXOs available to bump.`);
        return true;
    }

    try {
        const newRevealHex = await inscription.bumpTransactionFee(
            TAPROOT_HDKEYPATH,
            utxos,
            curSatPerVb,
            estSatPerVByte,
            accountKeys,
            commitHex,
            revealHex,
        );

        const newTxid = await broadcast(newRevealHex);
        console.log(`[bump] broadcast new reveal: ${newTxid} (prev: ${revealTxid})`);

        db.pendingTaproot.revealTxids.push(newTxid);
        db.pendingTaproot.blockCount = tip;
        await jsonDb.saveDb(db);
    } catch (e: any) {
        console.error(`[bump] error:`, e?.message || e);
    }

    return true;
}

async function anchorBatch() {
    const db = await jsonDb.loadDb();

    if (await replaceByFee(db)) {
        return;
    }

    const queue = await gatekeeper.getQueue(REGISTRY);
    if (!queue.length) {
        console.log(`[export] queue empty`);
        return;
    }

    const estSatPerVByte = await getRecommendedFee();
    const utxos = await getAddressUtxos(taprootAddress);
    if (!utxos.length) {
        console.log(`[export] no UTXOs at ${taprootAddress}. Fund the address and retry.`);
        return;
    }

    try {
        const { commitHex, revealHex, batch } = await inscription.createTransactions(
            queue,
            TAPROOT_HDKEYPATH,
            utxos,
            estSatPerVByte,
            accountKeys
        );

        const { commitTxid, revealTxid } = await broadcastChain(
            commitHex,
            revealHex
        );

        console.log(`[export] commit ${commitTxid}`);
        console.log(`[export] reveal ${revealTxid}`);

        const ok = await gatekeeper.clearQueue(REGISTRY, batch);
        if (ok) {
            const tip = await getTipHeight();
            db.pendingTaproot = {
                commitTxid,
                revealTxids: [revealTxid],
                blockCount: tip,
            };
            await jsonDb.saveDb(db);
        }
    } catch (e: any) {
        console.error(`[export] error:`, e?.message || e);
    }
}

async function exportLoop(): Promise<void> {
    if (exportRunning) {
        setTimeout(exportLoop, POLL_INTERVAL_SEC * 1000);
        console.log(`Export loop busy, waiting ${POLL_INTERVAL_SEC} seconds`);
        return;
    }

    exportRunning = true;

    try {
        await anchorBatch();
    } catch (error) {
        console.error(`Error in exportLoop: ${error}`);
    } finally {
        exportRunning = false;
        console.log(`export loop waiting ${POLL_INTERVAL_SEC} seconds`);
        setTimeout(exportLoop, POLL_INTERVAL_SEC * 1000);
    }
}

function checkEnvVars() {
    if (!BIP86_XPRV || !TAPROOT_HDKEYPATH) {
        console.error(
            `Missing env. Required: BIP86_XPRV, TAPROOT_HDKEYPATH. Optional: CHAIN, NETWORK, MEMPOOL_API_BASE, FEE_MAX_BTC, POLL_INTERVAL_SEC, BUMP_BLOCK_TARGET, GATEKEEPER_URL.`
        );
        process.exit(1);
    }


    if (FEE_MAX_BTC < 0.0001) {
        console.error("FEE_MAX_BTC must be at least 0.0001 BTC");
        process.exit(1);
    }

    if (POLL_INTERVAL_SEC < 1) {
        console.error("POLL_INTERVAL_SEC must be at least 1");
        process.exit(1);
    }

    if (BUMP_BLOCK_TARGET < 1) {
        console.error("BUMP_BLOCK_TARGET must be at least 1");
        process.exit(1);
    }
}

async function main() {
    checkEnvVars();

    taprootAddress = inscription.deriveP2TRAddress(BIP86_XPRV, TAPROOT_HDKEYPATH);

    console.log(`[demo] registry=${REGISTRY} network=${NETWORK} mempool=${MEMPOOL_API_BASE}`);
    console.log(`[demo] taproot address=${taprootAddress}`);

    await gatekeeper.connect({
        url: GATEKEEPER_URL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    console.log(`Exporting operations every ${POLL_INTERVAL_SEC} seconds`);
    setTimeout(exportLoop, POLL_INTERVAL_SEC * 1000);
}

main().catch((err) => {
    console.error("Unhandled error in main:", err);
    process.exit(1);
});
