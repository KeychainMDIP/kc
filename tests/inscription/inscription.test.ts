import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory, BIP32Interface } from 'bip32';
import { randomBytes } from 'crypto';
import Inscription from '@mdip/inscription';
import {Operation} from "@mdip/gatekeeper/types";
import {ExpectedExceptionError} from "@mdip/common/errors";

bitcoin.initEccLib(ecc);

const bip32 = BIP32Factory(ecc);

type SupportedTypes = 'p2wpkh' | 'p2tr';
interface FundInput {
    type: SupportedTypes;
    txid: string;
    vout: number;
    amount: number;
    hdkeypath: string;
}

interface AccountKeys {
    bip86: string;
    bip84?: string;
}

const NETWORK: 'testnet' = 'testnet';
const net = bitcoin.networks[NETWORK];

function seedNode(): BIP32Interface {
    const seed = Buffer.from(
        '000102030405060708090a0b0c0d0e0ff1f2f3f4f5f6f7f8f9fafbfcfdfeff',
        'hex'
    );
    return bip32.fromSeed(seed, net);
}

function acctXprvs() {
    const root = seedNode();
    const acc86 = root.derivePath(`m/86'/1'/0'`);
    const acc84 = root.derivePath(`m/84'/1'/0'`);
    return {
        bip86: acc86.toBase58(),
        bip84: acc84.toBase58(),
    };
}

function makeTxid(n: number): string {
    const b = Buffer.alloc(32, 0);
    b.writeUInt32BE(n >>> 0, 28);
    return b.toString('hex');
}

function hdp(purpose: 84 | 86, change: 0 | 1, index: number) {
    return `m/${purpose}h/1h/0h/${change}/${index}`;
}

function computeTxVsize(tx: bitcoin.Transaction): number {
    const w = typeof (tx as any).weight === 'function' ? (tx as any).weight() : tx.virtualSize() * 4;
    return Math.ceil(w / 4);
}

function parseFeeFromReveal(
    revealHex: string,
    commitHex: string,
    extraUtxoMap?: Record<string, number>
) {
    const reveal = bitcoin.Transaction.fromHex(revealHex);
    const commit = bitcoin.Transaction.fromHex(commitHex);
    const commitId = commit.getId();

    let totalIn = 0;
    for (const inp of reveal.ins) {
        const txid = Buffer.from(inp.hash).reverse().toString('hex');
        const vout = inp.index;
        if (txid === commitId) {
            totalIn += commit.outs[vout].value;
        } else if (extraUtxoMap) {
            const key = `${txid}:${vout}`;
            if (extraUtxoMap[key] != null) {
                totalIn += extraUtxoMap[key];
            }
        }
    }

    const totalOut = reveal.outs.reduce((s, o) => s + o.value, 0);
    const fee = totalIn - totalOut;
    const vsize = computeTxVsize(reveal);
    return { fee, vsize, reveal, commit };
}

function smallOps(n = 3) {
    const types = ["create", "update", "delete"];
    const ops = Array.from({ length: n }, (_, i) => {
        const type = types[i % types.length];
        return {
            type,
            created: new Date().toISOString(),
            mdip: { version: 1, type: "asset", registry: "mockRegistry" },
        }
    });
    return Buffer.from(JSON.stringify(ops), 'utf8');
}

export function largeOps(leaves: number): Operation[] {
    const BIG = 10 * 1000 * leaves;
    const data = randomBytes(BIG).toString('base64');

    return [{
        type: "create",
        created: new Date().toISOString(),
        mdip: { version: 1, type: "asset", registry: "mockRegistry" },
        data,
    }];
}

