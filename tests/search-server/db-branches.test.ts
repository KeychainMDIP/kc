import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import { setLogger } from '../../packages/common/src/logger.ts';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import Sqlite from '../../services/search-server/src/db/sqlite.ts';
import type {
    ChallengeReceiptRecord,
    PublishedCredentialRecord,
} from '../../services/search-server/src/types.ts';

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
    responseCommitment: 'mock-commitment-1',
    updatedAt: '2026-04-01T10:01:00.000Z',
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
    it('exercises memory defaults, tie breakers, and non-matching wildcard queries', async () => {
        const db = new DIDsDbMemory();
        await db.connect();

        try {
            await db.replacePublishedCredentials(publishedCredentialA.holderDid, [publishedCredentialA]);
            await db.replacePublishedCredentials(publishedCredentialB.holderDid, [publishedCredentialB]);
            await db.replaceChallengeReceipts(challengeReceipt.receiptDid, [challengeReceipt]);
            await db.storeDID('did:test:wildcards', {
                didDocument: { id: 'did:test:wildcards' },
                didDocumentData: {
                    notArray: 'value',
                    notObject: ['value'],
                },
            });

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
                firstUpdatedAt: challengeReceipt.updatedAt,
                lastUpdatedAt: challengeReceipt.updatedAt,
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
            await db.replacePublishedCredentials(publishedCredentialA.holderDid, [publishedCredentialA]);
            await db.replacePublishedCredentials(publishedCredentialB.holderDid, [publishedCredentialB]);
            await db.replaceChallengeReceipts(challengeReceipt.receiptDid, [challengeReceipt]);
            await db.storeDID('did:test:path', {
                didDocument: { id: 'did:test:path' },
            });

            expect((await db.listPublishedCredentials()).total).toBe(2);
            expect((await db.listPublishedCredentials({ revealed: true })).credentials).toStrictEqual([publishedCredentialA]);
            expect((await db.listPublishedCredentials({ revealed: false })).credentials).toStrictEqual([publishedCredentialB]);
            expect((await db.listChallengeReceipts()).receipts).toStrictEqual([challengeReceipt]);
            expect((await db.getChallengeReceiptUsage()).usage).toStrictEqual([{
                attesterDid: challengeReceipt.attesterDid,
                schemaDid: challengeReceipt.schemaDid,
                requesterDid: challengeReceipt.requesterDid,
                count: 1,
                firstUpdatedAt: challengeReceipt.updatedAt,
                lastUpdatedAt: challengeReceipt.updatedAt,
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
