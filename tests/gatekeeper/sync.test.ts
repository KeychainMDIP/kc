import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import { Operation } from '@mdip/gatekeeper/types';
import { copyJSON } from '@mdip/common/utils';
import { ExpectedExceptionError } from '@mdip/common/errors';
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

function setOperationHash(operation: Operation): void {
    const operationCopy = copyJSON(operation);
    delete operationCopy.signature;
    operation.signature!.hash = cipher.hashJSON(operationCopy);
}

beforeAll(async () => {
    await ipfs.start();
});

afterAll(async () => {
    await ipfs.stop();
});

beforeEach(async () => {
    await gatekeeper.resetDb();  // Reset database for each test to ensure isolation
});

describe('exportDID', () => {
    it('should export a valid DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const ops = await gatekeeper.exportDID(did);

        expect(ops.length).toBe(1);
        expect(ops[0].operation).toStrictEqual(agentOp);
    });

    it('should export a valid updated DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const ops = await gatekeeper.exportDID(did);

        expect(ops.length).toBe(2);
        expect(ops[0].operation).toStrictEqual(agentOp);
        expect(ops[1].operation).toStrictEqual(updateOp);
    });

    // eslint-disable-next-line
    it('should return empty array on an invalid DID', async () => {
        const ops = await gatekeeper.exportDID('mockDID');
        expect(ops).toStrictEqual([]);
    });
});

describe('historical operation CID cache', () => {
    async function storedAgent() {
        const keypair = cipher.generateRandomJwk();
        const operation = await helper.createAgentOp(keypair, { registry: 'hyperswarm' });
        const event = { registry: 'hyperswarm', time: operation.created!, ordinal: [1], operation };
        await expect(gatekeeper.importEvent(event)).resolves.toBe('added');
        return { keypair, operation, event, did: await gatekeeper.generateDID(operation) };
    }

    it('calculates historical CIDs once across 500 successive updates', async () => {
        const { keypair, operation, did } = await storedAgent();
        const generate = jest.spyOn(gatekeeper, 'generateCID');
        try {
            for (let step = 0; step < 500; step += 1) {
                const doc = await gatekeeper.resolveDID(did);
                doc.didDocumentData = { step };
                const update = await helper.createUpdateOp(keypair, did, doc);
                await expect(gatekeeper.importEvent({
                    registry: 'hyperswarm', time: update.signature!.signed, ordinal: [step + 2], operation: update,
                })).resolves.toBe('added');
            }
            expect(generate).toHaveBeenCalledTimes(1000);
            expect(generate.mock.calls.filter(([op]) => (op as Operation).signature?.hash === operation.signature!.hash))
                .toHaveLength(1);
            await expect(gatekeeper.resolveDID(did)).resolves.toMatchObject({
                didDocumentData: { step: 499 }, didDocumentMetadata: { version: '501' },
            });
        }
        finally {
            generate.mockRestore();
        }
    });

    it('does not reuse a cached CID when stored contents change but opid does not', async () => {
        const { keypair, did } = await storedAgent();
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { original: true };
        const operation = await helper.createUpdateOp(keypair, did, doc);
        const event = { registry: 'hyperswarm', time: operation.signature!.signed, ordinal: [2], operation };
        await expect(gatekeeper.importEvent(event)).resolves.toBe('added');
        await expect(gatekeeper.importEvent(copyJSON(event))).resolves.toBe('merged');
        const events = await gatekeeper.exportDID(did);
        events[1].operation.doc!.didDocumentData = { changed: true };
        await db.setEvents(did, events);

        const generate = jest.spyOn(gatekeeper, 'generateCID');
        try {
            await expect(gatekeeper.importEvent(copyJSON(event))).resolves.toBe('rejected');
            expect(generate).toHaveBeenCalledWith(events[1].operation);
        }
        finally {
            generate.mockRestore();
        }
    });

    it('still verifies incoming signatures and rejects forged opids after warming the cache', async () => {
        const { operation, event, did } = await storedAgent();
        await expect(gatekeeper.importEvent(copyJSON(event))).resolves.toBe('merged');
        const verify = jest.spyOn(gatekeeper, 'verifyCreateOperation').mockResolvedValueOnce(false);
        try {
            await expect(gatekeeper.importEvent(copyJSON(event))).resolves.toBe('rejected');
            expect(verify).toHaveBeenCalledWith(operation);
        }
        finally {
            verify.mockRestore();
        }
        await expect(gatekeeper.importEvent({ ...event, opid: 'forged-version' })).resolves.toBe('rejected');
        await expect(gatekeeper.exportDID(did)).resolves.toHaveLength(1);
    });

    it('recomputes missing legacy opids once and continues matching predecessors', async () => {
        const { keypair, did, event } = await storedAgent();
        const events = await gatekeeper.exportDID(did);
        delete events[0].opid;
        await db.setEvents(did, events);
        await expect(gatekeeper.importEvent(copyJSON(event))).resolves.toBe('merged');
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { legacy: true };
        const operation = await helper.createUpdateOp(keypair, did, doc);
        await expect(gatekeeper.importEvent({
            registry: 'hyperswarm', time: operation.signature!.signed, ordinal: [2], operation,
        })).resolves.toBe('added');
        await expect(gatekeeper.resolveDID(did)).resolves.toMatchObject({ didDocumentData: { legacy: true } });
    });

    it('evicts the least recently used contents at the entry limit', async () => {
        // @ts-expect-error Use a small internal bound to exercise eviction without thousands of identities.
        gatekeeper.maxHistoryCidCacheEntries = 2;
        try {
            const first = await storedAgent();
            const second = await storedAgent();
            const third = await storedAgent();
            for (const { event } of [first, second, first, third]) {
                await expect(gatekeeper.importEvent(copyJSON(event))).resolves.toBe('merged');
            }
            // @ts-expect-error Inspect retained contents to verify the memory bound and LRU order.
            expect([...gatekeeper.historicalOperationCids.keys()]).toEqual([
                JSON.stringify(first.operation), JSON.stringify(third.operation),
            ]);
        }
        finally {
            // @ts-expect-error Restore the production bound.
            gatekeeper.maxHistoryCidCacheEntries = 10_000;
        }
    });

    it('bounds retained string bytes and does not retain oversized contents', async () => {
        const first = await storedAgent();
        const second = await storedAgent();
        await gatekeeper.importEvent(copyJSON(first.event));
        // @ts-expect-error Read the accounted UTF-16 content/CID bytes for a small test bound.
        const firstBytes = gatekeeper.historicalOperationCidBytes;
        // @ts-expect-error Exercise the byte bound independently of the entry bound.
        gatekeeper.maxHistoryCidCacheBytes = firstBytes;
        try {
            await gatekeeper.importEvent(copyJSON(second.event));
            // @ts-expect-error Only one same-sized operation fits in this byte bound.
            expect(gatekeeper.historicalOperationCids.size).toBe(1);
            // @ts-expect-error Retained strings stay within the byte bound.
            expect(gatekeeper.historicalOperationCidBytes).toBeLessThanOrEqual(firstBytes);
            await gatekeeper.resetDb();
            // @ts-expect-error An operation larger than the cache remains importable, but is not cached.
            gatekeeper.maxHistoryCidCacheBytes = 1;
            const third = await storedAgent();
            await expect(gatekeeper.importEvent(copyJSON(third.event))).resolves.toBe('merged');
            // @ts-expect-error Oversized entries are not retained.
            expect(gatekeeper.historicalOperationCids.size).toBe(0);
            // @ts-expect-error Successful reset also clears byte accounting.
            expect(gatekeeper.historicalOperationCidBytes).toBe(0);
        }
        finally {
            // @ts-expect-error Restore the production bound.
            gatekeeper.maxHistoryCidCacheBytes = 64 * 1024 * 1024;
        }
    });
});

describe('exportDIDs', () => {
    it('should export valid DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const exports = await gatekeeper.exportDIDs([did]);
        const ops = exports[0];

        expect(ops.length).toBe(1);
        expect(ops[0].operation).toStrictEqual(agentOp);
    });

    it('should export all DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        for (let i = 0; i < 5; i++) {
            const assetOp = await helper.createAssetOp(agentDID, keypair);
            await gatekeeper.createDID(assetOp);
        }

        const exports = await gatekeeper.exportDIDs();

        expect(exports.length).toBe(6);
    });

    it('should export a DIDs in order requested', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        delete agentOp.mdip!.validUntil;
        const agentDID = await gatekeeper.createDID(agentOp);

        const assetOp = await helper.createAssetOp(agentDID, keypair);
        delete assetOp.mdip!.validUntil;
        const assetDID = await gatekeeper.createDID(assetOp);

        const exports = await gatekeeper.exportDIDs([assetDID, agentDID]);

        expect(exports.length).toBe(2);
        expect(exports[0][0].operation).toStrictEqual(assetOp);
        expect(exports[1][0].operation).toStrictEqual(agentOp);
    });

    it('should export valid updated DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const exports = await gatekeeper.exportDIDs([did]);
        const ops = exports[0];

        expect(ops.length).toBe(2);
        expect(ops[0].operation).toStrictEqual(agentOp);
        expect(ops[1].operation).toStrictEqual(updateOp);
    });

    // eslint-disable-next-line
    it('should return empty array on an invalid DID', async () => {
        const exports = await gatekeeper.exportDIDs(['mockDID']);
        const ops = exports[0];
        expect(ops).toStrictEqual([]);
    });
});

describe('importDIDs', () => {
    it('should import a valid agent DID export', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDIDs([did]);

        await gatekeeper.importDIDs(ops);
        const response = await gatekeeper.processEvents();

        expect(response.merged).toBe(1);
    });

    it('should report rejectedIndices using dids.flat() order', async () => {
        const keypair = cipher.generateRandomJwk();
        const op1 = await helper.createAgentOp(keypair);
        const did1 = await gatekeeper.createDID(op1);
        const did1Events = await gatekeeper.exportDIDs([did1]);

        const op2 = await helper.createAgentOp(keypair);
        const did2 = await gatekeeper.createDID(op2);
        const did2Events = await gatekeeper.exportDIDs([did2]);

        delete did2Events[0][0].operation.signature;

        const response = await gatekeeper.importDIDs([did1Events[0], did2Events[0]]);

        expect(response.queued).toBe(1);
        expect(response.rejected).toBe(1);
        expect(response.rejectedIndices).toStrictEqual([1]);
    });
});

describe('removeDIDs', () => {
    it('should remove a valid DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);

        const ok = await gatekeeper.removeDIDs([did]);
        expect(ok).toBe(true);

        const { didResolutionMetadata } = await gatekeeper.resolveDID(did);

        expect(didResolutionMetadata).toBeDefined();
        expect(didResolutionMetadata!.error).toBe('notFound');
    });

    it('should throw an exception if no array specified', async () => {
        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.removeDIDs();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: dids');
        }
    });

    it('should return true if no DID specified remove', async () => {
        const ok = await gatekeeper.removeDIDs([]);
        expect(ok).toBe(true);
    });

    it('should return true if unknown DIDs specified', async () => {
        const ok = await gatekeeper.removeDIDs(['did:test:mock']);
        expect(ok).toBe(true);
        await expect(gatekeeper.removeDIDs([''])).rejects.toThrow('Invalid DID');
    });

    it('should serialize removals through DID aliases', async () => {
        const order: string[] = [];
        let signalStarted: () => void = () => { };
        let releaseFirst: () => void = () => { };
        const started = new Promise<void>(resolve => (signalStarted = resolve));
        const release = new Promise<void>(resolve => (releaseFirst = resolve));
        const deleteEvents = jest.spyOn(db, 'deleteEvents')
            .mockImplementationOnce(async () => {
                order.push('first started');
                signalStarted();
                await release;
                order.push('first finished');
            })
            .mockImplementationOnce(async () => {
                order.push('second started');
            });

        try {
            const first = gatekeeper.removeDIDs(['did:test:mock']);
            await started;
            const second = gatekeeper.removeDIDs(['did:custom:mock']);
            await Promise.resolve();
            expect(order).toStrictEqual(['first started']);

            releaseFirst();
            await Promise.all([first, second]);
            expect(order).toStrictEqual(['first started', 'first finished', 'second started']);
            const didLocks = (gatekeeper as unknown as { didLocks: Map<string, Promise<void>> }).didLocks;
            expect(didLocks.has('mock')).toBe(false);
        }
        finally {
            releaseFirst();
            deleteEvents.mockRestore();
        }
    });

    it('should not append an update after a concurrent removal', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const updateOp = await helper.createUpdateOp(keypair, did, await gatekeeper.resolveDID(did));
        const originalDeleteEvents = db.deleteEvents.bind(db);
        let signalRemoval: () => void = () => { };
        let releaseRemoval: () => void = () => { };
        const removalStarted = new Promise<void>(resolve => (signalRemoval = resolve));
        const removalRelease = new Promise<void>(resolve => (releaseRemoval = resolve));
        const deleteEvents = jest.spyOn(db, 'deleteEvents').mockImplementationOnce(async (removedDID) => {
            signalRemoval();
            await removalRelease;
            return originalDeleteEvents(removedDID);
        });

        const removal = gatekeeper.removeDIDs([did]);
        try {
            await removalStarted;
            const update = expect(gatekeeper.updateDID(updateOp)).rejects.toThrow('doc.didDocument');
            releaseRemoval();
            await removal;
            await update;
            expect(await gatekeeper.exportDID(did)).toStrictEqual([]);
        }
        finally {
            releaseRemoval();
            await removal.catch(() => { });
            deleteEvents.mockRestore();
        }
    });
});

