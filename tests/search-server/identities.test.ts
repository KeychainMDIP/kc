import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import Sqlite from '../../services/search-server/src/db/sqlite.ts';
import Postgres from '../../services/search-server/src/db/postgres.ts';
import { parseIdentityListOptions } from '../../services/search-server/src/index-helpers.ts';
import { extractIdentity } from '../../services/search-server/src/published-credentials.ts';
import type { DIDsDb } from '../../services/search-server/src/types.ts';
import { createSeedEvent, seedDID } from './db-seed.ts';

const schemaDid = 'did:mdip:z3v8AuacR4diTuCgtbEfLDo2LzQNEDHgqBSNLMs5Szuq3WHcQdB';
const alice = 'did:mdip:Alice';
const bob = 'did:mdip:Bob';

function credential(subject = alice, schema = schemaDid, claims: unknown = { publicName: 'Alice' }) {
    return {
        type: ['VerifiableCredential', schema],
        issuer: 'did:mdip:Issuer',
        credentialSubject: { id: subject },
        credential: claims,
    };
}

function document(manifest: unknown = {}) {
    return { didDocumentData: { manifest } };
}

async function seedAgent(db: DIDsDb, did: string, manifest: unknown = {}, prefix = 'did:mdip') {
    const event = createSeedEvent(did);
    event.operation.mdip!.type = 'agent';
    event.operation.mdip!.prefix = prefix;
    await seedDID(db, did, { events: [event], doc: document(manifest) });
}