describe('Inscription createTransactions', () => {
    it('creates commit and reveal using only P2TR inputs', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.01, network: NETWORK });

        const parentPath = hdp(86, 0, 0);

        const utxos: FundInput[] = [5, 6].map((idx, i) => ({
            type: 'p2tr',
            txid: makeTxid(100 + i),
            vout: 0,
            amount: 546,
            hdkeypath: hdp(86, 0, idx),
        }));

        const { commitHex, revealHex, batch } = await lib.createTransactions(
            smallOps(),
            parentPath,
            utxos,
            3,
            keys
        );

        expect(batch.length).toBe(3);

        const commit = bitcoin.Transaction.fromHex(commitHex);
        const reveal = bitcoin.Transaction.fromHex(revealHex);

        expect(commit.ins.length).toBe(2);
        expect(reveal.ins.length).toBe(commit.outs.length);

        const hasOpReturn = reveal.outs.some((o) => {
            try {
                const decomp = bitcoin.script.decompile(o.script) || [];
                return decomp[0] === bitcoin.opcodes.OP_RETURN && Buffer.isBuffer(decomp[1]) && (decomp[1] as Buffer).toString('ascii').startsWith('MDIP');
            } catch {
                return false;
            }
        });
        expect(hasOpReturn).toBe(true);
    });

    it('creates commit and reveal using only P2WPKH inputs', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.01, network: NETWORK });

        const parentPath = hdp(86, 0, 0);

        const utxos: FundInput[] = [5, 6].map((idx, i) => ({
            type: 'p2wpkh',
            txid: makeTxid(100 + i),
            vout: 0,
            amount: 600,
            hdkeypath: hdp(86, 0, idx),
        }));

        const { commitHex, revealHex } = await lib.createTransactions(
            smallOps(),
            parentPath,
            utxos,
            3,
            keys
        );

        const commit = bitcoin.Transaction.fromHex(commitHex);
        const reveal = bitcoin.Transaction.fromHex(revealHex);

        expect(commit.ins.length).toBe(2);
        expect(reveal.ins.length).toBe(commit.outs.length);
    });

    it('mixes P2WPKH and P2TR inputs', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.01, network: NETWORK });

        const utxos: FundInput[] = [
            { type: 'p2tr', txid: makeTxid(1), vout: 0, amount: 546, hdkeypath: hdp(86, 0, 3) },
            { type: 'p2wpkh', txid: makeTxid(2), vout: 1, amount: 546, hdkeypath: hdp(84, 0, 7) },
        ];

        const { commitHex } = await lib.createTransactions(
            smallOps(),
            hdp(86, 0, 0),
            utxos,
            3,
            keys
        );

        const commit = bitcoin.Transaction.fromHex(commitHex);
        expect(commit.ins.length).toBe(2);
    });

    it('throws when UTXOs are insufficient to cover commit and reveal fees', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.01, network: NETWORK });

        const utxos: FundInput[] = [{
            type: 'p2tr',
            txid: makeTxid(9),
            vout: 0,
            amount: 546,
            hdkeypath: hdp(86, 0, 1)
        }];

        await expect(lib.createTransactions(
            smallOps(1),
            hdp(86, 0, 0),
            utxos,
            10,
            keys
        )).rejects.toThrow(/insufficient UTXOs/i);
    });

    it('throws for unsupported input type', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.01, network: NETWORK });

        const badUtxos: FundInput[] = [
            {
                // @ts-expect-error: Invalid type
                type: 'p2sh',
                txid: makeTxid(11),
                vout: 0,
                amount: 50_000,
                hdkeypath: hdp(86, 0, 2),
            },
        ];

        await expect(lib.createTransactions(
            smallOps(1),
            hdp(86, 0, 0),
            badUtxos,
            2,
            keys
        )).rejects.toThrow(/Unsupported input type/i);
    });

    it('throws if hdkeypath contains hardened step beyond account', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.01, network: NETWORK });

        const utxos: FundInput[] = [{
            type: 'p2tr',
            txid: makeTxid(12),
            vout: 0,
            amount: 50_000,
            hdkeypath: hdp(86, 0, 1)
        }];

        const badParent = `m/86h/1h/0h/0h/0`;

        await expect(lib.createTransactions(
            smallOps(1),
            badParent,
            utxos,
            2,
            keys
        )).rejects.toThrow(/Unexpected hardened step/i);
    });

    it('handles multiple leaves (payload split) and assigns change to the last taproot output in commit', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.05, network: NETWORK });

        const utxos: FundInput[] = [
            {
                type: 'p2tr',
                txid: makeTxid(51),
                vout: 0,
                amount: 120_000,
                hdkeypath: hdp(86, 0, 10)
            },
        ];

        const payload = Buffer.from(JSON.stringify(largeOps(2)), 'utf8');

        const { commitHex, revealHex } = await lib.createTransactions(
            payload,
            hdp(86, 0, 0),
            utxos,
            2,
            keys
        );

        const commit = bitcoin.Transaction.fromHex(commitHex);
        const reveal = bitcoin.Transaction.fromHex(revealHex);

        expect(commit.outs.length).toBe(2);
        expect(reveal.ins.length).toBe(2);

        expect(commit.outs[0].value).toBe(546);
        expect(commit.outs[1].value).toBeGreaterThan(546);
    });

    it('handles maximum leaves up to the hard limit', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.05, network: NETWORK });

        const utxos: FundInput[] = [
            {
                type: 'p2tr',
                txid: makeTxid(51),
                vout: 0,
                amount: 120_000,
                hdkeypath: hdp(86, 0, 10)
            },
        ];

        let batches: Operation[] = [];
        for (let i = 0; i < 50; i++) {
            batches.push(...largeOps(1));
        }

        const payload = Buffer.from(JSON.stringify(batches), 'utf8');

        const { batch, commitHex, revealHex } = await lib.createTransactions(
            payload,
            hdp(86, 0, 0),
            utxos,
            1,
            keys
        );

        expect(batch.length).toBe(38);

        const commit = bitcoin.Transaction.fromHex(commitHex);
        const reveal = bitcoin.Transaction.fromHex(revealHex);

        expect(commit.outs.length).toBe(38);
        expect(reveal.ins.length).toBe(commit.outs.length);

        expect(commit.outs[0].value).toBe(546);
        expect(commit.outs[37].value).toBeGreaterThan(546);
    });

    it('rejects P2WPKH inputs if BIP84 account key is not provided', async () => {
        const keys: AccountKeys = { bip86: acctXprvs().bip86 };
        const lib = new Inscription({ feeMax: 0.02, network: NETWORK });

        const utxos: FundInput[] = [
            {
                type: 'p2wpkh',
                txid: makeTxid(61),
                vout: 0,
                amount: 30_000,
                hdkeypath: hdp(84, 0, 1)
            },
        ];

        await expect(
            lib.createTransactions(
                smallOps(1),
                hdp(86, 0, 0),
                utxos,
                2,
                keys
            )).rejects.toThrow(/BIP84 account key is required/i);
    });

    it('omits change output when below dust (OP_RETURN output only)', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.05, network: NETWORK }) as any;

        const utxos: FundInput[] = [
            {
                type: 'p2tr',
                txid: makeTxid(51),
                vout: 0,
                amount: 657,
                hdkeypath: hdp(86, 0, 10)
            },
        ];

        const { revealHex } = await lib.createTransactions(
            smallOps(1),
            hdp(86, 0, 0),
            utxos,
            1,
            keys
        );

        const tx = bitcoin.Transaction.fromHex(revealHex);
        expect(tx.outs.length).toBe(1);
    });

    it('createCommitTransaction throws "no taproot outputs" when change is due but outputMap is empty', async () => {
        const keys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.05, network: NETWORK }) as any;

        const utxos: FundInput[] = [{
            type: 'p2tr',
            txid: makeTxid(700),
            vout: 0,
            amount: 100_000,
            hdkeypath: hdp(86, 0, 3),
        }];

        await expect(
            lib.createCommitTransaction({}, 1, utxos, keys)
        ).rejects.toThrow(/no taproot outputs/i);
    });

    it('createCommitTransaction inscribe plaintext', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.01, network: NETWORK });

        const parentPath = hdp(86, 0, 0);

        const utxos: FundInput[] = [5, 6].map((idx, i) => ({
            type: 'p2tr',
            txid: makeTxid(100 + i),
            vout: 0,
            amount: 546,
            hdkeypath: hdp(86, 0, idx),
        }));

        const plaintext = 'plaintext';

        const { revealHex } = await lib.createTransactions(
            Buffer.from(plaintext, 'utf8'),
            parentPath,
            utxos,
            3,
            keys
        );

        const asciiString = Buffer.from(revealHex, 'hex').toString('ascii');
        const hasPlaintext = asciiString.includes("plaintext");
        expect(hasPlaintext).toBeTruthy();
    });

    it('createCommitTransaction test plaintext size limit', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.01, network: NETWORK });

        const parentPath = hdp(86, 0, 0);

        const utxos: FundInput[] = [5, 6].map((idx, i) => ({
            type: 'p2tr',
            txid: makeTxid(100 + i),
            vout: 0,
            amount: 546,
            hdkeypath: hdp(86, 0, idx),
        }));

        const targetLength = 500 * 1024;
        const fillChar = 'a';
        const plaintext = fillChar.repeat(targetLength);

        try {
            await lib.createTransactions(
                Buffer.from(plaintext, 'utf8'),
                parentPath,
                utxos,
                3,
                keys
            );
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('payload exceeds hard limit of 389120 bytes');
        }
    });

    it('createCommitTransaction inscribe non-Operation JSON object', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.01, network: NETWORK });

        const parentPath = hdp(86, 0, 0);

        const utxos: FundInput[] = [5, 6].map((idx, i) => ({
            type: 'p2tr',
            txid: makeTxid(100 + i),
            vout: 0,
            amount: 546,
            hdkeypath: hdp(86, 0, idx),
        }));

        const json =  { "test" : "test" };

        const { revealHex } = await lib.createTransactions(
            Buffer.from(JSON.stringify(json), 'utf8'),
            parentPath,
            utxos,
            3,
            keys
        );

        const ascii = Buffer.from(revealHex, 'hex').toString('utf8');
        expect(ascii).toContain(JSON.stringify(json));
    });

    it('createCommitTransaction inscribe non-Operation JSON array', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.01, network: NETWORK });

        const parentPath = hdp(86, 0, 0);

        const utxos: FundInput[] = [5, 6].map((idx, i) => ({
            type: 'p2tr',
            txid: makeTxid(100 + i),
            vout: 0,
            amount: 546,
            hdkeypath: hdp(86, 0, idx),
        }));

        const json =  [{ "test" : "test" }];

        const { revealHex } = await lib.createTransactions(
            Buffer.from(JSON.stringify(json), 'utf8'),
            parentPath,
            utxos,
            3,
            keys
        );

        const ascii = Buffer.from(revealHex, 'hex').toString('utf8');
        expect(ascii).toContain(JSON.stringify(json));
    });
});

