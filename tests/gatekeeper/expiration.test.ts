import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { EcdsaJwkPair } from '@mdip/cipher/types';
import type { ExpirationContinuation, Operation } from '@mdip/gatekeeper/types';
import TestHelper from './helper.ts';

const cipher = new CipherNode();
const silent = { log() {}, error() {} } as unknown as typeof console;

function latch() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

async function fixture() {
    const db = new DbJsonMemory('expiration');
    await db.start();
    const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false, console: silent });
    const helper = new TestHelper(gatekeeper, cipher);
    let sequence = 0;
    function unique(operation: Operation, keypair: EcdsaJwkPair): Operation {
        operation.data = { fixture: ++sequence };
        const unsigned = { ...operation };
        delete unsigned.signature;
        const hash = cipher.hashJSON(unsigned);
        operation.signature = { ...operation.signature!, hash, value: cipher.signHash(hash, keypair.privateJwk) };
        return operation;
    }
    async function agent(validUntil?: string, prefix?: string) {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(unique(await helper.createAgentOp(keypair, { validUntil, prefix }), keypair));
        return { did, keypair };
    }
    async function asset(owner: { did: string; keypair: EcdsaJwkPair }, validUntil?: string) {
        const did = await gatekeeper.createDID(unique(await helper.createAssetOp(owner.did, owner.keypair, { validUntil }), owner.keypair));
        return did;
    }
    return { db, gatekeeper, helper, agent, asset };
}

async function collect(gatekeeper: Gatekeeper, limit = 100) {
    let continuation: ExpirationContinuation | undefined;
    const totals = { examined: 0, expired: 0, deferred: 0, pages: 0 };
    do {
        const page = await gatekeeper.collectExpiredDIDs({ limit, continuation });
        expect(page.examined).toBeLessThanOrEqual(limit);
        totals.examined += page.examined;
        totals.expired += page.expired;
        totals.deferred += page.deferred;
        totals.pages += 1;
        expect(totals.pages).toBeLessThan(200);
        continuation = page.continuation;
    } while (continuation);
    return totals;
}

beforeEach(() => jest.restoreAllMocks());

