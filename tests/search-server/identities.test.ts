import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'node:crypto';
import { jest } from '@jest/globals';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import Sqlite from '../../services/search-server/src/db/sqlite.ts';
import Postgres from '../../services/search-server/src/db/postgres.ts';
import { parseIdentityListOptions } from '../../services/search-server/src/index-helpers.ts';
import { extractIdentity, extractPublishedCredentials } from '../../services/search-server/src/published-credentials.ts';
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
    const doc = document(manifest);
    await seedDID(db, did, { events: [event], doc, publishedCredentials: extractPublishedCredentials(did, doc) });
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

    it('filters by schema before counting and pagination, counting each matching identity once', async () => {
        const dave = 'did:mdip:Dave';
        const eve = 'did:test:Eve';
        await seedAgent(db, alice, { 'did:mdip:unrelated': credential(alice, 'did:mdip:other-schema') });
        await seedAgent(db, bob, {
            'did:mdip:profile-1': credential(bob),
            'did:mdip:profile-2': credential(bob),
        });
        await seedAgent(db, 'did:mdip:Carol');
        await seedAgent(db, dave, { 'did:mdip:unrevealed': credential(dave, schemaDid, null) });
        await seedAgent(db, eve, { 'did:mdip:profile-3': credential(eve) }, 'did:test');
        const options = { didPrefix: 'did:mdip', schemaDid: schemaDid.replace('did:mdip:', 'did:test:') };
        const bobResult = { did: bob, manifestSchemaDids: [schemaDid] };
        const daveResult = { did: dave, manifestSchemaDids: [schemaDid] };
        expect(await db.listIdentities(options)).toEqual({ total: 2, identities: [bobResult, daveResult] });
        expect(await db.listIdentities({ ...options, limit: 1 })).toEqual({ total: 2, identities: [bobResult] });
        expect(await db.listIdentities({ ...options, limit: 1, offset: 1 })).toEqual({ total: 2, identities: [daveResult] });
        expect(await db.listIdentities({ ...options, limit: 0 })).toEqual({ total: 2, identities: [] });
        expect(await db.listIdentities({ ...options, offset: 2 })).toEqual({ total: 2, identities: [] });
        expect(await db.listIdentities({ ...options, schemaDid: 'did:mdip:missing' })).toEqual({ total: 0, identities: [] });
        expect(await db.listIdentities({ ...options, fields: ['publicName'], offset: 1 })).toEqual({
            total: 1, identities: [],
        });
        expect((await db.listIdentities({ schemaDid })).total).toBe(3);
        expect((await db.listIdentities()).total).toBe(5);
    });

    it('does not match malformed manifests or credentials belonging to another subject', async () => {
        await seedAgent(db, alice, { 'did:mdip:wrong-subject': credential(bob), 'not-a-did': credential() });
        await seedAgent(db, bob, []);
        expect(await db.listIdentities({ schemaDid })).toEqual({ total: 0, identities: [] });
        expect(await db.listIdentities({ fields: ['publicName'] })).toEqual({ total: 0, identities: [] });
    });

    it('uses OR field filters before pagination and requires schema and fields in the same credential', async () => {
        const otherSchema = 'did:mdip:other-schema';
        const carol = 'did:mdip:Carol';
        const dave = 'did:mdip:Dave';
        await seedAgent(db, alice, {
            'did:mdip:vc': credential(alice, schemaDid, { region: 'UK' }),
            'did:test:vc': credential(alice, otherSchema),
        });
        await seedAgent(db, bob, {
            'did:mdip:bob-vc': credential(bob, schemaDid, { publicName: 'Bob' }),
            'did:mdip:empty': credential(bob, schemaDid, {}),
        });
        await seedAgent(db, carol, {
            'did:mdip:carol-vc': credential(carol, schemaDid, { faveFood: 'Pizza' }),
        });
        await seedAgent(db, dave, { 'did:mdip:hidden': credential(dave, schemaDid, null) });
        const fields = ['publicName', 'faveFood'];
        const result = await db.listIdentities({ schemaDid, fields });
        expect(result).toEqual({ total: 2, identities: [
            { did: bob, manifestSchemaDids: [schemaDid], credentials: [
                { credentialDid: 'did:mdip:bob-vc', fields: { publicName: 'Bob' } },
            ] },
            { did: carol, manifestSchemaDids: [schemaDid], credentials: [
                { credentialDid: 'did:mdip:carol-vc', fields: { faveFood: 'Pizza' } },
            ] },
        ] });
        expect(await db.listIdentities({ schemaDid, fields, limit: 1, offset: 1 })).toEqual({
            total: 2, identities: [result.identities[1]],
        });
        expect(await db.listIdentities({ schemaDid, fields, limit: 0 })).toEqual({ total: 2, identities: [] });
        expect(await db.listIdentities({ schemaDid, fields, offset: 2 })).toEqual({ total: 2, identities: [] });
        expect((await db.listIdentities({ schemaDid, fields: ['publicName'] })).identities.map(id => id.did)).toEqual([bob]);
        const anySchema = await db.listIdentities({ fields });
        expect(anySchema.total).toBe(3);
        expect(anySchema.identities.map(id => id.did)).toEqual([alice, bob, carol]);
        expect(anySchema.identities[0].credentials).toEqual([
            { credentialDid: 'did:test:vc', fields: { publicName: 'Alice' } },
        ]);
        expect(await db.listIdentities({ fields, didPrefix: 'did:test' })).toEqual({ total: 0, identities: [] });
        expect((await db.listIdentities({ schemaDid })).total).toBe(4);
        expect((await db.listIdentities()).total).toBe(4);
    });

    it('matches own literal field names regardless of value and ignores malformed claim payloads', async () => {
        const claims = JSON.parse('{"publicName":"","score":0,"active":false,"nullable":null,"literal.dot":"value","nested":{"key":1},"__proto__":"safe","constructor":"value","x\u0027) OR TRUE --":"literal"}');
        claims[randomBytes(4096).toString('hex')] = 'long field';
        await seedAgent(db, alice, { 'did:mdip:vc': credential(alice, schemaDid, claims) });
        await seedAgent(db, bob, {
            'did:mdip:array': credential(bob, schemaDid, ['publicName']),
            'did:mdip:scalar': credential(bob, schemaDid, 'publicName'),
            'did:mdip:false': credential(bob, schemaDid, false),
        });
        for (const field of Object.keys(claims)) {
            expect(await db.listIdentities({ schemaDid, fields: [field, field] })).toEqual({
                total: 1, identities: [{ did: alice, manifestSchemaDids: [schemaDid], credentials: [
                    { credentialDid: 'did:mdip:vc', fields: Object.fromEntries([[field, claims[field]]]) },
                ] }],
            });
        }
        for (const field of ['missing', 'PublicName', 'nested.key', 'toString']) {
            expect(await db.listIdentities({ fields: [field] })).toEqual({ total: 0, identities: [] });
        }
    });

    it.each([false, true])('matches every schema when credential aliases contain different versions (reversed: %s)', async reversed => {
        const otherSchema = 'did:mdip:other-schema';
        const entries = [
            ['did:mdip:vc', credential(alice, schemaDid, { publicName: 'Alice' })],
            ['did:test:vc', credential(alice, otherSchema, { publicName: 'Updated Alice' })],
        ];
        await seedAgent(db, alice, Object.fromEntries(reversed ? entries.reverse() : entries));
        await seedAgent(db, bob, { 'did:mdip:vc-bob': credential(bob) });

        expect(await db.listIdentities({ schemaDid, fields: ['publicName'], limit: 1 })).toEqual({
            total: 2, identities: [{ did: alice, manifestSchemaDids: [otherSchema, schemaDid].sort(), credentials: [
                { credentialDid: 'did:mdip:vc', fields: { publicName: 'Alice' } },
            ] }],
        });
        expect((await db.listIdentities({ schemaDid, limit: 1, offset: 1 })).identities[0].did).toBe(bob);
        expect(await db.listIdentities({ schemaDid: otherSchema, fields: ['publicName'] })).toEqual({
            total: 1, identities: [{ did: alice, manifestSchemaDids: [otherSchema, schemaDid].sort(), credentials: [
                { credentialDid: 'did:test:vc', fields: { publicName: 'Updated Alice' } },
            ] }],
        });

        await seedAgent(db, alice, { 'did:test:vc': credential(alice, otherSchema) });
        expect((await db.listIdentities({ schemaDid })).identities.map(identity => identity.did)).toEqual([bob]);
        expect((await db.listIdentities({ schemaDid, fields: ['publicName'] })).identities.map(identity => identity.did)).toEqual([bob]);
        expect((await db.listIdentities({ schemaDid: otherSchema })).total).toBe(1);
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
        expect(result).toEqual({ total: 1, identities: [{
            did: alice,
            manifestSchemaDids: [schemaDid, 'did:mdip:other-schema'].sort(),
            credentials: [{
                credentialDid: 'did:mdip:credential-a',
                fields: { publicName: 'Alice A', active: false, score: 0, empty: '', nullable: null,
                    nested: { value: 1 }, 'literal.dot': 'literal' },
            }, {
                credentialDid: 'did:mdip:credential-b', fields: { publicName: 'Alice B' },
            }],
        }] });
        (result.identities[0].credentials![0].fields.nested as { value: number }).value = 2;
        expect((await db.listIdentities(options)).identities[0].credentials![0].fields.nested).toEqual({ value: 1 });
        expect((await db.listIdentities({ ...options, limit: 1, offset: 1 })).identities).toEqual([]);
    });

    it('reflects manifest updates, deactivation and removal rather than historical publications', async () => {
        await seedAgent(db, alice, { 'did:mdip:vc': credential() });
        expect((await db.listIdentities({ schemaDid })).total).toBe(1);
        expect((await db.listIdentities({ fields: ['publicName'] })).total).toBe(1);
        await seedAgent(db, alice, { 'did:mdip:vc2': credential(alice, 'did:mdip:new-schema') });
        expect((await db.listIdentities()).identities[0].manifestSchemaDids).toEqual(['did:mdip:new-schema']);
        expect((await db.listIdentities({ schemaDid })).total).toBe(0);
        expect((await db.listIdentities({ schemaDid: 'did:mdip:new-schema' })).total).toBe(1);
        const event = createSeedEvent(alice);
        event.operation.mdip!.type = 'agent';
        event.operation.mdip!.prefix = 'did:mdip';
        await seedDID(db, alice, { events: [event], doc: { didDocumentMetadata: { deactivated: true } } });
        expect(await db.listIdentities()).toEqual({ total: 1, identities: [{ did: alice, manifestSchemaDids: [] }] });
        expect((await db.listIdentities({ schemaDid: 'did:mdip:new-schema' })).total).toBe(0);
        expect((await db.listIdentities({ fields: ['publicName'] })).total).toBe(0);
        await seedAgent(db, alice, { 'did:mdip:vc': credential() });
        expect((await db.listIdentities({ schemaDid })).total).toBe(1);
        await seedDID(db, alice, { removed: true });
        expect(await db.listIdentities()).toEqual({ total: 0, identities: [] });
        expect((await db.listIdentities({ schemaDid })).total).toBe(0);
        expect((await db.listIdentities({ fields: ['publicName'] })).total).toBe(0);
    });

    it('deduplicates storage aliases and uses signed prefix classification for agents', async () => {
        await seedAgent(db, 'did:test:Alice', { 'did:mdip:vc': credential() });
        expect((await db.listIdentities({ didPrefix: 'did:mdip' })).identities[0].did).toBe(alice);
        expect((await db.listIdentities({ didPrefix: 'did:mdip', schemaDid })).identities[0].did).toBe(alice);
        expect((await db.listIdentities({ didPrefix: 'did:mdip', fields: ['publicName'] })).identities[0].did).toBe(alice);
        expect((await db.listIdentities({ didPrefix: 'did:test' })).total).toBe(0);
        await seedAgent(db, alice);
        expect((await db.listIdentities()).total).toBe(1);
        expect((await db.listIdentities({ fields: ['publicName'] })).total).toBe(0);
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
        }).credentials).toEqual([{ credentialDid: 'did:mdip:vc', fields: { publicName: 'Alice' } }]);
    });
});

