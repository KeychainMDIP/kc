import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import Postgres from '../../services/search-server/src/db/postgres.ts';
import Sqlite from '../../services/search-server/src/db/sqlite.ts';
import DidIndexer, {
    INDEX_SYNC_STATE_KEYS,
    type GatekeeperIndexClient,
} from '../../services/search-server/src/DidIndexer.ts';
import {
    buildNetworkMetricSnapshots,
    parseSnapshotDate,
} from '../../services/search-server/src/network-metrics.ts';
import type {
    DIDEventHistory,
    DIDsDb,
    GatekeeperEvent,
    NetworkMetricSnapshot,
} from '../../services/search-server/src/types.ts';

function createEvent(
    did: string,
    operation: GatekeeperEvent['operation'],
    time = '2099-01-01T00:00:00.000Z'
): GatekeeperEvent {
    return {
        did,
        registry: 'hyperswarm',
        time,
        operation: {
            ...operation,
            signature: operation.signature ?? {
                signed: '1970-01-01T00:00:00.000Z',
                hash: 'a'.repeat(64),
                value: 'signature',
            },
        },
    };
}

function createAgentHistory(
    did: string,
    created: string,
    extraEvents: GatekeeperEvent[] = [],
    eventTime?: string
): DIDEventHistory {
    return {
        did,
        events: [
            createEvent(did, {
                type: 'create',
                created,
                mdip: {
                    version: 1,
                    type: 'agent',
                    registry: 'hyperswarm',
                },
            }, eventTime),
            ...extraEvents,
        ],
    };
}

function createCredentialHistory(did: string, created: string): DIDEventHistory {
    return {
        did,
        events: [createEvent(did, {
            type: 'create',
            created,
            mdip: {
                version: 1,
                type: 'asset',
                registry: 'hyperswarm',
            },
            controller: 'did:test:issuer',
            data: { encrypted: {} },
        })],
    };
}

async function collectDIDEventHistories(
    db: DIDsDb,
    pageSize?: number
): Promise<DIDEventHistory[]> {
    const histories: DIDEventHistory[] = [];

    for await (const history of db.iterateDIDEventHistories(pageSize)) {
        histories.push(history);
    }

    return histories;
}

function manifestUpdate(
    holderDid: string,
    credentialDid: string,
    options: { schemaDid?: string; validFrom?: string | null } = {}
): GatekeeperEvent {
    const {
        schemaDid = 'did:test:schema',
        validFrom = '2026-08-01T00:00:00.000Z',
    } = options;
    return createEvent(holderDid, {
        type: 'update',
        did: holderDid,
        doc: {
            didDocument: { id: holderDid },
            didDocumentData: {
                manifest: {
                    [credentialDid]: {
                        type: ['VerifiableCredential', schemaDid],
                        issuer: 'did:test:issuer',
                        ...(validFrom ? { validFrom } : {}),
                        credentialSubject: { id: holderDid },
                        credential: null,
                    },
                },
            },
        },
    });
}