describe('exportBatch', () => {
    // local DIDs are excluded from exportBatch so we'll create on hyperswarm
    it('should export a valid batch', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const did = await gatekeeper.createDID(agentOp);

        const exports = await gatekeeper.exportBatch([did]);

        expect(exports.length).toBe(1);
        expect(exports[0].operation).toStrictEqual(agentOp);
    });

    it('should export batch with all DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const agentDID = await gatekeeper.createDID(agentOp);

        for (let i = 0; i < 5; i++) {
            const assetOp = await helper.createAssetOp(agentDID, keypair, { registry: 'hyperswarm' });
            await gatekeeper.createDID(assetOp);
        }

        const exports = await gatekeeper.exportBatch();

        expect(exports.length).toBe(6);
    });

    it('should export a valid updated batch', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);

        const exports = await gatekeeper.exportBatch([did]);

        expect(exports.length).toBe(2);
        expect(exports[0].operation).toStrictEqual(agentOp);
        expect(exports[1].operation).toStrictEqual(updateOp);
    });

    // eslint-disable-next-line
    it('should return empty array on an invalid DID', async () => {
        const exports = await gatekeeper.exportBatch(['mockDID']);
        expect(exports).toStrictEqual([]);
    });
});

describe('importBatch', () => {
    it('should queue a valid agent DID export', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
    });

    it('should import updates without generated document metadata', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { published: true };
        delete doc.didDocumentMetadata;
        delete doc.didResolutionMetadata;
        const update = await helper.createUpdateOp(keypair, did, doc);

        const imported = await gatekeeper.importBatch([{
            registry: 'local',
            time: new Date().toISOString(),
            operation: update,
        }]);

        expect(imported).toMatchObject({ queued: 1, rejected: 0 });
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ rejected: 0 });
        await expect(gatekeeper.resolveDID(did)).resolves.toMatchObject({
            didDocumentData: { published: true },
            didDocumentMetadata: { version: '2' },
        });
    });

    it('should requeue an event after its earlier processing completed', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();
        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
        expect(response.processed).toBe(0);
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ merged: 1 });
    });

    it('should report exact capacity-deferred and processed indexes', async () => {
        const localDb = new DbJsonMemory('bounded-import');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const operations = await Promise.all([
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
        ]);
        const events = operations.map((operation, index) => ({
            registry: 'hyperswarm',
            time: operation.created!,
            ordinal: [index],
            operation,
        }));
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxEventPageCount = 2;

        await expect(gk.importBatch(events)).resolves.toMatchObject({
            queued: 2,
            processed: 0,
            processedIndices: [],
            capacityDeferred: 1,
            capacityDeferredIndices: [2],
            total: 2,
        });
        await expect(gk.importBatch([events[0]])).resolves.toMatchObject({
            queued: 0,
            processed: 1,
            processedIndices: [0],
            capacityDeferred: 0,
            capacityDeferredIndices: [],
        });
    });

    it('should reject an event larger than the bounded event page', async () => {
        const localDb = new DbJsonMemory('oversized-event');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        const event = {
            registry: 'hyperswarm',
            time: operation.created!,
            metadata: 'x'.repeat(256),
            operation,
        } as any;
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxEventPageBytes = Buffer.byteLength(JSON.stringify(event), 'utf8') - 1;

        await expect(gk.importBatch([event])).resolves.toMatchObject({
            queued: 0,
            rejected: 1,
            rejectedIndices: [0],
            capacityDeferred: 0,
        });
    });

    it('should reject an event that cannot be serialized for admission', async () => {
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        const metadata: Record<string, unknown> = {};
        metadata.self = metadata;

        await expect(gatekeeper.importBatch([{
            registry: 'hyperswarm',
            time: operation.created!,
            operation,
            metadata,
        } as any])).resolves.toMatchObject({
            queued: 0,
            rejected: 1,
            rejectedIndices: [0],
        });
    });

    it('should reject an event whose canonical queue key cannot be generated', async () => {
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        const generateCID = jest.spyOn(gatekeeper, 'generateCID')
            .mockRejectedValueOnce(new Error('CID unavailable'));

        try {
            await expect(gatekeeper.importBatch([{
                registry: 'hyperswarm',
                time: operation.created!,
                operation,
            }])).resolves.toMatchObject({
                queued: 0,
                rejected: 1,
                rejectedIndices: [0],
            });
        } finally {
            generateCID.mockRestore();
        }
    });

    it('should reject an event whose normalized DID cannot be generated', async () => {
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        const generateDID = jest.spyOn(gatekeeper, 'generateDID')
            .mockRejectedValueOnce(new Error('DID unavailable'));

        try {
            await expect(gatekeeper.importBatch([{
                registry: 'hyperswarm',
                time: operation.created!,
                operation,
            }])).resolves.toMatchObject({
                queued: 0,
                rejected: 1,
                rejectedIndices: [0],
            });
        } finally {
            generateDID.mockRestore();
        }
    });

    it('should account for generated DID and opid fields at admission', async () => {
        const localDb = new DbJsonMemory('normalized-event-size');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        const event = {
            registry: 'hyperswarm',
            time: operation.created!,
            operation,
        };
        // The submitted shape fits exactly, but the retained event also needs its canonical DID and opid.
        // @ts-expect-error Testing bounded private state with a small fixture
        gk.maxEventPageBytes = Buffer.byteLength(JSON.stringify(event), 'utf8');

        await expect(gk.importBatch([event])).resolves.toMatchObject({
            queued: 0,
            rejected: 1,
            rejectedIndices: [0],
            capacityDeferred: 0,
        });
    });

    it('should reserve a concurrent create event only once', async () => {
        const localDb = new DbJsonMemory('concurrent-duplicate-import');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        const event = {
            registry: 'hyperswarm',
            time: operation.created!,
            operation,
        };
        const originalGenerateDID = gk.generateDID.bind(gk);
        const generateDID = jest.spyOn(gk, 'generateDID');
        let arrivals = 0;
        let release!: () => void;
        const bothArrived = new Promise<void>(resolve => {
            release = resolve;
        });
        generateDID.mockImplementation(async op => {
            arrivals += 1;
            if (arrivals === 2) {
                release();
            }
            await bothArrived;
            return originalGenerateDID(op);
        });

        try {
            const results = await Promise.all([
                gk.importBatch([event]),
                gk.importBatch([event]),
            ]);

            expect(results.reduce((total, result) => total + result.queued, 0)).toBe(1);
            expect(results.reduce((total, result) => total + result.processed, 0)).toBe(1);
            expect(results.every(result => result.total === 1)).toBe(true);
            await expect(gk.processEvents()).resolves.toMatchObject({
                added: 1,
                merged: 0,
                pending: 0,
            });
        } finally {
            generateDID.mockRestore();
        }
    });

    it('should queue an already-seen event again after resetDb', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();
        await gatekeeper.resetDb();

        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
        expect(response.processed).toBe(0);
    });

    it('should drain processing before reset and admit the same event after reset', async () => {
        const localDb = new DbJsonMemory('reset-processing');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        const event = { registry: 'hyperswarm', time: operation.created!, operation };
        await gk.importBatch([event]);

        let writing!: () => void;
        let resume!: () => void;
        const started = new Promise<void>(resolve => { writing = resolve; });
        const released = new Promise<void>(resolve => { resume = resolve; });
        const originalAddEvent = localDb.addEvent.bind(localDb);
        const addEvent = jest.spyOn(localDb, 'addEvent').mockImplementationOnce(async (did, queued) => {
            writing();
            await released;
            return originalAddEvent(did, queued);
        });
        const resetDb = jest.spyOn(localDb, 'resetDb');

        try {
            const processing = gk.processEvents();
            await started;
            const reset = gk.resetDb();
            let admitted = false;
            const admission = gk.importBatch([event]).then(result => {
                admitted = true;
                return result;
            });
            await Promise.resolve();
            expect(resetDb).not.toHaveBeenCalled();
            expect(admitted).toBe(false);

            resume();
            await expect(processing).resolves.toMatchObject({ added: 1 });
            await expect(reset).resolves.toBe(true);
            await expect(admission).resolves.toMatchObject({ queued: 1, processed: 0 });
            await expect(localDb.getAllKeys()).resolves.toHaveLength(0);
            await expect(gk.processEvents()).resolves.toMatchObject({ added: 1, pending: 0 });
            await expect(localDb.getAllKeys()).resolves.toHaveLength(1);
        }
        finally {
            resume();
            addEvent.mockRestore();
            resetDb.mockRestore();
        }
    });

    it('should wait for an in-flight admission before clearing the queues', async () => {
        const localDb = new DbJsonMemory('reset-admission');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        const event = { registry: 'hyperswarm', time: operation.created!, operation };
        let verifying!: () => void;
        let resume!: () => void;
        const started = new Promise<void>(resolve => { verifying = resolve; });
        const released = new Promise<void>(resolve => { resume = resolve; });
        const originalVerify = gk.verifyEvent.bind(gk);
        const verifyEvent = jest.spyOn(gk, 'verifyEvent').mockImplementationOnce(async queued => {
            verifying();
            await released;
            return originalVerify(queued);
        });
        const resetDb = jest.spyOn(localDb, 'resetDb');

        try {
            const admission = gk.importBatch([event]);
            await started;
            const reset = gk.resetDb();
            await Promise.resolve();
            expect(resetDb).not.toHaveBeenCalled();
            resume();
            await expect(admission).resolves.toMatchObject({ queued: 1 });
            await expect(reset).resolves.toBe(true);
            await expect(gk.processEvents()).resolves.toMatchObject({ added: 0, pending: 0 });
            await expect(gk.importBatch([event])).resolves.toMatchObject({ queued: 1, processed: 0 });
        }
        finally {
            resume();
            verifyEvent.mockRestore();
            resetDb.mockRestore();
        }
    });

    it('should preserve queued work and release the boundary after a failed reset', async () => {
        const localDb = new DbJsonMemory('failed-reset');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        const event = { registry: 'hyperswarm', time: operation.created!, operation };
        await gk.importBatch([event]);
        const resetDb = jest.spyOn(localDb, 'resetDb').mockRejectedValueOnce(new Error('reset failed'));

        try {
            await expect(gk.resetDb()).rejects.toThrow('reset failed');
            await expect(gk.importBatch([event])).resolves.toMatchObject({ processed: 1 });
            await expect(gk.processEvents()).resolves.toMatchObject({ added: 1, pending: 0 });
        }
        finally {
            resetDb.mockRestore();
        }
    });

    it('should throw an exception on undefined', async () => {
        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.importBatch();
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should throw an exception on non-array parameter', async () => {
        try {
            // @ts-expect-error Testing invalid usage
            await gatekeeper.importBatch('mock');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should throw an exception on an empty array', async () => {
        try {
            await gatekeeper.importBatch([]);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: batch');
        }
    });

    it('should report an error on non-transactions', async () => {
        // @ts-expect-error Testing invalid usage
        const response = await gatekeeper.importBatch([1, 2, 3]);

        expect(response.rejected).toBe(3);
        expect(response.rejectedIndices).toStrictEqual([0, 1, 2]);
    });

    it('should report an error on invalid event time', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].time = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        // @ts-expect-error Testing invalid usage
        ops[0].operation = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should reject an imported create operation with an invalid prefix', async () => {
        const keypair = cipher.generateRandomJwk();
        const operation = await helper.createAgentOp(keypair, { prefix: 'invalid' });

        const response = await gatekeeper.importBatch([{
            registry: 'local',
            time: operation.created!,
            operation,
        }]);

        expect(response).toMatchObject({ queued: 0, rejected: 1, rejectedIndices: [0] });
    });

    it('should reject operations exceeding the UTF-8 byte limit', async () => {
        const keypair = cipher.generateRandomJwk();
        const operation = await helper.createAgentOp(keypair, { prefix: 'did:tést' });
        const json = JSON.stringify(operation);
        const gk = new Gatekeeper({ db, ipfs, console: mockConsole, maxOpBytes: json.length });

        expect(Buffer.byteLength(json, 'utf8')).toBeGreaterThan(json.length);

        const response = await gk.importBatch([{
            registry: 'local',
            time: new Date().toISOString(),
            operation,
        }]);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation type', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        (ops[0].operation.type as any) = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing created time', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.created;
        setOperationHash(ops[0].operation);

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing mdip metadata', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.mdip;
        setOperationHash(ops[0].operation);

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid mdip version', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.mdip!.version = -1;
        setOperationHash(ops[0].operation);

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid mdip type', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        // @ts-expect-error Testing invalid usage
        ops[0].operation.mdip!.type = 'mock';
        setOperationHash(ops[0].operation);

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid mdip registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.mdip!.registry = 'mock';
        setOperationHash(ops[0].operation);

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing operation signature', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.signature;

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation signature date', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.signature!.signed = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation signature hash', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.signature!.hash = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid operation signature signer', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].operation.signature!.signer = 'mock';

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on missing operation key', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[0].operation.publicJwk;
        setOperationHash(ops[0].operation);

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on incorrect controller', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const ops = await gatekeeper.exportDID(assetDID);

        ops[0].operation.controller = 'mock';
        setOperationHash(ops[0].operation);

        const response = await gatekeeper.importBatch(ops);

        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid update operation missing doc', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[1].operation.doc;

        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
        expect(response.rejected).toBe(1);
        expect(response.rejectedIndices).toStrictEqual([1]);
    });

    it('should report sparse rejectedIndices in original submitted order', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        const invalid1 = { ...ops[0], time: 'invalid' } as any;
        const invalid2 = { ...ops[0], operation: { ...ops[0].operation, type: 'bad-type' } } as any;
        const response = await gatekeeper.importBatch([invalid1, ops[0], invalid2]);

        expect(response.queued).toBe(1);
        expect(response.rejected).toBe(2);
        expect(response.rejectedIndices).toStrictEqual([0, 2]);
    });

    it('should report an error on invalid update operation missing did', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[1].operation.did;

        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
        expect(response.rejected).toBe(1);
    });

    it('should report an error on invalid delete operation', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const deleteOp = await helper.createDeleteOp(keypair, did);
        const verifyResult = await gatekeeper.verifyOperation(deleteOp);
        await gatekeeper.deleteDID(deleteOp);
        const ops = await gatekeeper.exportDID(did);

        delete ops[1].operation.did;

        const response = await gatekeeper.importBatch(ops);

        expect(response.queued).toBe(1);
        expect(response.rejected).toBe(1);
        expect(verifyResult).toBe(true);
    });
});

