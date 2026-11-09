import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import HeliaClient from '@mdip/ipfs/helia';
import { jest } from '@jest/globals';
import TestHelper from './helper.ts';

const mockConsole = {
    log: (): void => { },
    error: (): void => { },
    time: (): void => { },
    timeEnd: (): void => { },
} as unknown as typeof console;

const cipher = new CipherNode();
const db = new DbJsonMemory('test');
const ipfs = new HeliaClient();
const gatekeeper = new Gatekeeper({ db, ipfs, console: mockConsole, registries: ['local', 'hyperswarm', 'TFTC'] });
const helper = new TestHelper(gatekeeper, cipher);

beforeAll(async () => {
    await db.start();
    await ipfs.start();
});

afterAll(async () => {
    await ipfs.stop();
    await db.stop();
});

beforeEach(async () => {
    await gatekeeper.resetDb();  // Reset database for each test to ensure isolation
});

describe('verifyDb', () => {
    it('reports a catalog entry without history as incomplete without removing the entry', async () => {
        const did = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        await db.setEvents(did, []);
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('missing or cyclic controller history');
        expect(await gatekeeper.getDIDs()).toContain(did);
        expect(await db.getEvents(did)).toEqual([]);
    });

    it.each(['empty', 'missing method', 'missing JWK'])(
        'retains a historical update whose previous signing key is %s', async state => {
            const pair = cipher.generateRandomJwk();
            const did = await gatekeeper.createDID(await helper.createAgentOp(pair));
            const doc = await gatekeeper.resolveDID(did);
            if (state === 'empty') doc.didDocument!.verificationMethod = [];
            if (state === 'missing method') delete doc.didDocument!.verificationMethod;
            if (state === 'missing JWK') delete doc.didDocument!.verificationMethod![0].publicKeyJwk;
            await expect(gatekeeper.updateDID(await helper.createUpdateOp(pair, did, doc))).resolves.toBe(true);
            const replacement = await gatekeeper.resolveDID(did);
            replacement.didDocumentData = { restored: true };
            const operation = await helper.createUpdateOp(pair, did, replacement);
            await db.addEvent(did, { did, registry: 'local', time: operation.signature!.signed, operation });
            const before = await db.getEvents(did);
            await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('unavailable signing key');
            expect(await db.getEvents(did)).toEqual(before);
        },
    );

    it('retains an asset when its signing time predates the controller history', async () => {
        const pair = cipher.generateRandomJwk();
        const anchor = await helper.createAgentOp(pair);
        const owner = await gatekeeper.createDID(anchor);
        const operation = await helper.createAssetOp(owner, pair);
        operation.signature!.signed = new Date(Date.parse(anchor.created!) - 1).toISOString();
        const asset = await gatekeeper.generateDID(operation);
        await db.addEvent(asset, { did: asset, registry: 'local', time: operation.created!, operation });
        const events = await db.getEvents(asset);
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('unavailable controller');
        expect(await db.getEvents(asset)).toEqual(events);
        expect(await db.getEvents(owner)).toHaveLength(1);
    });

    it('preserves a history whose envelope timestamp cannot be resolved during an audit', async () => {
        const did = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        const events = await db.getEvents(did);
        events[0].time = 'invalid';
        await db.setEvents(did, events);
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('history cannot be verified');
        expect(await db.getEvents(did)).toEqual(events);
    });

    it('repairs more than one expiration page after verifying all snapshot histories', async () => {
        const validUntil = new Date(Date.now() - 1000).toISOString();
        for (let index = 0; index < 101; index += 1) {
            await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk(), { validUntil }));
        }
        await expect(gatekeeper.verifyDb({ chatty: false })).resolves.toEqual({
            total: 101, verified: 0, invalid: 0, expired: 101,
        });
        expect(await gatekeeper.getDIDs()).toEqual([]);
    });

    it('audits asset controllers through their historical chain of signing keys', async () => {
        const pair = cipher.generateRandomJwk();
        const owner = await gatekeeper.createDID(await helper.createAgentOp(pair));
        const controller = await gatekeeper.createDID(await helper.createAssetOp(owner, pair, {
            validUntil: '2099-01-01T00:00:00Z',
        }));
        const asset = await gatekeeper.createDID(await helper.createAssetOp(owner, pair));
        const doc = await gatekeeper.resolveDID(asset);
        doc.didDocument!.controller = controller;
        await expect(gatekeeper.updateDID(await helper.createUpdateOp(pair, asset, doc))).resolves.toBe(true);
        const replacement = await gatekeeper.resolveDID(asset);
        replacement.didDocumentData = { nested: true };
        await expect(gatekeeper.updateDID(await helper.createUpdateOp(pair, asset, replacement))).resolves.toBe(true);
        const before = await gatekeeper.exportDIDs([owner, controller, asset]);
        await expect(gatekeeper.verifyDb({ chatty: false })).resolves.toEqual({
            total: 3, verified: 3, invalid: 0, expired: 0,
        });
        expect(await gatekeeper.exportDIDs([owner, controller, asset])).toEqual(before);
    });

    it('reports a history removed after cryptographic verification as an incomplete audit', async () => {
        const did = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        const read = db.getEvents.bind(db);
        let reads = 0;
        const history = jest.spyOn(db, 'getEvents').mockImplementation(async target => {
            if (target === did && ++reads === 2) await gatekeeper.removeDIDs([did]);
            return read(target);
        });
        try {
            await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('history removed concurrently');
            expect(await db.getEvents(did)).toEqual([]);
        } finally { history.mockRestore(); }
    });
    it.each(['missing signature', 'invalid timestamp', 'missing key', 'unsupported curve'])(
        'preserves a history with %s when cryptographic auditing cannot establish invalidity', async failure => {
            const did = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
            const events = await db.getEvents(did);
            const operation = events[0].operation;
            if (failure === 'missing signature') delete operation.signature;
            if (failure === 'invalid timestamp') operation.signature!.signed = 'invalid';
            if (failure === 'missing key') delete operation.publicJwk;
            if (failure === 'unsupported curve') {
                // @ts-expect-error Exercise unsupported persisted key material.
                operation.publicJwk!.crv = 'P-256';
            }
            await db.setEvents(did, events);
            const reason = failure === 'missing signature' || failure === 'invalid timestamp'
                ? 'unsupported signature structure' : 'unsupported signing key';
            await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow(reason);
            expect(await db.getEvents(did)).toEqual(events);
        },
    );

    it('preserves stored histories when the cryptographic provider fails during an audit', async () => {
        const did = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        const before = await db.getEvents(did);
        const verify = jest.spyOn(CipherNode.prototype, 'verifySig').mockImplementationOnce(() => {
            throw new Error('provider unavailable');
        });
        try {
            await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('unsupported cryptographic input');
            expect(await db.getEvents(did)).toEqual(before);
        } finally { verify.mockRestore(); }
        await expect(gatekeeper.verifyDb({ chatty: false })).resolves.toMatchObject({ verified: 1, invalid: 0 });
    });

    it('preserves stored histories when create identity derivation fails during an audit', async () => {
        const did = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        const before = await db.getEvents(did);
        const derive = jest.spyOn(gatekeeper, 'generateDID').mockRejectedValueOnce(new Error('CID unavailable'));
        try {
            await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('unsupported create identity');
            expect(await db.getEvents(did)).toEqual(before);
        } finally { derive.mockRestore(); }
    });

    it('retries an audit after reading a history fails without deleting its data', async () => {
        const did = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        const before = await db.getEvents(did);
        const read = jest.spyOn(db, 'getEvents').mockRejectedValueOnce(new Error('storage unavailable'));
        try {
            await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('verification dependency failed');
            expect(await db.getEvents(did)).toEqual(before);
        } finally { read.mockRestore(); }
        await expect(gatekeeper.verifyDb({ chatty: false })).resolves.toMatchObject({ verified: 1, invalid: 0 });
    });

    it('preserves deferred events during an explicit audit', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        await gatekeeper.updateDID(await helper.createUpdateOp(keypair, did, await gatekeeper.resolveDID(did)));
        const events = await gatekeeper.exportDID(did);
        await gatekeeper.resetDb();
        await gatekeeper.importBatch([events[1]]);
        expect(await gatekeeper.processEvents()).toMatchObject({ pending: 1 });
        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({ total: 0, verified: 0, expired: 0, invalid: 0 });
        expect(await gatekeeper.importBatch([events[1]])).toMatchObject({ queued: 0, processed: 1 });
        await gatekeeper.importBatch([events[0]]);
        expect(await gatekeeper.processEvents()).toMatchObject({ added: 2, pending: 0 });
    });

    it('audits all histories and returns the existing four fields', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        await gatekeeper.createDID(await helper.createAssetOp(did, keypair));
        expect(await gatekeeper.verifyDb()).toStrictEqual({ total: 2, verified: 2, expired: 0, invalid: 0 });
    });

    it('verifies again after a prior successful audit instead of trusting a cache', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { value: 1 };
        await gatekeeper.updateDID(await helper.createUpdateOp(keypair, did, doc));
        expect(await gatekeeper.verifyDb({ chatty: false })).toMatchObject({ verified: 1 });
        const events = await db.getEvents(did);
        events[1].operation.doc!.didDocumentData = { value: 2 };
        await db.setEvents(did, events);
        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({ total: 1, verified: 0, expired: 0, invalid: 1 });
        expect(await db.getEvents(did)).toStrictEqual([]);
    });

    it('retains the same results with chatty disabled', async () => {
        await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        expect(await gatekeeper.verifyDb()).toStrictEqual(await gatekeeper.verifyDb({ chatty: false }));
    });

    it('shares an in-flight audit and permits a new one after completion', async () => {
        let release!: () => void;
        let started!: () => void;
        const waiting = new Promise<void>(resolve => { release = resolve; });
        const entered = new Promise<void>(resolve => { started = resolve; });
        const spy = jest.spyOn(gatekeeper, 'getDIDs').mockImplementationOnce(async () => {
            started();
            await waiting;
            return [];
        });
        const first = gatekeeper.verifyDb({ chatty: false });
        try {
            await entered;
            expect(gatekeeper.verifyDb({ chatty: false })).toBe(first);
            release();
            expect(await first).toStrictEqual({ total: 0, verified: 0, expired: 0, invalid: 0 });
            await gatekeeper.verifyDb({ chatty: false });
            expect(spy).toHaveBeenCalledTimes(2);
        } finally {
            release();
            spy.mockRestore();
        }
    });

    it('retries an audit after a storage failure', async () => {
        const spy = jest.spyOn(gatekeeper, 'getDIDs').mockRejectedValueOnce(new Error('storage unavailable'));
        try {
            const first = gatekeeper.verifyDb({ chatty: false });
            expect(gatekeeper.verifyDb({ chatty: false })).toBe(first);
            await expect(first).rejects.toThrow('storage unavailable');
            expect(await gatekeeper.verifyDb({ chatty: false })).toMatchObject({ total: 0 });
        } finally { spy.mockRestore(); }
    });

    it('reports missing controller dependencies without deleting the credential history', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const asset = await gatekeeper.createDID(await helper.createAssetOp(agent, keypair));
        await gatekeeper.removeDIDs([agent]);
        const before = await db.getEvents(asset);
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('audit incomplete');
        expect(await db.getEvents(asset)).toStrictEqual(before);
    });

    it('audits an unconfirmed tail rather than only native-confirmed versions', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair, { registry: 'hyperswarm' }));
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { value: 1 };
        await gatekeeper.updateDID(await helper.createUpdateOp(keypair, did, doc));
        const events = await db.getEvents(did);
        events[1].operation.doc!.didDocumentData = { value: 2 };
        await db.setEvents(did, events);
        expect(await gatekeeper.verifyDb({ chatty: false })).toMatchObject({ verified: 0, invalid: 1 });
    });

    it('removes a create with a mathematically invalid signature', async () => {
        const did = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        const events = await db.getEvents(did);
        events[0].operation.signature!.value = '00'.repeat(64);
        await db.setEvents(did, events);
        expect(await gatekeeper.verifyDb({ chatty: false })).toMatchObject({ invalid: 1, verified: 0 });
    });

    it('preserves unsupported old replacement structure despite its authentic signature', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const doc = await gatekeeper.resolveDID(did);
        delete doc.didDocument!.id;
        const operation = await helper.createUpdateOp(keypair, did, doc);
        await db.addEvent(did, { registry: 'local', time: operation.signature!.signed, operation });
        const before = await db.getEvents(did);
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('audit incomplete');
        expect(await db.getEvents(did)).toStrictEqual(before);
    });

    it('preserves a legacy declared-hash discrepancy with an otherwise authentic signature', async () => {
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        operation.signature!.hash = '00'.repeat(32);
        const did = await gatekeeper.generateDID(operation);
        await db.addEvent(did, { registry: 'local', time: operation.created!, operation });
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('audit incomplete');
        expect(await db.getEvents(did)).toHaveLength(1);
    });

    it('continues accepting legacy updates without previd in an explicit audit', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = 'legacy';
        await gatekeeper.updateDID(await helper.createUpdateOp(keypair, did, doc, { excludePrevid: true }));
        expect(await gatekeeper.verifyDb({ chatty: false })).toMatchObject({ verified: 1, invalid: 0 });
    });

    it('rejects stored DID-binding and version metadata discrepancies without assuming forged signatures', async () => {
        const did = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        const other = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        await db.setEvents(did, await db.getEvents(other));
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('audit incomplete');
        expect(await db.getEvents(did)).toHaveLength(1);
        await gatekeeper.removeDIDs([did]);
        const events = await db.getEvents(other);
        events[0].opid = 'forged-version';
        await db.setEvents(other, events);
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('audit incomplete');
        expect(await db.getEvents(other)).toHaveLength(1);
    });

    it('reports an incorrect envelope DID instead of silently certifying it', async () => {
        const did = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        const events = await db.getEvents(did);
        events[0].did = 'did:test:incorrect-envelope';
        await db.setEvents(did, events);
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('audit incomplete');
        expect(await db.getEvents(did)).toHaveLength(1);
    });

    it('does not delete an asset because its controller history is corrupt', async () => {
        const pair = cipher.generateRandomJwk();
        const owner = await gatekeeper.createDID(await helper.createAgentOp(pair));
        const asset = await gatekeeper.createDID(await helper.createAssetOp(owner, pair));
        const doc = await gatekeeper.resolveDID(owner);
        doc.didDocumentData = 'before';
        await gatekeeper.updateDID(await helper.createUpdateOp(pair, owner, doc));
        const events = await db.getEvents(owner);
        events[1].operation.doc!.didDocumentData = 'tampered';
        await db.setEvents(owner, events);
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('audit incomplete');
        expect(await db.getEvents(asset)).toHaveLength(1);
    });

    it('preserves an unsupported history with a second authentic create operation', async () => {
        const did = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        const other = await helper.createAgentOp(cipher.generateRandomJwk());
        await db.addEvent(did, { operation: other, time: other.created!, registry: 'local' });
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('exactly one initial create');
        expect(await db.getEvents(did)).toHaveLength(2);
    });

    it.each(['update', 'delete'] as const)('does not certify a signed %s as the first operation', async type => {
        const pair = cipher.generateRandomJwk();
        const anchor = await helper.createAgentOp(pair);
        const did = await gatekeeper.createDID(anchor);
        const doc = await gatekeeper.resolveDID(did);
        const operation = type === 'update'
            ? await helper.createUpdateOp(pair, did, doc, { excludePrevid: true })
            : await helper.createDeleteOp(pair, did);
        delete operation.previd;
        operation.created = anchor.created;
        operation.mdip = anchor.mdip;
        operation.publicJwk = pair.publicJwk;
        const unsigned = { ...operation };
        delete unsigned.signature;
        operation.signature!.hash = cipher.hashJSON(unsigned);
        operation.signature!.value = cipher.signHash(operation.signature!.hash, pair.privateJwk);
        await db.setEvents(did, [{ operation, time: operation.signature!.signed, registry: 'local' }]);
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('exactly one initial create');
        expect(await db.getEvents(did)).toHaveLength(1);
    });

    it('detects an explicit invalid predecessor instead of trusting a supplied version ID', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const doc = await gatekeeper.resolveDID(did);
        const operation = await helper.createUpdateOp(keypair, did, doc, { mockPrevid: 'wrong-predecessor' });
        await db.addEvent(did, { operation, time: operation.signature!.signed, registry: 'local' });
        await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('audit incomplete');
        expect(await db.getEvents(did)).toHaveLength(2);
    });

    it('verifies assets before pruning their expired controller', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair, { validUntil: new Date(Date.now() - 1000).toISOString() }));
        await gatekeeper.createDID(await helper.createAssetOp(agent, keypair));
        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({ total: 2, verified: 0, expired: 2, invalid: 0 });
    });

    it('uses the historical controller key even when a later controller update is unverifiable', async () => {
        const pair = cipher.generateRandomJwk();
        const next = cipher.generateRandomJwk();
        const base = Date.now() - 100_000;
        const anchor = await helper.createAgentOp(pair);
        anchor.created = new Date(base).toISOString();
        const unsigned = { ...anchor };
        delete unsigned.signature;
        anchor.signature!.hash = cipher.hashJSON(unsigned);
        anchor.signature!.value = cipher.signHash(anchor.signature!.hash, pair.privateJwk);
        anchor.signature!.signed = anchor.created;
        const owner = await gatekeeper.createDID(anchor);
        const assetOperation = await helper.createAssetOp(owner, pair);
        assetOperation.signature!.signed = new Date(base + 1000).toISOString();
        const asset = await gatekeeper.createDID(assetOperation);
        const doc = await gatekeeper.resolveDID(owner);
        doc.didDocument!.verificationMethod![0].publicKeyJwk = next.publicJwk;
        const rotation = await helper.createUpdateOp(pair, owner, doc);
        rotation.signature!.signed = new Date(base + 2000).toISOString();
        await gatekeeper.updateDID(rotation);
        const later = await helper.createUpdateOp(next, owner, await gatekeeper.resolveDID(owner));
        later.signature!.signed = new Date(base + 3000).toISOString();
        later.signature!.value = '00'.repeat(64);
        await db.addEvent(owner, { operation: later, time: later.signature!.signed, registry: 'local' });
        const catalog = jest.spyOn(gatekeeper, 'getDIDs').mockResolvedValueOnce([asset]);
        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({ total: 1, verified: 1, expired: 0, invalid: 0 });
        } finally { catalog.mockRestore(); }
    });

    it('does not mutate signed event bodies during repeated audits', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { value: 1 };
        await gatekeeper.updateDID(await helper.createUpdateOp(keypair, did, doc));
        const before = await db.getEvents(did);
        await gatekeeper.verifyDb({ chatty: false });
        await gatekeeper.verifyDb({ chatty: false });
        expect(await db.getEvents(did)).toStrictEqual(before);
    });

    it('does not prune a replacement database when reset occurs during audit catalog selection', async () => {
        let replacement = '';
        const catalog = jest.spyOn(gatekeeper, 'getDIDs').mockImplementationOnce(async () => {
            await gatekeeper.resetDb();
            replacement = await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk(), {
                validUntil: new Date(Date.now() - 1000).toISOString(),
            }));
            return [];
        });
        try {
            await expect(gatekeeper.verifyDb({ chatty: false })).rejects.toThrow('reset');
            expect(await db.getEvents(replacement)).toHaveLength(1);
        } finally { catalog.mockRestore(); }
    });

    it('only includes snapshot DIDs in expiry counts despite concurrent arrivals', async () => {
        await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk()));
        const getDIDs = gatekeeper.getDIDs.bind(gatekeeper);
        const spy = jest.spyOn(gatekeeper, 'getDIDs').mockImplementationOnce(async () => {
            const snapshot = await getDIDs();
            await gatekeeper.createDID(await helper.createAgentOp(cipher.generateRandomJwk(), { validUntil: new Date(Date.now() - 1000).toISOString() }));
            return snapshot;
        });
        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({ total: 1, verified: 1, expired: 0, invalid: 0 });
        } finally { spy.mockRestore(); }
    });
});