describe('network metric snapshot builder', () => {
    it('prefers asset operation.created and retains schema history after unpublishing', async () => {
        const holderDid = 'did:test:holder';
        const credentialDid = 'did:test:credential';
        const histories = [
            createAgentHistory(holderDid, '2026-08-02T09:00:00.000Z', [
                manifestUpdate(holderDid, credentialDid),
                createEvent(holderDid, {
                    type: 'update',
                    did: holderDid,
                    doc: {
                        didDocument: { id: holderDid },
                        didDocumentData: { manifest: {} },
                    },
                }),
                createEvent(holderDid, { type: 'delete', did: holderDid }),
            ]),
            createCredentialHistory(credentialDid, '2026-08-03T10:00:00.000Z'),
        ];

        const result = await buildNetworkMetricSnapshots(histories, new Date('2026-08-05T12:00:00.000Z'));

        expect(result.snapshots).toStrictEqual([
            { date: '2026-08-02', agentDidCount: 1, credentialCount: 0, schemas: [], rebuiltAt: '2026-08-05T12:00:00.000Z' },
            { date: '2026-08-03', agentDidCount: 1, credentialCount: 1, schemas: [{ schemaDid: 'did:test:schema', count: 1 }], rebuiltAt: '2026-08-05T12:00:00.000Z' },
            { date: '2026-08-04', agentDidCount: 1, credentialCount: 1, schemas: [{ schemaDid: 'did:test:schema', count: 1 }], rebuiltAt: '2026-08-05T12:00:00.000Z' },
            { date: '2026-08-05', agentDidCount: 1, credentialCount: 1, schemas: [{ schemaDid: 'did:test:schema', count: 1 }], rebuiltAt: '2026-08-05T12:00:00.000Z' },
        ]);
        expect(result.credentialsDatedByOperationCreated).toBe(1);
        expect(result.credentialsDatedByValidFrom).toBe(0);
    });

    it('falls back to validFrom and ranks cumulative schema counts', async () => {
        const holderDid = 'did:test:holder';
        const histories = [createAgentHistory(holderDid, '2026-08-01T00:00:00.000Z', [
            manifestUpdate(holderDid, 'did:test:credential-a', {
                schemaDid: 'did:test:schema-a',
                validFrom: '2026-08-02T08:00:00.000Z',
            }),
            manifestUpdate(holderDid, 'did:test:credential-b', {
                schemaDid: 'did:test:schema-b',
                validFrom: '2026-08-02T09:00:00.000Z',
            }),
            manifestUpdate(holderDid, 'did:test:credential-c', {
                schemaDid: 'did:test:schema-b',
                validFrom: '2026-08-03T09:00:00.000Z',
            }),
        ])];

        const result = await buildNetworkMetricSnapshots(histories, new Date('2026-08-03T12:00:00.000Z'));

        expect(result.snapshots.at(-1)).toMatchObject({
            credentialCount: 3,
            schemas: [
                { schemaDid: 'did:test:schema-b', count: 2 },
                { schemaDid: 'did:test:schema-a', count: 1 },
            ],
        });
        expect(result.credentialsDatedByOperationCreated).toBe(0);
        expect(result.credentialsDatedByValidFrom).toBe(3);
        expect(result.credentialsWithoutUsableDate).toBe(0);
    });

    it('moves fallback history when a late asset anchor arrives', async () => {
        const holderDid = 'did:test:holder';
        const credentialDid = 'did:test:credential';
        const histories = [createAgentHistory(holderDid, '2026-08-01T00:00:00.000Z', [
            manifestUpdate(holderDid, credentialDid, {
                validFrom: '2026-08-04T00:00:00.000Z',
            }),
        ])];
        const now = new Date('2026-08-05T12:00:00.000Z');
        const before = await buildNetworkMetricSnapshots(histories, now);
        const after = await buildNetworkMetricSnapshots([
            ...histories,
            createCredentialHistory(credentialDid, '2026-08-02T00:00:00.000Z'),
        ], now);

        expect(before.snapshots.find(snapshot => snapshot.date === '2026-08-03')?.credentialCount).toBe(0);
        expect(before.credentialsDatedByValidFrom).toBe(1);
        expect(after.snapshots.find(snapshot => snapshot.date === '2026-08-03')?.credentialCount).toBe(1);
        expect(after.credentialsDatedByOperationCreated).toBe(1);
    });

    it('reports credentials without a usable date or with conflicting schemas', async () => {
        const holderDid = 'did:test:holder';
        const conflictingDid = 'did:test:conflicting';
        const histories = [createAgentHistory(holderDid, '2026-08-01T00:00:00.000Z', [
            manifestUpdate(holderDid, 'did:test:undated', { validFrom: null }),
            manifestUpdate(holderDid, 'did:test:normalized-date', { validFrom: '2026-02-31' }),
            manifestUpdate(holderDid, 'did:test:invalid-calendar-date', {
                validFrom: '2026-02-31T00:00:00.000Z',
            }),
            manifestUpdate(holderDid, 'did:test:numeric-date', { validFrom: '0' }),
            manifestUpdate(holderDid, conflictingDid, { schemaDid: 'did:test:schema-a' }),
            manifestUpdate(holderDid, conflictingDid, { schemaDid: 'did:test:schema-b' }),
            manifestUpdate(holderDid, 'did:test:future', { validFrom: '2026-08-10T00:00:00.000Z' }),
        ])];

        const result = await buildNetworkMetricSnapshots(histories, new Date('2026-08-03T12:00:00.000Z'));

        expect(result.snapshots.at(-1)).toMatchObject({ credentialCount: 0, schemas: [] });
        expect(result.credentialsWithoutUsableDate).toBe(4);
        expect(result.credentialsWithConflictingSchemas).toBe(1);
        expect(result.futureCredentialValidFrom).toBe(1);
    });

    it('is independent of receipt time and signature time', async () => {
        const first = createAgentHistory(
            'did:test:agent',
            '2026-08-02T09:00:00.000Z',
            [],
            '2026-08-02T09:00:01.000Z'
        );
        const second = createAgentHistory(
            'did:test:agent',
            '2026-08-02T09:00:00.000Z',
            [],
            '2099-12-31T23:59:59.000Z'
        );
        second.events[0].operation.signature!.signed = '2040-01-01T00:00:00.000Z';
        const now = new Date('2026-08-03T12:00:00.000Z');

        const firstResult = await buildNetworkMetricSnapshots([first], now);
        const secondResult = await buildNetworkMetricSnapshots([second], now);

        expect(firstResult.snapshots).toStrictEqual(secondResult.snapshots);
    });

    it('deduplicates credentials, corrects late history, and reports unusable anchors', async () => {
        const holderDid = 'did:test:holder';
        const credentialDid = 'did:test:credential';
        const update = manifestUpdate(holderDid, credentialDid);
        const histories = [
            createAgentHistory(holderDid, '2026-08-02T00:00:00.000Z', [update, update]),
            createCredentialHistory(credentialDid, '2026-08-02T00:00:00.000Z'),
            createAgentHistory('did:test:invalid', 'not-a-date'),
            createAgentHistory('did:test:future', '2026-08-10T00:00:00.000Z'),
        ];
        const now = new Date('2026-08-03T12:00:00.000Z');
        const before = await buildNetworkMetricSnapshots(histories, now);
        const after = await buildNetworkMetricSnapshots([
            ...histories,
            createAgentHistory('did:test:late', '2026-08-01T00:00:00.000Z'),
        ], now);

        expect(before.snapshots.at(-1)).toMatchObject({ agentDidCount: 1, credentialCount: 1 });
        expect(before.invalidCreatedTimes).toBe(1);
        expect(before.futureCreatedOperations).toBe(1);
        expect(after.snapshots[0]).toMatchObject({ date: '2026-08-01', agentDidCount: 1 });
        expect(after.snapshots.at(-1)).toMatchObject({ agentDidCount: 2, credentialCount: 1 });
    });

    it('reports unusable and future credential asset anchors', async () => {
        const holderDid = 'did:test:holder';
        const invalidCredentialDid = 'did:test:invalid-credential';
        const futureCredentialDid = 'did:test:future-credential';
        const invalidAgent = createAgentHistory('did:test:invalid-agent', 'unused');
        (invalidAgent.events[0].operation as any).created = 0;
        const histories = [
            invalidAgent,
            createAgentHistory(holderDid, '2026-08-01T00:00:00.000Z', [
                manifestUpdate(holderDid, invalidCredentialDid, {
                    validFrom: '2026-08-02T00:00:00.000Z',
                }),
                manifestUpdate(holderDid, futureCredentialDid, {
                    validFrom: '2026-08-02T00:00:00.000Z',
                }),
            ]),
            createCredentialHistory(invalidCredentialDid, 'not-a-date'),
            createCredentialHistory(futureCredentialDid, '2026-08-10T00:00:00.000Z'),
        ];

        const result = await buildNetworkMetricSnapshots(histories, new Date('2026-08-03T12:00:00.000Z'));

        expect(result.snapshots.at(-1)?.credentialCount).toBe(1);
        expect(result.invalidCreatedTimes).toBe(2);
        expect(result.futureCreatedOperations).toBe(1);
        expect(result.credentialsDatedByValidFrom).toBe(1);
    });

    it('puts pre-MDIP creates in the baseline and emits a zero snapshot for an empty index', async () => {
        const now = new Date('2024-01-03T12:00:00.000Z');
        const baseline = await buildNetworkMetricSnapshots([
            createAgentHistory('did:test:legacy', '1970-01-01T00:00:00.000Z'),
        ], now);
        const empty = await buildNetworkMetricSnapshots([], now);

        expect(baseline.snapshots[0]).toMatchObject({ date: '2024-01-01', agentDidCount: 1 });
        expect(baseline.snapshots).toHaveLength(3);
        expect(empty.snapshots).toStrictEqual([
            { date: '2024-01-03', agentDidCount: 0, credentialCount: 0, schemas: [], rebuiltAt: now.toISOString() },
        ]);
    });

    it('validates snapshot dates strictly', () => {
        const now = new Date('2026-08-05T12:00:00.000Z');

        expect(parseSnapshotDate('2026-08-05', now)).toBe('2026-08-05');
        expect(parseSnapshotDate('2026-02-31', now)).toBeNull();
        expect(parseSnapshotDate('2026-8-5', now)).toBeNull();
        expect(parseSnapshotDate('2026-08-06', now)).toBeNull();
    });
});

