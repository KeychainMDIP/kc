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
} from '../../services/search-server/src/types.ts';

function createReceiptDoc(
    receiptDid: string,
    {
        attesterDid = 'did:test:attester-1',
        schemaDid = 'did:test:schema-1',
        requesterDid = 'did:test:requester-1',
        verifiedAt = '2026-04-01T10:00:00.000Z',
        responseCommitment = 'mock-commitment-1',
        updatedAt = '2026-04-01T10:01:00.000Z',
        challengeReceipt,
    }: {
        attesterDid?: string;
        schemaDid?: string;
        requesterDid?: string;
        verifiedAt?: string;
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
                verifiedAt,
                responseCommitment,
            },
        },
        didDocumentMetadata: {
            updated: updatedAt,
        },
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
                verifiedAt: '2026-04-01T10:00:00.000Z',
                responseCommitment: 'mock-commitment-1',
                updatedAt: '2026-04-01T10:01:00.000Z',
            },
        ]);
    });

    it('falls back to verifiedAt when DID metadata does not include an update timestamp', () => {
        const receiptDid = 'did:test:receipt-1';
        const doc = createReceiptDoc(receiptDid);
        delete (doc.didDocumentMetadata as { updated?: string }).updated;

        expect(extractChallengeReceipts(receiptDid, doc)[0].updatedAt).toBe('2026-04-01T10:00:00.000Z');
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
                verifiedAt: '2026-04-01T10:00:00.000Z',
                responseCommitment: 'mock-commitment-1',
            },
        }))).toStrictEqual([]);
        expect(extractChallengeReceipts(receiptDid, createReceiptDoc(receiptDid, {
            verifiedAt: 'not-a-date',
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
                    verifiedAt: '2026-04-01T10:00:00.000Z',
                    responseCommitment: 'mock-commitment-1',
                    updatedAt: '2026-04-01T10:01:00.000Z',
                },
                {
                    receiptDid: 'did:test:receipt-2',
                    attesterDid: 'did:test:attester-1',
                    schemaDid: 'did:test:schema-1',
                    requesterDid: 'did:test:requester-1',
                    verifiedAt: '2026-04-01T11:00:00.000Z',
                    responseCommitment: 'mock-commitment-2',
                    updatedAt: '2026-04-01T11:01:00.000Z',
                },
                {
                    receiptDid: 'did:test:receipt-3',
                    attesterDid: 'did:test:attester-1',
                    schemaDid: 'did:test:schema-2',
                    requesterDid: 'did:test:requester-2',
                    verifiedAt: '2026-04-02T10:00:00.000Z',
                    responseCommitment: 'mock-commitment-3',
                    updatedAt: '2026-04-02T10:01:00.000Z',
                },
                {
                    receiptDid: 'did:test:receipt-4',
                    attesterDid: 'did:test:attester-2',
                    schemaDid: 'did:test:schema-1',
                    requesterDid: 'did:test:requester-1',
                    verifiedAt: '2026-04-03T10:00:00.000Z',
                    responseCommitment: 'mock-commitment-4',
                    updatedAt: '2026-04-03T10:01:00.000Z',
                },
                {
                    receiptDid: 'did:test:receipt-5',
                    attesterDid: 'did:test:attester-1',
                    schemaDid: 'did:test:schema-1',
                    requesterDid: 'did:test:requester-1',
                    verifiedAt: '2026-04-01T12:00:00.000Z',
                    responseCommitment: 'mock-commitment-2',
                    updatedAt: '2026-04-01T12:01:00.000Z',
                },
            ];

            for (const row of rows) {
                await db.replaceChallengeReceipts(row.receiptDid, [row]);
            }

            expect(await db.listChallengeReceipts({
                attesterDid: 'did:test:attester-1',
                schemaDid: 'did:test:schema-1',
                requesterDid: 'did:test:requester-1',
                verifiedAfter: '2026-04-01T10:30:00.000Z',
                verifiedBefore: '2026-04-01T11:30:00.000Z',
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
                        firstVerifiedAt: '2026-04-01T10:00:00.000Z',
                        lastVerifiedAt: '2026-04-01T12:00:00.000Z',
                    },
                    {
                        attesterDid: 'did:test:attester-1',
                        schemaDid: 'did:test:schema-2',
                        requesterDid: 'did:test:requester-2',
                        count: 1,
                        firstVerifiedAt: '2026-04-02T10:00:00.000Z',
                        lastVerifiedAt: '2026-04-02T10:00:00.000Z',
                    },
                ] satisfies ChallengeReceiptUsageRecord[],
            });

            await db.replaceChallengeReceipts('did:test:receipt-2', []);
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
            verifiedAt: '2026-04-01T10:00:00.000Z',
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
                        firstVerifiedAt: record.verifiedAt,
                        lastVerifiedAt: record.verifiedAt,
                    }],
                };
            }
            if (text === 'DELETE FROM did_docs' ||
                text === 'DELETE FROM published_credentials' ||
                text === 'DELETE FROM challenge_receipts' ||
                text === 'DELETE FROM config') {
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
        await db.replaceChallengeReceipts(record.receiptDid, [record]);

        expect(await db.listChallengeReceipts({
            receiptDid: record.receiptDid,
            attesterDid: record.attesterDid,
            schemaDid: record.schemaDid,
            requesterDid: record.requesterDid,
            responseCommitment: record.responseCommitment,
            verifiedAfter: '2026-04-01T00:00:00.000Z',
            verifiedBefore: '2026-04-02T00:00:00.000Z',
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
            verifiedAfter: '2026-04-01T00:00:00.000Z',
            verifiedBefore: '2026-04-02T00:00:00.000Z',
            limit: 5,
            offset: 10,
        })).toStrictEqual({
            total: 1,
            usage: [{
                attesterDid: record.attesterDid,
                schemaDid: record.schemaDid,
                requesterDid: record.requesterDid,
                count: 1,
                firstVerifiedAt: record.verifiedAt,
                lastVerifiedAt: record.verifiedAt,
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
                record.verifiedAt,
                record.responseCommitment,
                record.updatedAt,
            ]
        );
        expect(poolQuery).toHaveBeenCalledWith('DELETE FROM challenge_receipts');
        expect(mockPool.end).toHaveBeenCalledTimes(1);
    });
});

describe('DidIndexer challenge receipt indexing', () => {
    it('stores challenge receipt rows during refresh', async () => {
        const db = new DIDsDbMemory();
        const receiptDid = 'did:test:receipt-1';
        const doc = createReceiptDoc(receiptDid);
        const gatekeeper = {
            isReady: jest.fn().mockResolvedValue(true),
            getDIDs: jest.fn().mockResolvedValue([receiptDid]),
            resolveDID: jest.fn().mockResolvedValue(doc),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await indexer.startIndexing();
        indexer.stopIndexing();

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
                verifiedAt: '2026-04-01T10:00:00.000Z',
                responseCommitment: 'mock-commitment-1',
                updatedAt: '2026-04-01T10:01:00.000Z',
            }],
        });
    });
});