describe('identity query parameters', () => {
    it('defaults, caps pagination and supports repeated fields without duplicate keys', () => {
        expect(parseIdentityListOptions({})).toEqual({ schemaDid: undefined, fields: [], limit: 50, offset: 0 });
        expect(parseIdentityListOptions({ fields: ['publicName', 'faveFood'] })).toEqual({
            schemaDid: undefined, fields: ['publicName', 'faveFood'], limit: 50, offset: 0,
        });
        expect(parseIdentityListOptions({ schemaDid, fields: 'publicName', limit: '0', offset: '12' })).toEqual({
            schemaDid, fields: ['publicName'], limit: 0, offset: 12,
        });
        expect(parseIdentityListOptions({ schemaDid, fields: ['publicName', 'score', 'publicName'], limit: '501' }))
            .toEqual({ schemaDid, fields: ['publicName', 'score'], limit: 500, offset: 0 });
    });

    it.each([
        { fields: '' }, { schemaDid, fields: [''] },
        { schemaDid, fields: [{}] }, { schemaDid, fields: 1 }, { schemaDid: [schemaDid] },
        { schemaDid: '' }, { schemaDid: 'invalid' }, { schemaDid: 'did:mdip:not-a-cid' },
        ...['limit', 'offset'].flatMap(key => ['-1', '1.5', '1x', 'NaN', '', '9007199254740992', ['1'], {}]
            .map(value => ({ [key]: value }))),
    ])('rejects invalid input %j', query => {
        expect(() => parseIdentityListOptions(query)).toThrow();
    });
});