describe('Inscription bumpTransactionFee', () => {
    it('bumps fee by reducing change (no extra inputs needed)', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.02, network: NETWORK });

        const utxos: FundInput[] = [
            {
                type: 'p2tr',
                txid: makeTxid(21),
                vout: 0,
                amount: 60_000,
                hdkeypath: hdp(86, 0, 5)
            }
        ];

        const { commitHex, revealHex } = await lib.createTransactions(
            smallOps(2),
            hdp(86, 0, 0),
            utxos,
            2,
            keys
        );

        const base = parseFeeFromReveal(revealHex, commitHex);
        const curSatPerVb = Math.floor(base.fee / base.vsize);

        const bumpedHex = await lib.bumpTransactionFee(
            hdp(86, 0, 0),
            [],
            curSatPerVb,
            curSatPerVb + 1,
            keys,
            commitHex,
            revealHex
        );

        const bumped = parseFeeFromReveal(bumpedHex, commitHex);
        expect(bumped.vsize).toBe(base.vsize);
        expect(bumped.fee).toBeGreaterThan(base.fee);
        expect(bumped.fee).toBeGreaterThanOrEqual(base.fee + base.vsize);
    });

    it('bump uses extra P2TR input path (covers extra p2tr signer branch)', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.05, network: NETWORK });

        const utxosCommit: FundInput[] = [{
            type: 'p2tr',
            txid: makeTxid(801),
            vout: 0,
            amount: 1_200,
            hdkeypath: hdp(86, 0, 5),
        }];

        const { commitHex, revealHex } = await lib.createTransactions(
            smallOps(1),
            hdp(86, 0, 0),
            utxosCommit,
            1,
            keys
        );

        const base = parseFeeFromReveal(revealHex, commitHex);

        const extraTap: FundInput = {
            type: 'p2tr',
            txid: makeTxid(802),
            vout: 1,
            amount: 50_000,
            hdkeypath: hdp(86, 0, 6),
        };

        const bumpedHex = await lib.bumpTransactionFee(
            hdp(86, 0, 0),
            [extraTap],
            1,
            10,
            keys,
            commitHex,
            revealHex
        );

        const utxoMap: Record<string, number> = {
            [`${extraTap.txid}:${extraTap.vout}`]: extraTap.amount,
        };
        const bumped = parseFeeFromReveal(bumpedHex, commitHex, utxoMap);

        expect(bumped.reveal.ins.length).toBeGreaterThan(base.reveal.ins.length);
        expect(bumped.fee).toBeGreaterThan(base.fee);
    });

    it('bumps fee by adding an extra P2WPKH input when commit outputs are not enough', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.05, network: NETWORK });

        const utxosCommit: FundInput[] = [
            {
                type: 'p2tr',
                txid: makeTxid(31),
                vout: 0,
                amount: 768,
                hdkeypath: hdp(86, 0, 2)
            },
        ];

        const { commitHex, revealHex } = await lib.createTransactions(
            smallOps(1),
            hdp(86, 0, 0),
            utxosCommit,
            2,
            keys
        );

        const base = parseFeeFromReveal(revealHex, commitHex);

        expect(base.reveal.ins.length).toBe(1);

        const extra: FundInput = {
            type: 'p2wpkh',
            txid: makeTxid(99),
            vout: 0,
            amount: 40_000,
            hdkeypath: hdp(84, 0, 9),
        };

        const bumpedHex = await lib.bumpTransactionFee(
            hdp(86, 0, 0),
            [extra],
            Math.floor(base.fee / base.vsize),
            Math.floor(base.fee / base.vsize) + 10,
            keys,
            commitHex,
            revealHex
        );

        const utxoMap: Record<string, number> = {
            [`${extra.txid}:${extra.vout}`]: extra.amount,
        };
        const bumped = parseFeeFromReveal(bumpedHex, commitHex, utxoMap);

        expect(bumped.reveal.ins.length).toBe(2);
        expect(bumped.vsize).toBeGreaterThan(base.vsize);
        expect(bumped.fee).toBeGreaterThan(base.fee);
    });

    it('throws when candidate UTXOs cannot reach target feerate', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.05, network: NETWORK });

        const utxosCommit: FundInput[] = [
            {
                type: 'p2tr',
                txid: makeTxid(41),
                vout: 0,
                amount: 20_000,
                hdkeypath: hdp(86, 0, 3)
            },
        ];

        const { commitHex, revealHex } = await lib.createTransactions(
            smallOps(1),
            hdp(86, 0, 0),
            utxosCommit,
            1,
            keys
        );

        const base = parseFeeFromReveal(revealHex, commitHex);
        const hugeTarget = Math.floor(base.fee / base.vsize) + 5000;

        await expect(
            lib.bumpTransactionFee(
                hdp(86, 0, 0),
                [],
                Math.floor(base.fee / base.vsize),
                hugeTarget,
                keys,
                commitHex,
                revealHex
            )
        ).rejects.toThrow(/insufficient candidate UTXOs/i);
    });

    it('bumpTransactionFee throws if revealHex has no taproot-inscription inputs', async () => {
        const keys: AccountKeys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.05, network: NETWORK });

        const utxosCommit: FundInput[] = [
            {
                type: 'p2tr',
                txid: makeTxid(41),
                vout: 0,
                amount: 20_000,
                hdkeypath: hdp(86, 0, 3)
            },
        ];

        const { commitHex } = await lib.createTransactions(
            smallOps(1),
            hdp(86, 0, 0),
            utxosCommit,
            1,
            keys
        );

        await expect(lib.bumpTransactionFee(
            hdp(86, 0, 0),
            [],
            1,
            2,
            keys,
            commitHex,
            commitHex
        )).rejects.toThrow(/no Taproot-inscription inputs found/i);
    });

    it('extractTapscripts skips inputs without PROTOCOL_TAG (continue branch)', async () => {
        const keys = acctXprvs();
        const lib = new Inscription({ feeMax: 0.05, network: NETWORK }) as any;

        const utxos: FundInput[] = [
            { type: 'p2tr', txid: makeTxid(9100), vout: 0, amount: 150_000, hdkeypath: hdp(86, 0, 11) },
        ];

        const payload = Buffer.from(JSON.stringify(largeOps(2)), 'utf8');

        const { revealHex } = await (lib as Inscription).createTransactions(
            payload,
            hdp(86, 0, 0),
            utxos,
            2,
            keys
        );

        const tx = bitcoin.Transaction.fromHex(revealHex);

        expect(tx.ins.length).toBeGreaterThanOrEqual(2);

        const w0 = tx.ins[0].witness;
        expect(w0 && w0.length >= 3).toBeTruthy();

        const scriptIdx = w0.length - 2;
        const original = Buffer.from(w0[scriptIdx]);
        const tag = Buffer.from('MDIP', 'ascii');

        const mutated = Buffer.from(original);
        const pos = mutated.indexOf(tag);
        expect(pos).toBeGreaterThanOrEqual(0);
        mutated.set(Buffer.from('NOPE', 'ascii'), pos);

        tx.ins[0].witness[scriptIdx] = mutated;
        const revealHexMut = tx.toHex();

        const scripts = await lib.extractTapscripts(revealHexMut);
        expect(scripts.length).toBe(tx.ins.length - 1);
    });
});