describe('checkDIDs', () => {

    it('should check all DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair, { registry: 'local', validUntil: new Date().toISOString() });
        await gatekeeper.createDID(assetOp);

        const check = await gatekeeper.checkDIDs({ chatty: true });

        expect(check.total).toBe(2);
        expect(check.byType.agents).toBe(1);
        expect(check.byType.assets).toBe(1);
        expect(check.byType.ephemeral).toBe(1);
        expect(check.byType.invalid).toBe(0);
        expect(check.byRegistry['local']).toBe(2);
        expect(check.byVersion[1]).toBe(2);
    });

    it('should report unconfirmed DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair, { registry: 'hyperswarm' });
        const assetDID = await gatekeeper.createDID(assetOp);
        const doc = await gatekeeper.resolveDID(assetDID);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, assetDID, doc);
        const ok = await gatekeeper.updateDID(updateOp);

        const check = await gatekeeper.checkDIDs({ chatty: true });

        expect(ok).toBe(true);
        expect(check.total).toBe(2);
        expect(check.byType.agents).toBe(1);
        expect(check.byType.assets).toBe(1);
        expect(check.byType.confirmed).toBe(0);
        expect(check.byType.unconfirmed).toBe(2);
        expect(check.byType.ephemeral).toBe(0);
        expect(check.byType.invalid).toBe(0);
        expect(check.byRegistry['hyperswarm']).toBe(2);
        expect(check.byVersion[1]).toBe(1);
        expect(check.byVersion[2]).toBe(1);
    });

    it('should report invalid DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const dids = await gatekeeper.getDIDs();
        dids.push('mock');

        // @ts-expect-error Testing invalid usage
        const check = await gatekeeper.checkDIDs({ chatty: true, dids });

        expect(check.total).toBe(3);
        expect(check.byType.invalid).toBe(1);
    });
});
