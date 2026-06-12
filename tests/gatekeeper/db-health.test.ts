import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import DbMongo from '@mdip/gatekeeper/db/mongo.ts';
import DbPostgres from '@mdip/gatekeeper/db/postgres.ts';
import DbRedis from '@mdip/gatekeeper/db/redis.ts';
import DbSqlite from '@mdip/gatekeeper/db/sqlite.ts';
import { withHealthCheckTimeout } from '@mdip/gatekeeper/db/health.ts';

describe('database readiness checks', () => {
    it('reports JSON memory as ready', async () => {
        const db = new DbJsonMemory('health-json-memory');

        await expect(db.isReady()).resolves.toBe(true);
    });

    it('reports SQLite readiness from the open handle', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatekeeper-health-'));
        const db = new DbSqlite('sqlite', tempDir);

        try {
            await expect(db.isReady()).resolves.toBe(false);
            await db.start();
            await expect(db.isReady()).resolves.toBe(true);
            await db.stop();
            await expect(db.isReady()).resolves.toBe(false);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('reports Mongo readiness from an admin ping', async () => {
        const db = new DbMongo('health-mongo');
        const command = jest.fn().mockResolvedValue({ ok: 1 });

        await expect(db.isReady()).resolves.toBe(false);

        (db as any).client = {
            db: jest.fn(() => ({ command })),
        };
        (db as any).db = {};

        await expect(db.isReady()).resolves.toBe(true);
        expect(command).toHaveBeenCalledWith(
            { ping: 1 },
            { timeoutMS: 1_000 }
        );

        command.mockRejectedValue(new Error('mongo down'));
        await expect(db.isReady()).resolves.toBe(false);
    });

    it('reports Redis readiness only for a ready client with a successful ping', async () => {
        const db = new DbRedis('health-redis');
        const ping = jest.fn().mockResolvedValue('PONG');

        await expect(db.isReady()).resolves.toBe(false);

        (db as any).redis = {
            status: 'end',
            ping,
        };
        await expect(db.isReady()).resolves.toBe(false);
        expect(ping).not.toHaveBeenCalled();

        (db as any).redis.status = 'ready';
        await expect(db.isReady()).resolves.toBe(true);

        ping.mockResolvedValue('NOPE');
        await expect(db.isReady()).resolves.toBe(false);
    });

    it('reports Postgres readiness from a lightweight query', async () => {
        const db = new DbPostgres('health-postgres');
        const query = jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] });

        await expect(db.isReady()).resolves.toBe(false);

        (db as any).pool = { query };
        await expect(db.isReady()).resolves.toBe(true);
        expect(query).toHaveBeenCalledWith('SELECT 1');

        query.mockRejectedValue(new Error('postgres down'));
        await expect(db.isReady()).resolves.toBe(false);
    });

    it('bounds health checks with a timeout', async () => {
        await expect(withHealthCheckTimeout(
            new Promise(() => undefined),
            'health timeout',
            1
        )).rejects.toThrow('health timeout');
    });
});