type DbHarness = {
    db: DIDsDb;
    cleanup: () => Promise<void>;
};

const adapterFactories = [
    {
        name: 'memory',
        create: async (): Promise<DbHarness> => ({
            db: new DIDsDbMemory(),
            cleanup: async () => undefined,
        }),
    },
    {
        name: 'sqlite',
        create: async (): Promise<DbHarness> => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-metrics-'));
            const db = await Sqlite.create('metrics.db', tempDir);
            return {
                db,
                cleanup: async () => {
                    await db.disconnect();
                    fs.rmSync(tempDir, { recursive: true, force: true });
                },
            };
        },
    },
] as const;

describe.each(adapterFactories)('$name network metric persistence', ({ create }) => {
    let harness: DbHarness;

    beforeEach(async () => {
        harness = await create();
        await harness.db.connect();
    });

    afterEach(async () => {
        await harness.cleanup();
    });

    it('preserves event order and atomically replaces snapshot rows', async () => {
        const did = 'did:test:z-history';
        const earlierDid = 'did:test:a-history';
        const events = [
            createEvent(did, { type: 'create', created: '2026-08-01T00:00:00.000Z' }),
            createEvent(did, { type: 'delete', did }),
        ];
        const earlierEvents = [
            createEvent(earlierDid, { type: 'create', created: '2026-08-01T00:00:00.000Z' }),
        ];
        await harness.db.applyIndexPage({
            dids: [{ did, events }, { did: earlierDid, events: earlierEvents }],
            blocks: [],
        });
        const first: NetworkMetricSnapshot = {
            date: '2026-08-01',
            agentDidCount: 1,
            credentialCount: 0,
            schemas: [{ schemaDid: 'did:test:schema', count: 1 }],
            rebuiltAt: '2026-08-03T00:00:00.000Z',
        };
        const second = { ...first, date: '2026-08-02' };

        expect(await collectDIDEventHistories(harness.db, 2)).toStrictEqual([
            { did: earlierDid, events: earlierEvents },
            { did, events },
        ]);
        await harness.db.replaceNetworkMetricSnapshots([first, second]);
        expect(await harness.db.getNetworkMetricSnapshot(first.date)).toStrictEqual(first);
        await harness.db.replaceNetworkMetricSnapshots([second]);
        expect(await harness.db.getNetworkMetricSnapshot(first.date)).toBeNull();
        await harness.db.wipeDb();
        expect(await collectDIDEventHistories(harness.db)).toStrictEqual([]);
        expect(await harness.db.getNetworkMetricSnapshot(second.date)).toBeNull();
    });
});

