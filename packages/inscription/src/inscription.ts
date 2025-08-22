import { Operation } from '@mdip/gatekeeper/types';
import { gzipSync } from "zlib";
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import { encode as varuintEncode } from 'varuint-bitcoin';
import {
    AccountKeys,
    FundInput,
    InscriptionOptions,
    NetworkName,
    SupportedTypes,
} from './types.js';

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

const PROTOCOL_TAG = Buffer.from('MDIP', 'ascii');
const MAX_LEAF_BYTES = 10 * 1024;
const MAX_LEAVES = 38;
const HARD_LIMIT = MAX_LEAF_BYTES * MAX_LEAVES;
const INPUT_VBYTES: Record<SupportedTypes, number> = {
    p2wpkh: 69,
    p2tr:   57,
};
const DUST = 546;
const P2TR_OUTPUT_VBYTES = 43;
const OVERHEAD_VBYTES = 11;
const OP_RETURN_VBYTES = 16;
const NONWITNESS_IN_VBYTES = 41;

export default class Inscription {
    feeMax: number;
    network: NetworkName;

    constructor(options: InscriptionOptions) {
        this.feeMax = options.feeMax;
        this.network = options.network;
    }

    async createTransactions(
        queue: Operation[],
        hdkeypath: string,
        utxos: FundInput[],
        estSatPerVByte: number,
        keys: AccountKeys
    ) {

        const batch: Operation[] = [];
        for (const op of queue) {
            const candidate = this.encodePayload([...batch, op]);
            if (candidate.length > HARD_LIMIT) {
                break;
            }
            batch.push(op);
        }

        const slices = this.splitPayload(this.encodePayload(batch));

        const { address: parentTapAddr, xonly } = this.deriveP2TRAddressFromAccount(keys.bip86, hdkeypath);
        const outputMap: Record<string, number> = {};
        const tapScripts: Buffer[] = [];

        for (const slice of slices) {
            const tScript = this.buildInscriptionScript(xonly, slice);
            tapScripts.push(tScript);

            const p2tr = bitcoin.payments.p2tr({
                internalPubkey: xonly,
                scriptTree: { output: tScript },
                network: bitcoin.networks[this.network]
            });

            if (!p2tr.address) {
                throw new Error('Failed to derive p2tr script address');
            }

            const revealVSize = this.estimateRevealInputVbytes(tScript.length, slices.length);
            const outputAmount = estSatPerVByte * revealVSize;
            outputMap[p2tr.address] = outputAmount >= DUST ? outputAmount : DUST;
        }

        const commitTx = await this.createCommitTransaction(
            outputMap,
            estSatPerVByte,
            utxos,
            keys,
            parentTapAddr,
        );

        const revealHex = await this.createRevealTransactionHex(
            commitTx,
            hdkeypath,
            xonly,
            tapScripts,
            keys
        );

        return {
            commitHex: commitTx.toHex(),
            revealHex,
            batch
        };
    }