describe('processEvents', () => {
    it('should reject an imported update that changes its registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(
            await helper.createAgentOp(keypair, { registry: 'hyperswarm' })
        );
        const doc = await gatekeeper.resolveDID(did);
        doc.mdip!.registry = 'local';
        doc.didDocumentData = { updated: true };
        const operation = await helper.createUpdateOp(keypair, did, doc);

        await expect(gatekeeper.importBatch([{
            registry: 'hyperswarm',
            time: operation.signature!.signed,
            did,
            operation,
        }])).resolves.toMatchObject({ queued: 1, rejected: 0 });
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({
            added: 0,
            rejected: 1,
            pending: 0,
        });
        await expect(gatekeeper.exportDID(did)).resolves.toHaveLength(1);
        await expect(gatekeeper.resolveDID(did)).resolves.toMatchObject({
            didDocumentData: {},
            mdip: { registry: 'hyperswarm' },
        });
    });

    it('should reject an imported create that completes a controller cycle', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair, { registry: 'hyperswarm' }));
        const assetOp = await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' });
        const asset = await gatekeeper.generateDID(assetOp);

        const agentDoc = await gatekeeper.resolveDID(agent);
        agentDoc.didDocument!.controller = asset;
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(keypair, agent, agentDoc)
        )).toBe(true);

        await expect(gatekeeper.importBatch([{
            registry: 'hyperswarm',
            time: assetOp.created!,
            did: asset,
            operation: assetOp,
        }])).resolves.toMatchObject({ queued: 1, rejected: 0 });
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ added: 0, rejected: 1 });
        await expect(gatekeeper.exportDID(asset)).resolves.toStrictEqual([]);
    });

    it('should reject an imported update that would create a controller cycle', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair, { registry: 'hyperswarm' }));
        const assetA = await gatekeeper.createDID(
            await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' })
        );
        const assetB = await gatekeeper.createDID(
            await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' })
        );

        const assetADoc = await gatekeeper.resolveDID(assetA);
        assetADoc.didDocument!.controller = assetB;
        expect(await gatekeeper.updateDID(await helper.createUpdateOp(keypair, assetA, assetADoc))).toBe(true);

        const assetBDoc = await gatekeeper.resolveDID(assetB);
        assetBDoc.didDocument!.controller = assetA;
        for (const excludePrevid of [true, false]) {
            const cycle = await helper.createUpdateOp(keypair, assetB, assetBDoc, { excludePrevid });
            await expect(gatekeeper.importBatch([{
                registry: 'hyperswarm',
                time: cycle.signature!.signed,
                did: assetB,
                operation: cycle,
            }])).resolves.toMatchObject({ queued: 1, rejected: 0 });
            await expect(gatekeeper.processEvents()).resolves.toMatchObject({ added: 0, rejected: 1 });
        }
        expect((await gatekeeper.resolveDID(assetB)).didDocument!.controller).toBe(agent);
    });

    it('should reject a controller cycle introduced by a reorg', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair, { registry: 'hyperswarm' }));
        const assetA = await gatekeeper.createDID(
            await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' })
        );
        const assetB = await gatekeeper.createDID(
            await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' })
        );
        const assetC = await gatekeeper.createDID(
            await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' })
        );

        const assetADoc = await gatekeeper.resolveDID(assetA);
        assetADoc.didDocument!.controller = assetB;
        const updateAtoB = await helper.createUpdateOp(keypair, assetA, assetADoc);
        expect(await gatekeeper.updateDID(updateAtoB)).toBe(true);

        const nextAssetADoc = await gatekeeper.resolveDID(assetA);
        nextAssetADoc.didDocument!.controller = assetC;
        nextAssetADoc.didDocumentData = { updated: true };
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(keypair, assetA, nextAssetADoc)
        )).toBe(true);

        const assetBDoc = await gatekeeper.resolveDID(assetB);
        assetBDoc.didDocument!.controller = assetA;
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(keypair, assetB, assetBDoc)
        )).toBe(true);

        const updateAtoBOpid = await gatekeeper.generateCID(updateAtoB);
        const reorgDoc = await gatekeeper.resolveDID(assetA, { versionSequence: 2 });
        reorgDoc.didDocumentData = { reorg: true };
        const cycle = await helper.createUpdateOp(keypair, assetA, reorgDoc, { mockPrevid: updateAtoBOpid });

        await expect(gatekeeper.importBatch([{
            registry: 'hyperswarm',
            time: cycle.signature!.signed,
            did: assetA,
            operation: cycle,
        }])).resolves.toMatchObject({ queued: 1, rejected: 0 });
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ added: 0, rejected: 1 });
        expect((await gatekeeper.resolveDID(assetA)).didDocumentData).toEqual({ updated: true });
        expect((await gatekeeper.resolveDID(assetA)).didDocument!.controller).toBe(assetC);
    });

    it('should merge confirmation metadata without reapplying the controller update', async () => {
        const keypair = cipher.generateRandomJwk();
        const agent = await gatekeeper.createDID(await helper.createAgentOp(keypair, { registry: 'hyperswarm' }));
        const assetA = await gatekeeper.createDID(
            await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' })
        );
        const assetB = await gatekeeper.createDID(
            await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' })
        );
        const assetC = await gatekeeper.createDID(
            await helper.createAssetOp(agent, keypair, { registry: 'hyperswarm' })
        );

        const assetADoc = await gatekeeper.resolveDID(assetA);
        assetADoc.didDocument!.controller = assetB;
        const updateAtoB = await helper.createUpdateOp(keypair, assetA, assetADoc);
        expect(await gatekeeper.updateDID(updateAtoB)).toBe(true);

        const nextAssetADoc = await gatekeeper.resolveDID(assetA);
        nextAssetADoc.didDocument!.controller = assetC;
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(keypair, assetA, nextAssetADoc)
        )).toBe(true);

        const assetBDoc = await gatekeeper.resolveDID(assetB);
        assetBDoc.didDocument!.controller = assetA;
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(keypair, assetB, assetBDoc)
        )).toBe(true);

        await expect(gatekeeper.importBatch([{
            registry: 'hyperswarm',
            time: updateAtoB.signature!.signed,
            did: assetA,
            operation: updateAtoB,
        }])).resolves.toMatchObject({ queued: 1, rejected: 0 });
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ added: 1, rejected: 0 });
        expect((await gatekeeper.resolveDID(assetA)).didDocument!.controller).toBe(assetC);
    });

    it('rejects a create event that targets another DID before deduplication', async () => {
        const attackerOp = await helper.createAgentOp(cipher.generateRandomJwk(), { registry: 'hyperswarm' });
        const victimOp = await helper.createAgentOp(cipher.generateRandomJwk(), { registry: 'hyperswarm' });
        const attackerDid = await gatekeeper.generateDID(attackerOp);
        const victimDid = await gatekeeper.generateDID(victimOp);
        const event = {
            registry: 'hyperswarm',
            time: attackerOp.created!,
            did: victimDid,
            operation: attackerOp,
        };

        await expect(gatekeeper.importBatch([event])).resolves.toMatchObject({
            queued: 0,
            rejected: 1,
            rejectedIndices: [0],
        });
        await expect(gatekeeper.importEvent(event)).resolves.toBe('rejected');

        event.did = attackerDid;
        await expect(gatekeeper.importBatch([event])).resolves.toMatchObject({
            queued: 1,
            rejected: 0,
        });
    });

    it('rejects update and delete events that target another DID', async () => {
        const attackerKeys = cipher.generateRandomJwk();
        const victimKeys = cipher.generateRandomJwk();
        const attackerDid = await gatekeeper.createDID(await helper.createAgentOp(attackerKeys));
        const victimDid = await gatekeeper.createDID(await helper.createAgentOp(victimKeys));
        const attackerDoc = await gatekeeper.resolveDID(attackerDid);
        const operations = [
            await helper.createUpdateOp(attackerKeys, attackerDid, attackerDoc),
            await helper.createDeleteOp(attackerKeys, attackerDid),
        ];

        for (const operation of operations) {
            await expect(gatekeeper.importBatch([{
                registry: 'hyperswarm',
                time: operation.signature!.signed,
                did: victimDid,
                operation,
            }])).resolves.toMatchObject({
                queued: 0,
                rejected: 1,
                rejectedIndices: [0],
            });
        }

        await expect(gatekeeper.exportDID(attackerDid)).resolves.toHaveLength(1);
        await expect(gatekeeper.exportDID(victimDid)).resolves.toHaveLength(1);
    });

    it('accepts event DID aliases with the same canonical suffix', async () => {
        const keypair = cipher.generateRandomJwk();
        const create = await helper.createAgentOp(keypair, { registry: 'hyperswarm' });
        const did = await gatekeeper.createDID(create);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { mock: 1 };
        await gatekeeper.updateDID(await helper.createUpdateOp(keypair, did, doc));
        const events = await gatekeeper.exportDID(did);
        const alias = `did:mdip:${did.split(':').pop()}`;
        events.forEach(event => (event.did = alias));
        await gatekeeper.resetDb();

        await expect(gatekeeper.importBatch(events)).resolves.toMatchObject({
            queued: 2,
            rejected: 0,
        });
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({
            added: 2,
            rejected: 0,
            pending: 0,
        });
        await expect(gatekeeper.exportDID(did)).resolves.toHaveLength(2);
    });

    it('revalidates the locked event target after operation verification', async () => {
        const attackerKeys = cipher.generateRandomJwk();
        const victimKeys = cipher.generateRandomJwk();
        const attackerDid = await gatekeeper.createDID(await helper.createAgentOp(attackerKeys));
        const victimDid = await gatekeeper.createDID(await helper.createAgentOp(victimKeys));
        const attackerDoc = await gatekeeper.resolveDID(attackerDid);
        const operation = await helper.createUpdateOp(attackerKeys, attackerDid, attackerDoc);
        const event = {
            registry: 'hyperswarm',
            time: operation.signature!.signed,
            did: attackerDid,
            operation,
        };
        await gatekeeper.importBatch([event]);
        const originalVerifyOperation = gatekeeper.verifyOperation.bind(gatekeeper);
        const verifyOperation = jest.spyOn(gatekeeper, 'verifyOperation').mockImplementationOnce(async op => {
            const valid = await originalVerifyOperation(op);
            op.did = victimDid;
            event.did = victimDid;
            return valid;
        });

        try {
            await expect(gatekeeper.processEvents()).resolves.toMatchObject({
                added: 0,
                rejected: 1,
                pending: 0,
            });
            await expect(gatekeeper.exportDID(attackerDid)).resolves.toHaveLength(1);
            await expect(gatekeeper.exportDID(victimDid)).resolves.toHaveLength(1);
        }
        finally {
            verifyOperation.mockRestore();
        }
    });

    it('should reject a create operation that declares another operation hash', async () => {
        const attacker = cipher.generateRandomJwk();
        const victim = cipher.generateRandomJwk();
        const attackerOp = await helper.createAgentOp(attacker, { registry: 'hyperswarm' });
        const victimOp = await helper.createAgentOp(victim, { registry: 'hyperswarm' });
        attackerOp.signature!.hash = victimOp.signature!.hash;

        expect(await gatekeeper.verifyCreateOperation(attackerOp)).toBe(false);
        attackerOp.created = 'invalid';

        const rejected = await gatekeeper.importBatch([{
            registry: 'hyperswarm',
            time: victimOp.created!,
            operation: attackerOp,
        }]);
        expect(rejected).toMatchObject({ queued: 0, rejected: 1 });

        const imported = await gatekeeper.importBatch([{
            registry: 'hyperswarm',
            time: victimOp.created!,
            operation: victimOp,
        }]);
        expect(imported).toMatchObject({ queued: 1, processed: 0 });
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ added: 1 });

        const victimDid = await gatekeeper.generateDID(victimOp);
        await expect(gatekeeper.resolveDID(victimDid)).resolves.toMatchObject({
            didDocument: { id: victimDid },
        });

        const assetOp = await helper.createAssetOp(victimDid, victim, { registry: 'hyperswarm' });
        assetOp.signature!.hash = victimOp.signature!.hash;
        expect(await gatekeeper.verifyCreateOperation(assetOp)).toBe(false);
    });

    it('should import a valid agent DID export', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.merged).toBe(1);
        expect(response.acceptedHashes).toContain(ops[0].operation.signature!.hash.toLowerCase());
    });

    it('should import a valid asset DID export', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const ops = await gatekeeper.exportDID(assetDID);

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.merged).toBe(1);
    });

    it('should import a valid batch export', async () => {
        const keypair = cipher.generateRandomJwk();
        // create on hyperswarm because exportBatch will not export local DIDs
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair, { registry: 'hyperswarm' });
        await gatekeeper.createDID(assetOp);
        const batch = await gatekeeper.exportBatch();

        await gatekeeper.importBatch(batch);
        const response = await gatekeeper.processEvents();

        expect(response.merged).toBe(2);
    });

    it('should import a batch export with missing event dids', async () => {
        // This simulates an import from hyperswarm-mediator which receives only operations and creates events without DIDs
        // (TBD revisit whether events should be created with DIDs in advance of import)
        const keypair = cipher.generateRandomJwk();
        // create on hyperswarm because exportBatch will not export local DIDs
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(agentDID);
        const updateOp = await helper.createUpdateOp(keypair, agentDID, doc);
        await gatekeeper.updateDID(updateOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair, { registry: 'hyperswarm' });
        await gatekeeper.createDID(assetOp);
        const batch = await gatekeeper.exportBatch();

        await gatekeeper.resetDb();

        for (const event of batch) {
            delete event.did;
        }

        await gatekeeper.importBatch(batch);
        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(3);
    });

    it('should reject an event when DID generation returns no DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const operation = await helper.createAgentOp(keypair);
        const generateDID = jest.spyOn(gatekeeper, 'generateDID').mockResolvedValue('');

        try {
            await gatekeeper.importBatch([{
                registry: 'local',
                time: operation.created!,
                operation,
            }]);

            await expect(gatekeeper.processEvents()).resolves.toMatchObject({
                rejected: 1,
                pending: 0,
            });
        } finally {
            generateDID.mockRestore();
        }
    });

    it('should report 0 ops added when DID exists', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(0);
        expect(response.merged).toBe(2);
    });

    it('should update events when DID is imported from its native registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const deleteOp = await helper.createDeleteOp(keypair, did);
        await gatekeeper.deleteDID(deleteOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].registry = 'TFTC';
        ops[1].registry = 'TFTC';
        ops[1].blockchain = {
            "height": 100,
            "index": 1,
            "txid": "mock1",
            "batch": "mock1"
        };
        ops[2].registry = 'TFTC';
        ops[2].blockchain = {
            "height": 200,
            "index": 2,
            "txid": "mock2",
            "batch": "mock2"
        };

        const checkpoint = await db.exportIndexChanges();
        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(3);
        expect(response.merged).toBe(0);

        const changes = await db.exportIndexChanges({
            cursor: checkpoint.cursor,
            includeOperations: true,
        });

        expect(changes.operations).toStrictEqual([]);
        expect(changes.dids).toHaveLength(1);
        expect(changes.dids[0].events.map(event => event.registry)).toStrictEqual([
            'TFTC',
            'TFTC',
            'TFTC',
        ]);
    });

    it('should reject a forged native confirmation that reuses a signature value', async () => {
        const victim = cipher.generateRandomJwk();
        const attacker = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(victim, { registry: 'hyperswarm' });
        const did = await gatekeeper.createDID(agentOp);
        const [event] = await gatekeeper.exportDID(did);
        const forgedOperation = copyJSON(agentOp);
        forgedOperation.publicJwk = attacker.publicJwk;
        const unsignedForgedOperation = copyJSON(forgedOperation);
        delete unsignedForgedOperation.signature;
        forgedOperation.signature!.hash = cipher.hashJSON(unsignedForgedOperation);
        const forgedOpid = await gatekeeper.generateCID(forgedOperation);

        expect(await gatekeeper.verifyCreateOperation(forgedOperation)).toBe(false);

        await expect(gatekeeper.importBatch([{
            ...event,
            registry: 'hyperswarm',
            opid: forgedOpid,
            operation: forgedOperation,
        }])).resolves.toMatchObject({
            queued: 0,
            rejected: 1,
            rejectedIndices: [0],
        });

        const [storedEvent] = await gatekeeper.exportDID(did);
        const resolved = await gatekeeper.resolveDID(did);

        expect(storedEvent.operation).toStrictEqual(agentOp);
        expect(resolved.didDocument?.verificationMethod?.[0].publicKeyJwk).toStrictEqual(victim.publicJwk);
    });

    it('should verify an operation before merging native confirmation metadata', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { registry: 'hyperswarm' });
        const did = await gatekeeper.createDID(agentOp);
        const [event] = await gatekeeper.exportDID(did);
        const verify = jest.spyOn(gatekeeper, 'verifyCreateOperation').mockResolvedValueOnce(false);

        try {
            await gatekeeper.importBatch([{
                ...event,
                registry: 'hyperswarm',
            }]);
            await expect(gatekeeper.processEvents()).resolves.toMatchObject({
                added: 0,
                merged: 0,
                rejected: 1,
            });

            const [storedEvent] = await gatekeeper.exportDID(did);
            expect(storedEvent.registry).toBe('local');
            expect(verify).toHaveBeenCalledWith(agentOp);
        } finally {
            verify.mockRestore();
        }
    });

    it('should resolve as confirmed when DID is imported from its native registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].registry = 'TFTC';
        ops[1].registry = 'TFTC';
        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();

        const doc2 = await gatekeeper.resolveDID(did);

        expect(doc2.didDocumentMetadata!.version).toBe("2");
        expect(doc2.didDocumentMetadata!.confirmed).toBe(true);
    });

    it('should resolve with timestamp when available', async () => {
        const mockBlock1 = { hash: 'mockBlockid1', height: 100, time: 100 };
        const mockBlock2 = { hash: 'mockBlockid2', height: 101, time: 101 };
        await gatekeeper.addBlock('TFTC', mockBlock1);
        await gatekeeper.addBlock('TFTC', mockBlock2);

        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc, { mockBlockid: mockBlock1.hash });
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].registry = 'TFTC';
        ops[1].registry = 'TFTC';
        ops[1].blockchain = {
            "height": 101,
            "index": 1,
            "txid": "mockTxid",
            "batch": "mockBatch"
        };

        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();

        const doc2 = await gatekeeper.resolveDID(did);

        const expectedTimestamp = {
            chain: 'TFTC',
            opid: doc2.didDocumentMetadata!.versionId,
            lowerBound: {
                blockid: mockBlock1.hash,
                height: mockBlock1.height,
                time: mockBlock1.time,
                timeISO: new Date(mockBlock1.time * 1000).toISOString(),
            },
            upperBound: {
                blockid: mockBlock2.hash,
                height: mockBlock2.height,
                time: mockBlock2.time,
                timeISO: new Date(mockBlock2.time * 1000).toISOString(),
                txid: ops[1].blockchain.txid,
                txidx: ops[1].blockchain.index,
                batchid: ops[1].blockchain.batch,
            }
        };

        expect(doc2.didDocumentMetadata!.timestamp).toStrictEqual(expectedTimestamp);
    });

    it('should reuse persisted event opids when resolving a did', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        ops[0].opid = await gatekeeper.generateCID(ops[0].operation);
        ops[1].opid = await gatekeeper.generateCID(ops[1].operation);

        await gatekeeper.resetDb();
        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();

        const originalGenerateCid = gatekeeper.generateCID.bind(gatekeeper);
        gatekeeper.generateCID = async () => {
            throw new Error('unexpected generateCID');
        };

        try {
            const resolved = await gatekeeper.resolveDID(did);

            expect(resolved.didDocumentMetadata!.versionId).toBe(ops[1].opid);
            expect(resolved.didDocumentMetadata!.version).toBe('2');
        } finally {
            gatekeeper.generateCID = originalGenerateCid;
        }
    });

    it('should reject a create event with a non-canonical opid', async () => {
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        const did = await gatekeeper.generateDID(operation);
        const opid = await gatekeeper.generateCID(operation);
        const event = {
            registry: 'hyperswarm',
            time: operation.created!,
            operation,
            opid: 'attacker-version',
        };

        await gatekeeper.importBatch([event]);
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ added: 0, rejected: 1 });
        await expect(gatekeeper.exportDID(did)).resolves.toHaveLength(0);

        event.opid = '';
        await expect(gatekeeper.importEvent(event)).resolves.toBe('rejected');

        event.opid = opid;
        await gatekeeper.importBatch([event]);
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ added: 1, rejected: 0 });
        await expect(gatekeeper.resolveDID(did)).resolves.toMatchObject({
            didDocumentMetadata: { versionId: opid },
        });
    });

    it('should reject an update event with a non-canonical opid', async () => {
        const keypair = cipher.generateRandomJwk();
        const did = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { step: 1 };
        await gatekeeper.updateDID(await helper.createUpdateOp(keypair, did, doc));
        const events = await gatekeeper.exportDID(did);
        events[0].opid = await gatekeeper.generateCID(events[0].operation);
        const updateOpid = await gatekeeper.generateCID(events[1].operation);
        events[1].opid = 'attacker-version';
        await gatekeeper.resetDb();

        await gatekeeper.importBatch(events);
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ added: 1, rejected: 1 });
        await expect(gatekeeper.exportDID(did)).resolves.toHaveLength(1);

        events[1].opid = updateOpid;
        await gatekeeper.importBatch([events[1]]);
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ added: 1, rejected: 0 });
        await expect(gatekeeper.resolveDID(did)).resolves.toMatchObject({
            didDocumentData: { step: 1 },
            didDocumentMetadata: { versionId: updateOpid, version: '2' },
        });
    });

    it('should generate missing opids without writing operations to IPFS', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const [event] = await gatekeeper.exportDID(did);
        const expectedOpid = await gatekeeper.generateCID(event.operation);
        const addJSON = jest.spyOn(ipfs, 'addJSON');

        try {
            event.registry = 'hyperswarm';
            await gatekeeper.importBatch([event]);
            await gatekeeper.processEvents();

            expect(event.opid).toBe(expectedOpid);
            expect(addJSON).not.toHaveBeenCalled();
        } finally {
            addJSON.mockRestore();
        }
    });

    it('should not overwrite events when verified DID is later synced from another registry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);
        ops[0].registry = 'TFTC';
        ops[1].registry = 'TFTC';
        await gatekeeper.importBatch(ops);

        ops[0].registry = 'hyperswarm';
        ops[1].registry = 'hyperswarm';
        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(0);
        expect(response.merged).toBe(4);
    });

    it('should report 2 ops imported when DID deleted first', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);
        const updateOp = await helper.createUpdateOp(keypair, did, doc);
        await gatekeeper.updateDID(updateOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(2);
        expect(response.merged).toBe(0);
    });

    it('should report N+1 ops imported for N updates', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const doc = await gatekeeper.resolveDID(did);

        const N = 10;
        for (let i = 0; i < N; i++) {
            doc.didDocumentData = { mock: `${i}` };
            const updateOp = await helper.createUpdateOp(keypair, did, doc);
            const verified = await gatekeeper.verifyOperation(updateOp);
            expect(verified).toBe(true);
            await gatekeeper.updateDID(updateOp);
        }

        const events = await gatekeeper.exportDID(did);
        await gatekeeper.resetDb();
        const { queued, rejected } = await gatekeeper.importBatch(events);

        expect(queued).toBe(N + 1);
        expect(rejected).toBe(0);

        const response = await gatekeeper.processEvents();

        expect(response.added).toBe(N + 1);
        expect(response.merged).toBe(0);
    });

    it('should resolve an imported DID', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const ops = await gatekeeper.exportDID(did);

        await gatekeeper.resetDb();

        await gatekeeper.importBatch(ops);
        await gatekeeper.processEvents();
        const doc = await gatekeeper.resolveDID(did);

        expect(doc.didDocument!.id).toBe(did);
    });

    it('should handle processing events in any order', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);
        const updateOp1 = await helper.createUpdateOp(keypair, agentDID, agentDoc);
        await gatekeeper.updateDID(updateOp1);

        const assetOp = await helper.createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);
        const updateOp2 = await helper.createUpdateOp(keypair, assetDID, assetDoc);
        await gatekeeper.updateDID(updateOp2);

        const dids = await gatekeeper.exportDIDs();
        const ops = dids.flat();
        await gatekeeper.resetDb();
        // Reverse the ops so that the updates come before the create ops
        await gatekeeper.importBatch(ops.reverse());

        const response1 = await gatekeeper.processEvents();
        expect(response1.added).toBe(4);
    });

    it('should handle processing pre-v0.5 event without previd property', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);
        const updateOp1 = await helper.createUpdateOp(keypair, agentDID, agentDoc, { excludePrevid: true });
        await gatekeeper.updateDID(updateOp1);

        const assetOp = await helper.createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);
        const updateOp2 = await helper.createUpdateOp(keypair, assetDID, assetDoc, { excludePrevid: true });
        await gatekeeper.updateDID(updateOp2);

        const dids = await gatekeeper.exportDIDs();
        const ops = dids.flat();
        await gatekeeper.resetDb();
        await gatekeeper.importBatch(ops);

        const response = await gatekeeper.processEvents();
        expect(response.added).toBe(4);
    });

    it('should keep an update pending until its preceding update arrives', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const did = await gatekeeper.createDID(agentOp);
        const firstDoc = await gatekeeper.resolveDID(did);
        firstDoc.didDocumentData = { step: 1 };
        expect(await gatekeeper.updateDID(await helper.createUpdateOp(keypair, did, firstDoc))).toBe(true);

        const secondDoc = await gatekeeper.resolveDID(did);
        secondDoc.didDocumentData = { step: 2 };
        expect(await gatekeeper.updateDID(await helper.createUpdateOp(keypair, did, secondDoc))).toBe(true);

        const events = await gatekeeper.exportDID(did);
        expect(events[2].operation.previd).toBe(await gatekeeper.generateCID(events[1].operation));
        await gatekeeper.resetDb();
        await gatekeeper.importBatch([events[0], events[2]]);

        const waiting = await gatekeeper.processEvents();
        expect(waiting.added).toBe(1);
        expect(waiting.pending).toBe(1);

        await gatekeeper.importBatch([events[1]]);
        const complete = await gatekeeper.processEvents();
        expect(complete.added).toBe(2);
        expect(complete.pending).toBe(0);
        expect((await gatekeeper.resolveDID(did)).didDocumentData).toEqual({ step: 2 });
    });

    it('should reject events with duplicate previd property', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);

        const updateOp1 = await helper.createUpdateOp(keypair, agentDID, agentDoc);
        const update1 = copyJSON(agentDoc);
        update1.didDocumentData = { mock: 1 };
        const updateOp2 = await helper.createUpdateOp(keypair, agentDID, update1);
        const update2 = copyJSON(agentDoc);
        update2.didDocumentData = { mock: 2 };
        const updateOp3 = await helper.createUpdateOp(keypair, agentDID, update2);

        const ops = [];

        ops.push({
            registry: 'local',
            operation: updateOp1,
            ordinal: [0],
            time: new Date().toISOString(),
        });

        ops.push({
            registry: 'local',
            operation: updateOp2,
            ordinal: [1],
            time: new Date().toISOString(),
        });

        ops.push({
            registry: 'local',
            operation: updateOp3,
            ordinal: [2],
            time: new Date().toISOString(),
        });

        await gatekeeper.importBatch(ops);
        const response = await gatekeeper.processEvents();
        expect(response.added).toBe(1);
        expect(response.rejected).toBe(2);
        expect(response.acceptedHashes).toStrictEqual([updateOp1.signature!.hash.toLowerCase()]);
    });

    it('should handle a reorg event', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { registry: 'TFTC' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc1 = await gatekeeper.resolveDID(agentDID);
        const [createEvent] = await gatekeeper.exportDID(agentDID);
        await gatekeeper.importBatch([{ ...createEvent, registry: 'TFTC' }]);
        await gatekeeper.processEvents();

        // Simulate a double-spend scenario where a bad actor creates a pair of inconsistent operations
        // Only one of the pair can be confirmed and it depends on the order of operations
        const update1 = copyJSON(agentDoc1);
        update1.didDocumentData = { mock: 1 };
        const updateOp1 = await helper.createUpdateOp(keypair, agentDID, update1);
        const update2 = copyJSON(agentDoc1);
        update2.didDocumentData = { mock: 2 };
        const updateOp2 = await helper.createUpdateOp(keypair, agentDID, update2);

        const event1 = {
            registry: 'hyperswarm',
            operation: updateOp1,
            ordinal: [0],
            time: new Date().toISOString(),
        };

        const event2 = {
            registry: 'hyperswarm',
            operation: updateOp2,
            ordinal: [1],
            time: new Date().toISOString(),
        };

        // Simulate receiving events in reverse order from hyperswarm
        await gatekeeper.importBatch([event2, event1]);
        const response = await gatekeeper.processEvents();
        expect(response.added).toBe(1);
        expect(response.rejected).toBe(1);

        const agentDoc2 = await gatekeeper.resolveDID(agentDID);
        // @ts-expect-error Testing invalid usage
        expect(agentDoc2.didDocumentData.mock).toBe(2);
        const checkpoint = await db.exportIndexChanges();

        const event3 = {
            registry: 'TFTC',
            operation: updateOp1,
            ordinal: [31226, 1, 0],
            time: new Date().toISOString(),
        };

        const event4 = {
            registry: 'TFTC',
            operation: updateOp2,
            ordinal: [31226, 1, 1],
            time: new Date().toISOString(),
        };

        // Simulate receiving the events in the imposed order from TFTC
        await gatekeeper.importBatch([event3, event4]);
        const response2 = await gatekeeper.processEvents();
        expect(response2.added).toBe(1);
        expect(response2.rejected).toBe(1);

        const agentDoc3 = await gatekeeper.resolveDID(agentDID, { confirm: true });
        // @ts-expect-error Testing invalid usage
        expect(agentDoc3.didDocumentData.mock).toBe(1);

        const changes = await db.exportIndexChanges({
            cursor: checkpoint.cursor,
            includeOperations: true,
        });

        expect(changes.operations).toStrictEqual([
            expect.objectContaining({
                did: agentDID,
                event: expect.objectContaining({
                    registry: 'TFTC',
                    operation: expect.objectContaining({
                        signature: expect.objectContaining({
                            hash: updateOp1.signature!.hash,
                        }),
                    }),
                }),
            }),
        ]);
        expect(changes.dids).toHaveLength(1);
        expect(changes.dids[0].events.map(event => event.operation.signature?.hash)).toStrictEqual([
            agentOp.signature!.hash,
            updateOp1.signature!.hash,
        ]);
    });

    it('should handle deferred operation validation when asset ownership changes', async () => {
        const keypair1 = cipher.generateRandomJwk();
        const agentOp1 = await helper.createAgentOp(keypair1, { version: 1, registry: 'TFTC' });
        const agentDID1 = await gatekeeper.createDID(agentOp1);

        const keypair2 = cipher.generateRandomJwk();
        const agentOp2 = await helper.createAgentOp(keypair2, { version: 1, registry: 'TFTC' });
        const agentDID2 = await gatekeeper.createDID(agentOp2);

        const assetOp = await helper.createAssetOp(agentDID1, keypair1, { registry: 'TFTC' });
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc1 = await gatekeeper.resolveDID(assetDID);

        // agent1 transfers ownership of asset to agent2
        assetDoc1.didDocument!.controller = agentDID2;
        const updateOp1 = await helper.createUpdateOp(keypair1, assetDID, assetDoc1);
        await gatekeeper.updateDID(updateOp1);

        // agent2 transfers ownership of asset back to agent1
        assetDoc1.didDocument!.controller = agentDID1;
        const updateOp2 = await helper.createUpdateOp(keypair2, assetDID, assetDoc1);
        await gatekeeper.updateDID(updateOp2);

        const dids = await gatekeeper.exportDIDs();
        const events = dids.flat();
        await gatekeeper.resetDb();
        await gatekeeper.importBatch(events);

        const response1 = await gatekeeper.processEvents();
        expect(response1.added).toBe(events.length);

        const assetDoc2 = await gatekeeper.resolveDID(assetDID);
        expect(assetDoc2.didDocumentMetadata!.version).toBe("3");
        expect(assetDoc2.didDocumentMetadata!.confirmed).toBe(false);

        for (const event of events) {
            event.registry = 'TFTC';
        }

        await gatekeeper.importBatch(events);

        const response2 = await gatekeeper.processEvents();
        expect(response2.added).toBe(events.length);

        const assetDoc3 = await gatekeeper.resolveDID(assetDID);
        expect(assetDoc3.didDocumentMetadata!.version).toBe("3");
        expect(assetDoc3.didDocumentMetadata!.confirmed).toBe(true);
    });

    it('should return accepted deferred asset creates in processEvents', async () => {
        const controllerKeys = cipher.generateRandomJwk();
        const controllerCreate = await helper.createAgentOp(controllerKeys, { version: 1, registry: 'TFTC' });
        const controllerDid = await gatekeeper.createDID(controllerCreate);

        const assetCreate = await helper.createAssetOp(controllerDid, controllerKeys, { registry: 'TFTC' });
        await gatekeeper.createDID(assetCreate);

        await gatekeeper.resetDb();

        await gatekeeper.importBatch([{
            registry: 'hyperswarm',
            time: new Date().toISOString(),
            ordinal: [1],
            operation: assetCreate,
        }]);
        const first = await gatekeeper.processEvents();
        expect(first.acceptedHashes).toStrictEqual([]);
        expect(first.acceptedEvents).toStrictEqual([]);

        await gatekeeper.importBatch([{
            registry: 'hyperswarm',
            time: new Date().toISOString(),
            ordinal: [2],
            operation: controllerCreate,
        }]);
        const second = await gatekeeper.processEvents();
        expect(second.acceptedHashes).toEqual(expect.arrayContaining([
            controllerCreate.signature!.hash.toLowerCase(),
            assetCreate.signature!.hash.toLowerCase(),
        ]));
        const acceptedEventHashes = (second.acceptedEvents ?? [])
            .map(event => event.operation.signature?.hash?.toLowerCase())
            .filter((hash): hash is string => !!hash)
            .sort();

        expect(acceptedEventHashes).toStrictEqual([
            assetCreate.signature!.hash.toLowerCase(),
            controllerCreate.signature!.hash.toLowerCase(),
        ].sort());
    });

    it('should reject events with bad signatures', async () => {
        const keypair1 = cipher.generateRandomJwk();
        const agentOp1 = await helper.createAgentOp(keypair1);
        const agentDID1 = await gatekeeper.createDID(agentOp1);
        const agentDoc1 = await gatekeeper.resolveDID(agentDID1);
        const updateOp1 = await helper.createUpdateOp(keypair1, agentDID1, agentDoc1);
        await gatekeeper.updateDID(updateOp1);

        const keypair2 = cipher.generateRandomJwk();
        const agentOp2 = await helper.createAgentOp(keypair2);
        const agentDID2 = await gatekeeper.createDID(agentOp2);
        const agentDoc2 = await gatekeeper.resolveDID(agentDID2);
        const updateOp2 = await helper.createUpdateOp(keypair2, agentDID2, agentDoc2);
        await gatekeeper.updateDID(updateOp2);

        const dids = await gatekeeper.exportDIDs();
        const ops = dids.flat();
        await gatekeeper.resetDb();

        const sigVal1 = ops[1].operation.signature!.value;
        const sigVal3 = ops[3].operation.signature!.value;

        ops[1].operation.signature!.value = sigVal3;
        ops[3].operation.signature!.value = sigVal1;

        await gatekeeper.importBatch(ops);

        const response1 = await gatekeeper.processEvents();
        expect(response1.added).toBe(2);
        expect(response1.rejected).toBe(2);
        expect(response1.rejectedOperations).toStrictEqual([
            ops[1].operation,
            ops[3].operation,
        ]);

        await expect(gatekeeper.importBatch([ops[1]])).resolves.toMatchObject({
            queued: 1,
            processed: 0,
        });
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({
            rejected: 1,
            rejectedOperations: [ops[1].operation],
        });
    });

    it('should return busy when already proccessing events', async () => {
        const gk = new Gatekeeper({ db, ipfs, console: mockConsole });
        // @ts-expect-error Testing private state
        gk.isProcessingEvents = true;
        const response = await gk.processEvents();

        expect(response.busy).toBe(true);
    });

    it('should retain an event after a transient database failure', async () => {
        const logError = jest.fn();
        const gatekeeper = new Gatekeeper({ db, ipfs, console: { ...mockConsole, error: logError } });
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        const event = {
            registry: 'hyperswarm',
            time: new Date().toISOString(),
            ordinal: [1],
            operation,
        };
        await gatekeeper.importBatch([event]);
        const error = new Error('temporary database failure');
        const addEvent = jest.spyOn(db, 'addEvent')
            .mockRejectedValueOnce(error);

        try {
            await expect(gatekeeper.processEvents()).rejects.toThrow('temporary database failure');
            expect(logError).toHaveBeenCalledWith({
                error,
                eventKey: expect.stringMatching(/^hyperswarm\//),
                did: await gatekeeper.generateDID(operation),
                operationType: 'create',
                previd: undefined,
                staged: 1,
                pending: 0,
            }, 'processEvents error');
        }
        finally {
            addEvent.mockRestore();
        }

        await expect(gatekeeper.importBatch([event])).resolves.toMatchObject({
            queued: 0,
            processed: 1,
        });
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({
            added: 1,
            rejected: 0,
            pending: 0,
            acceptedHashes: [operation.signature!.hash.toLowerCase()],
        });
    });

    it('should replay a partial pass and preserve concurrently queued events after failure', async () => {
        const operations = await Promise.all([
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
        ]);
        const events = operations.map((operation, index) => ({
            registry: 'hyperswarm',
            time: new Date().toISOString(),
            ordinal: [index + 1],
            operation,
        }));
        await gatekeeper.importBatch(events.slice(0, 2));

        const originalAddEvent = db.addEvent.bind(db);
        let calls = 0;
        let noteFailureStarted!: () => void;
        const failureStarted = new Promise<void>(resolve => {
            noteFailureStarted = resolve;
        });
        let releaseFailure!: () => void;
        const failureBlocked = new Promise<void>(resolve => {
            releaseFailure = resolve;
        });
        const addEvent = jest.spyOn(db, 'addEvent').mockImplementation(async (did, event) => {
            calls += 1;
            if (calls === 2) {
                noteFailureStarted();
                await failureBlocked;
                throw new Error('second event database failure');
            }
            return originalAddEvent(did, event);
        });

        const processing = gatekeeper.processEvents();
        await failureStarted;
        await expect(gatekeeper.importBatch([events[0], events[2]])).resolves.toMatchObject({
            queued: 1,
            processed: 1,
            processedIndices: [0],
        });
        releaseFailure();
        await expect(processing).rejects.toThrow('second event database failure');
        addEvent.mockRestore();

        await expect(gatekeeper.importBatch(events)).resolves.toMatchObject({
            queued: 0,
            processed: 3,
        });
        const retried = await gatekeeper.processEvents();
        expect(retried).toMatchObject({
            added: 2,
            merged: 1,
            rejected: 0,
            pending: 0,
        });
        expect(retried.acceptedHashes).toStrictEqual(
            operations.map(operation => operation.signature!.hash.toLowerCase())
        );
    });

    it('should not free transient capacity before a deferred page commits', async () => {
        const localDb = new DbJsonMemory('deferred-page-rollback');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const keys = cipher.generateRandomJwk();
        const did = await gk.createDID(await localHelper.createAgentOp(keys));
        const doc = await gk.resolveDID(did);
        doc.didDocumentData = { updated: true };
        await gk.updateDID(await localHelper.createUpdateOp(keys, did, doc));
        const history = await gk.exportDID(did);
        await gk.resetDb();

        const creates = await Promise.all([
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
        ]);
        const events = [history[1], ...creates.map((operation, index) => ({
            registry: 'hyperswarm',
            time: operation.created!,
            ordinal: [index],
            operation,
        }))];
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxEventPageCount = 2;
        await gk.importBatch(events.slice(0, 2));

        let markWriteStarted!: () => void;
        const writeStarted = new Promise<void>(resolve => {
            markWriteStarted = resolve;
        });
        let releaseWrite!: () => void;
        const writeBlocked = new Promise<void>(resolve => {
            releaseWrite = resolve;
        });
        const addEvent = jest.spyOn(localDb, 'addEvent').mockImplementationOnce(async () => {
            markWriteStarted();
            await writeBlocked;
            throw new Error('page database failure');
        });

        const processing = gk.processEvents();
        await writeStarted;
        await expect(gk.importBatch([events[2]])).resolves.toMatchObject({
            queued: 0,
            capacityDeferred: 1,
            capacityDeferredIndices: [0],
        });
        releaseWrite();
        await expect(processing).rejects.toThrow('page database failure');
        addEvent.mockRestore();

        await expect(gk.importBatch(events.slice(0, 2))).resolves.toMatchObject({
            queued: 0,
            processed: 2,
        });
    });

    it('should report work admitted while a page is processing', async () => {
        const operations = await Promise.all([
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
        ]);
        const events = operations.map((operation, index) => ({
            registry: 'hyperswarm',
            time: operation.created!,
            ordinal: [index],
            operation,
        }));
        await gatekeeper.importBatch([events[0]]);

        const originalAddEvent = db.addEvent.bind(db);
        let markWriteStarted!: () => void;
        const writeStarted = new Promise<void>(resolve => {
            markWriteStarted = resolve;
        });
        let releaseWrite!: () => void;
        const writeBlocked = new Promise<void>(resolve => {
            releaseWrite = resolve;
        });
        const addEvent = jest.spyOn(db, 'addEvent').mockImplementationOnce(async (did, event) => {
            markWriteStarted();
            await writeBlocked;
            return originalAddEvent(did, event);
        });

        const processing = gatekeeper.processEvents();
        await writeStarted;
        await gatekeeper.importBatch([events[1]]);
        releaseWrite();

        await expect(processing).resolves.toMatchObject({ added: 1, hasMore: true });
        addEvent.mockRestore();
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({
            added: 1,
            pending: 0,
            hasMore: false,
        });
    });

    it('should replay successful earlier passes after a later dependency write fails', async () => {
        const controllerKeys = cipher.generateRandomJwk();
        const controllerCreate = await helper.createAgentOp(
            controllerKeys,
            { version: 1, registry: 'hyperswarm' }
        );
        const controllerDid = await gatekeeper.generateDID(controllerCreate);
        const assetCreate = await helper.createAssetOp(
            controllerDid,
            controllerKeys,
            { registry: 'hyperswarm' }
        );
        const assetDid = await gatekeeper.generateDID(assetCreate);
        const events = [assetCreate, controllerCreate].map((operation, index) => ({
            registry: 'hyperswarm',
            time: operation.signature!.signed,
            ordinal: [index + 1],
            operation,
        }));
        await gatekeeper.importBatch(events);

        const originalAddEvent = db.addEvent.bind(db);
        let calls = 0;
        const addEvent = jest.spyOn(db, 'addEvent').mockImplementation(async (did, event) => {
            calls += 1;
            if (calls === 2) {
                throw new Error('asset database failure');
            }
            return originalAddEvent(did, event);
        });

        try {
            await expect(gatekeeper.processEvents()).rejects.toThrow('asset database failure');

            const retried = await gatekeeper.processEvents();
            expect(retried).toMatchObject({
                added: 1,
                merged: 1,
                rejected: 0,
                pending: 0,
            });
            expect(retried.acceptedHashes).toEqual(expect.arrayContaining([
                controllerCreate.signature!.hash.toLowerCase(),
                assetCreate.signature!.hash.toLowerCase(),
            ]));
            expect(addEvent.mock.calls.map(([did]) => did)).toStrictEqual([
                controllerDid,
                assetDid,
                assetDid,
            ]);
            expect(await db.getEvents(controllerDid)).toHaveLength(1);
            expect(await db.getEvents(assetDid)).toHaveLength(1);
        }
        finally {
            addEvent.mockRestore();
        }
    });

    it('should page processing without omitting staged events', async () => {
        const localDb = new DbJsonMemory('paged-events');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const operations = await Promise.all([
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
        ]);
        const events = operations.map((operation, index) => ({
            registry: 'hyperswarm',
            time: operation.created!,
            ordinal: [index],
            operation,
        }));
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxEventPageCount = events.length;
        await gk.importBatch(events);
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxEventPageCount = 2;

        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 2,
            pending: 0,
            hasMore: true,
        });
        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 2,
            pending: 0,
            hasMore: false,
        });
        await expect(localDb.getAllKeys()).resolves.toHaveLength(4);
    });

    it('should enforce byte limits during admission and processing', async () => {
        const localDb = new DbJsonMemory('byte-bounded-events');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const operations = await Promise.all([
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
        ]);
        const events = operations.map((operation, index) => ({
            registry: 'hyperswarm',
            time: operation.created!,
            ordinal: [index],
            operation,
        }));
        const queuedEvents = await Promise.all(events.map(async event => ({
            ...event,
            did: await gk.generateDID(event.operation),
            opid: await gk.generateCID(event.operation),
        })));
        const eventBytes = queuedEvents.map(event => Buffer.byteLength(JSON.stringify(event), 'utf8'));
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxEventPageCount = events.length;
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxTransientEventBytes = eventBytes[0] + eventBytes[1];

        await expect(gk.importBatch(events)).resolves.toMatchObject({
            queued: 2,
            capacityDeferred: 1,
            capacityDeferredIndices: [2],
        });
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxEventPageBytes = Math.max(eventBytes[0], eventBytes[1]);
        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 1,
            acceptedHashes: [operations[0].signature!.hash.toLowerCase()],
            hasMore: true,
        });
        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 1,
            acceptedHashes: [operations[1].signature!.hash.toLowerCase()],
            hasMore: false,
        });
    });

    it('should admit envelope headroom while processing byte-bounded pages', async () => {
        const localDb = new DbJsonMemory('transient-envelope-headroom');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const operations = await Promise.all([
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
            helper.createAgentOp(cipher.generateRandomJwk()),
        ]);
        const events = operations.map((operation, index) => ({
            registry: 'hyperswarm',
            time: operation.created!,
            ordinal: [index],
            operation,
        }));
        const queuedEvents = await Promise.all(events.map(async event => ({
            ...event,
            did: await gk.generateDID(event.operation),
            opid: await gk.generateCID(event.operation),
        })));
        const eventBytes = queuedEvents.map(event => Buffer.byteLength(JSON.stringify(event), 'utf8'));
        // @ts-expect-error Testing separate admission and processing bounds with small fixtures
        gk.maxTransientEventBytes = eventBytes.reduce((total, bytes) => total + bytes, 0);
        // @ts-expect-error Testing separate admission and processing bounds with small fixtures
        gk.maxEventPageBytes = eventBytes[0] + eventBytes[1];

        await expect(gk.importBatch(events)).resolves.toMatchObject({
            queued: 3,
            capacityDeferred: 0,
        });
        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 2,
            hasMore: true,
        });
        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 1,
            hasMore: false,
        });
    });

    it('should reuse pending capacity freed during the same page', async () => {
        const localDb = new DbJsonMemory('reuse-pending-capacity');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const histories = [];

        for (let index = 0; index < 2; index += 1) {
            const keys = cipher.generateRandomJwk();
            const did = await gk.createDID(await localHelper.createAgentOp(keys));
            const doc = await gk.resolveDID(did);
            doc.didDocumentData = { index };
            await gk.updateDID(await localHelper.createUpdateOp(keys, did, doc));
            histories.push(await gk.exportDID(did));
        }
        await gk.resetDb();
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxPendingEventCount = 1;

        await gk.importBatch([histories[0][1]]);
        await expect(gk.processEvents()).resolves.toMatchObject({ pending: 1, hasMore: false });
        await gk.createDID(histories[0][0].operation);
        await gk.importBatch([histories[1][1]]);

        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 1,
            pending: 1,
            capacityDeferred: 0,
            hasMore: false,
        });
        await expect(gk.importBatch([histories[1][1]])).resolves.toMatchObject({
            processed: 1,
            processedIndices: [0],
        });
    });

    it('should give retained work a turn while staged work remains', async () => {
        const localDb = new DbJsonMemory('pending-fairness');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const keys = cipher.generateRandomJwk();
        const did = await gk.createDID(await localHelper.createAgentOp(keys));
        const doc = await gk.resolveDID(did);
        doc.didDocumentData = { updated: true };
        const update = await localHelper.createUpdateOp(keys, did, doc);
        const history = await gk.exportDID(did);
        history.push({
            registry: 'hyperswarm',
            time: update.signature!.signed,
            operation: update,
        });
        await gk.resetDb();
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxEventPageCount = 1;

        await gk.importBatch([history[1]]);
        await expect(gk.processEvents()).resolves.toMatchObject({ pending: 1, hasMore: false });
        await gk.importBatch([history[0]]);

        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 1,
            pending: 1,
            hasMore: true,
        });
        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 1,
            pending: 0,
            hasMore: false,
        });
    });

    it('should not retry a new deferred event after unrelated progress', async () => {
        const localDb = new DbJsonMemory('deferred-after-progress');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const keys = cipher.generateRandomJwk();
        const did = await gk.createDID(await localHelper.createAgentOp(keys));
        const doc = await gk.resolveDID(did);
        doc.didDocumentData = { updated: true };
        await gk.updateDID(await localHelper.createUpdateOp(keys, did, doc));
        const history = await gk.exportDID(did);
        await gk.resetDb();

        const accepted = await localHelper.createAgentOp(cipher.generateRandomJwk());
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxEventPageCount = 2;
        await gk.importBatch([history[1], {
            registry: 'hyperswarm',
            time: accepted.created!,
            operation: accepted,
        }]);

        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 1,
            pending: 1,
            hasMore: false,
        });
        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 0,
            pending: 1,
            hasMore: false,
        });
    });

    it('should skip unchanged pending dependencies and wake them through a DID-prefix alias', async () => {
        const localDb = new DbJsonMemory('pending-dependency-retry');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const keys = cipher.generateRandomJwk();
        const did = await gk.createDID(await localHelper.createAgentOp(keys));
        const doc = await gk.resolveDID(did);
        doc.didDocumentData = { updated: true };
        await gk.updateDID(await localHelper.createUpdateOp(keys, did, doc));
        const history = await gk.exportDID(did);
        await gk.resetDb();
        await gk.importBatch([history[1]]);
        await expect(gk.processEvents()).resolves.toMatchObject({ pending: 1, hasMore: false });
        const importEvent = jest.spyOn(gk, 'importEvent');

        try {
            await gk.processEvents();
            await gk.processEvents();
            expect(importEvent).not.toHaveBeenCalled();

            const unrelated = await localHelper.createAgentOp(cipher.generateRandomJwk());
            await gk.importBatch([{ registry: 'hyperswarm', time: unrelated.created!, operation: unrelated }]);
            await expect(gk.processEvents()).resolves.toMatchObject({ added: 1, pending: 1, hasMore: false });
            expect(importEvent).toHaveBeenCalledTimes(1);

            await gk.importBatch([{ ...history[0], did: did.replace('did:test:', 'did:alias:') }]);
            await expect(gk.processEvents()).resolves.toMatchObject({ added: 2, pending: 0, hasMore: false });
            expect(importEvent).toHaveBeenCalledTimes(3);
            await expect(gk.resolveDID(did)).resolves.toMatchObject({ didDocumentData: { updated: true } });
            // @ts-expect-error Completed events must not retain dependency metadata.
            expect(gk.pendingRetryStates.size).toBe(0);
            // @ts-expect-error Completed events must not retain dependency metadata.
            expect(gk.pendingDependents.size).toBe(0);
        }
        finally {
            importEvent.mockRestore();
        }
    });

    it('should wake an update when its missing nested controller is created locally', async () => {
        const localDb = new DbJsonMemory('nested-pending-dependency');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const keys = cipher.generateRandomJwk();
        const root = await gk.createDID(await localHelper.createAgentOp(keys));
        const controllerCreate = await localHelper.createAssetOp(root, keys);
        controllerCreate.data = 'future controller';
        const unsigned = copyJSON(controllerCreate);
        delete unsigned.signature;
        controllerCreate.signature!.hash = cipher.hashJSON(unsigned);
        controllerCreate.signature!.value = cipher.signHash(controllerCreate.signature!.hash, keys.privateJwk);
        const controllerDid = await gk.generateDID(controllerCreate);
        const did = await gk.createDID(await localHelper.createAssetOp(root, keys));
        const doc = await gk.resolveDID(did);
        doc.didDocument!.controller = controllerDid;
        await expect(gk.updateDID(await localHelper.createUpdateOp(keys, did, doc))).resolves.toBe(true);
        const replacement = await gk.resolveDID(did);
        replacement.didDocumentData = { updated: true };
        const update = await localHelper.createUpdateOp(keys, did, replacement);
        await gk.importBatch([{ registry: 'hyperswarm', time: update.signature!.signed, operation: update }]);
        await expect(gk.processEvents()).resolves.toMatchObject({ pending: 1, hasMore: false });
        const importEvent = jest.spyOn(gk, 'importEvent');

        try {
            await gk.processEvents();
            expect(importEvent).not.toHaveBeenCalled();
            await gk.createDID(controllerCreate);
            await expect(gk.processEvents()).resolves.toMatchObject({ added: 1, pending: 0, hasMore: false });
            expect(importEvent).toHaveBeenCalledTimes(1);
            await expect(gk.resolveDID(did)).resolves.toMatchObject({ didDocumentData: { updated: true } });
        }
        finally {
            importEvent.mockRestore();
        }
    });

    it('should wake a pending update when an intermediate controller history changes', async () => {
        const localDb = new DbJsonMemory('changed-pending-controller');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const keys = cipher.generateRandomJwk();
        const root = await gk.createDID(await localHelper.createAgentOp(keys));
        const controllerCreate = await localHelper.createAssetOp(root, keys);
        const controllerDid = await gk.createDID(controllerCreate);
        const missingController = await gk.generateDID(await localHelper.createAgentOp(cipher.generateRandomJwk()));
        const controller = await gk.resolveDID(controllerDid);
        controller.didDocument!.controller = missingController;
        await gk.updateDID(await localHelper.createUpdateOp(keys, controllerDid, controller));
        const assetCreate = await localHelper.createAssetOp(root, keys);
        assetCreate.data = 'target asset';
        setOperationHash(assetCreate);
        assetCreate.signature!.value = cipher.signHash(assetCreate.signature!.hash, keys.privateJwk);
        const did = await gk.createDID(assetCreate);
        const doc = await gk.resolveDID(did);
        doc.didDocument!.controller = controllerDid;
        await gk.updateDID(await localHelper.createUpdateOp(keys, did, doc));
        const replacement = await gk.resolveDID(did);
        replacement.didDocumentData = { updated: true };
        const update = await localHelper.createUpdateOp(keys, did, replacement);
        await gk.importBatch([{ registry: 'hyperswarm', time: update.signature!.signed, operation: update }]);
        await expect(gk.processEvents()).resolves.toMatchObject({ pending: 1, hasMore: false });

        await gk.removeDIDs([controllerDid]);
        await gk.createDID(controllerCreate);
        await expect(gk.processEvents()).resolves.toMatchObject({ added: 1, pending: 0, hasMore: false });
        await expect(gk.resolveDID(did)).resolves.toMatchObject({ didDocumentData: { updated: true } });
        // @ts-expect-error Completed events must release every controller watch.
        expect(gk.pendingDependents.size).toBe(0);
    });

    it('should wake retained dependencies after a partially persisted page rolls back', async () => {
        const localDb = new DbJsonMemory('pending-partial-persistence');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const keys = cipher.generateRandomJwk();
        const did = await gk.createDID(await localHelper.createAgentOp(keys));
        const doc = await gk.resolveDID(did);
        doc.didDocumentData = { updated: true };
        await gk.updateDID(await localHelper.createUpdateOp(keys, did, doc));
        const history = await gk.exportDID(did);
        await gk.resetDb();
        await gk.importBatch([history[1]]);
        await expect(gk.processEvents()).resolves.toMatchObject({ pending: 1, hasMore: false });
        await gk.importBatch([history[0]]);
        const originalAddEvent = localDb.addEvent.bind(localDb);
        const addEvent = jest.spyOn(localDb, 'addEvent').mockImplementationOnce(async (target, event) => {
            await originalAddEvent(target, event);
            throw new Error('failed after persistence');
        });
        try {
            await expect(gk.processEvents()).rejects.toThrow('failed after persistence');
        }
        finally {
            addEvent.mockRestore();
        }

        await expect(gk.processEvents()).resolves.toMatchObject({ added: 1, merged: 1, pending: 0, hasMore: false });
        await expect(gk.resolveDID(did)).resolves.toMatchObject({ didDocumentData: { updated: true } });
        // @ts-expect-error Rolled-back watches must be released when their events finish.
        expect(gk.pendingDependents.size).toBe(0);
    });

    it('should bound controller watches without rejecting long chains', async () => {
        const localDb = new DbJsonMemory('bounded-pending-controller-watches');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const keys = cipher.generateRandomJwk();
        const root = await gk.createDID(await localHelper.createAgentOp(keys));
        let controller = await gk.generateDID(await localHelper.createAgentOp(cipher.generateRandomJwk()));

        for (let index = 0; index < 33; index += 1) {
            const create = await localHelper.createAssetOp(root, keys);
            create.data = { index };
            setOperationHash(create);
            create.signature!.value = cipher.signHash(create.signature!.hash, keys.privateJwk);
            const did = await gk.createDID(create);
            const doc = await gk.resolveDID(did);
            doc.didDocument!.controller = controller;
            await expect(gk.updateDID(await localHelper.createUpdateOp(keys, did, doc))).resolves.toBe(true);
            controller = did;
        }

        const replacement = await gk.resolveDID(controller);
        replacement.didDocumentData = { updated: true };
        const update = await localHelper.createUpdateOp(keys, controller, replacement);
        await gk.importBatch([{ registry: 'hyperswarm', time: update.signature!.signed, operation: update }]);
        await expect(gk.processEvents()).resolves.toMatchObject({ pending: 1, rejected: 0, hasMore: false });
        // @ts-expect-error Long chains retain a single conservative mutation watch.
        expect(Array.from(gk.pendingRetryStates.values())).toEqual([{ dependencies: ['*'], ready: false }]);
        const importEvent = jest.spyOn(gk, 'importEvent');
        try {
            await gk.processEvents();
            expect(importEvent).not.toHaveBeenCalled();
            await gk.createDID(await localHelper.createAgentOp(cipher.generateRandomJwk()));
            await expect(gk.processEvents()).resolves.toMatchObject({ pending: 1, hasMore: false });
            expect(importEvent).toHaveBeenCalledTimes(1);
            await gk.resetDb();
            // @ts-expect-error Reset must release conservative watches as well.
            expect(gk.pendingDependents.size).toBe(0);
        }
        finally {
            importEvent.mockRestore();
        }
    });

    it('should retain old pending events and report new overflow as retryable capacity', async () => {
        const localDb = new DbJsonMemory('pending-capacity');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const histories = [];

        for (let index = 0; index < 2; index += 1) {
            const keys = cipher.generateRandomJwk();
            const did = await gk.createDID(await localHelper.createAgentOp(keys));
            const doc = await gk.resolveDID(did);
            doc.didDocumentData = { index };
            await gk.updateDID(await localHelper.createUpdateOp(keys, did, doc));
            histories.push(await gk.exportDID(did));
        }
        await gk.resetDb();
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxPendingEventCount = 1;

        await gk.importBatch([histories[0][1]]);
        await expect(gk.processEvents()).resolves.toMatchObject({
            pending: 1,
            capacityDeferred: 0,
            hasMore: false,
        });

        await gk.importBatch([histories[1][1]]);
        await expect(gk.processEvents()).resolves.toMatchObject({
            pending: 1,
            capacityDeferred: 1,
            capacityDeferredHashes: [histories[1][1].operation.signature!.hash.toLowerCase()],
            hasMore: false,
        });
        // @ts-expect-error Capacity-deferred events must not retain retry metadata.
        expect(gk.pendingRetryStates.size).toBe(1);
        // @ts-expect-error Only the retained event may hold a dependency watch.
        expect(gk.pendingDependents.size).toBe(1);
        await expect(gk.importBatch([histories[0][1]])).resolves.toMatchObject({
            queued: 0,
            processed: 1,
            processedIndices: [0],
        });

        await gk.importBatch([histories[0][0]]);
        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 2,
            pending: 0,
            capacityDeferred: 0,
        });
    });

    it('should remove capacity-deferred events from the current pending pass', async () => {
        const localDb = new DbJsonMemory('pending-pass-capacity');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const histories = [];

        for (let index = 0; index < 2; index += 1) {
            const keys = cipher.generateRandomJwk();
            const did = await gk.createDID(await localHelper.createAgentOp(keys));
            const doc = await gk.resolveDID(did);
            doc.didDocumentData = { index };
            await gk.updateDID(await localHelper.createUpdateOp(keys, did, doc));
            histories.push(await gk.exportDID(did));
        }
        await gk.resetDb();

        const accepted = await localHelper.createAgentOp(cipher.generateRandomJwk());
        const acceptedEvent = {
            registry: 'hyperswarm',
            time: accepted.created!,
            operation: accepted,
        };
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxPendingEventCount = 0;
        // @ts-expect-error Testing bounded private state with small fixtures
        gk.maxEventPageCount = 4;
        await gk.importBatch([histories[0][1], histories[1][1], acceptedEvent]);

        await expect(gk.processEvents()).resolves.toMatchObject({
            added: 1,
            pending: 0,
            capacityDeferred: 2,
            capacityDeferredHashes: [
                histories[0][1].operation.signature!.hash.toLowerCase(),
                histories[1][1].operation.signature!.hash.toLowerCase(),
            ],
            hasMore: false,
        });
    });

    it('should reject a deferred staged event whose verified hash is lost', async () => {
        const localDb = new DbJsonMemory('invalid-deferred-event');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const localHelper = new TestHelper(gk, cipher);
        const keys = cipher.generateRandomJwk();
        const did = await gk.createDID(await localHelper.createAgentOp(keys));
        const doc = await gk.resolveDID(did);
        doc.didDocumentData = { updated: true };
        await gk.updateDID(await localHelper.createUpdateOp(keys, did, doc));
        const history = await gk.exportDID(did);
        await gk.resetDb();

        await expect(gk.importBatch([history[1]])).resolves.toMatchObject({ queued: 1 });
        const getVerifiedOperationHash = jest.spyOn(
            gk as unknown as { getVerifiedOperationHash(operation: Operation): string | undefined },
            'getVerifiedOperationHash',
        ).mockReturnValueOnce(undefined);

        await expect(gk.processEvents()).resolves.toMatchObject({
            rejected: 1,
            rejectedOperations: [history[1].operation],
            pending: 0,
        });
        getVerifiedOperationHash.mockRestore();
    });

    it('should fail if queued event state is missing', async () => {
        const localDb = new DbJsonMemory('missing-event-state');
        const gk = new Gatekeeper({ db: localDb, ipfs, console: mockConsole });
        const operation = await helper.createAgentOp(cipher.generateRandomJwk());
        await gk.importBatch([{
            registry: 'hyperswarm',
            time: operation.created!,
            operation,
        }]);
        // @ts-expect-error Simulating corrupted private queue state
        gk.eventStates.clear();

        await expect(gk.processEvents()).rejects.toThrow('missing queued event state');
    });

    it('should propagate unexpected processing exceptions', async () => {
        const gk = new Gatekeeper({ db, ipfs, console: mockConsole });
        // @ts-expect-error Testing private state
        gk.stagedEvents = null;

        await expect(gk.processEvents()).rejects.toThrow();
        // @ts-expect-error Testing private state
        expect(gk.isProcessingEvents).toBe(false);
    });
});

