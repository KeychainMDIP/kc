import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import DbJson from '@mdip/gatekeeper/db/json';
import DbJsonCache from '@mdip/gatekeeper/db/json-cache';
import { GatekeeperDb, Operation } from '@mdip/gatekeeper/types';

type AdapterConstructor = new (name: string, folder: string) => GatekeeperDb;

const adapters: Array<[string, AdapterConstructor]> = [
    ['JSON', DbJson],
    ['cached JSON', DbJsonCache],
];
const firstOperation: Operation = { type: 'delete', did: 'did:test:first' };
const secondOperation: Operation = { type: 'delete', did: 'did:test:second' };

describe.each(adapters)('%s database', (_name, Adapter) => {
    let tempDir: string;
    let dataFolder: string;
    let dbName: string;
    let db: GatekeeperDb;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatekeeper-json-'));
        dataFolder = path.join(tempDir, 'data');
        dbName = path.join(dataFolder, 'test.json');
        db = new Adapter('test', dataFolder);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('initializes only a missing database', async () => {
        await db.start();

        expect(JSON.parse(fs.readFileSync(dbName, 'utf8'))).toStrictEqual({ dids: {} });
    });

    it.each([
        ['malformed JSON', '{'],
        ['an invalid database shape', JSON.stringify({ queue: {} })],
        ['invalid DID histories', JSON.stringify({ dids: { invalid: {} } })],
        ['an invalid queue', JSON.stringify({ dids: {}, queue: [] })],
        ['invalid queue entries', JSON.stringify({ dids: {}, queue: { hyperswarm: {} } })],
        ['invalid blocks', JSON.stringify({ dids: {}, blocks: [] })],
        ['invalid registry blocks', JSON.stringify({ dids: {}, blocks: { TBTC: [] } })],
        ['invalid hashes', JSON.stringify({ dids: {}, hashes: [] })],
        ['an invalid index sequence', JSON.stringify({ dids: {}, indexSeq: -1 })],
        ['invalid index changes', JSON.stringify({ dids: {}, indexChanges: {} })],
        ['an invalid index epoch', JSON.stringify({ dids: {}, indexEpoch: 1 })],
    ])('rejects %s without replacing it', async (_description, contents) => {
        fs.mkdirSync(dataFolder);
        fs.writeFileSync(dbName, contents);

        await expect(db.start()).rejects.toThrow();
        expect(fs.readFileSync(dbName, 'utf8')).toBe(contents);
    });

    it('propagates read failures without writing an empty database', async () => {
        fs.mkdirSync(dataFolder);
        fs.writeFileSync(dbName, JSON.stringify({ dids: {} }));
        const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
        jest.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
            throw error;
        });
        const write = jest.spyOn(fs, 'writeFileSync');

        await expect(db.start()).rejects.toThrow('permission denied');
        expect(write).not.toHaveBeenCalled();
    });

    it('flushes and atomically replaces the database before reporting success', async () => {
        await db.start();
        fs.chmodSync(dbName, 0o660);
        const original = fs.readFileSync(dbName, 'utf8');
        const writeFile = fs.writeFileSync;
        const write = jest.spyOn(fs, 'writeFileSync').mockImplementation(writeFile);
        const renameFile = fs.renameSync;
        const rename = jest.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
            expect(fs.readFileSync(dbName, 'utf8')).toBe(original);
            expect(JSON.parse(fs.readFileSync(source, 'utf8'))).toMatchObject({
                queue: { test: [firstOperation] },
            });
            expect(fs.statSync(source).mode & 0o777).toBe(0o660);
            renameFile(source, destination);
        });

        const originalUmask = process.umask(0o077);
        try {
            await expect(db.queueOperation('test', firstOperation)).resolves.toBe(1);
        }
        finally {
            process.umask(originalUmask);
        }

        expect(write).toHaveBeenCalledWith(
            expect.stringMatching(/test\.json\..+\.tmp$/),
            expect.any(String),
            { flag: 'wx', flush: true, mode: 0o660 }
        );
        expect(rename).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), dbName);
        expect(JSON.parse(fs.readFileSync(dbName, 'utf8'))).toMatchObject({
            queue: { test: [firstOperation] },
        });
        expect(fs.readdirSync(dataFolder)).toEqual(['test.json']);
    });

    it('preserves the authoritative database when a replacement write fails', async () => {
        await db.start();
        await db.queueOperation('test', firstOperation);
        const original = fs.readFileSync(dbName, 'utf8');
        jest.spyOn(fs, 'writeFileSync').mockImplementationOnce((file) => {
            const descriptor = fs.openSync(file as string, 'w');
            fs.writeSync(descriptor, '{"dids":');
            fs.closeSync(descriptor);
            throw new Error('disk full');
        });

        await expect(db.queueOperation('test', secondOperation)).rejects.toThrow('disk full');

        expect(fs.readFileSync(dbName, 'utf8')).toBe(original);
        await expect(db.getQueue('test')).resolves.toStrictEqual([firstOperation]);
        expect(fs.readdirSync(dataFolder)).toEqual(['test.json']);
    });

    it('preserves the write failure if temporary-file cleanup also fails', async () => {
        await db.start();
        jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
            throw new Error('disk full');
        });
        jest.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
            throw new Error('cleanup failed');
        });

        await expect(db.queueOperation('test', firstOperation)).rejects.toThrow('disk full');
    });

    it('persists an empty database when reset', async () => {
        await db.start();
        await db.queueOperation('test', firstOperation);

        await db.resetDb();

        expect(JSON.parse(fs.readFileSync(dbName, 'utf8'))).toStrictEqual({ dids: {} });
        await expect(db.getQueue('test')).resolves.toStrictEqual([]);
    });
});