    async bumpTransactionFee(
        hdkeypath: string,
        utxos: FundInput[],
        curSatPerVb: number,
        estSatPerVByte: number,
        keys: AccountKeys,
        commitHex: string,
        revealHex: string
    ) {

        const { address: parentTapAddr, xonly } = this.deriveP2TRAddressFromAccount(keys.bip86, hdkeypath);
        const commitTx = bitcoin.Transaction.fromHex(commitHex);
        const tapScripts = await this.extractTapscripts(revealHex);

        const baseFeeSat = tapScripts.reduce((sum, _t, idx) => {
            return sum + commitTx.outs[idx].value;
        }, 0);

        const revealTx = bitcoin.Transaction.fromHex(revealHex);
        const revealVsize = this.vsizeFromTransaction(revealTx);
        const currFeeSat = curSatPerVb * revealVsize;
        let targetSatPerVb = Math.max(estSatPerVByte, curSatPerVb + 1);

        const chosen: FundInput[] = [];
        let chosenSat = 0;
        let requiredExtraSat = 0;
        const incrementalSat = 1000; // Default min incremental fee

        console.log("Current Fee Sat/vB:", curSatPerVb);
        console.log("New Fee Sat/vB: ", targetSatPerVb);

        let hasChange = false;
        let newVsize = revealTx.outs.length > 1 ? (revealVsize - P2TR_OUTPUT_VBYTES) : revealVsize;
        const changeOutputSat = P2TR_OUTPUT_VBYTES * targetSatPerVb;

        for (const utxo of utxos) {
            chosen.push(utxo);
            chosenSat += utxo.amount;
            newVsize += INPUT_VBYTES[utxo.type];

            const calcFeeBump = Math.max(0, targetSatPerVb * newVsize - baseFeeSat);
            const minIncremental = Math.max(0, (currFeeSat + incrementalSat) - baseFeeSat);

            requiredExtraSat = Math.max(calcFeeBump, minIncremental);

            const changeSat = chosenSat - requiredExtraSat;

            if (!hasChange && changeSat >= DUST + changeOutputSat) {
                hasChange = true;
                newVsize += P2TR_OUTPUT_VBYTES;
                requiredExtraSat += changeOutputSat;
            } else if (hasChange && changeSat < DUST) {
                hasChange = false;
                newVsize -= P2TR_OUTPUT_VBYTES;
                requiredExtraSat -= changeOutputSat;
            }

            if (chosenSat >= requiredExtraSat) {
                break;
            }
        }

        const newTotalFeeSat = baseFeeSat + requiredExtraSat;

        if (chosenSat < requiredExtraSat) {
            throw new Error(`RBF: insufficient UTXOs to bump fee to ~${(newTotalFeeSat / 1e8).toFixed(8)} BTC`);
        }

        if (newTotalFeeSat > this.feeMax * 1e8) {
            throw new Error(`RBF: New fee exceeds max fee. Required: ${(newTotalFeeSat / 1e8).toFixed(8)} feeMax: ${this.feeMax}`);
        }

        return await this.createRevealTransactionHex(
            commitTx,
            hdkeypath,
            xonly,
            tapScripts,
            keys,
            {
                inputs: chosen,
                extraFeeSat: requiredExtraSat,
                changeAddr: parentTapAddr,
            },
        );
    }