describe('path helpers', () => {
    it('normalisePath converts h to apostrophe', () => {
        const lib = new Inscription({ feeMax: 0.01, network: 'testnet' }) as any;
        expect(lib.normalisePath("m/86h/1h/0h/0/123")).toBe("m/86'/1'/0'/0/123");
        expect(lib.normalisePath("84h/1h/0h/1/9")).toBe("m/84'/1'/0'/1/9");
    });

    it('relativePathFromAccount rejects short paths', () => {
        const lib = new Inscription({ feeMax: 0.01, network: 'testnet' }) as any;
        expect(() => lib.relativePathFromAccount("m/86h/1h")).toThrow(/Bad hdkeypath/i);
    });

    it('relativePathFromAccount rejects hardened step in relative part', () => {
        const lib = new Inscription({ feeMax: 0.01, network: 'testnet' }) as any;
        expect(() => lib.relativePathFromAccount("m/86h/1h/0h/0h/1")).toThrow(/Unexpected hardened step/i);
    });

    it('relativePathFromAccount returns expected relative path', () => {
        const lib = new Inscription({ feeMax: 0.01, network: 'testnet' }) as any;
        expect(lib.relativePathFromAccount("m/86h/1h/0h/0/5")).toBe("0/5");
    });
});

describe('size estimators', () => {
    it('compactSizeLen boundaries (1,3,5,9)', () => {
        const lib = new Inscription({ feeMax: 0.01, network: 'testnet' }) as any;
        expect(lib.compactSizeLen(252)).toBe(1);
        expect(lib.compactSizeLen(253)).toBe(3);
        expect(lib.compactSizeLen(65535)).toBe(3);
        expect(lib.compactSizeLen(65536)).toBe(5);
        expect(lib.compactSizeLen(2 ** 32)).toBe(9);
    });

    it('estimateRevealTotalVbytes with and without extra inputs', () => {
        const lib = new Inscription({ feeMax: 0.01, network: 'testnet' }) as any;

        const s1 = Buffer.alloc(100);
        const s2 = Buffer.alloc(10_000);
        const base = lib.estimateRevealTotalVbytes([s1, s2]);
        const withP2tr = lib.estimateRevealTotalVbytes([s1, s2], [{ type: 'p2tr' }]);
        const withMixed = lib.estimateRevealTotalVbytes([s1, s2], [{ type: 'p2tr' }, { type: 'p2wpkh' }]);

        expect(base).toBeGreaterThan(0);
        expect(withP2tr).toBe(base + 57);
        expect(withMixed).toBe(base + 57 + 69);
    });
});

