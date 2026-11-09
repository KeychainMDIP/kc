import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import DbJson from '@mdip/gatekeeper/db/json';
import DbJsonCache from '@mdip/gatekeeper/db/json-cache';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import type { GatekeeperDb, GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import { expirationKey, isExpirationJob, projectLifecycle } from '@mdip/gatekeeper/db/lifecycle.ts';
import { resolveDIDFromEvents } from '../../packages/gatekeeper/src/did-resolver.js';

const did = 'did:test:z3v8AuaTV5VKcT9MJoSHkSTRLpXDoqcgqiKkwGBNSV4nVzb6kLk';
const alias = did.replace('did:test:', 'did:custom:');
const time = '2026-01-01T00:00:00.000Z';
const expires = '2026-01-02T00:00:00.000Z';

function event(operation: Operation, target = did): GatekeeperEvent {
    return { did: target, registry: 'local', time, operation };
}

function agent(validUntil: string | null = expires, target = did): GatekeeperEvent {
    return event({ type: 'create', created: time,
        mdip: { version: 1, type: 'agent', registry: 'local', validUntil: validUntil ?? undefined } }, target);
}

function update(validUntil: string | null = expires, target = did): GatekeeperEvent {
    return event({ type: 'update', did: target, doc: {
        didDocument: { id: target }, didDocumentData: {},
        mdip: { version: 1, type: 'agent', registry: 'local', validUntil: validUntil ?? undefined },
    } }, target);
}

describe('lifecycle projection', () => {
    it('does not allow unknown controller coverage to become durable cascade proof', () => {
        const row = projectLifecycle(did, [agent()])!;
        expect(isExpirationJob({ ...row, controllerUnknown: true })).toBe(false);
    });

    it('lets deletion remove a legacy controller ambiguity while retaining a known expiry', () => {
        const malformed = update();
        malformed.operation.doc!.didDocument!.controller = {} as string;
        const previous = projectLifecycle(did, [malformed])!;
        expect(previous).toMatchObject({ controllerUnknown: true, unresolved: true });
        const deleted = projectLifecycle(did, [event({ type: 'delete', did })], previous)!;
        expect(deleted.expiresAt).toBe(Date.parse(expires));
        expect(deleted.unresolved).toBeUndefined();
        expect(deleted.controllerUnknown).toBeUndefined();
        const unknownExpiry = { ...previous, expiresAt: undefined };
        expect(projectLifecycle(did, [event({ type: 'delete', did })], unknownExpiry)).toMatchObject({ unresolved: true });
    });
    it('keeps later create records from changing the resolved expiration or controller', async () => {
        const initial = event({ type: 'create', created: time, controller: alias,
            mdip: { version: 1, type: 'asset', registry: 'local', validUntil: expires } });
        const later = event({ type: 'create', created: time, controller: 'did:test:other',
            mdip: { version: 1, type: 'asset', registry: 'local', validUntil: '2099-01-01T00:00:00Z' } });
        const history = [initial, later];
        const doc = await resolveDIDFromEvents({ did, events: JSON.parse(JSON.stringify(history)), generateCID: async () => 'version' });
        expect(projectLifecycle(did, history)).toMatchObject({
            expiresAt: Date.parse(doc.mdip!.validUntil!), controller: doc.didDocument!.controller!.split(':').pop(),
        });
    });
    it('keeps a freshly constructed memory database ready without asynchronous startup', async () => {
        const memory = new DbJsonMemory('constructor-ready');
        await expect(memory.getLifecycleMetadata()).resolves.toMatchObject({ complete: true });
        await memory.resetDb();
        await expect(memory.getLifecycleMetadata()).resolves.toMatchObject({ complete: true });
    });

    it('matches latest resolution through full replacement and signed deletion without mutating events', async () => {
        const create = event({ type: 'create', created: time, controller: alias,
            mdip: { version: 1, type: 'asset', registry: 'local', validUntil: expires } });
        const replacement = event({ type: 'update', did, doc: {
            didDocument: { id: did, controller: alias }, didDocumentData: {},
            mdip: { version: 1, type: 'asset', registry: 'local', validUntil: expires },
        } });
        const events = [create, replacement, event({ type: 'delete', did })];
        const original = JSON.stringify(events);
        const projected = projectLifecycle(did, events);
        const doc = await resolveDIDFromEvents({
            did, events: JSON.parse(original), generateCID: async () => 'version',
        });
        expect(projected).toMatchObject({ type: doc.mdip!.type, expiresAt: Date.parse(doc.mdip!.validUntil!) });
        expect(projected!.controller).toBe(doc.didDocument!.controller);
        expect(JSON.stringify(events)).toBe(original);
    });

    it('clears omitted replacement fields and ignores unused agent-create controller fields', () => {
        expect(projectLifecycle(did, [agent(), update(null)])).toBeNull();
        const create = agent(null);
        create.operation.controller = alias;
        expect(projectLifecycle(did, [create])).toBeNull();
    });

    it('keeps malformed expirations unresolved and clones prior projection state', () => {
        const malformed = projectLifecycle(did, [agent('not-a-date')]);
        expect(malformed).toMatchObject({ unresolved: true });
        expect(malformed!.controllerUnknown).toBeUndefined();
        const previous = projectLifecycle(did, [agent()])!;
        previous.controller = 'controller';
        const original = { ...previous };
        const next = projectLifecycle(alias, [event({ type: 'delete', did })], previous)!;
        expect(next.controller).toBeUndefined();
        expect(previous).toStrictEqual(original);
        expect(next.revision).not.toBe(previous.revision);
    });

    it('distinguishes an orphan delete history from deletion of a known sparse row', () => {
        const deletion = event({ type: 'delete', did });
        expect(projectLifecycle(did, [deletion])).toMatchObject({ unresolved: true });
        expect(projectLifecycle(did, [deletion], null)).toBeNull();
        expect(projectLifecycle(did, [agent(null), deletion])).toBeNull();
    });

    it('does not persist an invalid lifecycle shape while projecting malformed MDIP types', () => {
        const malformed = agent();
        malformed.operation.mdip!.type = 'unknown' as 'agent';
        expect(projectLifecycle(did, [malformed])).toMatchObject({ unresolved: true, type: undefined });
    });

    it('projects known legacy controller values without making global coverage uncertain', () => {
        const replacement = update();
        for (const controller of [undefined, null, '', false, 0]) {
            replacement.operation.doc!.didDocument!.controller = controller as unknown as string;
            expect(projectLifecycle(did, [replacement])!.controllerUnknown).toBeUndefined();
        }
        replacement.operation.doc!.didDocument!.controller = 'legacy-controller-suffix';
        expect(projectLifecycle(did, [replacement])).toMatchObject({ controller: 'legacy-controller-suffix' });
        expect(projectLifecycle(did, [replacement])!.controllerUnknown).toBeUndefined();
        replacement.operation.doc!.didDocument!.controller = {} as string;
        expect(projectLifecycle(did, [replacement])).toMatchObject({ unresolved: true, controllerUnknown: true });
    });

    it('keeps lexicographic expiration keys exact through the complete Date range', () => {
        const times = [-8_640_000_000_000_000, -1, 0, 1, 8_639_999_999_999_999, 8_640_000_000_000_000];
        const keys = times.map(expiresAt => expirationKey({ expiresAt, suffix: 'same' }));
        expect([...keys].sort()).toStrictEqual(keys);
        expect(new Set(keys).size).toBe(times.length);
    });
});

const adapters: Array<[string, new (name: string, folder: string) => GatekeeperDb]> = [
    ['JSON', DbJson], ['cached JSON', DbJsonCache], ['memory JSON', DbJsonMemory],
];

describe.each(adapters)('%s lifecycle index', (_name, Adapter) => {
    let folder: string;
    let db: GatekeeperDb;

    beforeEach(async () => {
        folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gatekeeper-lifecycle-'));
        db = new Adapter('test', folder);
        await db.start();
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await db.stop();
        fs.rmSync(folder, { recursive: true, force: true });
    });

    it('returns cleanup jobs in suffix order with a bounded exclusive cursor', async () => {
        for (const suffix of ['c', 'a', 'b']) {
            const target = `did:test:${suffix}`;
            await db.addEvent(target, agent(expires, target));
            const row = (await db.getLifecycle(target))!;
            await db.saveExpirationJob(suffix, { ...row, type: 'agent', expiresAt: row.expiresAt! });
        }
        expect((await db.getExpirationJobs(2)).map(row => row.suffix)).toEqual(['a', 'b']);
        expect((await db.getExpirationJobs(2, 'a')).map(row => row.suffix)).toEqual(['b', 'c']);
        expect(await db.getExpirationJobs(2, 'c')).toEqual([]);
    });

    it('rejects malformed cleanup jobs without persisting them', async () => {
        const row = projectLifecycle(did, [agent()])!;
        const invalid: unknown[] = [
            { ...row, type: 'asset' }, { ...row, expiresAt: undefined },
            { ...row, controllerUnknown: true }, { ...row, unresolved: true },
            { ...row, suffix: 'different' }, { ...row, dependentCursor: '' },
        ];
        for (const value of invalid) {
            // @ts-expect-error Deliberately exercise malformed runtime cleanup jobs.
            await expect(db.saveExpirationJob(row.suffix, value)).rejects.toThrow('Invalid expiration cleanup job');
        }
        expect(await db.getExpirationJobs(10)).toEqual([]);
    });

    it('invalidates a saved cleanup job when a replacement changes its expiration', async () => {
        await db.addEvent(did, agent());
        const row = (await db.getLifecycle(did))!;
        await db.saveExpirationJob(row.suffix, { ...row, type: 'agent', expiresAt: row.expiresAt! });
        await db.addEvent(did, update('2027-01-01T00:00:00Z'));
        expect(await db.getExpirationJob(row.suffix)).toBeNull();
        expect(await db.getLifecycle(did)).toMatchObject({ expiresAt: Date.parse('2027-01-01T00:00:00Z') });
        expect(await db.getEvents(did)).toHaveLength(2);
    });

    it('maintains sparse lifecycle rows and rejects stale revision and epoch deletions', async () => {
        await db.addEvent(did, agent());
        const row = (await db.getLifecycle(alias))!;
        const { epoch } = await db.getLifecycleMetadata();
        await db.addEvent(did, update('2027-01-01T00:00:00Z'));
        await expect(db.deleteEvents(alias, { epoch, revision: row.revision })).resolves.toBe(0);
        expect(await db.getEvents(did)).toHaveLength(2);
        const current = (await db.getLifecycle(did))!;
        await expect(db.deleteEvents(did, { epoch: 'old-epoch', revision: current.revision })).resolves.toBe(0);
        await expect(db.deleteEvents(did, { epoch, revision: current.revision })).resolves.toBe(1);
        expect(await db.getLifecycle(did)).toBeNull();
        expect(await db.getEvents(did)).toStrictEqual([]);
    });

    it('pages equal expiration instants by suffix, preserves equality, and never returns malformed expiry', async () => {
        await db.addEvent('did:test:b', agent('2026-01-02T01:00:00+01:00', 'did:test:b'));
        await db.addEvent('did:test:a', agent(expires, 'did:test:a'));
        await db.addEvent('did:test:c', agent('not-a-date', 'did:test:c'));
        const cutoff = Date.parse(expires);
        expect(await db.getDueDIDs(cutoff, 10)).toStrictEqual([]);
        const first = (await db.getDueDIDs(cutoff + 1, 1))[0];
        expect(first.suffix).toBe('a');
        const next = await db.getDueDIDs(cutoff + 1, 1, { expiresAt: first.expiresAt!, suffix: first.suffix });
        expect(next.map(row => row.suffix)).toStrictEqual(['b']);
        expect(await db.hasUnresolvedLifecycle()).toBe(false);
        await expect(db.getDueDIDs(cutoff, 0)).rejects.toThrow('Lifecycle limit');
    });

    it('distinguishes unknown controller coverage from an unrelated malformed expiration', async () => {
        await db.addEvent(did, agent('not-a-date'));
        expect(await db.hasUnresolvedLifecycle()).toBe(false);
        await db.setEvents('did:test:unknown', [event({ type: 'update', did: 'did:test:unknown', doc: {} }, 'did:test:unknown')]);
        expect(await db.hasUnresolvedLifecycle()).toBe(true);
        await db.deleteEvents('did:test:unknown');
        expect(await db.hasUnresolvedLifecycle()).toBe(false);
    });

    it('removes stale reverse edges after transfer or deactivation', async () => {
        const create = event({ type: 'create', created: time, controller: did,
            mdip: { version: 1, type: 'asset', registry: 'local' } }, 'did:test:asset');
        await db.addEvent('did:test:asset', create);
        expect((await db.getControlledDIDs(alias, 10)).map(row => row.suffix)).toStrictEqual(['asset']);
        const replacement = event({ type: 'update', did: 'did:test:asset', doc: {
            didDocument: { id: 'did:test:asset', controller: 'did:test:new' }, didDocumentData: {},
            mdip: { version: 1, type: 'asset', registry: 'local' },
        } }, 'did:test:asset');
        await db.addEvent('did:test:asset', replacement);
        expect(await db.getControlledDIDs(did, 10)).toStrictEqual([]);
        expect(await db.getControlledDIDs('did:test:new', 10)).toHaveLength(1);
        await db.addEvent('did:test:asset', event({ type: 'delete', did: 'did:test:asset' }, 'did:test:asset'));
        expect(await db.getControlledDIDs('did:test:new', 10)).toStrictEqual([]);
    });

    it('retains interrupted cleanup across physical removal but cancels it on renewal', async () => {
        await db.addEvent(did, agent());
        const row = (await db.getLifecycle(did))!;
        await db.saveExpirationJob(row.suffix, { ...row, dependentCursor: 'middle' });
        await db.addEvent(did, update());
        expect((await db.getExpirationJobs(10))[0].dependentCursor).toBe('middle');
        await db.deleteEvents(did);
        expect(await db.getExpirationJobs(10)).toHaveLength(1);
        await db.addEvent(did, agent('2027-01-01T00:00:00Z'));
        expect(await db.getExpirationJobs(10)).toStrictEqual([]);
    });

    it('retains interrupted cleanup when direct history replacement removes the agent', async () => {
        await db.addEvent(did, agent());
        const row = (await db.getLifecycle(did))!;
        await db.saveExpirationJob(row.suffix, { ...row, dependentCursor: 'middle' });
        await db.setEvents(did, []);
        expect(await db.getLifecycle(did)).toBeNull();
        expect(await db.getExpirationJob(row.suffix)).toMatchObject({ dependentCursor: 'middle' });
    });

    it('keeps projection consistent when a direct append contains a later create', async () => {
        await db.addEvent(did, agent(null));
        const replacement = update();
        replacement.operation.doc!.didDocument!.controller = 'did:test:current';
        await db.addEvent(did, replacement);
        const later = event({ type: 'create', created: time, controller: 'did:test:other',
            mdip: { version: 1, type: 'asset', registry: 'local', validUntil: '2099-01-01T00:00:00Z' } });
        await db.addEvent(did, later);
        expect(await db.getLifecycle(did)).toMatchObject({ type: 'agent', expiresAt: Date.parse(expires), controller: 'current' });
        await db.setEvents(did, [agent(null)]);
        await db.addEvent(did, later);
        expect(await db.getLifecycle(did)).toBeNull();
    });

    it('does not expose mutable lifecycle or job references', async () => {
        await db.addEvent(did, agent());
        const row = (await db.getLifecycle(did))!;
        await db.saveExpirationJob(row.suffix, row);
        row.expiresAt = 0;
        (await db.getLifecycle(did))!.expiresAt = 1;
        (await db.getDueDIDs(Date.parse(expires) + 1, 10))[0].expiresAt = 2;
        (await db.getExpirationJobs(10))[0].expiresAt = 3;
        (await db.getExpirationJob(row.suffix))!.expiresAt = 4;
        expect((await db.getLifecycle(did))!.expiresAt).toBe(Date.parse(expires));
        expect((await db.getExpirationJobs(10))[0].expiresAt).toBe(Date.parse(expires));
        expect((await db.getExpirationJob(row.suffix))!.expiresAt).toBe(Date.parse(expires));
        expect(await db.getExpirationJob('missing')).toBeNull();
    });
});

describe.each(adapters.slice(0, 2))('%s lifecycle durability', (_name, Adapter) => {
    let folder: string;

    beforeEach(() => { folder = fs.mkdtempSync(path.join(os.tmpdir(), 'gatekeeper-backfill-')); });
    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(folder, { recursive: true, force: true });
    });

    it.each(['version', 'epoch', 'incomplete', 'future cursor', 'missing lifecycle', 'missing jobs', 'legacy write'])(
        'rebuilds %s metadata without changing authoritative histories', async failure => {
            const db = new Adapter('test', folder);
            await db.start();
            await db.addEvent(did, agent());
            const history = await db.getEvents(did);
            const row = (await db.getLifecycle(did))!;
            const { epoch } = await db.getLifecycleMetadata();
            await db.stop();
            const file = path.join(folder, 'test.json');
            const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (failure === 'version') saved.lifecycleMetadata.version += 1;
            if (failure === 'epoch') saved.lifecycleMetadata.epoch = 'old';
            if (failure === 'incomplete') saved.lifecycleMetadata.complete = false;
            if (failure === 'future cursor') saved.lifecycleMetadata.checkedCursor = '999999';
            if (failure === 'missing lifecycle') delete saved.lifecycle;
            if (failure === 'missing jobs') delete saved.expirationJobs;
            if (failure === 'legacy write') {
                delete saved.indexChanges.at(-1).lifecycleVersion;
                saved.lifecycleMetadata.checkedCursor = '0';
            }
            if (saved.lifecycle) saved.lifecycle[row.suffix].expiresAt = Date.parse(expires) + 1000;
            fs.writeFileSync(file, JSON.stringify(saved));
            const reopened = new Adapter('test', folder);
            try {
                if (['version', 'epoch', 'incomplete', 'missing lifecycle', 'missing jobs'].includes(failure)) {
                    await expect(reopened.getLifecycleMetadata()).rejects.toThrow('not initialized');
                }
                if (['version', 'epoch', 'incomplete', 'missing lifecycle'].includes(failure)) {
                    await expect(reopened.deleteEvents(did, { epoch, revision: row.revision })).resolves.toBe(0);
                }
                await reopened.start();
                expect(await reopened.getLifecycleMetadata()).toMatchObject({
                    complete: true, epoch, checkedCursor: String(saved.indexSeq),
                });
                expect(await reopened.getEvents(did)).toEqual(history);
                expect(await reopened.getLifecycle(did)).toMatchObject({ expiresAt: Date.parse(expires), type: 'agent' });
            } finally { await reopened.stop(); }
        },
    );

    it('resumes interrupted backfill without re-projecting committed pages or changing histories', async () => {
        const histories: Record<string, GatekeeperEvent[]> = {};
        for (let i = 0; i < 205; i++) {
            const suffix = String(i).padStart(5, '0');
            histories[suffix] = [agent(expires, `did:test:${suffix}`)];
        }
        const file = path.join(folder, 'test.json');
        fs.writeFileSync(file, JSON.stringify({ dids: histories }));
        let writes = 0;
        const rename = fs.renameSync;
        jest.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
            if (++writes === 3) throw new Error('interrupted backfill');
            rename(source, destination);
        });
        const db = new Adapter('test', folder);
        await expect(db.start()).rejects.toThrow('interrupted backfill');
        const partial = JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(partial.lifecycleMetadata).toMatchObject({ complete: false, backfillCursor: '00099' });
        expect(Object.keys(partial.lifecycle)).toHaveLength(100);
        const firstRevision = partial.lifecycle['00000'].revision;
        jest.restoreAllMocks();
        const reopened = new Adapter('test', folder);
        await reopened.start();
        expect((await reopened.getLifecycleMetadata()).complete).toBe(true);
        expect((await reopened.getLifecycle('did:test:00000'))!.revision).toBe(firstRevision);
        const complete = JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(Object.keys(complete.lifecycle)).toHaveLength(205);
        expect(complete.dids).toStrictEqual(histories);
        await reopened.stop();
    });

    it('does not overwrite persisted history or metadata when a mutation fails', async () => {
        const db = new Adapter('test', folder);
        await db.start();
        await db.addEvent(did, agent());
        const original = await db.getLifecycle(did);
        jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk failure'); });
        await expect(db.addEvent(did, update('2027-01-01T00:00:00Z'))).rejects.toThrow('disk failure');
        expect(await db.getLifecycle(did)).toStrictEqual(original);
        expect(await db.getEvents(did)).toHaveLength(1);
        await db.stop();
    });

    it('does not rewrite an unchanged initialized database on subsequent checks', async () => {
        const db = new Adapter('test', folder);
        await db.start();
        const rename = jest.spyOn(fs, 'renameSync');
        await db.initializeLifecycleIndex();
        expect(rename).not.toHaveBeenCalled();
        await db.stop();
    });
});
