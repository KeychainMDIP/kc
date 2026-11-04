import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import Postgres from '../../services/search-server/src/db/postgres.ts';
import type { DIDProjectionUpdate } from '../../services/search-server/src/types.ts';
import { createSeedEvent, seedDID } from './db-seed.ts';

const postgresUrl = process.env.KC_SEARCH_TEST_POSTGRES_URL;
const describePostgres = postgresUrl ? describe : describe.skip;

describePostgres('PostgreSQL stored document search', () => {
    let schema: string;
    let admin: Pool;
    let inspection: Pool;
    let db: Postgres;
    let createDatabase: () => Postgres;

    beforeEach(async () => {
        schema = `search_test_${randomUUID().replaceAll('-', '')}`;
        admin = new Pool({ connectionString: postgresUrl });
        const options = { connectionString: postgresUrl, options: `-c search_path=${schema},public` };
        inspection = new Pool(options);
        class TestPostgres extends Postgres {
            protected createPool(): Pool {
                return new Pool(options);
            }
        }
        createDatabase = () => new TestPostgres(postgresUrl!);
        db = createDatabase();
        await admin.query('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');
        // eslint-disable-next-line sonarjs/sql-queries -- schema is a fixed prefix plus a generated hex UUID.
        await admin.query(`CREATE SCHEMA ${schema}`);
        await db.connect();
    });

    afterEach(async () => {
        await db.disconnect();
        await inspection.end();
        // eslint-disable-next-line sonarjs/sql-queries -- schema is a fixed prefix plus a generated hex UUID.
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
    });

    it('generates searchable text on writes and preserves scoped literal search and pagination', async () => {
        const alpha = 'did:mdip:alpha';
        const beta = 'did:mdip:beta';
        const otherNetwork = 'did:test:gamma';

        async function store(did: string, label: string): Promise<void> {
            const event = createSeedEvent(did);
            event.operation.mdip!.type = 'agent';
            event.operation.mdip!.prefix = did.slice(0, did.lastIndexOf(':'));
            await seedDID(db, did, { events: [event], doc: { didDocumentData: { label } } });
        }

        for (const did of [alpha, beta, otherNetwork]) {
            await store(did, 'Alice 100%_Complete!');
        }
        for (const q of ['alice', 'ALICE', 'aLiCe', '100%_complete!', '100%_COMPLETE!']) {
            expect(await db.searchDocs(q, { limit: 50 })).toEqual({
                dids: [alpha, beta, otherNetwork], nextCursor: null,
            });
        }
        expect(await db.searchDocs('100%_missing!', { limit: 50 })).toEqual({ dids: [], nextCursor: null });
        const first = await db.searchDocs('ALICE', { didPrefix: 'did:mdip', limit: 1 });
        expect(first).toEqual({ dids: [alpha], nextCursor: alpha });
        expect(await db.searchDocs('alice', { didPrefix: 'did:mdip', limit: 1, cursor: first.nextCursor! }))
            .toEqual({ dids: [beta], nextCursor: null });
        expect(await db.searchDocs('alice', { didPrefix: 'did:test', limit: 50 }))
            .toEqual({ dids: [otherNetwork], nextCursor: null });

        await store(alpha, 'Bob');
        expect(await db.searchDocs('alice', { didPrefix: 'did:mdip', limit: 50 }))
            .toEqual({ dids: [beta], nextCursor: null });
        expect(await db.searchDocs('BOB', { limit: 50 })).toEqual({ dids: [alpha], nextCursor: null });
        expect(await db.getDID(alpha)).toEqual({ didDocumentData: { label: 'Bob' } });
        const generated = await inspection.query('SELECT search_text = lower(doc::text) AS correct FROM did_docs');
        expect(generated.rows).toEqual([{ correct: true }, { correct: true }, { correct: true }]);

        await db.disconnect();
        db = createDatabase();
        await db.connect();
        const indexes = await inspection.query(`
            SELECT indexname, indexdef FROM pg_indexes
            WHERE schemaname = $1 AND tablename = 'did_docs' AND indexdef LIKE '%USING gin%'
        `, [schema]);
        expect(indexes.rows).toEqual([{
            indexname: 'idx_did_docs_search_text_trgm',
            indexdef: expect.stringContaining('USING gin (search_text gin_trgm_ops)'),
        }]);
        expect(await db.searchDocs('BOB', { limit: 50 })).toEqual({ dids: [alpha], nextCursor: null });
    });

    it('keeps complete scoped pages across the probe boundary, including matches outside the probe', async () => {
        const label = 'Bounded Probe 100%_Done!';
        const expected: { did: string; ambiguous: boolean }[] = [];
        const records: DIDProjectionUpdate[] = Array.from({ length: 1000 }, (_, index) => {
            const suffix = `item-${String(index).padStart(4, '0')}`;
            const prefix = index === 0 || index === 2 ? 'did:mdip'
                : index === 4 ? 'did:arbitrary' : index % 2 ? 'did:test' : 'did:mdip';
            const did = `${index === 0 || index === 2 ? 'did:test' : prefix}:${suffix}`;
            const event = createSeedEvent(did);
            event.operation.mdip!.type = index === 2 ? 'asset' : 'agent';
            if (index !== 1 && index !== 2) event.operation.mdip!.prefix = prefix;
            expected.push({ did: `${prefix}:${suffix}`, ambiguous: index === 1 });
            return {
                did, events: [event],
                doc: { didDocumentData: { label, rare: index === 0 ? 'RareOnlyValue' : null } },
                didPrefixReferences: index === 3 ? ['did:mdip:item-0002', 'did:mdip:item-0001'] : [],
            };
        }).reverse();
        const noDoc = 'did:mdip:000-no-doc';
        const canary = 'did:mdip:000-wildcard-canary';
        for (const did of [noDoc, canary]) {
            const event = createSeedEvent(did);
            event.operation.mdip!.prefix = 'did:mdip';
            records.push({ did, events: [event], doc: did === noDoc ? undefined
                : { didDocumentData: { label: 'Bounded Probe 100abDone!' } } });
        }
        await db.applyIndexPage({ dids: records, blocks: [] });

        async function assertPages(didPrefix?: string, includeAmbiguous = false): Promise<void> {
            const ordered = expected
                .filter(row => !didPrefix || row.did.startsWith(`${didPrefix}:`) || (includeAmbiguous && row.ambiguous))
                .map(row => didPrefix && includeAmbiguous && row.ambiguous
                    ? `${didPrefix}:${row.did.split(':').pop()}` : row.did)
                .sort((a, b) => {
                    const left = didPrefix ? a.split(':').pop()! : a;
                    const right = didPrefix ? b.split(':').pop()! : b;
                    return left < right ? -1 : left > right ? 1 : 0;
                });
            let cursor: string | undefined;
            for (let offset = 0; offset < Math.max(ordered.length, 1); offset += 500) {
                const page = await db.searchDocs('BOUNDED PROBE 100%_DONE!', {
                    didPrefix, includeAmbiguous, limit: 500,
                    cursor: didPrefix && cursor ? cursor.replace(didPrefix, 'did:alias') : cursor,
                });
                expect(page).toEqual({
                    dids: ordered.slice(offset, offset + 500),
                    nextCursor: ordered.length > offset + 500 ? ordered[offset + 499] : null,
                });
                cursor = page.nextCursor ?? undefined;
            }
            expect(await db.searchDocs('bounded probe 100%_done!', {
                didPrefix, includeAmbiguous, limit: 50,
            })).toEqual({ dids: ordered.slice(0, 50), nextCursor: ordered.length > 50 ? ordered[49] : null });
        }

        for (let size = 1000; size <= 1002; size++) {
            if (size > 1000) {
                const did = `did:mdip:000-late-${1002 - size}`;
                const event = createSeedEvent(did);
                event.operation.mdip!.prefix = 'did:mdip';
                await seedDID(db, did, { events: [event], doc: { didDocumentData: { label } } });
                expected.push({ did, ambiguous: false });
            }
            await assertPages();
            await assertPages('did:mdip');
            await assertPages('did:test');
            await assertPages('did:mdip', true);
            await assertPages('did:absent');
        }
        expect(await db.searchDocs('rareonlyvalue', { didPrefix: 'did:mdip', limit: 50 }))
            .toEqual({ dids: ['did:mdip:item-0000'], nextCursor: null });
        expect(await db.searchDocs('no such label', { limit: 50 })).toEqual({ dids: [], nextCursor: null });
    }, 30_000);
});