describe.each(['memory', 'sqlite'])('%s identities', adapter => {
    let db: DIDsDb;
    let directory: string | undefined;

    beforeEach(async () => {
        if (adapter === 'sqlite') {
            directory = fs.mkdtempSync(path.join(os.tmpdir(), 'search-identities-'));
            db = await Sqlite.create('identities.db', directory);
        }
        else {
            db = new DIDsDbMemory();
        }
    });

    afterEach(async () => {
        await db.disconnect();
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
    });

    it('enumerates agents only, with stable pagination and prefix scoping', async () => {
        expect(await db.listIdentities()).toEqual({ total: 0, identities: [] });
        await seedAgent(db, bob);
        await seedAgent(db, 'did:test:Carol', {}, 'did:test');
        await seedAgent(db, alice);
        await seedDID(db, 'did:mdip:asset', { doc: { mdip: { type: 'agent' } } });
        const noDoc = createSeedEvent('did:mdip:no-doc');
        noDoc.operation.mdip!.type = 'agent';
        await seedDID(db, noDoc.did!, { events: [noDoc] });

        expect(await db.listIdentities()).toEqual({ total: 3, identities: [
            { did: alice, manifestSchemaDids: [] },
            { did: bob, manifestSchemaDids: [] },
            { did: 'did:test:Carol', manifestSchemaDids: [] },
        ] });
        expect(await db.listIdentities({ limit: 1, offset: 1 })).toEqual({
            total: 3, identities: [{ did: bob, manifestSchemaDids: [] }],
        });
        expect(await db.listIdentities({ didPrefix: 'did:mdip', limit: 1, offset: 1 })).toEqual({
            total: 2, identities: [{ did: bob, manifestSchemaDids: [] }],
        });
        expect(await db.listIdentities({ didPrefix: 'did:unknown' })).toEqual({ total: 0, identities: [] });
        expect(await db.listIdentities({ limit: 0 })).toEqual({ total: 3, identities: [] });
        expect(await db.listIdentities({ offset: 3 })).toEqual({ total: 3, identities: [] });
        expect((await db.listIdentities({ offset: -1, limit: -1 })).identities).toEqual([]);
    });

    it('returns schema DIDs without claims unless explicitly requested', async () => {
        await seedAgent(db, alice, {
            'did:mdip:credential-b': credential(),
            'did:mdip:credential-a': credential(),
            'did:mdip:unrevealed': credential(alice, 'did:mdip:other-schema', null),
        });
        const expected = { total: 1, identities: [{
            did: alice, manifestSchemaDids: [schemaDid, 'did:mdip:other-schema'].sort(),
        }] };
        expect(await db.listIdentities()).toEqual(expected);
        expect(await db.listIdentities({ schemaDid })).toEqual(expected);
        expect(await db.listIdentities({ schemaDid, fields: [] })).toEqual(expected);
    });

    it('orders by prefix then suffix consistently regardless of locale', async () => {
        await seedAgent(db, 'did:a1:b', {}, 'did:a1');
        await seedAgent(db, 'did:a:z', {}, 'did:a');
        await seedAgent(db, 'did:a:A', {}, 'did:a');
        expect((await db.listIdentities()).identities.map(record => record.did)).toEqual([
            'did:a:A', 'did:a:z', 'did:a1:b',
        ]);
    });

    it('projects only requested fields from matching revealed credentials without merging them', async () => {
        await seedAgent(db, alice, {
            'did:mdip:credential-b': credential(alice, schemaDid, { publicName: 'Alice B', privateField: 'omit' }),
            'did:mdip:credential-a': credential(alice, schemaDid, {
                publicName: 'Alice A', active: false, score: 0, empty: '', nullable: null,
                nested: { value: 1 }, 'literal.dot': 'literal', privateField: 'omit',
            }),
            'did:mdip:unrevealed': credential(alice, schemaDid, null),
            'did:mdip:other-schema': credential(alice, 'did:mdip:other-schema', { publicName: 'wrong' }),
        });
        await seedAgent(db, bob);
        const options = {
            schemaDid: schemaDid.replace('did:mdip:', 'did:test:'),
            fields: ['publicName', 'active', 'score', 'empty', 'nullable', 'nested', 'literal.dot', 'missing'],
        };
        const result = await db.listIdentities(options);
        expect(result).toEqual({ total: 2, identities: [{
            did: alice,
            manifestSchemaDids: [schemaDid, 'did:mdip:other-schema'].sort(),
            credentials: [{
                credentialDid: 'did:mdip:credential-a',
                fields: { publicName: 'Alice A', active: false, score: 0, empty: '', nullable: null,
                    nested: { value: 1 }, 'literal.dot': 'literal' },
            }, {
                credentialDid: 'did:mdip:credential-b', fields: { publicName: 'Alice B' },
            }],
        }, { did: bob, manifestSchemaDids: [], credentials: [] }] });
        (result.identities[0].credentials![0].fields.nested as { value: number }).value = 2;
        expect((await db.listIdentities(options)).identities[0].credentials![0].fields.nested).toEqual({ value: 1 });
        expect((await db.listIdentities({ ...options, limit: 1, offset: 1 })).identities).toEqual([
            { did: bob, manifestSchemaDids: [], credentials: [] },
        ]);
    });

    it('reflects manifest updates, deactivation and removal rather than historical publications', async () => {
        await seedAgent(db, alice, { 'did:mdip:vc': credential() });
        await seedAgent(db, alice, { 'did:mdip:vc2': credential(alice, 'did:mdip:new-schema') });
        expect((await db.listIdentities()).identities[0].manifestSchemaDids).toEqual(['did:mdip:new-schema']);
        const event = createSeedEvent(alice);
        event.operation.mdip!.type = 'agent';
        event.operation.mdip!.prefix = 'did:mdip';
        await seedDID(db, alice, { events: [event], doc: { didDocumentMetadata: { deactivated: true } } });
        expect(await db.listIdentities()).toEqual({ total: 1, identities: [{ did: alice, manifestSchemaDids: [] }] });
        await seedDID(db, alice, { removed: true });
        expect(await db.listIdentities()).toEqual({ total: 0, identities: [] });
    });

    it('deduplicates storage aliases and uses signed prefix classification for agents', async () => {
        await seedAgent(db, 'did:test:Alice');
        expect((await db.listIdentities({ didPrefix: 'did:mdip' })).identities[0].did).toBe(alice);
        expect((await db.listIdentities({ didPrefix: 'did:test' })).total).toBe(0);
        await seedAgent(db, alice);
        expect((await db.listIdentities()).total).toBe(1);
        const event = createSeedEvent('did:mdip:legacy');
        event.operation.mdip!.type = 'agent';
        await seedDID(db, 'did:mdip:legacy', { events: [event], doc: document() });
        expect((await db.listIdentities({ didPrefix: 'did:test' })).identities).toEqual([
            { did: 'did:test:legacy', manifestSchemaDids: [] },
        ]);
    });
});

describe('identity field projection', () => {
    it.each([{}, document(null), document([]), document('bad')])('handles absent or malformed manifests', doc => {
        expect(extractIdentity(alice, doc, { schemaDid, fields: ['publicName'] })).toEqual({
            did: alice, manifestSchemaDids: [], credentials: [],
        });
    });

    it('ignores invalid manifest entries and non-object claim payloads', () => {
        const result = extractIdentity(alice, document({
            'not-a-did': credential(),
            'did:mdip:wrong-subject': credential(bob),
            'did:mdip:bad-type': { ...credential(), type: [] },
            'did:mdip:malformed': null,
            'did:mdip:array': credential(alice, schemaDid, ['no']),
            'did:mdip:scalar': credential(alice, schemaDid, 'no'),
            'did:mdip:false': credential(alice, schemaDid, false),
        }), { schemaDid, fields: ['publicName'] });
        expect(result).toEqual({ did: alice, manifestSchemaDids: [schemaDid], credentials: [] });
    });

    it('selects own literal keys safely, including prototype-like names', () => {
        const claims = JSON.parse('{"__proto__":{"safe":true},"constructor":"value"}');
        const result = extractIdentity(alice, document({ 'did:mdip:vc': credential(alice, schemaDid, claims) }), {
            schemaDid, fields: ['__proto__', 'constructor', 'toString'],
        });
        expect(result.credentials![0].fields).toEqual(claims);
        expect(Object.getPrototypeOf(result.credentials![0].fields)).toBe(Object.prototype);
        expect(extractIdentity(alice, document({ 'did:mdip:vc': credential() }), {
            fields: ['publicName'],
        }).credentials).toEqual([]);
    });
});

