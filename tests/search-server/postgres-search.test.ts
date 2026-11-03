import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import Postgres from '../../services/search-server/src/db/postgres.ts';
import { createSeedEvent, seedDID } from './db-seed.ts';

const postgresUrl = process.env.KC_SEARCH_SERVER_TEST_POSTGRES_URL;
const describePostgres = postgresUrl ? describe : describe.skip;

describePostgres('PostgreSQL stored document search', () => {
    it('generates searchable text on writes and preserves scoped literal search and pagination', async () => {
        const schema = `search_test_${randomUUID().replaceAll('-', '')}`;
        const admin = new Pool({ connectionString: postgresUrl });
        const options = { connectionString: postgresUrl, options: `-c search_path=${schema},public` };
        const inspection = new Pool(options);

        class TestPostgres extends Postgres {
            protected createPool(): Pool {
                return new Pool(options);
            }
        }

        const db = new TestPostgres(postgresUrl!);
        const alpha = 'did:mdip:alpha';
        const beta = 'did:mdip:beta';
        const otherNetwork = 'did:test:gamma';

        async function store(did: string, label: string): Promise<void> {
            const event = createSeedEvent(did);
            event.operation.mdip!.type = 'agent';
            event.operation.mdip!.prefix = did.slice(0, did.lastIndexOf(':'));
            await seedDID(db, did, { events: [event], doc: { didDocumentData: { label } } });
        }

        try {
            await admin.query('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public');
            // eslint-disable-next-line sonarjs/sql-queries -- schema is a fixed prefix plus a generated hex UUID.
            await admin.query(`CREATE SCHEMA ${schema}`);
            await db.connect();
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
        }
        finally {
            await db.disconnect();
            await inspection.end();
            // eslint-disable-next-line sonarjs/sql-queries -- schema is a fixed prefix plus a generated hex UUID.
            await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
            await admin.end();
        }
    });
});