describe('getDids', () => {
    it('should return all DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);

        const allDIDs = await gatekeeper.getDIDs();

        expect(allDIDs.length).toBe(2);
        expect(allDIDs.includes(agentDID)).toBe(true);
        expect(allDIDs.includes(assetDID)).toBe(true);
    });

    it('should return all DIDs resolved', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);

        const assetOp = await helper.createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);

        const allDocs = await gatekeeper.getDIDs({ resolve: true });

        // Update the retrieved timestamps to match any value
        agentDoc.didResolutionMetadata!.retrieved = expect.any(String);
        assetDoc.didResolutionMetadata!.retrieved = expect.any(String);

        expect(allDocs.length).toBe(2);
        expect(allDocs[0]).toStrictEqual(agentDoc);
        expect(allDocs[1]).toStrictEqual(assetDoc);
    });

    it('should return all DIDs confirmed and resolved', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);

        const updatedAgentDoc = JSON.parse(JSON.stringify(agentDoc));
        updatedAgentDoc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, agentDID, updatedAgentDoc);
        await gatekeeper.updateDID(updateOp);

        const assetOp = await helper.createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);

        const allDocs = await gatekeeper.getDIDs({ confirm: true, resolve: true });

        // Update the retrieved timestamp to match any value
        assetDoc.didResolutionMetadata!.retrieved = expect.any(String);

        expect(allDocs.length).toBe(1);
        expect(allDocs[0]).toStrictEqual(assetDoc);
    });

    it('should return all DIDs unconfirmed and resolved', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'TFTC' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const agentDoc = await gatekeeper.resolveDID(agentDID);

        const updatedAgentDoc = JSON.parse(JSON.stringify(agentDoc));
        updatedAgentDoc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, agentDID, updatedAgentDoc);
        await gatekeeper.updateDID(updateOp);
        const agentDocv2 = await gatekeeper.resolveDID(agentDID);

        const assetOp = await helper.createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const assetDoc = await gatekeeper.resolveDID(assetDID);

        const allDocs = await gatekeeper.getDIDs({ confirm: false, resolve: true });

        // Update the retrieved timestamps to match any value
        agentDocv2.didResolutionMetadata!.retrieved = expect.any(String);
        assetDoc.didResolutionMetadata!.retrieved = expect.any(String);

        expect(allDocs.length).toBe(2);
        expect(allDocs[0]).toStrictEqual(agentDocv2);
        expect(allDocs[1]).toStrictEqual(assetDoc);
    });

    it('should return all DIDs after specified time', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { registry: 'TFTC' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];
        const batch = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await helper.createAssetOp(agentDID, keypair, { registry: 'TFTC' });
            const assetDID = await gatekeeper.createDID(assetOp);
            const update = await gatekeeper.resolveDID(assetDID);
            update.didDocumentData = { mock: i + 1 };
            const updateOp = await helper.createUpdateOp(keypair, assetDID, update);
            await gatekeeper.updateDID(updateOp);
            dids.push(assetDID);
            const ops = await gatekeeper.exportDID(assetDID);
            batch.push(...ops);
        }

        let timestamp = Date.now();

        for (const op of batch) {
            op.registry = 'TFTC';
            timestamp += 3600000; // add 1 hour to timestamp for each op
            op.time = new Date(timestamp).toISOString();
        }

        await gatekeeper.importBatch(batch);
        await gatekeeper.processEvents();

        const doc = await gatekeeper.resolveDID(dids[4]);
        const recentDIDs = await gatekeeper.getDIDs({ updatedAfter: doc.didDocumentMetadata!.updated });

        expect(recentDIDs.length).toBe(5);
        expect(recentDIDs.includes(dids[5])).toBe(true);
        expect(recentDIDs.includes(dids[6])).toBe(true);
        expect(recentDIDs.includes(dids[7])).toBe(true);
        expect(recentDIDs.includes(dids[8])).toBe(true);
        expect(recentDIDs.includes(dids[9])).toBe(true);
    });

    it('should return all DIDs before specified time', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { registry: 'TFTC' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];
        const batch = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await helper.createAssetOp(agentDID, keypair, { registry: 'TFTC' });
            const assetDID = await gatekeeper.createDID(assetOp);
            const update = await gatekeeper.resolveDID(assetDID);
            update.didDocumentData = { mock: i + 1 };
            const updateOp = await helper.createUpdateOp(keypair, assetDID, update);
            await gatekeeper.updateDID(updateOp);
            dids.push(assetDID);
            const ops = await gatekeeper.exportDID(assetDID);
            batch.push(...ops);
        }

        let timestamp = Date.now();

        for (const op of batch) {
            op.registry = 'TFTC';
            timestamp += 3600000; // add 1 hour to timestamp for each op
            op.time = new Date(timestamp).toISOString();
        }

        await gatekeeper.importBatch(batch);
        await gatekeeper.processEvents();
        const doc = await gatekeeper.resolveDID(dids[5]);
        const recentDIDs = await gatekeeper.getDIDs({ updatedBefore: doc.didDocumentMetadata!.updated });

        expect(recentDIDs.length).toBe(6);
        expect(recentDIDs.includes(agentDID)).toBe(true);
        expect(recentDIDs.includes(dids[0])).toBe(true);
        expect(recentDIDs.includes(dids[1])).toBe(true);
        expect(recentDIDs.includes(dids[2])).toBe(true);
        expect(recentDIDs.includes(dids[3])).toBe(true);
        expect(recentDIDs.includes(dids[4])).toBe(true);
    });

    it('should return all DIDs between specified times', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { registry: 'TFTC' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];
        const batch = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await helper.createAssetOp(agentDID, keypair, { registry: 'TFTC' });
            const assetDID = await gatekeeper.createDID(assetOp);
            const update = await gatekeeper.resolveDID(assetDID);
            update.didDocumentData = { mock: i + 1 };
            const updateOp = await helper.createUpdateOp(keypair, assetDID, update);
            await gatekeeper.updateDID(updateOp);
            dids.push(assetDID);
            const ops = await gatekeeper.exportDID(assetDID);
            batch.push(...ops);
        }

        let timestamp = Date.now();

        for (const op of batch) {
            op.registry = 'TFTC';
            timestamp += 3600000; // add 1 hour to timestamp for each op
            op.time = new Date(timestamp).toISOString();
        }

        await gatekeeper.importBatch(batch);
        await gatekeeper.processEvents();
        const doc3 = await gatekeeper.resolveDID(dids[3]);
        const doc8 = await gatekeeper.resolveDID(dids[8]);
        const recentDIDs = await gatekeeper.getDIDs({
            updatedAfter: doc3.didDocumentMetadata!.updated,
            updatedBefore: doc8.didDocumentMetadata!.updated
        });

        expect(recentDIDs.length).toBe(4);
        expect(recentDIDs.includes(dids[4])).toBe(true);
        expect(recentDIDs.includes(dids[5])).toBe(true);
        expect(recentDIDs.includes(dids[6])).toBe(true);
        expect(recentDIDs.includes(dids[7])).toBe(true);
    });

    it('should resolve all specified DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const dids = [];
        const expected = [];

        for (let i = 0; i < 10; i++) {
            const assetOp = await helper.createAssetOp(agentDID, keypair);
            const assetDID = await gatekeeper.createDID(assetOp);
            dids.push(assetDID);

            const doc = await gatekeeper.resolveDID(assetDID);
            doc.didResolutionMetadata!.retrieved = expect.any(String);
            expected.push(doc);
        }

        const resolvedDIDs = await gatekeeper.getDIDs({
            dids: dids,
            resolve: true
        });

        expect(resolvedDIDs.length).toBe(10);

        for (let i = 0; i < 10; i++) {
            expect(resolvedDIDs[i]).toStrictEqual(expected[i]);
        }
    });
});