describe('identity query parameters', () => {
    it('defaults, caps pagination and supports repeated fields without duplicate keys', () => {
        expect(parseIdentityListOptions({})).toEqual({ schemaDid: undefined, fields: [], limit: 50, offset: 0 });
        expect(parseIdentityListOptions({ schemaDid, fields: 'publicName', limit: '0', offset: '12' })).toEqual({
            schemaDid, fields: ['publicName'], limit: 0, offset: 12,
        });
        expect(parseIdentityListOptions({ schemaDid, fields: ['publicName', 'score', 'publicName'], limit: '501' }))
            .toEqual({ schemaDid, fields: ['publicName', 'score'], limit: 500, offset: 0 });
    });

    it.each([
        { fields: 'publicName' }, { fields: '' }, { schemaDid, fields: [''] },
        { schemaDid, fields: [{}] }, { schemaDid, fields: 1 }, { schemaDid: [schemaDid] },
        { schemaDid: '' }, { schemaDid: 'invalid' }, { schemaDid: 'did:mdip:not-a-cid' },
        ...['limit', 'offset'].flatMap(key => ['-1', '1.5', '1x', 'NaN', '', '9007199254740992', ['1'], {}]
            .map(value => ({ [key]: value }))),
    ])('rejects invalid input %j', query => {
        expect(() => parseIdentityListOptions(query)).toThrow();
    });
});

describe('SQL identity enumeration', () => {
    it('uses the classification index in SQLite and rejects a disconnected adapter', async () => {
        const db = new Sqlite(':memory:', '.');
        await expect(db.listIdentities()).rejects.toThrow('SQLite DB not connected');
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'search-identities-plan-'));
        const sqlite = new Sqlite('test.db', directory);
        try {
            await sqlite.connect();
            const plan = await (sqlite as any).db.all(`EXPLAIN QUERY PLAN
                SELECT dc.prefix || ':' || dc.suffix AS did, d.doc
                FROM did_classifications dc JOIN did_docs d ON d.did = dc.did
                WHERE dc.is_agent = 1 AND dc.prefix = ? ORDER BY dc.prefix, dc.suffix LIMIT ? OFFSET ?`,
            ['did:mdip', 50, 0]);
            expect(plan.some((row: { detail: string }) => row.detail.includes('idx_did_classifications_agents'))).toBe(true);
            expect(plan.some((row: { detail: string }) => row.detail.includes('TEMP B-TREE'))).toBe(false);
        }
        finally {
            await sqlite.disconnect();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('parameterizes PostgreSQL pagination and prefix filtering, and projects JSONB or string documents', async () => {
        const query = jest.fn(async (sql: string, params?: unknown[]) => {
            if (sql.includes('CREATE TABLE')) return { rows: [] };
            if (sql.includes('COUNT(*)')) return { rows: [{ total: 2 }] };
            expect(sql).toContain('WHERE dc.is_agent = TRUE');
            expect(sql).toContain('ORDER BY dc.prefix COLLATE "C", dc.suffix COLLATE "C"');
            expect(sql).not.toContain('jsonb');
            if (params?.length === 3) {
                expect(sql).toContain('AND dc.prefix COLLATE "C" = $1');
                expect(sql).toContain('LIMIT $2 OFFSET $3');
            }
            else {
                expect(sql).toContain('LIMIT $1 OFFSET $2');
            }
            return { rows: [
                { did: alice, doc: document({ 'did:mdip:vc': credential() }) },
                { did: bob, doc: JSON.stringify(document()) },
            ] };
        });
        class TestPostgres extends Postgres {
            protected createPool(): any { return { query, end: jest.fn() }; }
        }
        const db = await TestPostgres.create('postgresql://isolated-test');
        try {
            expect((await db.listIdentities()).identities).toEqual([
                { did: alice, manifestSchemaDids: [schemaDid] }, { did: bob, manifestSchemaDids: [] },
            ]);
            expect(query).toHaveBeenLastCalledWith(expect.any(String), [50, 0]);
            const prefix = "did:mdip' OR TRUE --";
            const result = await db.listIdentities({ didPrefix: prefix, schemaDid, fields: ['publicName'], limit: 2, offset: 4 });
            expect(result.identities[0].credentials).toEqual([{ credentialDid: 'did:mdip:vc', fields: { publicName: 'Alice' } }]);
            expect(query).toHaveBeenLastCalledWith(expect.not.stringContaining(prefix), [prefix, 2, 4]);
            await db.listIdentities({ limit: -1, offset: -2 });
            expect(query).toHaveBeenLastCalledWith(expect.any(String), [0, 0]);
        }
        finally {
            await db.disconnect();
        }
    });
});
