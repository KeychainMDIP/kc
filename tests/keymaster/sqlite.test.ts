import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import WalletSQLite from '@mdip/keymaster/wallet/sqlite';
import { WalletFile } from '@mdip/keymaster/types';

const original: WalletFile = { version: 1, seed: {}, counter: 0, ids: {} };
const replacement: WalletFile = { ...original, counter: 1 };

describe('SQLite wallet storage', () => {
    let tempDir: string;
    let wallet: WalletSQLite;
    let db: Database;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymaster-sqlite-'));
        wallet = await WalletSQLite.create('wallet.db', tempDir);
        db = await open({ filename: path.join(tempDir, 'wallet.db'), driver: sqlite3.Database });
    });

    afterEach(async () => {
        await wallet.disconnect();
        await db.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('uses data/wallet.db by default for construction and creation', async () => {
        const originalCwd = process.cwd();
        fs.mkdirSync(path.join(tempDir, 'data'));
        let defaultWallet: WalletSQLite | undefined;

        try {
            process.chdir(tempDir);
            defaultWallet = new WalletSQLite();
            expect(await defaultWallet.saveWallet(original)).toBe(true);
            expect(fs.existsSync(path.join(tempDir, 'data', 'wallet.db'))).toBe(true);
            await defaultWallet.disconnect();

            defaultWallet = await WalletSQLite.create();
            expect(await defaultWallet.loadWallet()).toStrictEqual(original);
        } finally {
            process.chdir(originalCwd);
            await defaultWallet?.disconnect();
        }
    });

    it('rejects reads and writes when connect leaves the adapter disconnected', async () => {
        await wallet.saveWallet(original);
        await wallet.disconnect();
        const connect = jest.spyOn(wallet, 'connect').mockResolvedValue(undefined);

        try {
            await expect(wallet.saveWallet(replacement, true)).rejects.toThrow('DB failed to connect.');
            await expect(wallet.loadWallet()).rejects.toThrow('DB failed to connect.');
            await expect(wallet.disconnect()).resolves.toBeUndefined();
        } finally {
            connect.mockRestore();
        }

        expect(await wallet.loadWallet()).toStrictEqual(original);
    });

    it('creates the first wallet and refuses an unrequested overwrite', async () => {
        expect(await wallet.loadWallet()).toBeNull();
        expect(await wallet.saveWallet(original)).toBe(true);
        expect(await wallet.saveWallet(replacement)).toBe(false);
        expect(await wallet.loadWallet()).toStrictEqual(original);
    });

    it('replaces a wallet saved with the legacy implicit row ID', async () => {
        await db.run('INSERT INTO wallet (data) VALUES (?)', JSON.stringify(original));

        expect(await wallet.saveWallet(replacement, true)).toBe(true);
        expect(await db.all('SELECT id, data FROM wallet')).toEqual([
            { id: 1, data: JSON.stringify(replacement) },
        ]);
        await wallet.disconnect();
        expect(await wallet.loadWallet()).toStrictEqual(replacement);
    });

    it.each(['ABORT', 'FAIL', 'ROLLBACK'])(
        'preserves the wallet after an insertion failure using %s', async (action) => {
            await wallet.saveWallet(original);
            await db.exec(`
                CREATE TRIGGER fail_wallet_insert BEFORE INSERT ON wallet
                BEGIN
                    SELECT RAISE(${action}, 'wallet insertion failed');
                END;
            `);

            expect(await wallet.saveWallet(replacement)).toBe(false);
            await expect(wallet.saveWallet(replacement, true)).rejects.toThrow('wallet insertion failed');
            expect(await wallet.loadWallet()).toStrictEqual(original);
            await wallet.disconnect();
            expect(await wallet.loadWallet()).toStrictEqual(original);

            await db.exec('DROP TRIGGER fail_wallet_insert');
            expect(await wallet.saveWallet(replacement, true)).toBe(true);
            expect(await wallet.loadWallet()).toStrictEqual(replacement);
        }
    );

    it('preserves the wallet when replacement data cannot be serialized', async () => {
        await wallet.saveWallet(original);
        const circular = { ...replacement };
        circular.self = circular;

        await expect(wallet.saveWallet(circular, true)).rejects.toThrow(TypeError);
        expect(await wallet.loadWallet()).toStrictEqual(original);
    });

    it.each(['BEFORE', 'AFTER'])('preserves the wallet when an update aborts %s changing the row', async (timing) => {
        await wallet.saveWallet(original);
        await db.exec(`
            CREATE TRIGGER fail_wallet_update ${timing} UPDATE ON wallet
            BEGIN
                SELECT RAISE(ABORT, 'wallet update failed');
            END;
        `);

        await expect(wallet.saveWallet(replacement, true)).rejects.toThrow('wallet update failed');
        expect(await wallet.loadWallet()).toStrictEqual(original);
        await wallet.disconnect();
        expect(await wallet.loadWallet()).toStrictEqual(original);
    });

    it('allows only one concurrent creation without overwrite', async () => {
        const other = await WalletSQLite.create('wallet.db', tempDir);
        try {
            const results = await Promise.all([
                wallet.saveWallet(original),
                other.saveWallet(replacement),
            ]);
            expect(results.filter(Boolean)).toHaveLength(1);
            expect(await wallet.loadWallet()).toStrictEqual(results[0] ? original : replacement);
            expect(await db.get('SELECT COUNT(*) AS count FROM wallet')).toEqual({ count: 1 });
        } finally {
            await other.disconnect();
        }
    });
});