describe('SQLite identity query isolation', () => {
    let db: Sqlite;
    let directory: string;

    function deferred() {
        let resolve!: () => void;
        const promise = new Promise<void>(done => { resolve = done; });
        return { promise, resolve };
    }

    beforeEach(async () => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'search-identities-isolation-'));
        db = new Sqlite('test.db', directory);
        await db.connect();
        await seedAgent(db, alice, { 'did:mdip:vc': credential() });
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await db.disconnect();
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it.each([false, true])('waits for the whole index transaction before reading (rollback: %s)', async rollback => {
        const connection = (db as any).db;
        const run = connection.run.bind(connection);
        const paused = deferred();
        const resume = deferred();
        jest.spyOn(connection, 'run').mockImplementation(async (...args: any[]) => {
            const result = await run(...args);
            if (args[0] === 'DELETE FROM identity_schemas WHERE did = ?') {
                paused.resolve();
                await resume.promise;
                if (rollback) throw new Error('index write failed');
            }
            return result;
        });
        const update = seedAgent(db, alice, {
            'did:mdip:vc': credential(alice, schemaDid, { publicName: 'Updated Alice' }),
        });
        const checkedUpdate = rollback
            ? expect(update).rejects.toThrow('index write failed')
            : expect(update).resolves.toBeUndefined();
        await paused.promise;
        const get = jest.spyOn(connection, 'get');
        const read = db.listIdentities({ schemaDid, fields: ['publicName'] });
        try {
            await new Promise(resolve => setImmediate(resolve));
            expect(get).not.toHaveBeenCalled();
        }
        finally {
            resume.resolve();
            await checkedUpdate;
        }
        expect(await read).toEqual({ total: 1, identities: [{
            did: alice,
            manifestSchemaDids: [schemaDid],
            credentials: [{ credentialDid: 'did:mdip:vc', fields: {
                publicName: rollback ? 'Alice' : 'Updated Alice',
            } }],
        }] });
        // A failed transaction must not prevent subsequent work.
        jest.restoreAllMocks();
        await seedAgent(db, bob, { 'did:mdip:bob-vc': credential(bob) });
        expect((await db.listIdentities({ schemaDid })).total).toBe(2);
    });

    it.each(['update', 'reset', 'disconnect'])('finishes count and page queries before %s', async action => {
        const original = await db.listIdentities({ schemaDid });
        const connection = (db as any).db;
        const get = connection.get.bind(connection);
        const paused = deferred();
        const resume = deferred();
        jest.spyOn(connection, 'get').mockImplementation(async (...args: any[]) => {
            const result = await get(...args);
            if (args[0].includes('COUNT(*) AS total')) {
                paused.resolve();
                await resume.promise;
            }
            return result;
        });
        const read = db.listIdentities({ schemaDid });
        await paused.promise;
        const exec = jest.spyOn(connection, 'exec');
        const close = jest.spyOn(connection, 'close');
        const events = jest.spyOn(db, 'getDIDEvents');
        const change = action === 'update'
            ? seedAgent(db, bob, { 'did:mdip:bob-vc': credential(bob) })
            : action === 'reset' ? db.wipeDb() : db.disconnect();
        try {
            await new Promise(resolve => setImmediate(resolve));
            expect(events).not.toHaveBeenCalled();
            expect(exec).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
        }
        finally {
            resume.resolve();
            await Promise.allSettled([read, change]);
        }
        expect(await read).toEqual(original);
        await change;
        jest.restoreAllMocks();
        if (action === 'disconnect') {
            await expect(db.listIdentities()).rejects.toThrow('SQLite DB not connected');
            await db.connect();
            expect(await db.listIdentities({ schemaDid })).toEqual(original);
        }
        else {
            expect((await db.listIdentities({ schemaDid })).total).toBe(action === 'update' ? 2 : 0);
        }
    });

    it('continues queued writes and reads after an identity query fails', async () => {
        jest.spyOn((db as any).db, 'get').mockRejectedValueOnce(new Error('read failed'));
        const read = expect(db.listIdentities()).rejects.toThrow('read failed');
        const write = seedAgent(db, bob);
        const nextRead = db.listIdentities();
        await read;
        await write;
        expect(await nextRead).toEqual({ total: 2, identities: [
            { did: alice, manifestSchemaDids: [schemaDid] },
            { did: bob, manifestSchemaDids: [] },
        ] });
    });
});

