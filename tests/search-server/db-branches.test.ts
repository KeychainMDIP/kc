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
        await db.saveSyncState('stale-cursor', 'old');
        await db.applyIndexPage({
            dids: [],
            blocks: [],
            syncStateUpdates: {
                'stale-cursor': null,
                'next-cursor': '43',
            },
        });
        expect(await db.loadSyncState('stale-cursor')).toBeNull();
        expect(await db.loadSyncState('next-cursor')).toBe('43');

        await seedDID(db, eventDid, { events: [didEventA] });
        expect(await db.getDIDEvents(eventDid)).toStrictEqual([didEventA]);
        const unchanged = await db.applyIndexPage({
            dids: [{ did: eventDid, events: [didEventA] }],
            blocks: [],
        });
        expect(unchanged.changedDids).toStrictEqual([]);
        await seedDID(db, eventDid, { events: [didEventA, didEventB] });
        expect(await db.getDIDEvents(eventDid)).toStrictEqual([didEventA, didEventB]);
        expect(await db.listEvents()).toStrictEqual({
            total: 2,
            events: [
                {
                    did: eventDid,
                    registry: 'local',
                    time: didEventB.time,
                    event: didEventB,
                },
                {
                    did: eventDid,
                    registry: 'local',
                    time: didEventA.time,
                    event: didEventA,
                },
            ],
        });
        expect(await db.listEvents({
            registry: 'local',
            updatedAfter: didEventA.time,
            updatedBefore: '2026-04-01T12:00:00.000Z',
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

        const signedEventDid = 'did:test:signed-event-storage';
        const envelopeTime = '2026-05-27T11:24:00.000Z';
        const signedEventA: GatekeeperEvent = {
            ...didEventA,
            did: signedEventDid,
            time: envelopeTime,
            operation: {
                ...didEventA.operation,
                signature: {
                    signed: '2026-05-01T10:00:00.000Z',
                    hash: 'signed-event-a',
                    value: 'mock-signature-a',
                },
            },
        };
        const signedEventB: GatekeeperEvent = {
            ...didEventB,
            did: signedEventDid,
            time: envelopeTime,
            operation: {
                ...didEventB.operation,
                signature: {
                    signed: '2026-05-02T10:00:00.000Z',
                    hash: 'signed-event-b',
                    value: 'mock-signature-b',
                },
            },
        };

        await seedDID(db, signedEventDid, { events: [signedEventA, signedEventB] });
        expect(await db.listEvents({
            updatedAfter: '2026-05-01T00:00:00.000Z',
            updatedBefore: '2026-05-03T00:00:00.000Z',
        })).toStrictEqual({
            total: 2,
            events: [
                {
                    did: signedEventDid,
                    registry: 'local',
                    time: signedEventB.operation.signature!.signed,
                    event: signedEventB,
                },
                {
                    did: signedEventDid,
                    registry: 'local',
                    time: signedEventA.operation.signature!.signed,
                    event: signedEventA,
                },
            ],
        });

        await seedBlock(db, 'TFTC', blockA);
        await seedBlock(db, 'TFTC', blockB);
        expect(await db.getBlock('TFTC')).toStrictEqual(blockB);
        expect(await db.getBlock('TFTC', 100)).toStrictEqual(blockA);
        expect(await db.getBlock('TFTC', 'block-b')).toStrictEqual(blockB);
        expect(await db.getBlock('TFTC', 'missing')).toBeNull();
        expect(await db.applyIndexPage({
            dids: [],
            blocks: [{ registry: 'TFTC', block: { ...blockA, hash: 'missing' }, removed: true }],
        })).toMatchObject({
            removedBlocks: 0,
        });
        expect(await db.applyIndexPage({
            dids: [],
            blocks: [{ registry: 'TFTC', block: blockA, removed: true }],
        })).toMatchObject({
            removedBlocks: 1,
        });
        expect(await db.getBlock('TFTC', 100)).toBeNull();
        expect(await db.applyIndexPage({
            dids: [],
            blocks: [{ registry: 'TFTC', block: blockB, removed: true }],
        })).toMatchObject({
            removedBlocks: 1,
        });
        expect(await db.getBlock('TFTC')).toBeNull();

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
                firstUpdatedAt: challengeReceipt.updatedAt,
                lastUpdatedAt: challengeReceipt.updatedAt,
            }]);

            expect(await db.queryDocs({ 'didDocumentData.notArray[*]': { $in: ['value'] } })).toStrictEqual([]);
            expect(await db.queryDocs({ 'didDocumentData.notArray[*].kind': { $in: ['value'] } })).toStrictEqual([]);
            expect(await db.queryDocs({ 'didDocumentData.notObject.*': { $in: ['value'] } })).toStrictEqual([]);
            expect(await db.queryDocs({ 'didDocumentData.notObject.*.kind': { $in: ['value'] } })).toStrictEqual([]);
            expect(await db.applyIndexPage({
                dids: [],
                blocks: [{ registry: 'missing', block: { ...blockA, hash: 'missing' }, removed: true }],
            })).toMatchObject({
                removedBlocks: 0,
            });

            const tieDidA = 'did:test:event-tie-a';
            const tieDidB = 'did:test:event-tie-b';
            const tieEventA = { ...didEventA, did: tieDidA };
            const tieEventB = { ...didEventA, did: tieDidB };

            await seedDID(db, tieDidB, { events: [tieEventB] });
            await seedDID(db, tieDidA, { events: [tieEventA] });

            expect((await db.listEvents({
                updatedAfter: '2026-04-01T09:00:00.000Z',
                updatedBefore: '2026-04-01T10:30:00.000Z',
                limit: 2,
            })).events.map(record => record.did)).toStrictEqual([
                tieDidA,
                tieDidB,
            ]);
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
            await defaultDb.connect();
            await defaultDb.disconnect();
            const disconnected = new Sqlite();
            await expect(disconnected.getDIDEvents(eventDid)).rejects.toThrow('DB not connected');
            await expect(disconnected.getBlock('TFTC')).rejects.toThrow('DB not connected');
            await expect(disconnected.listEvents()).rejects.toThrow('DB not connected');
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
                expect(await db.listEvents()).toStrictEqual({ total: 0, events: [] });
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

    it('stores raw events, blocks, sync state, and event filters in postgres', async () => {
        jest.resetModules();
        const Postgres = (await import('../../services/search-server/src/db/postgres.ts')).default;
        const events = new Map<string, GatekeeperEvent[]>();
        const docs = new Map<string, object>();
        const blocks = new Map<string, BlockInfo>();
        const syncState = new Map<string, string>();
        const publishedCredentials = new Map<string, PublishedCredentialRecord[]>();
        const challengeReceipts = new Map<string, ChallengeReceiptRecord[]>();

        function blockKey(registry: string, hash: string): string {
            return `${registry}\u0000${hash}`;
        }

        function filterEvents(params: unknown[], sql: string) {
            const rows = Array.from(events.entries())
                .flatMap(([did, didEvents]) => didEvents.map((event, eventIndex) => ({
                    did,
                    eventIndex,
                    registry: event.registry,
                    time: event.time,
                    event,
                })));

            return rows
                .filter(row => {
                    let paramIndex = 0;

                    if (sql.includes('registry =')) {
                        if (row.registry !== params[paramIndex++]) {
                            return false;
                        }
                    }
                    if (sql.includes('time >')) {
                        if (row.time <= String(params[paramIndex++])) {
                            return false;
                        }
                    }
                    if (sql.includes('time <')) {
                        if (row.time >= String(params[paramIndex++])) {
                            return false;
                        }
                    }
                    return true;
                })
                .sort((a, b) => b.time.localeCompare(a.time) || a.did.localeCompare(b.did) || a.eventIndex - b.eventIndex);
        }

        const query = jest.fn(async (sql: string, params: unknown[] = []) => {
            const text = String(sql);

            if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX') ||
                text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
                return { rowCount: 0, rows: [] };
            }

            if (text.includes('SELECT value FROM sync_state')) {
                const value = syncState.get(String(params[0]));
                return value ? { rowCount: 1, rows: [{ value }] } : { rowCount: 0, rows: [] };
            }

            if (text.includes('DELETE FROM sync_state')) {
                const deleted = syncState.delete(String(params[0]));
                return { rowCount: deleted ? 1 : 0, rows: [] };
            }

            if (text.includes('INSERT INTO sync_state')) {
                syncState.set(String(params[0]), String(params[1]));
                return { rowCount: 1, rows: [] };
            }

            if (text.includes('SELECT event FROM did_events')) {
                if (String(params[0]) === 'did:test:object-event') {
                    return {
                        rowCount: 1,
                        rows: [{ event: didEventA }],
                    };
                }

                return {
                    rowCount: events.get(String(params[0]))?.length ?? 0,
                    rows: (events.get(String(params[0])) ?? [])
                        .map(event => ({ event: JSON.stringify(event) })),
                };
            }

            if (text.includes('SELECT block FROM blocks') && text.includes('ORDER BY height DESC')) {
                const registry = String(params[0]);
                const block = Array.from(blocks.entries())
                    .filter(([key]) => key.startsWith(`${registry}\u0000`))
                    .map(([, value]) => value)
                    .sort((a, b) => b.height - a.height)[0];
                return block
                    ? { rowCount: 1, rows: [{ block: JSON.stringify(block) }] }
                    : { rowCount: 0, rows: [] };
            }

            if (text.includes('SELECT block FROM blocks') && text.includes('height =')) {
                const registry = String(params[0]);
                const height = Number(params[1]);
                const block = Array.from(blocks.entries())
                    .filter(([key]) => key.startsWith(`${registry}\u0000`))
                    .map(([, value]) => value)
                    .find(value => value.height === height);
                return block ? { rowCount: 1, rows: [{ block }] } : { rowCount: 0, rows: [] };
            }

            if (text.includes('SELECT block FROM blocks') && text.includes('hash =')) {
                const block = blocks.get(blockKey(String(params[0]), String(params[1])));
                return block ? { rowCount: 1, rows: [{ block }] } : { rowCount: 0, rows: [] };
            }

            if (text.includes('DELETE FROM blocks')) {
                const deleted = blocks.delete(blockKey(String(params[0]), String(params[1])));
                return { rowCount: deleted ? 1 : 0, rows: [] };
            }

            if (text.includes('INSERT INTO blocks')) {
                const block = JSON.parse(String(params[4])) as BlockInfo;
                blocks.set(blockKey(String(params[0]), String(params[1])), block);
                return { rowCount: 1, rows: [] };
            }

            if (text.includes('DELETE FROM did_events')) {
                const deleted = events.delete(String(params[0]));
                return { rowCount: deleted ? 1 : 0, rows: [] };
            }

            if (text.includes('INSERT INTO did_events')) {
                const did = String(params[0]);
                const eventIndex = Number(params[1]);
                const event = JSON.parse(String(params[4])) as GatekeeperEvent;
                const didEvents = events.get(did) ?? [];
                didEvents[eventIndex] = event;
                events.set(did, didEvents);
                return { rowCount: 1, rows: [] };
            }

            if (text.includes('DELETE FROM did_docs')) {
                const deleted = docs.delete(String(params[0]));
                return { rowCount: deleted ? 1 : 0, rows: [] };
            }

            if (text.includes('INSERT INTO did_docs')) {
                docs.set(String(params[0]), JSON.parse(String(params[1])) as object);
                return { rowCount: 1, rows: [] };
            }

            if (text.includes('DELETE FROM published_credentials')) {
                const deleted = publishedCredentials.delete(String(params[0]));
                return { rowCount: deleted ? 1 : 0, rows: [] };
            }

            if (text.includes('INSERT INTO published_credentials')) {
                const holderDid = String(params[0]);
                publishedCredentials.set(holderDid, [{
                    holderDid,
                    credentialDid: String(params[1]),
                    schemaDid: String(params[2]),
                    issuerDid: String(params[3]),
                    subjectDid: String(params[4]),
                    revealed: Boolean(params[5]),
                    updatedAt: String(params[6]),
                }]);
                return { rowCount: 1, rows: [] };
            }

            if (text.includes('DELETE FROM challenge_receipts')) {
                const deleted = challengeReceipts.delete(String(params[0]));
                return { rowCount: deleted ? 1 : 0, rows: [] };
            }

            if (text.includes('INSERT INTO challenge_receipts')) {
                const receiptDid = String(params[0]);
                challengeReceipts.set(receiptDid, [{
                    receiptDid,
                    attesterDid: String(params[1]),
                    schemaDid: String(params[2]),
                    requesterDid: String(params[3]),
                    responseCommitment: String(params[4]),
                    updatedAt: String(params[5]),
                }]);
                return { rowCount: 1, rows: [] };
            }

            if (text.includes('SELECT COUNT(*)::int AS total FROM did_events')) {
                if (params.length === 0) {
                    return { rowCount: 0, rows: [] };
                }

                return { rowCount: 1, rows: [{ total: filterEvents(params, text).length }] };
            }

            if (text.includes('SELECT did, registry, time, event')) {
                const limit = Number(params[params.length - 2]);
                const offset = Number(params[params.length - 1]);
                return {
                    rowCount: 1,
                    rows: filterEvents(params.slice(0, -2), text)
                        .slice(offset, offset + limit)
                        .map(row => ({
                            did: row.did,
                            registry: row.registry,
                            time: row.time,
                            event: params.length === 2 ? row.event : JSON.stringify(row.event),
                        })),
                };
            }

            throw new Error(`Unexpected postgres query: ${text}`);
        });
        const mockPool = {
            query,
            connect: jest.fn(async () => ({
                query,
                release: jest.fn(),
            })),
            end: jest.fn().mockResolvedValue(undefined as never),
        };

        class TestPostgres extends Postgres {
            protected createPool(): any {
                return mockPool;
            }
        }

        const db = new TestPostgres('postgresql://example');
        await db.connect();

        expect(await db.loadSyncState('missing')).toBeNull();
        await db.saveSyncState('cursor', '42');
        expect(await db.loadSyncState('cursor')).toBe('42');
        await db.saveSyncState('cursor', null);
        expect(await db.loadSyncState('cursor')).toBeNull();

        const stored = await db.applyIndexPage({
            dids: [{
                did: eventDid,
                events: [didEventA, didEventB],
                doc: { didDocument: { id: eventDid } },
                publishedCredentials: [{ ...publishedCredentialA, holderDid: eventDid }],
                challengeReceipts: [{ ...challengeReceipt, receiptDid: eventDid }],
            }],
            blocks: [{ registry: 'TFTC', block: blockA }],
            syncStateUpdates: {
                old: null,
                next: '43',
            },
        });

        expect(stored).toMatchObject({
            changedDids: [eventDid],
            storedBlocks: 1,
        });
        expect(await db.getDIDEvents(eventDid)).toStrictEqual([didEventA, didEventB]);
        expect(await db.getDIDEvents('did:test:object-event')).toStrictEqual([didEventA]);
        expect(await db.getBlock('TFTC')).toStrictEqual(blockA);
        expect(await db.getBlock('TFTC', 100)).toStrictEqual(blockA);
        expect(await db.getBlock('TFTC', 'block-a')).toStrictEqual(blockA);
        expect(await db.getBlock('TFTC', 'missing')).toBeNull();
        expect(await db.loadSyncState('next')).toBe('43');
        expect(await db.listEvents()).toStrictEqual({
            total: 0,
            events: [
                {
                    did: eventDid,
                    registry: 'local',
                    time: didEventB.time,
                    event: didEventB,
                },
                {
                    did: eventDid,
                    registry: 'local',
                    time: didEventA.time,
                    event: didEventA,
                },
            ],
        });

        expect(await db.listEvents({
            registry: 'local',
            updatedAfter: didEventA.time,
            updatedBefore: '2026-04-01T12:00:00.000Z',
            limit: 1,
            offset: 0,
        })).toStrictEqual({
            total: 1,
            events: [{
                did: eventDid,
                registry: 'local',
                time: didEventB.time,
                event: didEventB,
            }],
        });

        expect(await db.applyIndexPage({
            dids: [{ did: eventDid, events: [didEventA, didEventB] }],
            blocks: [],
        })).toMatchObject({
            changedDids: [],
        });

        expect(await db.applyIndexPage({
            dids: [],
            blocks: [{ registry: 'TFTC', block: { ...blockA, hash: 'missing' }, removed: true }],
        })).toMatchObject({
            removedBlocks: 0,
        });

        expect(await db.applyIndexPage({
            dids: [],
            blocks: [{ registry: 'TFTC', block: blockA, removed: true }],
        })).toMatchObject({
            removedBlocks: 1,
        });
        expect(await db.getBlock('TFTC')).toBeNull();

        expect(await db.applyIndexPage({
            dids: [{ did: eventDid, events: [], removed: true }],
            blocks: [],
        })).toMatchObject({
            changedDids: [eventDid],
            removedDids: 1,
        });
        expect(await db.getDIDEvents(eventDid)).toStrictEqual([]);

        await db.disconnect();
        expect(mockPool.end).toHaveBeenCalledTimes(1);
    });
});
