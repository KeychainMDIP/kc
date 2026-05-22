import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import { setLogger } from '../../packages/common/src/logger.ts';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import Sqlite from '../../services/search-server/src/db/sqlite.ts';
import type {
    BlockInfo,
    ChallengeReceiptRecord,
    GatekeeperEvent,
    PublishedCredentialRecord,
} from '../../services/search-server/src/types.ts';
import { seedBlock, seedDID } from './db-seed.ts';

const publishedCredentialA: PublishedCredentialRecord = {
    holderDid: 'did:test:holder-1',
    credentialDid: 'did:test:credential-1',
    schemaDid: 'did:test:schema-a',
    issuerDid: 'did:test:issuer-1',
    subjectDid: 'did:test:subject-1',
    revealed: true,
    updatedAt: '2026-04-01T10:00:00.000Z',
};

const publishedCredentialB: PublishedCredentialRecord = {
    holderDid: 'did:test:holder-2',
    credentialDid: 'did:test:credential-2',
    schemaDid: 'did:test:schema-b',
    issuerDid: 'did:test:issuer-2',
    subjectDid: 'did:test:subject-2',
    revealed: false,
    updatedAt: '2026-04-01T11:00:00.000Z',
};

const challengeReceipt: ChallengeReceiptRecord = {
    receiptDid: 'did:test:receipt-1',
    attesterDid: 'did:test:attester-1',
    schemaDid: 'did:test:schema-1',
    requesterDid: 'did:test:requester-1',
    verifiedAt: '2026-04-01T10:00:00.000Z',
    responseCommitment: 'mock-commitment-1',
    updatedAt: '2026-04-01T10:01:00.000Z',
};

const eventDid = 'did:test:event-storage';
const didEventA: GatekeeperEvent = {
    registry: 'local',
    time: '2026-04-01T10:00:00.000Z',
    ordinal: [0],
    did: eventDid,
    operation: {
        type: 'create',
        created: '2026-04-01T10:00:00.000Z',
        mdip: {
            version: 1,
            type: 'agent',
            registry: 'local',
        },
        publicJwk: {
            kty: 'EC',
            crv: 'secp256k1',
            x: 'mock-x',
            y: 'mock-y',
        },
    },
};
const didEventB: GatekeeperEvent = {
    ...didEventA,
    time: '2026-04-01T11:00:00.000Z',
    operation: {
        type: 'update',
        did: eventDid,
        doc: {
            didDocument: { id: eventDid },
            didDocumentData: { name: 'updated' },
        },
    },
};
const blockA: BlockInfo = {
    height: 100,
    hash: 'block-a',
    time: 1775037600,
};
const blockB: BlockInfo = {
    height: 101,
    hash: 'block-b',
    time: 1775041200,
};

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