describe('address helpers', () => {
    it('deriveP2TRAddress returns a bech32m address', () => {
        const keys: AccountKeys = acctXprvs();
        const insc = new Inscription({ feeMax: 0.01, network: 'testnet' });
        const addr = insc.deriveP2TRAddress(keys.bip86, hdp(86, 0, 0));
        expect(addr).toMatch(/^tb1p/);
    });

    it('deriveP2WPKHAddress returns a bech32 address', () => {
        const keys: AccountKeys = acctXprvs();
        const insc = new Inscription({ feeMax: 0.01, network: 'testnet' });
        const addr = insc.deriveP2WPKHAddress(keys.bip84!, hdp(84, 0, 0));
        expect(addr).toMatch(/^tb1q/);
    });

    it('deriveFromAccountXprv throws on xpub (no private key)', () => {
        const root = seedNode();
        const acc86 = root.derivePath(`m/86'/1'/0'`).neutered();
        const xpub = acc86.toBase58();
        const lib = new Inscription({ feeMax: 0.01, network: NETWORK }) as any;

        expect(() => lib.deriveFromAccountXprv(xpub, hdp(86, 0, 0)))
            .toThrow(/derived node has no private key/i);
    });

    it('tweakPrivKeyTaproot throws on invalid private key (zero scalar)', () => {
        const lib = new Inscription({ feeMax: 0.01, network: 'testnet' }) as any;
        const zeroPriv = Buffer.alloc(32, 0);
        const dummyXonly = Buffer.alloc(32, 1);

        expect(() => lib.tweakPrivKeyTaproot(zeroPriv, dummyXonly))
            .toThrow(/Expected Private/);
    });

    it('throws for unsupported input type in chooseAccountXprvForInput', () => {
        const lib = new Inscription({ feeMax: 0.01, network: 'testnet' }) as any;

        const keys = { bip86: "dummy86", bip84: "dummy84" };

        expect(() => lib.chooseAccountXprvForInput(keys, 'p2sh'))
            .toThrow(/Unsupported input type: p2sh/);
    });
});