describe('SQL identity enumeration', () => {
    it('keeps SQLite schema membership atomic and clears it on alias replacement, removal and reset', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'search-identities-lifecycle-'));
        const sqlite = await Sqlite.create('test.db', directory);
        const connection = (sqlite as any).db;
        try {
            await seedAgent(sqlite, alice, { 'did:mdip:vc': credential() });
            const original = await sqlite.listIdentities({ schemaDid });
            const events = await sqlite.getDIDEvents(alice);
            await connection.exec(`CREATE TRIGGER fail_schema BEFORE INSERT ON identity_schemas
                WHEN NEW.schema_suffix = 'rejected-schema'
                BEGIN SELECT RAISE(ABORT, 'schema write failed'); END`);
            await expect(seedAgent(sqlite, alice, {
                'did:mdip:vc': credential(alice, 'did:mdip:rejected-schema'),
            })).rejects.toThrow('schema write failed');
            expect(await sqlite.listIdentities({ schemaDid })).toEqual(original);
            expect(await sqlite.getDIDEvents(alice)).toEqual(events);
            await connection.exec(`CREATE TRIGGER fail_field BEFORE INSERT ON identity_fields
                WHEN NEW.field = 'reject'
                BEGIN SELECT RAISE(ABORT, 'field write failed'); END`);
            await expect(seedAgent(sqlite, alice, {
                'did:mdip:vc': credential(alice, schemaDid, { publicName: 'Changed', reject: true }),
            })).rejects.toThrow('field write failed');
            expect((await sqlite.listIdentities({ fields: ['publicName'] })).identities[0].credentials).toEqual([
                { credentialDid: 'did:mdip:vc', fields: { publicName: 'Alice' } },
            ]);
            expect((await sqlite.listIdentities({ fields: ['reject'] })).total).toBe(0);
            expect(await sqlite.getDIDEvents(alice)).toEqual(events);

            const alias = 'did:test:Alice';
            await seedAgent(sqlite, alias, { 'did:mdip:vc': credential() });
            expect(await connection.all('SELECT did FROM identity_schemas')).toEqual([{ did: alias }]);
            expect(await connection.all('SELECT did, field FROM identity_fields')).toEqual([{ did: alias, field: 'publicName' }]);
            expect(await sqlite.listIdentities({ schemaDid })).toEqual(original);
            await seedDID(sqlite, alias, { removed: true });
            expect(await connection.all('SELECT * FROM identity_schemas')).toEqual([]);
            expect(await connection.all('SELECT * FROM identity_fields')).toEqual([]);
            await seedAgent(sqlite, alice, { 'did:mdip:vc': credential() });
            await sqlite.wipeDb();
            expect(await connection.all('SELECT * FROM identity_schemas')).toEqual([]);
            expect(await connection.all('SELECT * FROM identity_fields')).toEqual([]);
            expect(await sqlite.listIdentities({ fields: ['publicName'] })).toEqual({ total: 0, identities: [] });
        }
        finally {
            await sqlite.disconnect();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('uses SQLite indexes for agent and schema filters and preserves them across restarts', async () => {
        const db = new Sqlite(':memory:', '.');
        await expect(db.listIdentities()).rejects.toThrow('SQLite DB not connected');
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'search-identities-plan-'));
        const sqlite = new Sqlite('test.db', directory);
        try {
            await sqlite.connect();
            await seedAgent(sqlite, alice, { 'did:mdip:vc': credential() });
            await sqlite.disconnect();
            await sqlite.connect();
            expect((await sqlite.listIdentities({ schemaDid })).total).toBe(1);
            expect((await sqlite.listIdentities({ fields: ['publicName'] })).total).toBe(1);
            const plan = await (sqlite as any).db.all(`EXPLAIN QUERY PLAN
                SELECT dc.prefix || ':' || dc.suffix AS did, d.doc
                FROM did_classifications dc JOIN did_docs d ON d.did = dc.did
                WHERE dc.is_agent = 1 AND dc.prefix = ? ORDER BY dc.prefix, dc.suffix LIMIT ? OFFSET ?`,
            ['did:mdip', 50, 0]);
            expect(plan.some((row: { detail: string }) => row.detail.includes('idx_did_classifications_agents'))).toBe(true);
            expect(plan.some((row: { detail: string }) => row.detail.includes('TEMP B-TREE'))).toBe(false);
            const filteredPlan = await (sqlite as any).db.all(`EXPLAIN QUERY PLAN
                SELECT dc.prefix || ':' || dc.suffix AS did, d.doc
                FROM did_classifications dc JOIN did_docs d ON d.did = dc.did
                WHERE dc.is_agent = 1 AND dc.prefix = ? AND EXISTS (
                    SELECT 1 FROM identity_schemas ids
                    WHERE ids.did = dc.did AND ids.schema_suffix = ?
                ) ORDER BY dc.prefix, dc.suffix LIMIT ? OFFSET ?`,
            ['did:mdip', schemaDid.split(':').pop(), 50, 0]);
            expect(filteredPlan.some((row: { detail: string }) => row.detail.includes('SEARCH ids USING COVERING INDEX'))).toBe(true);
            expect(filteredPlan.some((row: { detail: string }) => row.detail.includes('TEMP B-TREE'))).toBe(false);
            for (const schema of [undefined, schemaDid]) {
                const fieldPlan = await (sqlite as any).db.all(`EXPLAIN QUERY PLAN
                    SELECT dc.prefix || ':' || dc.suffix AS did, d.doc
                    FROM did_classifications dc JOIN did_docs d ON d.did = dc.did
                    WHERE dc.is_agent = 1 AND EXISTS (
                        SELECT 1 FROM identity_fields idf
                        WHERE idf.did = dc.did AND idf.field IN (?, ?)
                        ${schema ? 'AND idf.schema_suffix = ?' : ''}
                    ) ORDER BY dc.prefix, dc.suffix LIMIT 50 OFFSET 0`,
                ['publicName', 'faveFood', ...(schema ? [schema.split(':').pop()] : [])]);
                expect(fieldPlan.some((row: { detail: string }) => row.detail.includes('SEARCH idf USING COVERING INDEX'))).toBe(true);
            }
        }
        finally {
            await sqlite.disconnect();
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('parameterizes PostgreSQL pagination and prefix filtering, and projects JSONB or string documents', async () => {
        const query = jest.fn(async (sql: string, params?: unknown[]) => {
            if (sql.includes('CREATE TABLE')) return { rows: [] };
            const filtered = sql.includes('AND EXISTS');
            if (sql.includes('COUNT(*)')) return { rows: [{ total: filtered ? 1 : 2 }] };
            expect(sql).toContain('WHERE dc.is_agent = TRUE');
            expect(sql).toContain('ORDER BY dc.prefix COLLATE "C", dc.suffix COLLATE "C"');
            expect(sql).not.toContain('jsonb');
            expect(sql).toContain(`LIMIT $${params!.length - 1} OFFSET $${params!.length}`);
            return { rows: [
                { did: alice, doc: document({ 'did:mdip:vc': credential() }) },
                ...(filtered ? [] : [{ did: bob, doc: JSON.stringify(document()) }]),
            ] };
        });
        class TestPostgres extends Postgres {
            protected createPool(): any { return { query, end: jest.fn() }; }
        }
        const db = await TestPostgres.create('postgresql://isolated-test');
        try {
            expect(query).toHaveBeenCalledWith(expect.stringContaining('ON identity_fields (did, md5(field), schema_suffix)'));
            expect((await db.listIdentities()).identities).toEqual([
                { did: alice, manifestSchemaDids: [schemaDid] }, { did: bob, manifestSchemaDids: [] },
            ]);
            expect(query).toHaveBeenLastCalledWith(expect.any(String), [50, 0]);
            const prefix = "did:mdip' OR TRUE --";
            await db.listIdentities({ didPrefix: prefix });
            expect(query).toHaveBeenLastCalledWith(expect.stringContaining('AND dc.prefix COLLATE "C" = $1'), [prefix, 50, 0]);
            expect(query).toHaveBeenLastCalledWith(expect.not.stringContaining(prefix), [prefix, 50, 0]);
            query.mockClear();
            const field = "faveFood') OR TRUE --";
            const result = await db.listIdentities({ didPrefix: prefix, schemaDid, fields: ['publicName', field], limit: 2, offset: 4 });
            expect(result.identities[0].credentials).toEqual([{ credentialDid: 'did:mdip:vc', fields: { publicName: 'Alice' } }]);
            const suffix = schemaDid.split(':').pop();
            expect(query.mock.calls).toHaveLength(2);
            for (const [sql] of query.mock.calls) {
                expect(sql).toContain('AND dc.prefix COLLATE "C" = $1');
                expect(sql).toContain('AND EXISTS');
                expect(sql).toContain('FROM identity_fields idf');
                expect(sql).toContain('idf.did = dc.did AND idf.field IN ($2,$3)');
                expect(sql).toContain('md5(idf.field) IN (md5($2),md5($3))');
                expect(sql).toContain('AND idf.schema_suffix = $4');
                expect(sql).not.toContain(prefix);
                expect(sql).not.toContain(suffix);
                expect(sql).not.toContain(field);
            }
            expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('COUNT(*)'), [prefix, 'publicName', field, suffix]);
            expect(query).toHaveBeenLastCalledWith(expect.any(String), [prefix, 'publicName', field, suffix, 2, 4]);
            for (const scope of [undefined, prefix]) {
                for (const schema of [undefined, schemaDid]) {
                    query.mockClear();
                    await db.listIdentities({ didPrefix: scope, schemaDid: schema, fields: ['publicName', 'faveFood'] });
                    const params = [...(scope ? [scope] : []), 'publicName', 'faveFood', ...(schema ? [suffix] : [])];
                    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('FROM identity_fields idf'), params);
                    expect(query).toHaveBeenLastCalledWith(expect.any(String), [...params, 50, 0]);
                    for (const [sql] of query.mock.calls) {
                        expect(sql).toContain(`idf.field IN ($${scope ? 2 : 1},$${scope ? 3 : 2})`);
                        expect(sql).toContain(`md5(idf.field) IN (md5($${scope ? 2 : 1}),md5($${scope ? 3 : 2}))`);
                        if (schema) expect(sql).toContain(`AND idf.schema_suffix = $${params.length}`);
                        else expect(sql).not.toContain('idf.schema_suffix');
                    }
                }
            }
            query.mockClear();
            await db.listIdentities({ schemaDid: schemaDid.replace('did:mdip:', 'did:test:') });
            for (const [sql] of query.mock.calls) {
                expect(sql).toContain('FROM identity_schemas ids');
                expect(sql).toContain('ids.did = dc.did AND ids.schema_suffix = $1');
                expect(sql).not.toContain('AND dc.prefix');
            }
            expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('COUNT(*)'), [suffix]);
            expect(query).toHaveBeenLastCalledWith(expect.any(String), [suffix, 50, 0]);
            await db.listIdentities({ didPrefix: prefix, schemaDid });
            expect(query).toHaveBeenLastCalledWith(expect.stringContaining('ids.schema_suffix = $2'), [prefix, suffix, 50, 0]);
            await db.listIdentities({ limit: -1, offset: -2 });
            expect(query).toHaveBeenLastCalledWith(expect.any(String), [0, 0]);
        }
        finally {
            await db.disconnect();
        }
    });
});