    private async createCommitTransaction(
        outputMap: Record<string, number>,
        estSatPerVByte: number,
        inputs: FundInput[],
        keys: AccountKeys,
        parentTapAddr: string
    ) {

        const nTapOuts = Object.keys(outputMap).length;
        const totalOutputsSat = Object.values(outputMap).reduce((a, b) => a + b, 0);

        const sumInputVbytes = (ins: FundInput[]) =>
            ins.reduce((s, u) => s + INPUT_VBYTES[u.type], 0);

        const estimateCommitVsize = (ins: FundInput[], nTapOuts: number, includeChange: boolean) => {
            const inVB = sumInputVbytes(ins);
            const outVB = nTapOuts * P2TR_OUTPUT_VBYTES + (includeChange ? P2TR_OUTPUT_VBYTES : 0);
            return OVERHEAD_VBYTES + inVB + outVB;
        };

        let selected: FundInput[] = [];
        let selectedSat = 0;
        let requiredSat = Infinity;
        let changeSat = 0;

        for (const input of inputs) {
            if (input.type !== 'p2wpkh' && input.type !== 'p2tr') {
                throw new Error(`Unsupported input type: ${input.type}`);
            }

            selected.push(input);
            selectedSat += input.amount;

            const vNoChange = estimateCommitVsize(selected, nTapOuts, false);
            const feeNoChange = estSatPerVByte * vNoChange;
            const requiredNoChange = totalOutputsSat + feeNoChange;
            const leftover = selectedSat - requiredNoChange;

            const needChange = leftover >= (DUST + estSatPerVByte * P2TR_OUTPUT_VBYTES);

            const vChosen = estimateCommitVsize(selected, nTapOuts, needChange);
            requiredSat = totalOutputsSat + estSatPerVByte * vChosen;
            changeSat = Math.max(0, selectedSat - requiredSat);

            if (selectedSat >= requiredSat) {
                break;
            }
        }

        const requiredBtc = requiredSat / 1e8;
        if (selectedSat < requiredSat) {
            throw new Error(`insufficient UTXOs for commit + reveal fees: ${requiredBtc.toFixed(8)}`);
        }

        if (requiredBtc > this.feeMax) {
            throw new Error(`Fee above maximum allowed. Required: ${requiredBtc} feeMax: ${this.feeMax}`);
        }

        if (changeSat) {
            outputMap[parentTapAddr] = (outputMap[parentTapAddr] || 0) + changeSat;
        }

        const network = bitcoin.networks[this.network];
        const psbt = new bitcoin.Psbt({ network });

        const signers: Array<{ index: number; signer: bitcoin.Signer }> = [];
        const offset = 0;

        const xprv86 = this.chooseAccountXprvForInput(keys, 'p2tr');
        const fp86 = this.masterFingerprintFromXprv(xprv86);

        selected.forEach((inp, i) => {
            const path = this.normalisePath(inp.hdkeypath);
            if (inp.type === 'p2wpkh') {
                const xprv = this.chooseAccountXprvForInput(keys, 'p2wpkh');
                const priv = this.deriveFromAccountXprv(xprv, inp.hdkeypath);
                const keyPair = ECPair.fromPrivateKey(priv);
                const pubkey = Buffer.from(keyPair.publicKey);
                const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network });
                const script = p2wpkh.output;

                if (!script) {
                    throw new Error('Failed to derive p2wpkh script');
                }

                const h160 = bitcoin.crypto.hash160(pubkey);

                if (script.length !== 22 || script[0] !== 0x00 || script[1] !== 0x14 || !h160.equals(script.subarray(2))) {
                    throw new Error(`Derived pubkey does not match UTXO script at ${inp.hdkeypath}`);
                }

                psbt.addInput({
                    hash: inp.txid,
                    index: inp.vout,
                    sequence: 0xfffffffd,
                    witnessUtxo: { script, value: inp.amount }
                });

                signers.push({
                    index: offset + i,
                    signer: { publicKey: pubkey, sign: (h: Buffer) => Buffer.from(keyPair.sign(h)) },
                });
            } else {
                const xprv = this.chooseAccountXprvForInput(keys, 'p2tr');
                const priv = this.deriveFromAccountXprv(xprv, inp.hdkeypath);
                const xonlyChild = this.xonlyFromPriv(priv);
                const p2tr = bitcoin.payments.p2tr({ internalPubkey: xonlyChild, network });
                if (!p2tr.output || !p2tr.pubkey) {
                    throw new Error('Failed to derive p2tr script');
                }

                const tweakedPriv = this.tweakPrivKeyTaproot(priv, xonlyChild);
                const tweakedPub = ecc.pointFromScalar(tweakedPriv, true)!;
                if (!this.toXOnly(Buffer.from(tweakedPub)).equals(p2tr.pubkey)) {
                    throw new Error(`Tweaked pubkey mismatch at ${inp.hdkeypath}`);
                }

                psbt.addInput({
                    hash: inp.txid,
                    index: inp.vout,
                    sequence: 0xfffffffd,
                    witnessUtxo: { script: p2tr.output, value: inp.amount },
                    tapInternalKey: xonlyChild,
                    tapBip32Derivation: [{
                        masterFingerprint: fp86,
                        path,
                        pubkey: p2tr.pubkey,
                        leafHashes: [],
                    }]
                });

                signers.push({
                    index: offset + i,
                    signer: {
                        publicKey: p2tr.pubkey,
                        signSchnorr: (h: Buffer) => Buffer.from(ecc.signSchnorr(h, tweakedPriv))
                    } as bitcoin.Signer,
                });
            }
        });

        for (const [addr, sat] of Object.entries(outputMap)) {
            psbt.addOutput({ address: addr, value: sat });
        }

        signers.forEach(({ index, signer }) => psbt.signInput(index, signer));

        psbt.finalizeAllInputs();
        return psbt.extractTransaction();
    }

    private async createRevealTransactionHex(
        commitTx: bitcoin.Transaction,
        hdkeypath: string,
        xonly: Buffer,
        tapScripts: Buffer[],
        keys: AccountKeys,
        extra?: {
            inputs: FundInput[];
            extraFeeSat: number;
            changeAddr?: string;
        }
    ) {
        const network = bitcoin.networks[this.network];
        const psbt = new bitcoin.Psbt({ network });

        const xprv86 = this.chooseAccountXprvForInput(keys, 'p2tr');
        const fp86 = this.masterFingerprintFromXprv(xprv86);

        tapScripts.forEach((tScript, idx) => {
            const commitOut = commitTx.outs[idx];
            const leafHash = this.tapLeafHash(tScript, 0xc0);
            const { parity } = this.tweakPubkey(xonly, leafHash);

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

        const extraSigners: Array<{ index: number; signer: bitcoin.Signer }> = [];

        if (extra?.inputs?.length) {
            const offset = tapScripts.length;
            extra.inputs.forEach((inp, i) => {
                const path = this.normalisePath(inp.hdkeypath);

                if (inp.type === 'p2wpkh') {
                    const xprv = this.chooseAccountXprvForInput(keys, 'p2wpkh');
                    const priv = this.deriveFromAccountXprv(xprv, inp.hdkeypath);
                    const keyPair = ECPair.fromPrivateKey(priv);
                    const pubkey = Buffer.from(keyPair.publicKey);

                    const p2wpkh = bitcoin.payments.p2wpkh({pubkey, network});
                    if (!p2wpkh.output) {
                        throw new Error('Failed to derive p2wpkh script for extra input');
                    }

                    psbt.addInput({
                        hash: inp.txid,
                        index: inp.vout,
                        sequence: 0xfffffffd,
                        witnessUtxo: {
                            script: p2wpkh.output,
                            value: inp.amount,
                        }
                    });

                    extraSigners.push({
                        index: offset + i,
                        signer: {
                            publicKey: pubkey,
                            sign: (hash: Buffer) => Buffer.from(keyPair.sign(hash)),
                        },
                    });
                } else {
                    const xprv = this.chooseAccountXprvForInput(keys, 'p2tr');
                    const priv = this.deriveFromAccountXprv(xprv, inp.hdkeypath);
                    const xonlyChild = this.xonlyFromPriv(priv);
                    const p2tr = bitcoin.payments.p2tr({ internalPubkey: xonlyChild, network });
                    if (!p2tr.output || !p2tr.pubkey) {
                        throw new Error('Failed to derive p2tr script');
                    }

                    const tweakedPriv = this.tweakPrivKeyTaproot(priv, xonlyChild);
                    const tweakedPub = ecc.pointFromScalar(tweakedPriv, true)!;
                    if (!this.toXOnly(Buffer.from(tweakedPub)).equals(p2tr.pubkey)) {
                        throw new Error(`Tweaked pubkey mismatch at ${inp.hdkeypath}`);
                    }

                    psbt.addInput({
                        hash: inp.txid,
                        index: inp.vout,
                        sequence: 0xfffffffd,
                        witnessUtxo: { script: p2tr.output, value: inp.amount },
                        tapInternalKey: xonlyChild,
                        tapBip32Derivation: [{
                            masterFingerprint: fp86,
                            path,
                            pubkey: p2tr.pubkey,
                            leafHashes: [],
                        }],
                    });

                    extraSigners.push({
                        index: offset + i,
                        signer: {
                            publicKey: p2tr.pubkey,
                            signSchnorr: (h: Buffer) => Buffer.from(ecc.signSchnorr(h, tweakedPriv)),
                        } as bitcoin.Signer,
                    });
                }
            });
        }

        const marker = Buffer.concat([PROTOCOL_TAG, Buffer.from([0x01])]);
        psbt.addOutput({
            script: bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, marker]),
            value: 0,
        });

        if (extra?.inputs?.length) {
            const sumExtra = extra.inputs.reduce((s, i) => s + i.amount, 0);
            const changeSat = sumExtra - extra.extraFeeSat;

            if (extra.changeAddr && changeSat >= DUST) {
                psbt.addOutput({
                    address: extra.changeAddr,
                    value  : changeSat,
                });
            }
        }

        const privKey = this.deriveFromAccountXprv(keys.bip86, hdkeypath);
        const xonlyPub = this.xonlyFromPriv(privKey);
        const signer = {
            publicKey: xonlyPub,
            signSchnorr: (hash: Buffer) => ecc.signSchnorr(hash, privKey),
        } as bitcoin.Signer;

        tapScripts.forEach((_tScript, idx) => psbt.signInput(idx, signer));
        extraSigners.forEach(({ index, signer }) => psbt.signInput(index, signer));

        psbt.finalizeAllInputs();
        return psbt.extractTransaction().toHex();
    }

    private compactSizeLen(n: number): number {
        if (n < 253) {
            return 1;
        }
        if (n <= 0xffff) {
            return 3;
        }
        if (n <= 0xffffffff) {
            return 5;
        }
        return 9;
    }

    private estimateRevealInputVbytes(tScriptLen: number, nInputs: number): number {
        const witnessBytes = 100 + this.compactSizeLen(tScriptLen) + tScriptLen; // see above
        const perInputOverhead = Math.ceil((OVERHEAD_VBYTES + OP_RETURN_VBYTES) / nInputs);
        return NONWITNESS_IN_VBYTES + Math.ceil(witnessBytes / 4) + perInputOverhead;
    }

    private tweakPrivKeyTaproot(priv: Buffer, internalXOnly: Buffer, merkleRoot?: Buffer) {
        const P = ecc.pointFromScalar(priv, true);
        if (!P) {
            throw new Error('Invalid private key');
        }
        let dEven = Buffer.from(priv);
        if (P[0] === 0x03) {
            const neg = ecc.privateNegate(dEven);
            if (!neg) throw new Error('privateNegate failed');
            dEven = Buffer.from(neg);
        }
        const tweak = bitcoin.crypto.taggedHash(
            'TapTweak',
            merkleRoot ? Buffer.concat([internalXOnly, merkleRoot]) : internalXOnly
        );
        const tweaked = ecc.privateAdd(dEven, tweak);
        if (!tweaked) {
            throw new Error('privateAdd (tweak) failed');
        }
        return Buffer.from(tweaked);
    }

    private normalisePath(path: string): string {
        const withM = path.startsWith('m/') ? path : `m/${path}`;
        return withM.replace(/(\d+)h/g, "$1'");
    }

    private masterFingerprintFromXprv(xprv: string): Buffer {
        const node = bip32.fromBase58(xprv, bitcoin.networks[this.network]);
        const pubkey = Buffer.from(node.publicKey);
        const h160 = bitcoin.crypto.hash160(pubkey);
        return Buffer.from(h160.subarray(0, 4));
    }

    private tweakPubkey(xonly: Buffer, leafHash: Buffer): {
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

    private tapLeafHash(script: Buffer, leafVer = 0xc0): Buffer {
        const verBuf = Buffer.from([leafVer]);
        const enc = varuintEncode(script.length);
        const lenBuf = Buffer.from(enc.buffer).subarray(0, enc.bytes);
        return bitcoin.crypto.taggedHash('TapLeaf', Buffer.concat([verBuf, lenBuf, script]));
    }

    private chooseAccountXprvForInput(keys: AccountKeys, type: FundInput['type']): string {
        if (type === 'p2tr') {
            return keys.bip86;
        }
        if (type === 'p2wpkh') {
            if (!keys.bip84) {
                throw new Error('BIP84 account key is required to sign P2WPKH inputs.');
            }
            return keys.bip84;
        }
        throw new Error(`Unsupported input type: ${type}`);
    }

    private async extractTapscripts(revealHex: string) {

        const revealTx = bitcoin.Transaction.fromHex(revealHex);

        const tapScripts: Buffer[] = [];

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
        }

        if (tapScripts.length === 0) {
            throw new Error('no Taproot-inscription inputs found in reveal tx');
        }

        return tapScripts;
    }

    private encodePayload(batch: Operation[]): Buffer {
        const raw = Buffer.from(JSON.stringify(batch), 'utf8');
        const gz = gzipSync(raw);
        return Buffer.concat([Buffer.from([0x01]), gz]);
    }

    private splitPayload(payload: Buffer): Buffer[] {
        const out: Buffer[] = [];
        for (let i = 0; i < payload.length; i += MAX_LEAF_BYTES) {
            out.push(payload.subarray(i, i + MAX_LEAF_BYTES));
        }
        return out;
    }

    private buildInscriptionScript(xonly: Buffer, payload: Buffer): Buffer {
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

    private deriveP2TRAddressFromAccount(bip86Xprv: string, hdkeypath: string) {
        const priv = this.deriveFromAccountXprv(bip86Xprv, hdkeypath);
        const xonly = this.xonlyFromPriv(priv);
        const p2tr = bitcoin.payments.p2tr({ internalPubkey: xonly, network: bitcoin.networks[this.network] });
        if (!p2tr.address) {
            throw new Error('Failed to derive taproot address');
        }
        return { address: p2tr.address, xonly };
    }

    deriveP2TRAddress(bip86Xprv: string, hdkeypath: string) {
        const { address } = this.deriveP2TRAddressFromAccount(bip86Xprv, hdkeypath);
        return address;
    }

    derviceP2WPKHAddress(bip84Xprv: string, hdkeypath: string) {
        const priv = this.deriveFromAccountXprv(bip84Xprv, hdkeypath);
        const keyPair = ECPair.fromPrivateKey(priv);
        const pubkey = Buffer.from(keyPair.publicKey);
        const p2wpkh = bitcoin.payments.p2wpkh({ pubkey, network: bitcoin.networks[this.network] });
        if (!p2wpkh.address) {
            throw new Error('Failed to derive p2wpkh address');
        }
        return p2wpkh.address;
    }

    private toXOnly(pubkey33: Buffer) {
        return pubkey33.subarray(1, 33);
    }

    private xonlyFromPriv(priv: Buffer): Buffer {
        const comp = ECPair.fromPrivateKey(priv).publicKey;
        return this.toXOnly(Buffer.from(comp));
    }

    private deriveFromAccountXprv(
        accountXprv: string,
        hdkeypath: string
    ) {
        const rel = this.relativePathFromAccount(hdkeypath);
        const node = bip32.fromBase58(accountXprv, bitcoin.networks[this.network]);
        const child = rel ? node.derivePath(rel) : node;
        if (!child.privateKey) {
            throw new Error('derived node has no private key');
        }
        return Buffer.from(child.privateKey);
    }

    private vsizeFromTransaction(tx: bitcoin.Transaction): number {
        const weight = typeof tx.weight === 'function' ? tx.weight() : tx.virtualSize() * 4;
        return Math.ceil(weight / 4);
    }

    private relativePathFromAccount(hdkeypath: string): string {
        const parts = hdkeypath.replace(/^m\//, '').split('/');
        if (parts.length < 4) {
            throw new Error(`Bad hdkeypath: ${hdkeypath}`);
        }
        const rel = parts.slice(3).join('/');
        if (!rel || /[h']/.test(rel)) {
            throw new Error(`Unexpected hardened step in relative path: ${rel} from ${hdkeypath}`);
        }
        return rel;
    }
}