describe('feeMax (commit-time enforcement)', () => {
    const DUST = 546;
    const OVERHEAD_VBYTES = 11;
    const P2TR_OUTPUT_VBYTES = 43;
    const INPUT_VBYTES_P2TR = 57;

    function requiredBtcForCommit(nTapOuts: number, estSatPerVByte: number, nInputs = 1) {
        const totalOutputsSat = nTapOuts * DUST;
        const inVB = nInputs * INPUT_VBYTES_P2TR;
        const outVB = nTapOuts * P2TR_OUTPUT_VBYTES;
        const vsize = OVERHEAD_VBYTES + inVB + outVB;
        const requiredSat = totalOutputsSat + estSatPerVByte * vsize;
        return requiredSat / 1e8;
    }

    it('throws when requiredBtc > feeMax (single leaf)', async () => {
        const keys = acctXprvs();
        const est = 2;
        const nLeaves = 1;

        const feeMax = requiredBtcForCommit(nLeaves, est) - 0.00000001;
        const lib = new Inscription({ feeMax, network: NETWORK });

        const utxos: FundInput[] = [{
            type: 'p2tr',
            txid: makeTxid(9001),
            vout: 0,
            amount: 50_000,
            hdkeypath: hdp(86, 0, 0),
        }];

        await expect(
            lib.createTransactions(smallOps(1), hdp(86, 0, 0), utxos, est, keys)
        ).rejects.toThrow(/Fee above maximum allowed/i);
    });

    it('accepts when feeMax == requiredBtc (boundary, single leaf)', async () => {
        const keys = acctXprvs();
        const est = 2;
        const nLeaves = 1;

        const feeMax = requiredBtcForCommit(nLeaves, est);
        const lib = new Inscription({ feeMax, network: NETWORK });

        const utxos: FundInput[] = [{
            type: 'p2tr',
            txid: makeTxid(9002),
            vout: 0,
            amount: 60_000,
            hdkeypath: hdp(86, 0, 1),
        }];

        const { commitHex, revealHex, batch } = await lib.createTransactions(
            smallOps(1),
            hdp(86, 0, 0),
            utxos,
            est,
            keys
        );

        expect(batch.length).toBe(1);
        expect(bitcoin.Transaction.fromHex(commitHex)).toBeTruthy();
        expect(bitcoin.Transaction.fromHex(revealHex)).toBeTruthy();
    });

    it('accepts when feeMax > requiredBtc (single leaf)', async () => {
        const keys = acctXprvs();
        const est = 2;

        const feeMax = requiredBtcForCommit(1, est) + 0.000001;
        const lib = new Inscription({ feeMax, network: NETWORK });

        const utxos: FundInput[] = [{
            type: 'p2tr',
            txid: makeTxid(9003),
            vout: 0,
            amount: 80_000,
            hdkeypath: hdp(86, 0, 2),
        }];

        const { commitHex, revealHex } = await lib.createTransactions(
            smallOps(1),
            hdp(86, 0, 0),
            utxos,
            est,
            keys
        );

        expect(commitHex).toMatch(/^[0-9a-f]+$/i);
        expect(revealHex).toMatch(/^[0-9a-f]+$/i);
    });

    it('throws when requiredBtc > feeMax (multi-leaf payload)', async () => {
        const keys = acctXprvs();
        const est = 2;
        const nLeaves = 3;

        const feeMax = requiredBtcForCommit(nLeaves, est) - 0.00000001;
        const lib = new Inscription({ feeMax, network: NETWORK });

        const utxos: FundInput[] = [{
            type: 'p2tr',
            txid: makeTxid(9004),
            vout: 0,
            amount: 200_000,
            hdkeypath: hdp(86, 0, 3),
        }];

        const payload = Buffer.from(JSON.stringify(largeOps(nLeaves)), 'utf8');

        await expect(
            lib.createTransactions(payload, hdp(86, 0, 0), utxos, est, keys)
        ).rejects.toThrow(/Fee above maximum allowed/i);
    });
});
