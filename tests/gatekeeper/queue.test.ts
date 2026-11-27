import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import {
    MAX_OPERATION_PAGE_BYTES,
    MAX_OPERATION_PAGE_COUNT,
    QUEUE_OPERATION_EXCEEDS_PAGE_LIMIT,
} from '@mdip/gatekeeper/types';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import DbMongo from '@mdip/gatekeeper/db/mongo.ts';
import DbPostgres from '@mdip/gatekeeper/db/postgres.ts';
import DbRedis from '@mdip/gatekeeper/db/redis.ts';
import DbSqlite from '@mdip/gatekeeper/db/sqlite.ts';
import type { Operation } from '@mdip/gatekeeper/types';
import { ExpectedExceptionError, InvalidParameterError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import fs from 'fs';
import os from 'os';
import path from 'path';
import TestHelper from './helper.ts';

const mockConsole = {
    log: (): void => { },
    error: (): void => { },
    time: (): void => { },
    timeEnd: (): void => { },
} as unknown as typeof console;

const cipher = new CipherNode();
const db = new DbJsonMemory('test');
const ipfs = new HeliaClient();
const gatekeeper = new Gatekeeper({ db, ipfs, console: mockConsole, registries: ['local', 'hyperswarm', 'TFTC'] });
const helper = new TestHelper(gatekeeper, cipher);

function queuedOperation(index: number, payload = ''): Operation {
    return {
        type: 'create',
        created: `2026-11-19T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
        mdip: { version: 1, type: 'agent', registry: 'TFTC' },
        signature: {
            signed: 'created',
            hash: `queue-operation-${index}`,
            value: `signature-${index}${payload}`,
        },
    } as Operation;
}

beforeAll(async () => {
    await ipfs.start();
});

afterAll(async () => {
    await ipfs.stop();
});

beforeEach(async () => {
    await gatekeeper.resetDb();  // Reset database for each test to ensure isolation
});

describe('atomic event publication', () => {
    it('should roll back an event when a publication queue write fails', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatekeeper-publication-'));
        const sqliteDb = new DbSqlite('atomic', tempDir);
        await sqliteDb.start();

        try {
            const operation = await helper.createAgentOp(cipher.generateRandomJwk(), { registry: 'TFTC' });
            const did = await gatekeeper.generateDID(operation);
            const event = {
                registry: 'local',
                time: operation.created!,
                ordinal: [0],
                operation,
                did,
            };
            await (sqliteDb as any).db.exec(`
                CREATE TRIGGER fail_publication_queue
                BEFORE INSERT ON queue
                BEGIN
                    SELECT RAISE(FAIL, 'queue insert failed');
                END;
            `);

            await expect(sqliteDb.addEventAndQueue(
                did,
                event,
                ['hyperswarm', 'TFTC']
            )).rejects.toThrow('queue insert failed');
            await expect(sqliteDb.getEvents(did)).resolves.toStrictEqual([]);
            await expect(sqliteDb.getQueue('hyperswarm')).resolves.toStrictEqual([]);
            await expect(sqliteDb.getQueue('TFTC')).resolves.toStrictEqual([]);
        }
        finally {
            await sqliteDb.stop();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe('bounded storage reads', () => {
    const operation = queuedOperation(1);

    it('uses a bounded MongoDB projection', async () => {
        const findOne = jest.fn(async () => ({ ops: [operation] }));
        const mongo = new DbMongo('test');
        (mongo as any).db = { collection: () => ({ findOne }) };

        await expect(mongo.getQueue('TFTC', 2)).resolves.toStrictEqual([operation]);
        expect(findOne).toHaveBeenCalledWith(
            { id: 'TFTC' },
            { projection: { ops: { $slice: 2 } } },
        );
    });

    it('uses a bounded Redis range', async () => {
        const lrange = jest.fn(async () => [JSON.stringify(operation)]);
        const redis = new DbRedis('test');
        (redis as any).redis = { lrange };

        await expect(redis.getQueue('TFTC', 2)).resolves.toStrictEqual([operation]);
        expect(lrange).toHaveBeenCalledWith('test/registry/TFTC/queue', 0, 1);
    });

    it('uses a bounded PostgreSQL JSON query', async () => {
        const query = jest.fn(async () => ({ rowCount: 1, rows: [{ ops: [operation] }] }));
        const postgres = new DbPostgres('test');
        (postgres as any).pool = { query };

        await expect(postgres.getQueue('TFTC', 2)).resolves.toStrictEqual([operation]);
        expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $3'), [
            'test', 'TFTC', 2,
        ]);
    });
});

describe('getQueue', () => {

    it('should queue an operation for each publication registry', async () => {
        const operation = await helper.createAgentOp(cipher.generateRandomJwk(), { registry: 'TFTC' });

        await gatekeeper.queueOperation('TFTC', operation);

        await expect(gatekeeper.getQueue('hyperswarm')).resolves.toStrictEqual([operation]);
        await expect(gatekeeper.getQueue('TFTC')).resolves.toStrictEqual([operation]);
    });

    it('should return empty list when no events in queue', async () => {
        const registry = 'TFTC';

        const queue = await gatekeeper.getQueue(registry, { maxBytes: 1 });

        expect(queue).toStrictEqual([]);
    });

    it('should return events in queue', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const queue = await gatekeeper.getQueue(registry);

        expect(queue).toStrictEqual([agentOp, updateOp]);
    });

    it('returns and clears a large queue as ordered head pages', async () => {
        const operations = Array.from(
            { length: MAX_OPERATION_PAGE_COUNT + 2 },
            (_, index) => queuedOperation(index),
        );
        for (const operation of operations) {
            await db.queueOperation('TFTC', operation);
        }

        const first = await gatekeeper.getQueue('TFTC');
        expect(first).toStrictEqual(operations.slice(0, MAX_OPERATION_PAGE_COUNT));

        const appended = queuedOperation(operations.length);
        await db.queueOperation('TFTC', appended);
        await gatekeeper.clearQueue('TFTC', first);

        const second = await gatekeeper.getQueue('TFTC');
        expect(second).toStrictEqual([...operations.slice(MAX_OPERATION_PAGE_COUNT), appended]);
        await gatekeeper.clearQueue('TFTC', second);
        await expect(gatekeeper.getQueue('TFTC')).resolves.toStrictEqual([]);
    });

    it('honors smaller operation and byte limits', async () => {
        const first = queuedOperation(1);
        const second = queuedOperation(2);
        const third = queuedOperation(3);
        for (const operation of [first, second, third]) {
            await db.queueOperation('TFTC', operation);
        }

        await expect(gatekeeper.getQueue('TFTC', { limit: 2 }))
            .resolves.toStrictEqual([first, second]);

        const firstPageBytes = Buffer.byteLength(JSON.stringify([first]), 'utf8');
        await expect(gatekeeper.getQueue('TFTC', {
            maxBytes: firstPageBytes,
        })).resolves.toStrictEqual([first]);
        await expect(gatekeeper.getQueue('TFTC', {
            maxBytes: firstPageBytes - 1,
        })).rejects.toMatchObject({ code: QUEUE_OPERATION_EXCEEDS_PAGE_LIMIT });

        const secondPageBytes = Buffer.byteLength(JSON.stringify([first, second]), 'utf8');
        const twoOperations = await gatekeeper.getQueue('TFTC', { maxBytes: secondPageBytes });
        expect(twoOperations).toStrictEqual([first, second]);
        expect(Buffer.byteLength(JSON.stringify(twoOperations), 'utf8')).toBe(secondPageBytes);
        await expect(gatekeeper.getQueue('TFTC', { maxBytes: secondPageBytes - 1 }))
            .resolves.toStrictEqual([first]);
    });

    it('applies the default byte limit', async () => {
        const first = queuedOperation(1, 'a'.repeat(300 * 1024));
        const second = queuedOperation(2, 'b'.repeat(300 * 1024));
        await db.queueOperation('TFTC', first);
        await db.queueOperation('TFTC', second);

        const page = await gatekeeper.getQueue('TFTC');
        expect(page).toStrictEqual([first]);
        expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(MAX_OPERATION_PAGE_BYTES);
        expect(Buffer.byteLength(JSON.stringify([first, second]), 'utf8')).toBeGreaterThan(MAX_OPERATION_PAGE_BYTES);
    });

    it.each([
        { options: { limit: 0 } },
        { options: { limit: -1 } },
        { options: { limit: 1.5 } },
        { options: { limit: MAX_OPERATION_PAGE_COUNT + 1 } },
        { options: { maxBytes: 0 } },
        { options: { maxBytes: MAX_OPERATION_PAGE_BYTES + 1 } },
    ])('rejects invalid queue page options $options', async ({ options }) => {
        await expect(gatekeeper.getQueue('TFTC', options)).rejects.toBeInstanceOf(InvalidParameterError);
    });

    it('reports an oversized head operation without removing it', async () => {
        const operation = queuedOperation(1);
        await db.queueOperation('TFTC', operation);

        await expect(gatekeeper.getQueue('TFTC', { maxBytes: 1 }))
            .rejects.toMatchObject({ code: QUEUE_OPERATION_EXCEEDS_PAGE_LIMIT });
        await expect(db.getQueue('TFTC')).resolves.toStrictEqual([operation]);
    });

    it('should throw an exception if invalid registry', async () => {
        try {
            await gatekeeper.getQueue('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: registry=mock');
        }
    });
});

describe('clearQueue', () => {

    it('should clear non-empty queue', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const queue = await gatekeeper.getQueue(registry);

        await gatekeeper.clearQueue(registry, queue);
        const queue2 = await gatekeeper.getQueue(registry);

        expect(queue2).toStrictEqual([]);
    });

    it('should clear queue using signature hashes', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const queue = await gatekeeper.getQueue(registry);
        const hashes = queue
            .map(op => op.signature?.hash)
            .filter((hash): hash is string => !!hash);

        await gatekeeper.clearQueue(registry, hashes);
        const queue2 = await gatekeeper.getQueue(registry);

        expect(queue2).toStrictEqual([]);
    });

    it('should return true when hash list has no valid hashes', async () => {
        const ok = await gatekeeper.clearQueue('TFTC', ['']);
        expect(ok).toBe(true);
    });

    it('should leave queue unchanged when hashes do not match', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        await gatekeeper.createDID(agentOp);

        const queue1 = await gatekeeper.getQueue(registry);
        expect(queue1.length).toBeGreaterThan(0);

        const ok = await gatekeeper.clearQueue(registry, ['deadbeef']);
        expect(ok).toBe(true);

        const queue2 = await gatekeeper.getQueue(registry);
        expect(queue2).toStrictEqual(queue1);
    });

    it('should ignore queued ops without hashes when clearing by hash', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        await gatekeeper.createDID(agentOp);

        const opWithoutHash = {
            type: 'create',
            mdip: { version: 1, type: 'agent', registry },
            signature: { signed: '', hash: '', value: '' },
        } as any;
        await db.queueOperation(registry, opWithoutHash);

        const hashes = [agentOp.signature!.hash];
        await gatekeeper.clearQueue(registry, hashes);

        const queue = await gatekeeper.getQueue(registry);
        expect(queue).toStrictEqual([opWithoutHash]);
    });

    it('should return true when queue missing but operations provided', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const ok = await gatekeeper.clearQueue(registry, [agentOp]);
        expect(ok).toBe(true);
    });

    it('should clear only specified events', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const queue1 = [agentOp];

        for (let i = 0; i < 5; i++) {
            const doc = await gatekeeper.resolveDID(did);
            doc.didDocumentData = { mock: i };
            const updateOp = await helper.createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
            queue1.push(updateOp);
        }

        const queue2 = await gatekeeper.getQueue(registry);
        expect(queue2).toStrictEqual(queue1);

        const queue3 = [];
        for (let i = 0; i < 5; i++) {
            const doc = await gatekeeper.resolveDID(did);
            doc.didDocumentData = { mock: i };
            const updateOp = await helper.createUpdateOp(keypair, did, doc);
            await gatekeeper.updateDID(updateOp);
            queue3.push(updateOp);
        }

        await gatekeeper.clearQueue(registry, queue2);
        const queue4 = await gatekeeper.getQueue(registry);
        expect(queue4).toStrictEqual(queue3);
    });

    it('should return true if queue already empty', async () => {
        const ok = await gatekeeper.clearQueue('TFTC', []);
        expect(ok).toBe(true);
    });

    it('should return true if invalid queue specified', async () => {
        const registry = 'TFTC';
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const queue = await gatekeeper.getQueue(registry);
        await gatekeeper.clearQueue(registry, queue);
        await gatekeeper.getQueue(registry);

        // @ts-expect-error Testing invalid queue
        const ok = await gatekeeper.clearQueue(registry, 'mock');

        expect(ok).toStrictEqual(true);
    });

    it('should throw an exception if invalid registry', async () => {
        try {
            await gatekeeper.clearQueue('mock', []);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: registry=mock');
        }
    });
});
