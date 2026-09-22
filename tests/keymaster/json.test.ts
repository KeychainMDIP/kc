import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import WalletJson from '@mdip/keymaster/wallet/json';
import { WalletFile } from '@mdip/keymaster/types';

const original: WalletFile = { version: 1, seed: {}, counter: 0, ids: {} };
const replacement: WalletFile = { ...original, counter: 1 };

describe('JSON wallet storage', () => {
    let tempDir: string;
    let dataDir: string;
    let walletName: string;
    let wallet: WalletJson;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymaster-json-'));
        dataDir = path.join(tempDir, 'data');
        walletName = path.join(dataDir, 'wallet.json');
        wallet = new WalletJson('wallet.json', dataDir);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates a wallet and refuses an unrequested overwrite', async () => {
        expect(await wallet.loadWallet()).toBeNull();
        expect(await wallet.saveWallet(original)).toBe(true);
        expect(await wallet.saveWallet(replacement)).toBe(false);
        expect(await wallet.loadWallet()).toStrictEqual(original);
    });

    it('uses data/wallet.json by default', async () => {
        const originalCwd = process.cwd();
        process.chdir(tempDir);
        try {
            const defaultWallet = new WalletJson();
            expect(await defaultWallet.saveWallet(original)).toBe(true);
            expect(await defaultWallet.loadWallet()).toStrictEqual(original);
        }
        finally {
            process.chdir(originalCwd);
        }
    });

    it('flushes a replacement before atomically renaming it without changing permissions', async () => {
        await wallet.saveWallet(original);
        fs.chmodSync(walletName, 0o660);
        const writeFile = fs.writeFileSync;
        const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(writeFile);
        const renameFile = fs.renameSync;
        const rename = jest.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
            expect(JSON.parse(fs.readFileSync(walletName, 'utf8'))).toStrictEqual(original);
            expect(JSON.parse(fs.readFileSync(source, 'utf8'))).toStrictEqual(replacement);
            expect(fs.statSync(source).mode & 0o777).toBe(0o660);
            renameFile(source, destination);
        });

        const originalUmask = process.umask(0o077);
        try {
            expect(await wallet.saveWallet(replacement, true)).toBe(true);
        }
        finally {
            process.umask(originalUmask);
        }

        expect(write).toHaveBeenCalledWith(
            expect.stringMatching(/wallet\.json\..+\.tmp$/),
            JSON.stringify(replacement, null, 4),
            { flag: 'wx', flush: true, mode: 0o660 }
        );
        expect(rename).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), walletName);
        expect(await wallet.loadWallet()).toStrictEqual(replacement);
        expect(fs.statSync(walletName).mode & 0o777).toBe(0o660);
        expect(fs.readdirSync(dataDir)).toEqual(['wallet.json']);
    });

    it('preserves the wallet when writing its replacement fails', async () => {
        await wallet.saveWallet(original);
        jest.spyOn(fs, 'writeFileSync').mockImplementationOnce((file) => {
            const descriptor = fs.openSync(file as string, 'w');
            fs.writeSync(descriptor, '{"version":');
            fs.closeSync(descriptor);
            throw new Error('disk full');
        });

        await expect(wallet.saveWallet(replacement, true)).rejects.toThrow('disk full');

        expect(await wallet.loadWallet()).toStrictEqual(original);
        expect(fs.readdirSync(dataDir)).toEqual(['wallet.json']);
    });

    it('reports the write failure if temporary-file cleanup also fails', async () => {
        jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
            throw new Error('disk full');
        });
        jest.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
            throw new Error('cleanup failed');
        });

        await expect(wallet.saveWallet(original)).rejects.toThrow('disk full');
    });
});
