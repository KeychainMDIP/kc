import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import { setLogger } from '../../packages/common/src/logger.ts';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import Sqlite from '../../services/search-server/src/db/sqlite.ts';
import DidIndexer from '../../services/search-server/src/DidIndexer.ts';
import { extractChallengeReceipts } from '../../services/search-server/src/challenge-receipts.ts';
import type {
    ChallengeReceiptRecord,
    ChallengeReceiptUsageRecord,
    DIDsDb,
    GatekeeperEvent,
} from '../../services/search-server/src/types.ts';
import { seedDID } from './db-seed.ts';

function createReceiptDoc(
    receiptDid: string,
    {
        attesterDid = 'did:test:attester-1',
        schemaDid = 'did:test:schema-1',
        requesterDid = 'did:test:requester-1',
        responseCommitment = 'mock-commitment-1',
        updatedAt = '2026-04-01T10:01:00.000Z',
        challengeReceipt,
    }: {
        attesterDid?: string;
        schemaDid?: string;
        requesterDid?: string;
        responseCommitment?: string;
        updatedAt?: string;
        challengeReceipt?: unknown;
    } = {}
) {
    return {
        didDocument: {
            id: receiptDid,
        },
        didDocumentData: {
            challengeReceipt: challengeReceipt ?? {
                version: 1,
                attesterDid,
                schemaDid,
                requesterDid,
                responseCommitment,
            },
        },
        didDocumentMetadata: {
            updated: updatedAt,
        },
    };
}

function createAssetEvent(
    did: string,
    data: unknown,
    created = '2026-04-01T10:01:00.000Z'
): GatekeeperEvent {
    return {
        registry: 'local',
        time: created,
        ordinal: [0],
        did,
        operation: {
            type: 'create',
            created,
            mdip: {
                version: 1,
                type: 'asset',
                registry: 'local',
            },
            controller: did,
            data,
        },
    };
}

function createSnapshotResponse(did: string, data: unknown) {
    return {
        mode: 'snapshot' as const,
        cursor: did,
        checkpointCursor: '0',
        hasMore: false,
        blocks: [],
        dids: [{
            did,
            events: [createAssetEvent(did, data)],
        }],
    };
}

type DbHarness = {
    db: DIDsDb;
    cleanup: () => Promise<void>;
};