describe('search DB branch behavior', () => {
    async function exerciseSyncStorage(db: DIDsDbMemory | Sqlite): Promise<void> {
        expect(await db.loadSyncState('cursor')).toBeNull();
        await db.saveSyncState('cursor', '42');
        expect(await db.loadSyncState('cursor')).toBe('42');
        await db.saveSyncState('index.changes.cursor', '2026-04-01T12:00:00.000Z');
        expect(await db.loadSyncState('index.changes.cursor')).toBe('2026-04-01T12:00:00.000Z');
        await db.saveSyncState('cursor', null);
        expect(await db.loadSyncState('cursor')).toBeNull();

        await seedDID(db, eventDid, { events: [didEventA] });
        expect(await db.getDIDEvents(eventDid)).toStrictEqual([didEventA]);
        const unchanged = await db.applyIndexPage({
            dids: [{ did: eventDid, events: [didEventA] }],
            blocks: [],
        });
        expect(unchanged.changedDids).toStrictEqual([]);
        await seedDID(db, eventDid, { events: [didEventA, didEventB] });
        expect(await db.getDIDEvents(eventDid)).toStrictEqual([didEventA, didEventB]);
        expect(await db.listEvents({
            registry: 'local',
            updatedAfter: didEventA.time,
            limit: 1,
            offset: 0,
        })).toStrictEqual({
            total: 1,
            events: [{
                did: eventDid,
                registry: didEventB.registry,
                time: didEventB.time,
                event: didEventB,
            }],
        });

        await seedBlock(db, 'TFTC', blockA);
        await seedBlock(db, 'TFTC', blockB);
        expect(await db.getBlock('TFTC')).toStrictEqual(blockB);
        expect(await db.getBlock('TFTC', 100)).toStrictEqual(blockA);
        expect(await db.getBlock('TFTC', 'block-b')).toStrictEqual(blockB);
        expect(await db.getBlock('TFTC', 'missing')).toBeNull();

        await seedDID(db, eventDid, {
            doc: { didDocument: { id: eventDid } },
            publishedCredentials: [{ ...publishedCredentialA, holderDid: eventDid }],
            challengeReceipts: [{ ...challengeReceipt, receiptDid: eventDid }],
        });
        await seedDID(db, eventDid, { removed: true });

        expect(await db.getDID(eventDid)).toBeNull();
        expect(await db.getDIDEvents(eventDid)).toStrictEqual([]);
        expect(await db.listPublishedCredentials({ subjectDid: publishedCredentialA.subjectDid })).toStrictEqual({
            total: 0,
            credentials: [],
        });
        expect(await db.listChallengeReceipts({ receiptDid: eventDid })).toStrictEqual({
            total: 0,
            receipts: [],
        });
    }

    it('stores sync state, raw events, blocks, and clears projections in memory', async () => {
        const db = new DIDsDbMemory();
        await db.connect();

        try {
            await exerciseSyncStorage(db);
        }
        finally {
            await db.disconnect();
        }
    });

    it('stores sync state, raw events, blocks, and clears projections in sqlite', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-server-sync-storage-'));
        const db = await Sqlite.create('sync-storage.db', tempDir);

        try {
            await exerciseSyncStorage(db as Sqlite);
        }
        finally {
            await db.disconnect();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('exercises memory defaults, tie breakers, and non-matching wildcard queries', async () => {
        const db = new DIDsDbMemory();
        await db.connect();

        try {
            await seedDID(db, publishedCredentialA.holderDid, { publishedCredentials: [publishedCredentialA] });
            await seedDID(db, publishedCredentialB.holderDid, { publishedCredentials: [publishedCredentialB] });
            await seedDID(db, challengeReceipt.receiptDid, { challengeReceipts: [challengeReceipt] });
            await seedDID(db, 'did:test:wildcards', { doc: {
                didDocument: { id: 'did:test:wildcards' },
                didDocumentData: {
                    notArray: 'value',
                    notObject: ['value'],
                },
            } });

            expect(await db.getPublishedCredentialCountsBySchema()).toStrictEqual([
                { schemaDid: publishedCredentialA.schemaDid, count: 1 },
                { schemaDid: publishedCredentialB.schemaDid, count: 1 },
            ]);
            expect((await db.listPublishedCredentials()).total).toBe(2);
            expect((await db.listPublishedCredentials({
                issuerDid: publishedCredentialA.issuerDid,
                subjectDid: publishedCredentialA.subjectDid,
            })).credentials).toStrictEqual([publishedCredentialA]);
            expect((await db.listChallengeReceipts()).receipts).toStrictEqual([challengeReceipt]);
            expect((await db.getChallengeReceiptUsage()).usage).toStrictEqual([{
                attesterDid: challengeReceipt.attesterDid,
                schemaDid: challengeReceipt.schemaDid,
                requesterDid: challengeReceipt.requesterDid,
                count: 1,
                firstVerifiedAt: challengeReceipt.verifiedAt,
                lastVerifiedAt: challengeReceipt.verifiedAt,
            }]);

            expect(await db.queryDocs({ 'didDocumentData.notArray[*]': { $in: ['value'] } })).toStrictEqual([]);
            expect(await db.queryDocs({ 'didDocumentData.notArray[*].kind': { $in: ['value'] } })).toStrictEqual([]);
            expect(await db.queryDocs({ 'didDocumentData.notObject.*': { $in: ['value'] } })).toStrictEqual([]);
            expect(await db.queryDocs({ 'didDocumentData.notObject.*.kind': { $in: ['value'] } })).toStrictEqual([]);
        }
        finally {
            await db.disconnect();
        }
    });

    it('exercises sqlite defaults, fallbacks, and path normalization', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-server-db-branches-'));
        const originalCwd = process.cwd();

        try {
            fs.mkdirSync(path.join(tempDir, 'data'));
            process.chdir(tempDir);
            const defaultDb = await Sqlite.create();
            await defaultDb.disconnect();
            new Sqlite();
        }
        finally {
            process.chdir(originalCwd);
        }

        const db = await Sqlite.create('branches.db', tempDir);

        try {
            await seedDID(db, publishedCredentialA.holderDid, { publishedCredentials: [publishedCredentialA] });
            await seedDID(db, publishedCredentialB.holderDid, { publishedCredentials: [publishedCredentialB] });
            await seedDID(db, challengeReceipt.receiptDid, { challengeReceipts: [challengeReceipt] });
            await seedDID(db, 'did:test:path', { doc: {
                didDocument: { id: 'did:test:path' },
            } });

            expect((await db.listPublishedCredentials()).total).toBe(2);
            expect((await db.listPublishedCredentials({ revealed: true })).credentials).toStrictEqual([publishedCredentialA]);
            expect((await db.listPublishedCredentials({ revealed: false })).credentials).toStrictEqual([publishedCredentialB]);
            expect((await db.listChallengeReceipts()).receipts).toStrictEqual([challengeReceipt]);
            expect((await db.getChallengeReceiptUsage()).usage).toStrictEqual([{
                attesterDid: challengeReceipt.attesterDid,
                schemaDid: challengeReceipt.schemaDid,
                requesterDid: challengeReceipt.requesterDid,
                count: 1,
                firstVerifiedAt: challengeReceipt.verifiedAt,
                lastVerifiedAt: challengeReceipt.verifiedAt,
            }]);
            expect(await db.queryDocs({ 'didDocument.id': { $in: ['did:test:path'] } })).toStrictEqual(['did:test:path']);
            await expect(db.queryDocs({ '$didDocument.id': { $in: ['did:test:path'] } }))
                .rejects.toThrow('JSON path error');

            const sqliteDb = (db as any).db;
            const getSpy = jest.spyOn(sqliteDb, 'get').mockResolvedValue(undefined as never);
            const allSpy = jest.spyOn(sqliteDb, 'all').mockResolvedValue([] as never);

            try {
                expect(await db.listPublishedCredentials()).toStrictEqual({ total: 0, credentials: [] });
                expect(await db.listChallengeReceipts()).toStrictEqual({ total: 0, receipts: [] });
                expect(await db.getChallengeReceiptUsage()).toStrictEqual({ total: 0, usage: [] });
            }
            finally {
                getSpy.mockRestore();
                allSpy.mockRestore();
            }
        }
        finally {
            await db.disconnect();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('exercises postgres challenge receipt defaults and empty totals', async () => {
        jest.resetModules();
        const Postgres = (await import('../../services/search-server/src/db/postgres.ts')).default;
        const poolQuery = jest.fn(async (sql: string) => {
            const text = String(sql);

            if (text.includes('COUNT(*)::int AS total') ||
                text.includes('receipt_did AS "receiptDid"') ||
                text.includes('attester_did AS "attesterDid"')) {
                return { rowCount: 0, rows: [] };
            }

            return { rowCount: 0, rows: [] };
        });
        const mockPool = {
            query: poolQuery,
            connect: jest.fn(),
            end: jest.fn().mockResolvedValue(undefined as never),
        };

        class TestPostgres extends Postgres {
            protected createPool(): any {
                return mockPool;
            }
        }

        const db = new TestPostgres('postgresql://example');
        await db.connect();

        expect(await db.listChallengeReceipts()).toStrictEqual({ total: 0, receipts: [] });
        expect(await db.getChallengeReceiptUsage()).toStrictEqual({ total: 0, usage: [] });

        await db.disconnect();
        expect(mockPool.end).toHaveBeenCalledTimes(1);
    });
});
