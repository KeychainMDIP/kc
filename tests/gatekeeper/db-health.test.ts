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
        const loadDb = jest.spyOn(db as any, 'loadDb')
            .mockImplementationOnce(() => {
                throw new Error('json read failed');
            });
        await expect(db.getEvents('did:test:missing')).rejects.toThrow('json read failed');
        loadDb.mockRestore();
    });

    it('reports SQLite readiness from the open handle', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatekeeper-health-'));
        const db = new DbSqlite('sqlite', tempDir);

        try {
            await expect(db.isReady()).resolves.toBe(false);
            await db.start();
            await expect(db.isReady()).resolves.toBe(true);
            const get = jest.spyOn((db as any).db, 'get')
                .mockRejectedValueOnce(new Error('sqlite read failed'));
            await expect(db.getEvents('did:test:missing')).rejects.toThrow('sqlite read failed');
            get.mockRestore();
            await db.stop();
            await expect(db.isReady()).resolves.toBe(false);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('reports Mongo readiness from an admin ping', async () => {
        const db = new DbMongo('health-mongo');
        const command = jest.fn<(...args: unknown[]) => Promise<{ ok: number }>>()
            .mockResolvedValue({ ok: 1 });

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
        const ping = jest.fn<() => Promise<string>>().mockResolvedValue('PONG');

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
        const query = jest.fn<(config: { text: string; query_timeout: number }) => Promise<{ rows: Record<string, number>[] }>>()
            .mockResolvedValue({ rows: [{ '?column?': 1 }] });

        await expect(db.isReady()).resolves.toBe(false);

        (db as any).pool = {
            query,
            options: { max: 10 },
        };
        await expect(db.isReady()).resolves.toBe(true);
        expect(query).toHaveBeenCalledWith({
            text: 'SELECT 1',
            query_timeout: 1_000,
        });

        query.mockRejectedValue(new Error('postgres down'));
        await expect(db.isReady()).resolves.toBe(false);
        await expect(db.getEvents('did:test:missing')).rejects.toThrow('postgres down');
    });

    it('rejects an invalid Postgres pool limit', async () => {
        const previous = process.env.KC_POSTGRES_POOL_MAX;
        process.env.KC_POSTGRES_POOL_MAX = '-1';

        try {
            await expect(new DbPostgres('invalid-pool-limit').start())
                .rejects.toThrow('KC_POSTGRES_POOL_MAX must be a positive integer');
        }
        finally {
            if (previous === undefined) {
                delete process.env.KC_POSTGRES_POOL_MAX;
            }
            else {
                process.env.KC_POSTGRES_POOL_MAX = previous;
            }
        }
    });

    it('rejects an invalid Postgres connection timeout', async () => {
        const previous = process.env.KC_POSTGRES_CONNECTION_TIMEOUT_MS;
        process.env.KC_POSTGRES_CONNECTION_TIMEOUT_MS = '0';

        try {
            await expect(new DbPostgres('invalid-connection-timeout').start())
                .rejects.toThrow('KC_POSTGRES_CONNECTION_TIMEOUT_MS must be a positive integer');
        }
        finally {
            if (previous === undefined) {
                delete process.env.KC_POSTGRES_CONNECTION_TIMEOUT_MS;
            }
            else {
                process.env.KC_POSTGRES_CONNECTION_TIMEOUT_MS = previous;
            }
        }
    });

    it('configures Postgres connection lifecycle settings', async () => {
        const configured = {
            KC_POSTGRES_POOL_MAX: '7',
            KC_POSTGRES_CONNECTION_TIMEOUT_MS: '2000',
            KC_POSTGRES_KEEP_ALIVE: 'false',
            KC_POSTGRES_KEEP_ALIVE_INITIAL_DELAY_MS: '12000',
            KC_POSTGRES_IDLE_TIMEOUT_MS: '0',
            KC_POSTGRES_MAX_LIFETIME_SECONDS: '0',
        };
        const previous: Record<string, string | undefined> = {};
        for (const name of Object.keys(configured)) {
            previous[name] = process.env[name];
        }
        Object.assign(process.env, configured);
        const db = new DbPostgres('configured-pool');
        jest.spyOn(db as any, 'withTx').mockResolvedValue(undefined);

        try {
            await db.start();
            expect((db as any).pool.options).toMatchObject({
                max: 7,
                connectionTimeoutMillis: 2_000,
                keepAlive: false,
                keepAliveInitialDelayMillis: 12_000,
                idleTimeoutMillis: 0,
                maxLifetimeSeconds: 0,
            });
        }
        finally {
            await db.stop();
            for (const [name, value] of Object.entries(previous)) {
                if (value === undefined) {
                    delete process.env[name];
                }
                else {
                    process.env[name] = value;
                }
            }
        }
    });

    it('rejects invalid Postgres connection lifecycle settings', async () => {
        const previousKeepAlive = process.env.KC_POSTGRES_KEEP_ALIVE;
        process.env.KC_POSTGRES_KEEP_ALIVE = 'yes';
        try {
            await expect(new DbPostgres('invalid-keep-alive').start())
                .rejects.toThrow('KC_POSTGRES_KEEP_ALIVE must be true or false');
        }
        finally {
            if (previousKeepAlive === undefined) {
                delete process.env.KC_POSTGRES_KEEP_ALIVE;
            }
            else {
                process.env.KC_POSTGRES_KEEP_ALIVE = previousKeepAlive;
            }
        }

        const previousIdleTimeout = process.env.KC_POSTGRES_IDLE_TIMEOUT_MS;
        process.env.KC_POSTGRES_IDLE_TIMEOUT_MS = '';
        try {
            await expect(new DbPostgres('invalid-idle-timeout').start())
                .rejects.toThrow('KC_POSTGRES_IDLE_TIMEOUT_MS must be a non-negative integer');
        }
        finally {
            if (previousIdleTimeout === undefined) {
                delete process.env.KC_POSTGRES_IDLE_TIMEOUT_MS;
            }
            else {
                process.env.KC_POSTGRES_IDLE_TIMEOUT_MS = previousIdleTimeout;
            }
        }
    });

    it('bounds health checks with a timeout', async () => {
        await expect(withHealthCheckTimeout(
            new Promise(() => undefined),
            'health timeout',
            1
        )).rejects.toThrow('health timeout');
    });
});