const adapterFactories = [
    {
        name: 'memory',
        create: async (): Promise<DbHarness> => {
            const db = new DIDsDbMemory();
            await db.connect();

            return {
                db,
                cleanup: async () => {
                    await db.disconnect();
                },
            };
        },
    },
    {
        name: 'sqlite',
        create: async (): Promise<DbHarness> => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-server-receipts-'));
            const db = await Sqlite.create('receipts.db', tempDir);

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

beforeEach(() => {
    const logger = {
        child: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    logger.child.mockReturnValue(logger);
    setLogger(logger as any);
});

describe('extractChallengeReceipts', () => {
    it('extracts a normalized row from a valid challenge receipt asset', () => {
        const receiptDid = 'did:test:receipt-1';
        const doc = createReceiptDoc(receiptDid);

        expect(extractChallengeReceipts(receiptDid, doc)).toStrictEqual<ChallengeReceiptRecord[]>([
            {
                receiptDid,
                attesterDid: 'did:test:attester-1',
                schemaDid: 'did:test:schema-1',
                requesterDid: 'did:test:requester-1',
                responseCommitment: 'mock-commitment-1',
                updatedAt: '2026-04-01T10:01:00.000Z',
            },
        ]);
    });

    it('ignores malformed receipt assets', () => {
        const receiptDid = 'did:test:receipt-1';

        expect(extractChallengeReceipts(receiptDid, {})).toStrictEqual([]);
        expect(extractChallengeReceipts('not-a-did', createReceiptDoc('not-a-did'))).toStrictEqual([]);
        expect(extractChallengeReceipts(receiptDid, createReceiptDoc(receiptDid, {
            challengeReceipt: [],
        }))).toStrictEqual([]);
        expect(extractChallengeReceipts(receiptDid, createReceiptDoc(receiptDid, {
            challengeReceipt: {
                version: 2,
                attesterDid: 'did:test:attester-1',
                schemaDid: 'did:test:schema-1',
                requesterDid: 'did:test:requester-1',
                responseCommitment: 'mock-commitment-1',
            },
        }))).toStrictEqual([]);
        expect(extractChallengeReceipts(receiptDid, createReceiptDoc(receiptDid, {
            responseCommitment: '',
        }))).toStrictEqual([]);
    });
});

describe.each(adapterFactories)('$name challenge receipt storage', ({ create }) => {
    it('lists, filters, groups, replaces, and wipes challenge receipt rows', async () => {
        const { db, cleanup } = await create();

        try {
            const rows: ChallengeReceiptRecord[] = [
                {
                    receiptDid: 'did:test:receipt-1',
                    attesterDid: 'did:test:attester-1',
                    schemaDid: 'did:test:schema-1',
                    requesterDid: 'did:test:requester-1',
                    responseCommitment: 'mock-commitment-1',
                    updatedAt: '2026-04-01T10:01:00.000Z',
                },
                {
                    receiptDid: 'did:test:receipt-2',
                    attesterDid: 'did:test:attester-1',
                    schemaDid: 'did:test:schema-1',
                    requesterDid: 'did:test:requester-1',
                    responseCommitment: 'mock-commitment-2',
                    updatedAt: '2026-04-01T11:01:00.000Z',
                },
                {
                    receiptDid: 'did:test:receipt-3',
                    attesterDid: 'did:test:attester-1',
                    schemaDid: 'did:test:schema-2',
                    requesterDid: 'did:test:requester-2',
                    responseCommitment: 'mock-commitment-3',
                    updatedAt: '2026-04-02T10:01:00.000Z',
                },
                {
                    receiptDid: 'did:test:receipt-4',
                    attesterDid: 'did:test:attester-2',
                    schemaDid: 'did:test:schema-1',
                    requesterDid: 'did:test:requester-1',
                    responseCommitment: 'mock-commitment-4',
                    updatedAt: '2026-04-03T10:01:00.000Z',
                },
                {
                    receiptDid: 'did:test:receipt-5',
                    attesterDid: 'did:test:attester-1',
                    schemaDid: 'did:test:schema-1',
                    requesterDid: 'did:test:requester-1',
                    responseCommitment: 'mock-commitment-2',
                    updatedAt: '2026-04-01T12:01:00.000Z',
                },
            ];

            for (const row of rows) {
                await seedDID(db, row.receiptDid, {
                    challengeReceipts: [row],
                });
            }

            expect(await db.listChallengeReceipts({
                attesterDid: 'did:test:attester-1',
                schemaDid: 'did:test:schema-1',
                requesterDid: 'did:test:requester-1',
                updatedAfter: '2026-04-01T10:30:00.000Z',
                updatedBefore: '2026-04-01T11:30:00.000Z',
                limit: 10,
                offset: 0,
            })).toStrictEqual({
                total: 1,
                receipts: [rows[1]],
            });

            expect(await db.listChallengeReceipts({
                responseCommitment: 'mock-commitment-3',
                limit: 10,
                offset: 0,
            })).toStrictEqual({
                total: 1,
                receipts: [rows[2]],
            });

            expect(await db.getChallengeReceiptUsage({
                attesterDid: 'did:test:attester-1',
                limit: 10,
                offset: 0,
            })).toStrictEqual({
                total: 2,
                usage: [
                    {
                        attesterDid: 'did:test:attester-1',
                        schemaDid: 'did:test:schema-1',
                        requesterDid: 'did:test:requester-1',
                        count: 2,
                        firstUpdatedAt: '2026-04-01T10:01:00.000Z',
                        lastUpdatedAt: '2026-04-01T12:01:00.000Z',
                    },
                    {
                        attesterDid: 'did:test:attester-1',
                        schemaDid: 'did:test:schema-2',
                        requesterDid: 'did:test:requester-2',
                        count: 1,
                        firstUpdatedAt: '2026-04-02T10:01:00.000Z',
                        lastUpdatedAt: '2026-04-02T10:01:00.000Z',
                    },
                ] satisfies ChallengeReceiptUsageRecord[],
            });

            await seedDID(db, 'did:test:receipt-2', {
                challengeReceipts: [],
            });
            expect(await db.listChallengeReceipts({
                receiptDid: 'did:test:receipt-2',
                limit: 10,
                offset: 0,
            })).toStrictEqual({
                total: 0,
                receipts: [],
            });

            await db.wipeDb();
            expect(await db.getChallengeReceiptUsage({
                attesterDid: 'did:test:attester-1',
                limit: 10,
                offset: 0,
            })).toStrictEqual({
                total: 0,
                usage: [],
            });
        }
        finally {
            await cleanup();
        }
    });
});

describe('memory challenge receipt ordering', () => {
    it('sorts receipts and grouped usage deterministically', async () => {
        const db = new DIDsDbMemory();
        await db.connect();

        const rows: ChallengeReceiptRecord[] = [
            {
                receiptDid: 'did:test:receipt-3',
                attesterDid: 'did:test:attester-1',
                schemaDid: 'did:test:schema-b',
                requesterDid: 'did:test:requester-b',
                responseCommitment: 'mock-commitment-b-b',
                updatedAt: '2026-04-01T10:01:00.000Z',
            },
            {
                receiptDid: 'did:test:receipt-2',
                attesterDid: 'did:test:attester-1',
                schemaDid: 'did:test:schema-b',
                requesterDid: 'did:test:requester-a',
                responseCommitment: 'mock-commitment-b-a',
                updatedAt: '2026-04-01T10:01:00.000Z',
            },
            {
                receiptDid: 'did:test:receipt-1',
                attesterDid: 'did:test:attester-1',
                schemaDid: 'did:test:schema-a',
                requesterDid: 'did:test:requester-a',
                responseCommitment: 'mock-commitment-a-a-late',
                updatedAt: '2026-04-01T10:01:00.000Z',
            },
            {
                receiptDid: 'did:test:receipt-0',
                attesterDid: 'did:test:attester-1',
                schemaDid: 'did:test:schema-a',
                requesterDid: 'did:test:requester-a',
                responseCommitment: 'mock-commitment-a-a-early',
                updatedAt: '2026-04-01T09:01:00.000Z',
            },
        ];

        try {
            for (const row of rows) {
                await seedDID(db, row.receiptDid, {
                    challengeReceipts: [row],
                });
            }

            expect((await db.listChallengeReceipts({
                attesterDid: 'did:test:attester-1',
                limit: 10,
                offset: 0,
            })).receipts.map(row => row.receiptDid)).toStrictEqual([
                'did:test:receipt-1',
                'did:test:receipt-2',
                'did:test:receipt-3',
                'did:test:receipt-0',
            ]);

            expect(await db.getChallengeReceiptUsage({
                attesterDid: 'did:test:attester-1',
                limit: 10,
                offset: 0,
            })).toStrictEqual({
                total: 3,
                usage: [
                    {
                        attesterDid: 'did:test:attester-1',
                        schemaDid: 'did:test:schema-a',
                        requesterDid: 'did:test:requester-a',
                        count: 2,
                        firstUpdatedAt: '2026-04-01T09:01:00.000Z',
                        lastUpdatedAt: '2026-04-01T10:01:00.000Z',
                    },
                    {
                        attesterDid: 'did:test:attester-1',
                        schemaDid: 'did:test:schema-b',
                        requesterDid: 'did:test:requester-a',
                        count: 1,
                        firstUpdatedAt: '2026-04-01T10:01:00.000Z',
                        lastUpdatedAt: '2026-04-01T10:01:00.000Z',
                    },
                    {
                        attesterDid: 'did:test:attester-1',
                        schemaDid: 'did:test:schema-b',
                        requesterDid: 'did:test:requester-b',
                        count: 1,
                        firstUpdatedAt: '2026-04-01T10:01:00.000Z',
                        lastUpdatedAt: '2026-04-01T10:01:00.000Z',
                    },
                ] satisfies ChallengeReceiptUsageRecord[],
            });
        }
        finally {
            await db.disconnect();
        }
    });
});

describe('sqlite challenge receipt adapter errors', () => {
    it('rejects challenge receipt calls when disconnected', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-server-receipts-'));
        const db = await Sqlite.create('receipts.db', tempDir);
        await db.disconnect();

        try {
            await expect(db.applyIndexPage({
                dids: [{
                    did: 'did:test:receipt-1',
                    events: [createAssetEvent('did:test:receipt-1', {})],
                    challengeReceipts: [],
                }],
                blocks: [],
            }))
                .rejects.toThrow('DB not connected');
            await expect(db.listChallengeReceipts())
                .rejects.toThrow('DB not connected');
            await expect(db.getChallengeReceiptUsage())
                .rejects.toThrow('DB not connected');
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('rolls back failed challenge receipt replacements', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-server-receipts-'));
        const db = await Sqlite.create('receipts.db', tempDir);
        const record: ChallengeReceiptRecord = {
            receiptDid: 'did:test:receipt-1',
            attesterDid: 'did:test:attester-1',
            schemaDid: 'did:test:schema-1',
            requesterDid: 'did:test:requester-1',
            responseCommitment: 'mock-commitment-1',
            updatedAt: '2026-04-01T10:01:00.000Z',
        };
        const sqliteDb = (db as any).db;
        const failure = new Error('mock insert failure');
        const runSpy = jest.spyOn(sqliteDb, 'run')
            .mockResolvedValueOnce(undefined as never)
            .mockResolvedValueOnce(undefined as never)
            .mockResolvedValueOnce(undefined as never)
            .mockResolvedValueOnce(undefined as never)
            .mockRejectedValueOnce(failure as never);

        try {
            await expect(seedDID(db, record.receiptDid, {
                challengeReceipts: [record],
            }))
                .rejects.toThrow('mock insert failure');
            runSpy.mockRestore();

            expect(await db.listChallengeReceipts({
                receiptDid: record.receiptDid,
                limit: 10,
                offset: 0,
            })).toStrictEqual({
                total: 0,
                receipts: [],
            });
        }
        finally {
            runSpy.mockRestore();
            await db.disconnect();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe('postgres challenge receipt adapter with mocked pool', () => {
    async function loadPostgresModule() {
        jest.resetModules();
        const module = await import('../../services/search-server/src/db/postgres.ts');
        return module.default;
    }

    it('creates receipt schema and supports replace, list, usage, and wipe queries', async () => {
        const record: ChallengeReceiptRecord = {
            receiptDid: 'did:test:receipt-1',
            attesterDid: 'did:test:attester-1',
            schemaDid: 'did:test:schema-1',
            requesterDid: 'did:test:requester-1',
            responseCommitment: 'mock-commitment-1',
            updatedAt: '2026-04-01T10:01:00.000Z',
        };
        const poolQuery = jest.fn(async (sql: string) => {
            const text = String(sql);

            if (text.includes('CREATE TABLE IF NOT EXISTS challenge_receipts')) {
                return { rowCount: 0, rows: [] };
            }
            if (text.includes('COUNT(*)::int AS total') && text.includes('GROUP BY attester_did')) {
                return { rowCount: 1, rows: [{ total: 1 }] };
            }
            if (text.includes('COUNT(*)::int AS total')) {
                return { rowCount: 1, rows: [{ total: 1 }] };
            }
            if (text.includes('receipt_did AS "receiptDid"')) {
                return { rowCount: 1, rows: [record] };
            }
            if (text.includes('attester_did AS "attesterDid"')) {
                return {
                    rowCount: 1,
                    rows: [{
                        attesterDid: record.attesterDid,
                        schemaDid: record.schemaDid,
                        requesterDid: record.requesterDid,
                        count: 1,
                        firstUpdatedAt: record.updatedAt,
                        lastUpdatedAt: record.updatedAt,
                    }],
                };
            }
            if (text === 'DELETE FROM did_docs' ||
                text === 'DELETE FROM published_credentials' ||
                text === 'DELETE FROM challenge_receipts') {
                return { rowCount: 1, rows: [] };
            }

            return { rowCount: 0, rows: [] };
        });
        const mockClient = {
            query: jest.fn().mockResolvedValue(undefined),
            release: jest.fn(),
        };
        const mockPool = {
            query: poolQuery,
            connect: jest.fn().mockResolvedValue(mockClient),
            end: jest.fn().mockResolvedValue(undefined),
        };
        const Postgres = await loadPostgresModule();

        class TestPostgres extends Postgres {
            protected createPool(): any {
                return mockPool;
            }
        }

        const db = new TestPostgres('postgresql://example');
        await db.connect();
        await db.applyIndexPage({
            dids: [{
                did: record.receiptDid,
                events: [createAssetEvent(record.receiptDid, {})],
                challengeReceipts: [record],
            }],
            blocks: [],
        });

        expect(await db.listChallengeReceipts({
            receiptDid: record.receiptDid,
            attesterDid: record.attesterDid,
            schemaDid: record.schemaDid,
            requesterDid: record.requesterDid,
            responseCommitment: record.responseCommitment,
            updatedAfter: '2026-04-01T00:00:00.000Z',
            updatedBefore: '2026-04-02T00:00:00.000Z',
            limit: 5,
            offset: 10,
        })).toStrictEqual({
            total: 1,
            receipts: [record],
        });

        expect(await db.getChallengeReceiptUsage({
            attesterDid: record.attesterDid,
            schemaDid: record.schemaDid,
            requesterDid: record.requesterDid,
            updatedAfter: '2026-04-01T00:00:00.000Z',
            updatedBefore: '2026-04-02T00:00:00.000Z',
            limit: 5,
            offset: 10,
        })).toStrictEqual({
            total: 1,
            usage: [{
                attesterDid: record.attesterDid,
                schemaDid: record.schemaDid,
                requesterDid: record.requesterDid,
                count: 1,
                firstUpdatedAt: record.updatedAt,
                lastUpdatedAt: record.updatedAt,
            }],
        });

        await db.wipeDb();
        await db.disconnect();

        expect(mockClient.query).toHaveBeenCalledWith(
            'DELETE FROM challenge_receipts WHERE receipt_did = $1',
            [record.receiptDid]
        );
        expect(mockClient.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO challenge_receipts'),
            [
                record.receiptDid,
                record.attesterDid,
                record.schemaDid,
                record.requesterDid,
                record.responseCommitment,
                record.updatedAt,
            ]
        );
        expect(poolQuery).toHaveBeenCalledWith('DELETE FROM challenge_receipts');
        expect(mockPool.end).toHaveBeenCalledTimes(1);
    });

    it('rolls back and releases the client when replacement fails', async () => {
        const record: ChallengeReceiptRecord = {
            receiptDid: 'did:test:receipt-1',
            attesterDid: 'did:test:attester-1',
            schemaDid: 'did:test:schema-1',
            requesterDid: 'did:test:requester-1',
            responseCommitment: 'mock-commitment-1',
            updatedAt: '2026-04-01T10:01:00.000Z',
        };
        const failure = new Error('mock insert failure');
        const mockClient = {
            query: jest.fn(async (sql: string) => {
                if (String(sql).includes('INSERT INTO challenge_receipts')) {
                    throw failure;
                }

                return { rowCount: 0, rows: [] };
            }),
            release: jest.fn(),
        };
        const mockPool = {
            query: jest.fn().mockResolvedValue({ rowCount: 0, rows: [] } as never),
            connect: jest.fn().mockResolvedValue(mockClient as never),
            end: jest.fn().mockResolvedValue(undefined as never),
        };
        const Postgres = await loadPostgresModule();

        class TestPostgres extends Postgres {
            protected createPool(): any {
                return mockPool;
            }
        }

        const db = new TestPostgres('postgresql://example');
        await db.connect();

        await expect(db.applyIndexPage({
            dids: [{
                did: record.receiptDid,
                events: [createAssetEvent(record.receiptDid, {})],
                challengeReceipts: [record],
            }],
            blocks: [],
        }))
            .rejects.toThrow('mock insert failure');
        await db.disconnect();

        expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        expect(mockClient.release).toHaveBeenCalledTimes(1);
        expect(mockPool.end).toHaveBeenCalledTimes(1);
    });
});

describe('DidIndexer challenge receipt indexing', () => {
    it('stores challenge receipt rows during refresh', async () => {
        const db = new DIDsDbMemory();
        const receiptDid = 'did:test:z3v8AuacbUAvrNRex7q3dm2HJU5hQSpSp7YEcaCUcX1vhCfk5EY';
        const data = {
            challengeReceipt: {
                version: 1,
                attesterDid: 'did:test:attester-1',
                schemaDid: 'did:test:schema-1',
                requesterDid: 'did:test:requester-1',
                verifiedAt: '2026-04-01T10:00:00.000Z',
                responseCommitment: 'mock-commitment-1',
            },
        };
        const gatekeeper = {
            isReady: jest.fn().mockResolvedValue(true),
            exportIndex: jest.fn().mockResolvedValue(createSnapshotResponse(receiptDid, data)),
            getDIDs: jest.fn(),
            resolveDID: jest.fn(),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await indexer.startIndexing();
        indexer.stopIndexing();

        expect(gatekeeper.getDIDs).not.toHaveBeenCalled();
        expect(gatekeeper.resolveDID).not.toHaveBeenCalled();
        expect(await db.listChallengeReceipts({
            attesterDid: 'did:test:attester-1',
            limit: 10,
            offset: 0,
        })).toStrictEqual({
            total: 1,
            receipts: [{
                receiptDid,
                attesterDid: 'did:test:attester-1',
                schemaDid: 'did:test:schema-1',
                requesterDid: 'did:test:requester-1',
                responseCommitment: 'mock-commitment-1',
                updatedAt: '2026-04-01T10:01:00Z',
            }],
        });
    });
});