describe('indexed expiration collection', () => {
    it.each(['missing', 'unresolved', 'agent'])('defers a stale asset candidate whose lifecycle is %s', async state => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent();
        const due = await asset(owner, new Date(Date.now() - 1000).toISOString());
        const row = (await db.getLifecycle(due))!;
        const read = jest.spyOn(db, 'getLifecycle').mockResolvedValueOnce(state === 'missing' ? null
            : { ...row, ...(state === 'unresolved' ? { unresolved: true } : { type: 'agent' as const }) });
        expect(await collect(gatekeeper)).toMatchObject({ expired: 0, deferred: 1 });
        read.mockRestore();
        expect(await db.getEvents(due)).toHaveLength(1);
        expect(await collect(gatekeeper)).toMatchObject({ expired: 1 });
    });

    it('retains dependents when a selected orphan cleanup job disappears', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        const child = await asset(owner);
        await gatekeeper.collectExpiredDIDs({ limit: 1 });
        await gatekeeper.removeDIDs([owner.did]);
        const query = db.getExpirationJobs.bind(db);
        jest.spyOn(db, 'getExpirationJobs').mockImplementationOnce(async (...args) => {
            const rows = await query(...args);
            await db.saveExpirationJob(rows[0].suffix, null);
            return rows;
        });
        expect(await collect(gatekeeper)).toMatchObject({ expired: 0, deferred: 1 });
        expect(await db.getEvents(child)).toHaveLength(1);
    });

    it('revalidates a selected cleanup job after its agent is renewed', async () => {
        const { db, gatekeeper, helper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        const child = await asset(owner);
        await gatekeeper.collectExpiredDIDs({ limit: 1 });
        const query = db.getExpirationJobs.bind(db);
        jest.spyOn(db, 'getExpirationJobs').mockImplementationOnce(async (...args) => {
            const rows = await query(...args);
            const doc = await gatekeeper.resolveDID(owner.did);
            delete doc.mdip!.validUntil;
            await gatekeeper.updateDID(await helper.createUpdateOp(owner.keypair, owner.did, doc));
            return rows;
        });
        expect(await collect(gatekeeper)).toMatchObject({ expired: 0, deferred: 1 });
        expect(await db.getEvents(child)).toHaveLength(1);
        expect(await db.getExpirationJobs(1)).toEqual([]);
    });

    it('reselects dependents after a saved cleanup cursor changes', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        await asset(owner);
        await gatekeeper.collectExpiredDIDs({ limit: 1 });
        const query = db.getControlledDIDs.bind(db);
        jest.spyOn(db, 'getControlledDIDs').mockImplementationOnce(async (...args) => {
            const rows = await query(...args);
            const job = (await db.getExpirationJob(owner.did.split(':').pop()!))!;
            await db.saveExpirationJob(job.suffix, { ...job, dependentCursor: rows[0].suffix });
            return rows;
        });
        const page = await gatekeeper.collectExpiredDIDs({ limit: 2 });
        expect(page).toMatchObject({ examined: 1, expired: 0, hasMore: true });
        expect(await collect(gatekeeper)).toMatchObject({ expired: 2 });
    });

    it('continues safely when a selected dependent is already removed', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        const child = await asset(owner);
        const query = db.getControlledDIDs.bind(db);
        jest.spyOn(db, 'getControlledDIDs').mockImplementationOnce(async (...args) => {
            const rows = await query(...args);
            await db.deleteEvents(child);
            return rows;
        });
        expect(await collect(gatekeeper)).toMatchObject({ expired: 1, deferred: 0 });
        expect(await gatekeeper.getDIDs()).toEqual([]);
    });

    it.each(['metadata', 'resolution', 'revision'])('retains a dependent after failed %s revalidation', async failure => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        const child = await asset(owner);
        const lifecycle = db.getLifecycle.bind(db);
        const resolve = gatekeeper.resolveDID.bind(gatekeeper);
        const remove = db.deleteEvents.bind(db);
        const read = jest.spyOn(db, 'getLifecycle').mockImplementation(did =>
            failure === 'metadata' && did === child ? Promise.resolve(null) : lifecycle(did));
        const resolution = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation((did, options) =>
            failure === 'resolution' && did === child
                ? Promise.resolve({ didResolutionMetadata: { error: 'internalError' } }) : resolve(did, options));
        const deletion = jest.spyOn(db, 'deleteEvents').mockImplementation((did, options) =>
            failure === 'revision' && did === child ? Promise.resolve(0) : remove(did, options));
        expect(await collect(gatekeeper)).toMatchObject({ expired: 0, deferred: 1 });
        expect(await db.getEvents(child)).toHaveLength(1);
        read.mockRestore();
        resolution.mockRestore();
        deletion.mockRestore();
        expect(await collect(gatekeeper)).toMatchObject({ expired: 2 });
    });

    it('retains an agent and its cleanup job after a guarded deletion is rejected', async () => {
        const { db, gatekeeper, agent } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        const remove = jest.spyOn(db, 'deleteEvents').mockResolvedValue(0);
        expect(await collect(gatekeeper)).toMatchObject({ expired: 0, deferred: 1 });
        expect(await db.getEvents(owner.did)).toHaveLength(1);
        expect(await db.getExpirationJobs(1)).toHaveLength(1);
        remove.mockRestore();
        expect(await collect(gatekeeper)).toMatchObject({ expired: 1 });
    });

    it('only resolves due candidates and does no full scan, audit or backfill', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent();
        const due = await asset(owner, new Date(Date.now() - 1000).toISOString());
        await asset(owner, new Date(Date.now() + 60000).toISOString());
        await agent();
        const getDIDs = jest.spyOn(gatekeeper, 'getDIDs').mockRejectedValue(new Error('full scan'));
        const check = jest.spyOn(gatekeeper, 'checkDIDs').mockRejectedValue(new Error('statistics scan'));
        const verify = jest.spyOn(gatekeeper, 'verifyCreateOperation').mockRejectedValue(new Error('signature replay'));
        const initialize = jest.spyOn(db, 'initializeLifecycleIndex').mockRejectedValue(new Error('backfill'));
        const reads = jest.spyOn(db, 'getEvents');
        expect(await collect(gatekeeper)).toMatchObject({ expired: 1, deferred: 0 });
        expect(new Set(reads.mock.calls.map(([did]) => did))).toStrictEqual(new Set([due]));
        expect(getDIDs).not.toHaveBeenCalled();
        expect(check).not.toHaveBeenCalled();
        expect(verify).not.toHaveBeenCalled();
        expect(initialize).not.toHaveBeenCalled();
    });

    it('uses strict expiry equality and respects timezone offsets', async () => {
        const { gatekeeper, agent, asset } = await fixture();
        const owner = await agent();
        const cutoff = Date.now();
        const equal = await asset(owner, new Date(cutoff).toISOString());
        await asset(owner, new Date(cutoff - 1).toISOString());
        jest.spyOn(Date, 'now').mockReturnValue(cutoff);
        expect(await collect(gatekeeper)).toMatchObject({ expired: 1 });
        expect((await gatekeeper.resolveDID(equal)).didDocumentMetadata?.version).toBe('1');
        jest.spyOn(Date, 'now').mockReturnValue(cutoff + 1);
        expect(await collect(gatekeeper)).toMatchObject({ expired: 1 });
    });

    it('rejects invalid page sizes and forged future or malformed continuations', async () => {
        const { db, gatekeeper } = await fixture();
        for (const limit of [0, -1, 1.5, Infinity, 1001]) {
            await expect(gatekeeper.collectExpiredDIDs({ limit })).rejects.toThrow('Lifecycle limit');
        }
        const epoch = (await db.getLifecycleMetadata()).epoch;
        const pass = { epoch, cutoff: Date.now(), dueComplete: false, jobsComplete: false };
        await expect(gatekeeper.collectExpiredDIDs({ continuation: { ...pass, cutoff: Date.now() + 60000 } })).rejects.toThrow('continuation');
        await expect(gatekeeper.collectExpiredDIDs({ continuation: { ...pass, dueCursor: { expiresAt: NaN, suffix: '' } } })).rejects.toThrow('continuation');
        await expect(gatekeeper.collectExpiredDIDs({ continuation: { ...pass, epoch: 'old' } })).rejects.toThrow('reset');
    });

    it('prunes direct dependents before a custom-prefix agent with limit one', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString(), 'did:custom');
        const children = await Promise.all([asset(owner), asset(owner), asset(owner)]);
        const removed = jest.spyOn(db, 'deleteEvents');
        expect(await collect(gatekeeper, 1)).toMatchObject({ expired: 4, deferred: 0 });
        expect(removed.mock.calls.map(([did]) => did)).toEqual(expect.arrayContaining(children));
        expect(removed.mock.calls.at(-1)?.[0]).toBe(owner.did);
        expect(await gatekeeper.getDIDs()).toStrictEqual([]);
    });

    it('keeps already removed children removed when the agent is renewed between batches', async () => {
        const { db, gatekeeper, helper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        await asset(owner);
        await asset(owner);
        const page = await gatekeeper.collectExpiredDIDs({ limit: 2 });
        expect(page.expired).toBe(1);
        const doc = await gatekeeper.resolveDID(owner.did);
        doc.mdip!.validUntil = new Date(Date.now() + 60000).toISOString();
        await gatekeeper.updateDID(await helper.createUpdateOp(owner.keypair, owner.did, doc));
        expect(await collect(gatekeeper)).toMatchObject({ expired: 0 });
        expect(await db.getExpirationJob(owner.did.split(':').pop()!)).toBeNull();
        expect(await gatekeeper.getDIDs()).toHaveLength(2);
    });

    it('revalidates a renewal occurring after candidate selection', async () => {
        const { db, gatekeeper, helper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        await asset(owner);
        const query = db.getDueDIDs.bind(db);
        jest.spyOn(db, 'getDueDIDs').mockImplementationOnce(async (...args) => {
            const stale = await query(...args);
            const doc = await gatekeeper.resolveDID(owner.did);
            delete doc.mdip!.validUntil;
            await gatekeeper.updateDID(await helper.createUpdateOp(owner.keypair, owner.did, doc));
            return stale;
        });
        expect(await collect(gatekeeper)).toMatchObject({ expired: 0 });
        expect(await gatekeeper.getDIDs()).toHaveLength(2);
    });

    it('retains a dependent transferred after its old controller page was read', async () => {
        const { db, gatekeeper, helper, agent, asset } = await fixture();
        const expired = await agent(new Date(Date.now() - 1000).toISOString());
        const live = await agent();
        const child = await asset(expired);
        const query = db.getControlledDIDs.bind(db);
        jest.spyOn(db, 'getControlledDIDs').mockImplementationOnce(async (...args) => {
            const stale = await query(...args);
            const doc = await gatekeeper.resolveDID(child);
            doc.didDocument!.controller = live.did;
            await gatekeeper.updateDID(await helper.createUpdateOp(expired.keypair, child, doc));
            return stale;
        });
        expect(await collect(gatekeeper)).toMatchObject({ expired: 1 });
        expect((await gatekeeper.resolveDID(child)).didDocument?.controller).toBe(live.did);
    });

    it('preserves a failed candidate without counting it twice or exceeding the page budget', async () => {
        const { gatekeeper, agent, asset } = await fixture();
        const owner = await agent();
        const due = await asset(owner, new Date(Date.now() - 1000).toISOString());
        const resolve = gatekeeper.resolveDID.bind(gatekeeper);
        const spy = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            if (did === due) throw new Error('transient outage');
            return resolve(did, options);
        });
        expect(await collect(gatekeeper, 1)).toMatchObject({ expired: 0, deferred: 1, examined: 1 });
        spy.mockRestore();
        expect(await collect(gatekeeper)).toMatchObject({ expired: 1 });
    });

    it('counts repeated catalog candidates against the work limit under continuous changes', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent();
        const due = await asset(owner, new Date(Date.now() - 1000).toISOString());
        const row = (await db.getLifecycle(due))!;
        let calls = 0;
        const query = jest.spyOn(db, 'getDueDIDs').mockImplementation(async () => [{ ...row, expiresAt: row.expiresAt! + ++calls }]);
        const resolve = gatekeeper.resolveDID.bind(gatekeeper);
        jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            const doc = await resolve(did, options);
            if (did === due) doc.mdip!.validUntil = new Date(Date.now() + 60000).toISOString();
            return doc;
        });
        expect(await gatekeeper.collectExpiredDIDs({ limit: 3 })).toMatchObject({ examined: 3, expired: 0, deferred: 1, hasMore: true });
        expect(query).toHaveBeenCalledTimes(3);
    });

    it('continues past a failing dependent and retries it in the next pass', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        await Promise.all([asset(owner), asset(owner), asset(owner)]);
        const first = (await db.getControlledDIDs(owner.did, 1))[0].did;
        const resolve = gatekeeper.resolveDID.bind(gatekeeper);
        const spy = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            if (did === first) throw new Error('temporary child failure');
            return resolve(did, options);
        });
        expect(await collect(gatekeeper, 2)).toMatchObject({ expired: 2 });
        expect(await gatekeeper.getDIDs()).toHaveLength(2);
        spy.mockRestore();
        expect(await collect(gatekeeper, 2)).toMatchObject({ expired: 2 });
    });

    it('finds interrupted cleanup after independent agent removal and a restart', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        await Promise.all([asset(owner), asset(owner), asset(owner)]);
        expect(await gatekeeper.collectExpiredDIDs({ limit: 2 })).toMatchObject({ expired: 1 });
        await gatekeeper.removeDIDs([owner.did]);
        const restarted = new Gatekeeper({ db, ipfsEnabled: false, console: silent });
        expect(await collect(restarted, 1)).toMatchObject({ expired: 2 });
        expect(await db.getExpirationJobs(1)).toStrictEqual([]);
        expect(await restarted.getDIDs()).toStrictEqual([]);
    });

    it('does not interpret an absent controller without a durable job as expired', async () => {
        const { gatekeeper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        const child = await asset(owner);
        await gatekeeper.removeDIDs([owner.did]);
        expect(await collect(gatekeeper)).toMatchObject({ expired: 0 });
        expect((await gatekeeper.resolveDID(child)).didDocument).toBeDefined();
    });

    it('does not cascade merely because an agent was deactivated', async () => {
        const { gatekeeper, helper, agent, asset } = await fixture();
        const owner = await agent();
        await asset(owner);
        await gatekeeper.deleteDID(await helper.createDeleteOp(owner.keypair, owner.did));
        expect(await collect(gatekeeper)).toMatchObject({ expired: 0 });
        expect(await gatekeeper.getDIDs()).toHaveLength(2);
    });

    it('retains expiry semantics when deactivation preserves validUntil', async () => {
        const { gatekeeper, helper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        await asset(owner);
        await gatekeeper.deleteDID(await helper.createDeleteOp(owner.keypair, owner.did));
        expect(await collect(gatekeeper)).toMatchObject({ expired: 2 });
    });

    it('prunes direct dependents without adding transitive pruning rules', async () => {
        const { gatekeeper, helper, agent, asset } = await fixture();
        const expired = await agent(new Date(Date.now() - 1000).toISOString());
        const live = await agent();
        const direct = await asset(expired);
        const indirect = await asset(live);
        const doc = await gatekeeper.resolveDID(indirect);
        doc.didDocument!.controller = direct;
        await gatekeeper.updateDID(await helper.createUpdateOp(live.keypair, indirect, doc));
        expect(await collect(gatekeeper)).toMatchObject({ expired: 2 });
        expect((await gatekeeper.resolveDID(indirect)).didDocument?.controller).toBe(direct);
    });

    it('does not let an unrelated malformed expiry stall an agent cascade', async () => {
        const { gatekeeper, helper, agent, asset } = await fixture();
        const expired = await agent(new Date(Date.now() - 1000).toISOString());
        await asset(expired);
        const malformed = await agent();
        const doc = await gatekeeper.resolveDID(malformed.did);
        doc.mdip!.validUntil = 'not-a-date';
        await gatekeeper.updateDID(await helper.createUpdateOp(malformed.keypair, malformed.did, doc));
        expect(await collect(gatekeeper)).toMatchObject({ expired: 2 });
        expect(await gatekeeper.getDIDs()).toHaveLength(1);
    });

    it('does not let a signed empty controller stall unrelated expiration cleanup', async () => {
        const { gatekeeper, helper, agent, asset } = await fixture();
        const expired = await agent(new Date(Date.now() - 1000).toISOString());
        await asset(expired);
        const unrelated = await agent();
        const doc = await gatekeeper.resolveDID(unrelated.did);
        doc.didDocument!.controller = '';
        expect(await gatekeeper.updateDID(await helper.createUpdateOp(unrelated.keypair, unrelated.did, doc))).toBe(true);
        expect(await collect(gatekeeper)).toMatchObject({ expired: 2 });
        expect(await gatekeeper.getDIDs()).toHaveLength(1);
    });

    it('uses controller expiry even when the dependent has a malformed own expiry', async () => {
        const { gatekeeper, helper, agent, asset } = await fixture();
        const expired = await agent(new Date(Date.now() - 1000).toISOString());
        const child = await asset(expired);
        const doc = await gatekeeper.resolveDID(child);
        doc.mdip!.validUntil = 'not-a-date';
        await gatekeeper.updateDID(await helper.createUpdateOp(expired.keypair, child, doc));
        expect(await collect(gatekeeper)).toMatchObject({ expired: 2 });
    });

    it('blocks cascades only while controller coverage is genuinely unknown', async () => {
        const { db, gatekeeper, helper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        await asset(owner);
        const unrelated = await agent();
        const malformed = await asset(unrelated);
        const original = await db.getEvents(malformed);
        const doc = await gatekeeper.resolveDID(malformed);
        doc.didDocument!.controller = true as unknown as string;
        const operation = await helper.createUpdateOp(unrelated.keypair, malformed, doc);
        await db.addEvent(malformed, { operation, time: operation.signature!.signed, registry: 'local' });
        expect(await collect(gatekeeper)).toMatchObject({ expired: 0, deferred: 1 });
        await db.setEvents(malformed, original);
        expect(await collect(gatekeeper)).toMatchObject({ expired: 2 });
        expect(await gatekeeper.getDIDs()).toHaveLength(2);
    });

    it('retains an expired controller until a failed dependent lookup can be retried', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        await asset(owner);
        jest.spyOn(db, 'getControlledDIDs').mockRejectedValueOnce(new Error('dependency lookup unavailable'));
        expect(await collect(gatekeeper)).toMatchObject({ expired: 0, deferred: 1 });
        expect(await gatekeeper.getDIDs()).toHaveLength(2);
        expect(await collect(gatekeeper)).toMatchObject({ expired: 2 });
    });

    it('revisits a dependent arriving before a saved cursor instead of losing it', async () => {
        const { gatekeeper, helper, agent } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        const candidates: Array<{ did: string; operation: Operation }> = [];
        for (let index = 0; index < 3; index += 1) {
            const operation = await helper.createAssetOp(owner.did, owner.keypair);
            operation.data = { order: index };
            const unsigned = { ...operation };
            delete unsigned.signature;
            operation.signature!.hash = cipher.hashJSON(unsigned);
            operation.signature!.value = cipher.signHash(operation.signature!.hash, owner.keypair.privateJwk);
            candidates.push({ operation, did: await gatekeeper.generateDID(operation) });
        }
        candidates.sort((left, right) => left.did < right.did ? -1 : 1);
        await gatekeeper.createDID(candidates[1].operation);
        await gatekeeper.createDID(candidates[2].operation);
        const initial = await gatekeeper.collectExpiredDIDs({ limit: 2 });
        expect(initial.expired).toBe(1);
        await gatekeeper.createDID(candidates[0].operation);
        let continuation = initial.continuation;
        let expired = 0;
        for (let pages = 0; continuation && pages < 20; pages += 1) {
            const page = await gatekeeper.collectExpiredDIDs({ limit: 2, continuation });
            expired += page.expired;
            continuation = page.continuation;
        }
        expect(continuation).toBeUndefined();
        expect(expired).toBe(1);
        expect(await gatekeeper.getDIDs()).toHaveLength(2);
        expect(await collect(gatekeeper, 2)).toMatchObject({ expired: 2 });
    });

    it('keeps expiry state and interrupted jobs when reset fails before mutation', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        await asset(owner);
        await gatekeeper.collectExpiredDIDs({ limit: 1 });
        const jobs = await db.getExpirationJobs(1);
        const spy = jest.spyOn(db, 'resetDb').mockRejectedValueOnce(new Error('reset failed'));
        await expect(gatekeeper.resetDb()).rejects.toThrow('reset failed');
        expect(await db.getExpirationJobs(1)).toStrictEqual(jobs);
        spy.mockRestore();
        expect(await collect(gatekeeper, 1)).toMatchObject({ expired: 2 });
    });

    it('preserves successful deletion counts if a later progress write fails', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        await Promise.all([asset(owner), asset(owner)]);
        const save = db.saveExpirationJob.bind(db);
        let calls = 0;
        const spy = jest.spyOn(db, 'saveExpirationJob').mockImplementation(async (...args) => {
            if (++calls === 2) throw new Error('progress persistence failed');
            return save(...args);
        });
        const result = await gatekeeper.collectExpiredDIDs({ limit: 2 });
        expect(result).toMatchObject({ expired: 1, examined: 2, deferred: 1 });
        expect(await gatekeeper.getDIDs()).toHaveLength(2);
        spy.mockRestore();
        expect(await collect(gatekeeper, 1)).toMatchObject({ expired: 2 });
    });

    it('attaches completed progress if the index becomes unreadable after a deletion', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent();
        const due = await asset(owner, new Date(Date.now() - 1000).toISOString());
        let fail = false;
        const metadata = db.getLifecycleMetadata.bind(db);
        jest.spyOn(db, 'getLifecycleMetadata').mockImplementation(async () => {
            if (fail) throw new Error('database unavailable');
            return metadata();
        });
        const remove = db.deleteEvents.bind(db);
        jest.spyOn(db, 'deleteEvents').mockImplementation(async (...args) => {
            const result = await remove(...args);
            if (args[0] === due) fail = true;
            return result;
        });
        await expect(gatekeeper.collectExpiredDIDs()).rejects.toMatchObject({ progress: { examined: 1, expired: 1, deferred: 0 } });
        expect(await db.getEvents(due)).toStrictEqual([]);
    });

    it('keeps explicit auditing behind an active collector maintenance section', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent();
        const due = await asset(owner, new Date(Date.now() - 1000).toISOString());
        const entered = latch();
        const release = latch();
        const remove = db.deleteEvents.bind(db);
        jest.spyOn(db, 'deleteEvents').mockImplementation(async (...args) => {
            if (args[0] === due) { entered.resolve(); await release.promise; }
            return remove(...args);
        });
        const cleanup = collect(gatekeeper);
        await entered.promise;
        const catalog = jest.spyOn(gatekeeper, 'getDIDs');
        const audit = gatekeeper.verifyDb({ chatty: false });
        await Promise.resolve();
        expect(catalog).not.toHaveBeenCalled();
        release.resolve();
        await cleanup;
        expect(await audit).toMatchObject({ verified: 1, expired: 0, invalid: 0 });
    });

    it('serializes a deletion with reset and invalidates the old pass', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent();
        const due = await asset(owner, new Date(Date.now() - 1000).toISOString());
        const entered = latch();
        const release = latch();
        const remove = db.deleteEvents.bind(db);
        jest.spyOn(db, 'deleteEvents').mockImplementation(async (...args) => {
            if (args[0] === due) { entered.resolve(); await release.promise; }
            return remove(...args);
        });
        const reset = jest.spyOn(db, 'resetDb');
        const cleanup = gatekeeper.collectExpiredDIDs().catch(error => error as Error);
        await entered.promise;
        const resetting = gatekeeper.resetDb();
        await Promise.resolve();
        expect(reset).not.toHaveBeenCalled();
        release.resolve();
        await resetting;
        expect(await cleanup).toBeInstanceOf(Error);
        expect(await gatekeeper.getDIDs()).toStrictEqual([]);
    });

    it('does not write selected expiry candidates after reset has replaced the store', async () => {
        const { db, gatekeeper, agent, asset } = await fixture();
        const owner = await agent();
        await asset(owner, new Date(Date.now() - 1000).toISOString());
        const entered = latch();
        const release = latch();
        const selected = latch();
        const reset = db.resetDb.bind(db);
        jest.spyOn(db, 'resetDb').mockImplementation(async () => {
            entered.resolve();
            await release.promise;
            return reset();
        });
        const query = db.getDueDIDs.bind(db);
        jest.spyOn(db, 'getDueDIDs').mockImplementation(async (...args) => {
            const page = await query(...args);
            selected.resolve();
            return page;
        });
        const remove = jest.spyOn(db, 'deleteEvents');
        const resetting = gatekeeper.resetDb();
        await entered.promise;
        const cleanup = gatekeeper.collectExpiredDIDs().catch(error => error as Error);
        await selected.promise;
        release.resolve();
        await resetting;
        expect(await cleanup).toBeInstanceOf(Error);
        expect(remove).not.toHaveBeenCalled();
    });

    it('copies a create operation before waiting for its graph boundary', async () => {
        const { gatekeeper, helper, agent } = await fixture();
        const owner = await agent();
        const operation = await helper.createAssetOp(owner.did, owner.keypair);
        const original = JSON.parse(JSON.stringify(operation)) as Operation;
        const intended = await gatekeeper.generateDID(original);
        const entered = latch();
        const release = latch();
        const generate = gatekeeper.generateDID.bind(gatekeeper);
        const spy = jest.spyOn(gatekeeper, 'generateDID').mockImplementationOnce(async input => {
            entered.resolve();
            await release.promise;
            return generate(input);
        });
        const creating = gatekeeper.createDID(operation);
        await entered.promise;
        operation.data = 'mutated after submission';
        release.resolve();
        try {
            expect(await creating).toBe(intended);
            expect((await gatekeeper.exportDID(intended))[0].operation).toStrictEqual(original);
        } finally { spy.mockRestore(); }
    });

    it('does not admit an asset after its controller is pruned in the graph boundary', async () => {
        const { db, gatekeeper, helper, agent } = await fixture();
        const owner = await agent(new Date(Date.now() - 1000).toISOString());
        const operation = await helper.createAssetOp(owner.did, owner.keypair);
        const assetDID = await gatekeeper.generateDID(operation);
        const entered = latch();
        const release = latch();
        const remove = db.deleteEvents.bind(db);
        jest.spyOn(db, 'deleteEvents').mockImplementation(async (...args) => {
            if (args[0] === owner.did) { entered.resolve(); await release.promise; }
            return remove(...args);
        });
        const cleanup = collect(gatekeeper);
        await entered.promise;
        const creating = gatekeeper.createDID(operation).catch(error => error as Error);
        release.resolve();
        await cleanup;
        expect(await creating).toBeInstanceOf(Error);
        expect(await db.getEvents(assetDID)).toStrictEqual([]);
    });
});