describe('network metric database branches', () => {
    const snapshot: NetworkMetricSnapshot = {
        date: '2026-08-01',
        agentDidCount: 2,
        credentialCount: 1,
        schemas: [{ schemaDid: 'did:test:schema', count: 1 }],
        rebuiltAt: '2026-08-03T00:00:00.000Z',
    };

    it('rejects network metric operations when SQLite is disconnected', async () => {
        const db = new Sqlite('unused.db', '/tmp');

        await expect(collectDIDEventHistories(db)).rejects.toThrow('DB not connected');
        await expect(db.replaceNetworkMetricSnapshots([snapshot])).rejects.toThrow('DB not connected');
        await expect(db.getNetworkMetricSnapshot(snapshot.date)).rejects.toThrow('DB not connected');
    });

    it('rolls back a failed SQLite snapshot replacement', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-metrics-rollback-'));
        const db = await Sqlite.create('metrics.db', tempDir) as Sqlite;
        const sqliteDb = (db as any).db;
        const failure = new Error('snapshot insert failed');
        const run = jest.spyOn(sqliteDb, 'run').mockRejectedValueOnce(failure);
        const exec = jest.spyOn(sqliteDb, 'exec');

        try {
            await expect(db.replaceNetworkMetricSnapshots([snapshot])).rejects.toThrow(failure);
            expect(exec).toHaveBeenCalledWith('ROLLBACK');
        }
        finally {
            run.mockRestore();
            exec.mockRestore();
            await db.disconnect();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('stores and reads network metrics through the PostgreSQL adapter', async () => {
        const did = 'did:test:history';
        const secondDid = 'did:test:z-history';
        const firstEvent = createEvent(did, {
            type: 'create',
            created: '2026-08-01T00:00:00.000Z',
        });
        const secondEvent = createEvent(did, { type: 'delete', did });
        const thirdEvent = createEvent(secondDid, {
            type: 'create',
            created: '2026-08-02T00:00:00.000Z',
        });
        const poolQuery = jest.fn(async (sql: string, params: unknown[] = []) => {
            const text = String(sql);

            if (text.includes('FROM did_events')) {
                const eventRows = [
                    { did, eventIndex: 0, event: JSON.stringify(firstEvent) },
                    { did, eventIndex: 1, event: secondEvent },
                    { did: secondDid, eventIndex: 0, event: thirdEvent },
                ];
                const cursorDid = params.length === 3 ? String(params[0]) : '';
                const cursorIndex = params.length === 3 ? Number(params[1]) : -1;
                const limit = Number(params[params.length - 1]);
                const rows = eventRows
                    .filter(row => row.did > cursorDid || (row.did === cursorDid && row.eventIndex > cursorIndex))
                    .slice(0, limit);

                return {
                    rowCount: rows.length,
                    rows,
                };
            }
            if (text.includes('FROM network_metric_snapshots')) {
                if (params[0] === 'missing') {
                    return { rowCount: 0, rows: [] };
                }

                return {
                    rowCount: 1,
                    rows: [{
                        date: params[0],
                        agentDidCount: snapshot.agentDidCount,
                        credentialCount: snapshot.credentialCount,
                        schemaCounts: params[0] === snapshot.date
                            ? JSON.stringify(snapshot.schemas)
                            : snapshot.schemas,
                        rebuiltAt: snapshot.rebuiltAt,
                    }],
                };
            }

            throw new Error(`Unexpected PostgreSQL query: ${text}`);
        });
        const client = {
            query: jest.fn<(...args: unknown[]) => Promise<unknown>>()
                .mockResolvedValue({ rowCount: 0, rows: [] }),
            release: jest.fn(),
        };
        const pool = {
            query: poolQuery,
            connect: jest.fn<() => Promise<typeof client>>().mockResolvedValue(client),
        };
        const db = new Postgres('postgresql://example');
        (db as any).pool = pool;

        expect(await collectDIDEventHistories(db, 1)).toStrictEqual([
            { did, events: [firstEvent, secondEvent] },
            { did: secondDid, events: [thirdEvent] },
        ]);
        expect(poolQuery).toHaveBeenCalledWith(
            expect.stringContaining('WHERE (did, event_index) > ($1, $2)'),
            [did, 0, 1]
        );
        expect(await collectDIDEventHistories(db, 500)).toHaveLength(2);
        await db.replaceNetworkMetricSnapshots([snapshot]);
        expect(client.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO network_metric_snapshots'),
            [
                snapshot.date,
                snapshot.agentDidCount,
                snapshot.credentialCount,
                JSON.stringify(snapshot.schemas),
                snapshot.rebuiltAt,
            ]
        );
        expect(client.query).toHaveBeenCalledWith('COMMIT');
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(await db.getNetworkMetricSnapshot(snapshot.date)).toStrictEqual(snapshot);
        expect(await db.getNetworkMetricSnapshot('2026-08-02')).toStrictEqual({
            ...snapshot,
            date: '2026-08-02',
        });
        expect(await db.getNetworkMetricSnapshot('missing')).toBeNull();
    });

    it('rolls back and releases a failed PostgreSQL snapshot replacement', async () => {
        const failure = new Error('snapshot delete failed');
        const client = {
            query: jest.fn(async (sql: string) => {
                if (sql === 'DELETE FROM network_metric_snapshots') {
                    throw failure;
                }

                return { rowCount: 0, rows: [] };
            }),
            release: jest.fn(),
        };
        const pool = {
            connect: jest.fn<() => Promise<typeof client>>().mockResolvedValue(client),
        };
        const db = new Postgres('postgresql://example');
        (db as any).pool = pool;

        await expect(db.replaceNetworkMetricSnapshots([snapshot])).rejects.toThrow(failure);
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(client.release).toHaveBeenCalledTimes(1);
    });
});

describe('DidIndexer network metrics scheduling', () => {
    it('waits for the initial snapshot before rebuilding metrics', async () => {
        const db = new DIDsDbMemory();
        const iterateHistories = jest.spyOn(db, 'iterateDIDEventHistories');
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>(),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>(),
        };
        const indexer = new DidIndexer(gatekeeper, db, {
            intervalMs: 60_000,
            metricsRefreshIntervalMs: 60_000,
        });

        await (indexer as any).refreshNetworkMetricsIfDue();

        expect(iterateHistories).not.toHaveBeenCalled();
    });

    it('logs when the metrics error state cannot be saved', async () => {
        const db = new DIDsDbMemory();
        await db.saveSyncState(INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        const metricsFailure = new Error('metrics failed');
        const stateFailure = new Error('state failed');
        jest.spyOn(db, 'replaceNetworkMetricSnapshots').mockRejectedValue(metricsFailure);
        jest.spyOn(db, 'saveSyncState').mockImplementation((key, value) => {
            if (key === INDEX_SYNC_STATE_KEYS.metricsLastError) {
                return Promise.reject(stateFailure);
            }

            return DIDsDbMemory.prototype.saveSyncState.call(db, key, value);
        });
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>(),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>(),
        };
        const indexer = new DidIndexer(gatekeeper, db, {
            intervalMs: 60_000,
            metricsRefreshIntervalMs: 60_000,
        });
        const log = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        (indexer as any).log = log;

        await (indexer as any).refreshNetworkMetricsIfDue();

        expect(log.warn).toHaveBeenCalledWith(
            { error: stateFailure },
            'Could not save metrics error state'
        );
        expect(log.error).toHaveBeenCalledWith(
            { error: metricsFailure },
            'Network metrics rebuild error'
        );
    });

    it('rebuilds after the initial snapshot and does not rebuild again before the interval', async () => {
        const db = new DIDsDbMemory();
        const did = 'did:test:z3v8AuaTV5VKcT9MJoSHkSTRLpXDoqcgqiKkwGBNSV4nVzb6kLk';
        const created = new Date().toISOString();
        const event = createEvent(did, {
            type: 'create',
            created,
            mdip: { version: 1, type: 'agent', registry: 'hyperswarm' },
        });
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValueOnce({
                    mode: 'snapshot',
                    indexEpoch: 'epoch-test',
                    cursor: did,
                    checkpointCursor: '1',
                    hasMore: false,
                    dids: [{ did, events: [event] }],
                    blocks: [],
                })
                .mockResolvedValueOnce({
                    mode: 'changes',
                    indexEpoch: 'epoch-test',
                    cursor: '1',
                    checkpointCursor: '1',
                    hasMore: false,
                    dids: [],
                    blocks: [],
                }),
        };
        const replace = jest.spyOn(db, 'replaceNetworkMetricSnapshots');
        const indexer = new DidIndexer(gatekeeper, db, {
            intervalMs: 60_000,
            metricsRefreshIntervalMs: 60_000,
        });

        await (indexer as any).refreshIndex();
        await (indexer as any).refreshIndex();

        expect(replace).toHaveBeenCalledTimes(1);
        expect(await db.getNetworkMetricSnapshot(created.slice(0, 10))).toMatchObject({
            agentDidCount: 1,
            credentialCount: 0,
        });
    });

    it('retries metric failures without marking the DID sync as failed', async () => {
        const db = new DIDsDbMemory();
        const did = 'did:test:z3v8AuaUaK93ip2KsM5KGsWXWqgXFSNQxRkcMReXe4LheX5CkHe';
        const event = createEvent(did, {
            type: 'create',
            created: new Date().toISOString(),
            mdip: { version: 1, type: 'agent', registry: 'hyperswarm' },
        });
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValueOnce({
                    mode: 'snapshot',
                    indexEpoch: 'epoch-test',
                    cursor: did,
                    checkpointCursor: '1',
                    hasMore: false,
                    dids: [{ did, events: [event] }],
                    blocks: [],
                })
                .mockResolvedValueOnce({
                    mode: 'changes',
                    indexEpoch: 'epoch-test',
                    cursor: '1',
                    checkpointCursor: '1',
                    hasMore: false,
                    dids: [],
                    blocks: [],
                }),
        };
        const replace = jest.spyOn(db, 'replaceNetworkMetricSnapshots')
            .mockRejectedValueOnce(new Error('metrics failed'))
            .mockImplementation(snapshots =>
                DIDsDbMemory.prototype.replaceNetworkMetricSnapshots.call(db, snapshots));
        const indexer = new DidIndexer(gatekeeper, db, {
            intervalMs: 60_000,
            metricsRefreshIntervalMs: 60_000,
        });

        await (indexer as any).refreshIndex();
        expect(await db.loadSyncState('index.lastSyncError')).toBeNull();
        expect(await db.loadSyncState('metrics.lastError')).toContain('metrics failed');

        await (indexer as any).refreshIndex();
        expect(replace).toHaveBeenCalledTimes(2);
        expect(await db.loadSyncState('metrics.lastError')).toBeNull();
        expect(await db.loadSyncState('metrics.lastRebuiltAt')).not.toBeNull();
    });
});
