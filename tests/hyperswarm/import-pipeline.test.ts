import { jest } from '@jest/globals';

import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import { generateCID } from '@mdip/ipfs/utils';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import {
    createImportPipeline,
    type ImportPipelineOptions,
    type PersistedOperationsPage,
} from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import { mapAcceptedOperationsToSyncRecords } from '../../services/mediators/hyperswarm/src/sync-persistence.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import TestHelper from '../gatekeeper/helper.ts';

const operation: Operation = {
    type: 'create',
    created: '2026-08-01T12:00:00.000Z',
    mdip: {
        version: 1,
        type: 'agent',
        registry: 'hyperswarm',
    },
    signature: {
        signed: '2026-08-01T12:00:00.000Z',
        hash: 'a'.repeat(64),
        value: 'signature',
    },
};

function createPipeline(
    isReady: jest.Mock<() => Promise<boolean>>,
    syncStore = new InMemoryOperationSyncStore(),
    gatekeeperOverrides: Partial<ImportPipelineOptions['gatekeeper']> = {},
    callbackOverrides: Partial<Pick<ImportPipelineOptions, 'beginStoreMutation' | 'onStoreChanged' | 'syncStats'>> = {},
) {
    const gatekeeper = {
        exportIndex: jest.fn(),
        importBatch: jest.fn(),
        isReady,
        processEvents: jest.fn(),
        ...gatekeeperOverrides,
    } as unknown as ImportPipelineOptions['gatekeeper'];

    return createImportPipeline({
        gatekeeper,
        syncStore,
        cipher: new CipherNode(),
        syncStats: createMediatorSyncStats(),
        retryDelayMs: 300_000,
        beginStoreMutation: jest.fn(() => jest.fn()),
        onStoreChanged: jest.fn(),
        ...callbackOverrides,
    });
}

async function makeTerminalChain(): Promise<{ root: Operation; child: Operation }> {
    const cipher = new CipherNode();
    const rootUnsigned = {
        type: 'update' as const,
        did: 'did:test:legacy',
        doc: { didDocumentData: { root: true } },
    };
    const root: Operation = {
        ...rootUnsigned,
        signature: {
            signed: '2026-08-01T12:00:00.000Z',
            hash: cipher.hashJSON(rootUnsigned),
            value: 'signature',
        },
    };
    const rootCid = await generateCID(JSON.parse(cipher.canonicalizeJSON(root)));
    const childUnsigned = {
        type: 'update' as const,
        did: rootUnsigned.did,
        previd: rootCid,
        doc: { didDocumentData: { child: true } },
    };
    return {
        root,
        child: {
            ...childUnsigned,
            signature: {
                signed: '2026-08-01T12:01:00.000Z',
                hash: cipher.hashJSON(childUnsigned),
                value: 'signature',
            },
        },
    };
}

function makeValidOperation(index: number): Operation {
    const cipher = new CipherNode();
    const unsigned = {
        type: 'create' as const,
        created: new Date(Date.UTC(2026, 7, 1, 12, 0, 0, index)).toISOString(),
        mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
    };
    return {
        ...unsigned,
        signature: {
            signed: unsigned.created,
            hash: cipher.hashJSON(unsigned),
            value: `signature-${index}`,
        },
    };
}

describe('import pipeline', () => {
    it('runs completion before starting the next queued import', async () => {
        const isReady = jest.fn(async () => false);
        const pipeline = createPipeline(isReady);
        let aborted = false;

        const first = pipeline.enqueue(
            { kind: 'remote', name: 'peer-a', data: [operation] },
            () => { aborted = true; },
        );
        const second = pipeline.enqueue({
            kind: 'remote',
            name: 'peer-a',
            data: [operation],
            cancelled: () => aborted,
        });

        await expect(first).resolves.toMatchObject({ retryable: true });
        await expect(second).resolves.toMatchObject({ retryable: false });
        expect(isReady).toHaveBeenCalledTimes(1);
        await pipeline.shutdown();
    });

    it('drains active work during shutdown and rejects later imports', async () => {
        let releaseReady!: () => void;
        const isReady = jest.fn(() => new Promise<boolean>(resolve => {
            releaseReady = () => resolve(false);
        }));
        const pipeline = createPipeline(isReady);
        const active = pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [operation] });
        const shutdown = pipeline.shutdown();

        await new Promise(resolve => setImmediate(resolve));
        expect(pipeline.running).toBe(1);
        releaseReady();
        await expect(active).resolves.toMatchObject({ retryable: true });
        await shutdown;
        await expect(pipeline.enqueue({
            kind: 'remote',
            name: 'peer-a',
            data: [operation],
        })).resolves.toMatchObject({ retryable: true });
        expect(isReady).toHaveBeenCalledTimes(1);
    });

    it('does not persist terminal operations after their session is cancelled', async () => {
        const cipher = new CipherNode();
        const unsigned = {
            type: 'update' as const,
            did: 'did:test:legacy',
            doc: { didDocumentData: { legacy: true } },
        };
        const legacyOperation: Operation = {
            ...unsigned,
            signature: {
                signed: '2026-08-01T12:00:00.000Z',
                hash: cipher.hashJSON(unsigned),
                value: 'signature',
            },
        };
        const store = new InMemoryOperationSyncStore();
        const upsertMany = jest.spyOn(store, 'upsertMany');
        const pipeline = createPipeline(jest.fn(async () => true), store);
        let cancellationChecks = 0;

        await expect(pipeline.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [legacyOperation],
            cancelled: () => ++cancellationChecks > 1,
        })).resolves.toMatchObject({ persistedIds: [], retryable: false });
        expect(cancellationChecks).toBe(2);
        expect(upsertMany).not.toHaveBeenCalled();
        await pipeline.shutdown();
    });

    it('drains an admitted index refresh and rejects new refreshes during shutdown', async () => {
        let rejectRefresh!: (error: Error) => void;
        const exportIndex = jest.fn(() => new Promise<never>((_resolve, reject) => {
            rejectRefresh = reject;
        }));
        const pipeline = createPipeline(
            jest.fn(async () => true),
            new InMemoryOperationSyncStore(),
            { exportIndex },
        );
        const refresh = pipeline.refreshIndex('test');
        const refreshResult = expect(refresh).rejects.toThrow('index unavailable');
        let shutdownSettled = false;

        await new Promise(resolve => setImmediate(resolve));
        const shutdown = pipeline.shutdown().then(() => { shutdownSettled = true; });
        await new Promise(resolve => setImmediate(resolve));

        expect(shutdownSettled).toBe(false);
        await expect(pipeline.refreshIndex('late')).rejects.toThrow('import pipeline is shutting down');
        expect(exportIndex).toHaveBeenCalledTimes(1);

        rejectRefresh(new Error('index unavailable'));
        await refreshResult;
        await shutdown;
        expect(shutdownSettled).toBe(true);
    });

    it('invalidates the cache before an import write that persists and then throws', async () => {
        const store = new InMemoryOperationSyncStore();
        const upsertMany = store.upsertMany.bind(store);
        const finishStoreMutation = jest.fn();
        const beginStoreMutation = jest.fn(() => finishStoreMutation);
        const onStoreChanged = jest.fn();
        jest.spyOn(store, 'upsertMany').mockImplementationOnce(async records => {
            expect(beginStoreMutation).toHaveBeenCalledTimes(1);
            expect(finishStoreMutation).not.toHaveBeenCalled();
            await upsertMany(records);
            throw new Error('commit acknowledgement lost');
        });
        const pipeline = createPipeline(
            jest.fn(async () => true),
            store,
            {},
            { beginStoreMutation, onStoreChanged },
        );

        await expect(pipeline.enqueue({
            kind: 'local_queue',
            phase: 'persist',
            name: 'local',
            data: [operation],
        })).resolves.toMatchObject({
            persistedIds: [],
            acceptedOperations: [],
            portableTerminalOperations: [],
            retryable: true,
        });

        await expect(store.has(operation.signature!.hash)).resolves.toBe(true);
        expect(finishStoreMutation).toHaveBeenCalledTimes(1);
        expect(onStoreChanged).not.toHaveBeenCalled();
        await pipeline.shutdown();
    });

    it('returns accepted operations only after their sync records persist', async () => {
        const accepted = makeValidOperation(1);
        const store = new InMemoryOperationSyncStore();
        const upsertMany = store.upsertMany.bind(store);
        let releaseWrite!: () => void;
        const writeBlocked = new Promise<void>(resolve => { releaseWrite = resolve; });
        let markWriteStarted!: () => void;
        const writeStarted = new Promise<void>(resolve => { markWriteStarted = resolve; });
        jest.spyOn(store, 'upsertMany').mockImplementationOnce(async records => {
            markWriteStarted();
            await writeBlocked;
            return upsertMany(records);
        });
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn(async () => ({
                queued: 1, processed: 0, rejected: 0, total: 1,
                rejectedIndices: [], capacityDeferredIndices: [], processedIndices: [],
            })),
            processEvents: jest.fn(async () => ({
                added: 1, merged: 0, rejected: 0, pending: 0,
                acceptedHashes: [accepted.signature!.hash],
                acceptedEvents: [{ registry: 'hyperswarm', time: accepted.created!, operation: accepted }],
                hasMore: false,
            })),
        });

        let completed = false;
        const importing = pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [accepted] })
            .then(result => {
                completed = true;
                return result;
            });
        await writeStarted;
        expect(completed).toBe(false);

        releaseWrite();
        await expect(importing).resolves.toMatchObject({
            acceptedOperations: [accepted],
            portableTerminalOperations: [],
            retryable: false,
        });
        await pipeline.shutdown();
    });

    it('returns content-verified Gatekeeper rejections as portable terminal operations', async () => {
        const rejected = makeValidOperation(1);
        const store = new InMemoryOperationSyncStore();
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn(async () => ({
                queued: 0, processed: 0, rejected: 1, total: 1,
                rejectedIndices: [0], capacityDeferredIndices: [], processedIndices: [],
            })),
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [rejected] }))
            .resolves.toMatchObject({
                persistedIds: [rejected.signature!.hash],
                acceptedOperations: [],
                portableTerminalOperations: [rejected],
                unaddressableOperations: [],
                retryable: false,
            });
        expect((await store.getByIds([rejected.signature!.hash]))[0].syncOrder)
            .toBe(Number.MAX_SAFE_INTEGER);
        await pipeline.shutdown();
    });

    it('shares the accepted event instead of a rejected request with the same unsigned hash', async () => {
        const cipher = new CipherNode();
        const db = new DbJsonMemory('accepted-signature-variant');
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });
        const helper = new TestHelper(gatekeeper, cipher);
        const genuine = await helper.createAgentOp(cipher.generateRandomJwk(), { registry: 'hyperswarm' });
        const forged: Operation = {
            ...genuine,
            signature: { ...genuine.signature!, value: '0'.repeat(128) },
        };
        expect(await gatekeeper.verifyCreateOperation(forged)).toBe(false);
        await gatekeeper.importBatch([{ registry: 'hyperswarm', time: genuine.created!, operation: genuine }]);
        const store = new InMemoryOperationSyncStore();
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: gatekeeper.importBatch.bind(gatekeeper),
            processEvents: gatekeeper.processEvents.bind(gatekeeper),
        });

        try {
            await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [forged] }))
                .resolves.toMatchObject({
                    acceptedOperations: [genuine],
                    portableTerminalOperations: [],
                    retryable: false,
                });
            expect((await store.getByIds([genuine.signature!.hash]))[0].operation).toEqual(genuine);
            const did = await gatekeeper.generateDID(genuine);
            expect((await db.getEvents(did))[0].operation).toEqual(genuine);
        } finally {
            await pipeline.shutdown();
        }
    });

    it('drains another caller\'s full staging queue before retrying refused operations', async () => {
        jest.useFakeTimers();
        const cipher = new CipherNode();
        const db = new DbJsonMemory('staged-capacity-recovery');
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });
        (gatekeeper as unknown as { maxEventPageCount: number }).maxEventPageCount = 1;
        const helper = new TestHelper(gatekeeper, cipher);
        const staged = await helper.createAgentOp(cipher.generateRandomJwk(), { registry: 'hyperswarm' });
        const refused = await helper.createAgentOp(cipher.generateRandomJwk(), { registry: 'hyperswarm' });
        await gatekeeper.importBatch([{ registry: 'hyperswarm', time: staged.created!, operation: staged }]);
        const processEvents = jest.fn(gatekeeper.processEvents.bind(gatekeeper));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch: gatekeeper.importBatch.bind(gatekeeper),
            processEvents,
        });

        try {
            await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [refused] }))
                .resolves.toMatchObject({ capacityDeferredIds: [refused.signature!.hash], retryable: false });
            expect(processEvents).toHaveBeenCalledTimes(1);
            expect(await db.getAllKeys()).toHaveLength(1);
            expect(gatekeeper.getQueueStatus().total).toBe(0);

            await jest.advanceTimersByTimeAsync(300_000);
            await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [refused] }))
                .resolves.toMatchObject({ persistedIds: [refused.signature!.hash], capacityDeferredIds: [] });
            expect(await db.getAllKeys()).toHaveLength(2);
        } finally {
            await pipeline.shutdown();
            jest.useRealTimers();
        }
    });

    it('processes an operation already staged by another caller', async () => {
        const cipher = new CipherNode();
        const db = new DbJsonMemory('staged-duplicate-recovery');
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });
        const helper = new TestHelper(gatekeeper, cipher);
        const staged = await helper.createAgentOp(cipher.generateRandomJwk(), { registry: 'hyperswarm' });
        await gatekeeper.importBatch([{ registry: 'hyperswarm', time: staged.created!, operation: staged }]);
        const processEvents = jest.fn(gatekeeper.processEvents.bind(gatekeeper));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch: gatekeeper.importBatch.bind(gatekeeper),
            processEvents,
        });

        try {
            await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [staged] }))
                .resolves.toMatchObject({ persistedIds: [staged.signature!.hash], pendingIds: [], retryable: false });
            expect(processEvents).toHaveBeenCalledTimes(1);
            expect(await db.getAllKeys()).toHaveLength(1);
            expect(gatekeeper.getQueueStatus().total).toBe(0);
        } finally {
            await pipeline.shutdown();
        }
    });

    it('preserves accepted-hash-only responses when the server omits accepted events', async () => {
        const accepted = makeValidOperation(1);
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch: jest.fn(async () => ({ queued: 1, processed: 0, rejected: 0, total: 1, rejectedIndices: [] })),
            processEvents: jest.fn(async () => ({ acceptedHashes: [accepted.signature!.hash] })),
        });
        try {
            await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [accepted] }))
                .resolves.toMatchObject({ acceptedOperations: [accepted], retryable: false });
        } finally {
            await pipeline.shutdown();
        }
    });

    it('publishes older pending operations a bounded persisted page at a time', async () => {
        const requested = makeValidOperation(0);
        const pages: Operation[][] = Array.from({ length: 6 }, (_, page) => Array.from({ length: 8 }, (_, index) => {
            const operation = makeValidOperation(1 + page * 8 + index);
            return { ...operation, signature: { ...operation.signature!, padding: 'x'.repeat(60_000) } };
        }));
        pages[5].push(requested);
        const store = new InMemoryOperationSyncStore();
        const order: string[] = [];
        let pageIndex = 0;
        const processEvents = jest.fn<GatekeeperClient['processEvents']>(async () => {
            const index = pageIndex++;
            order.push(`process-${index}`);
            return {
                acceptedEvents: pages[index].map(operation => ({ registry: 'hyperswarm', time: operation.created!, operation })),
                hasMore: index < pages.length - 1,
            };
        });
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn(async () => ({ queued: 1, processed: 0, rejected: 0, total: 1, rejectedIndices: [] })),
            processEvents,
        });
        let published = 0;
        const onPersistedPage = jest.fn(async (page: { acceptedOperations: Operation[]; portableTerminalOperations: Operation[] }) => {
            const operations = [...page.acceptedOperations, ...page.portableTerminalOperations];
            expect(operations.length).toBeLessThanOrEqual(300);
            expect(operations.reduce((bytes, item) => bytes + Buffer.byteLength(JSON.stringify(item)), 0))
                .toBeLessThanOrEqual(512 * 1024);
            for (const operation of operations) expect(await store.has(operation.signature!.hash)).toBe(true);
            order.push(`publish-${published++}`);
        });
        try {
            await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [requested], onPersistedPage }))
                .resolves.toMatchObject({
                    persistedIds: [requested.signature!.hash], acceptedOperations: [],
                    portableTerminalOperations: [], retryable: false,
                });
            expect(onPersistedPage).toHaveBeenCalledTimes(6);
            expect(await store.count()).toBe(49);
            expect(order).toEqual(pages.flatMap((_page, index) => [`process-${index}`, `publish-${index}`]));
        } finally {
            await pipeline.shutdown();
        }
    });

    it('bounds returned classifications when accepted variants are larger than the request', async () => {
        const requested = Array.from({ length: 12 }, (_, index) => makeValidOperation(index));
        const variants = requested.map(operation => ({
            ...operation, signature: { ...operation.signature!, padding: 'x'.repeat(60_000) },
        }));
        const unrelated = makeValidOperation(20);
        const invalid = { ...makeValidOperation(21), signature: { ...makeValidOperation(21).signature!, hash: 'f'.repeat(64) } };
        const pages = [[unrelated], variants.slice(0, 8), variants.slice(8)];
        const store = new InMemoryOperationSyncStore();
        let pageIndex = 0;
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn(async () => ({ queued: requested.length, processed: 0, rejected: 0, total: requested.length, rejectedIndices: [] })),
            processEvents: jest.fn<GatekeeperClient['processEvents']>(async () => {
                const index = pageIndex++;
                return {
                    acceptedEvents: pages[index].map(operation => ({ registry: 'hyperswarm', time: operation.created!, operation })),
                    ...(index === 0 ? { rejectedOperations: [invalid] } : {}),
                    hasMore: index < pages.length - 1,
                };
            }),
        });
        try {
            const result = await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: requested });
            expect(result.retryable).toBe(false);
            expect(result.persistedIds).toEqual(requested.map(item => item.signature!.hash));
            expect(result.acceptedOperations).toHaveLength(8);
            expect(result.acceptedOperations).not.toContainEqual(unrelated);
            expect(Buffer.byteLength(JSON.stringify(result.acceptedOperations))).toBeLessThan(512 * 1024);
            expect(result.unaddressableOperations).toEqual([]);
            expect(await store.count()).toBe(13);
        } finally {
            await pipeline.shutdown();
        }
    });

    it('splits structural rejections and accepted events into bounded persisted publications', async () => {
        const accepted = Array.from({ length: 300 }, (_, index) => makeValidOperation(index));
        const rejected = makeValidOperation(300);
        const store = new InMemoryOperationSyncStore();
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn(async () => ({ queued: 1, processed: 0, rejected: 1, total: 301, rejectedIndices: [1] })),
            processEvents: jest.fn(async () => ({
                acceptedEvents: accepted.map(operation => ({ registry: 'hyperswarm', time: operation.created!, operation })),
            })),
        });
        const onPersistedPage = jest.fn<(page: PersistedOperationsPage) => Promise<void>>(async () => {});
        try {
            const result = await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [accepted[0], rejected], onPersistedPage });
            expect(result.retryable).toBe(false);
            expect(onPersistedPage).toHaveBeenCalledTimes(2);
            expect(onPersistedPage.mock.calls[0][0]).toEqual({ acceptedOperations: accepted, portableTerminalOperations: [] });
            expect(onPersistedPage.mock.calls[1][0]).toEqual({ acceptedOperations: [], portableTerminalOperations: [rejected] });
            expect(await store.count()).toBe(301);
        } finally {
            await pipeline.shutdown();
        }
    });

    it('caps returned operation count while still persisting a larger internal batch', async () => {
        const requested = Array.from({ length: 301 }, (_, index) => makeValidOperation(index));
        const store = new InMemoryOperationSyncStore();
        let current: GatekeeperEvent[] = [];
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn<GatekeeperClient['importBatch']>(async events => {
                current = events;
                return { queued: events.length, processed: 0, rejected: 0, total: events.length, rejectedIndices: [] };
            }),
            processEvents: jest.fn(async () => ({ acceptedEvents: current })),
        });
        try {
            const result = await pipeline.enqueue({ kind: 'remote', name: 'internal', data: requested });
            expect(result.retryable).toBe(false);
            expect(result.persistedIds).toHaveLength(301);
            expect(result.acceptedOperations).toHaveLength(300);
            expect(await store.count()).toBe(301);
        } finally {
            await pipeline.shutdown();
        }
    });

    it('publishes structural rejections without requiring a processing page', async () => {
        const rejected = makeValidOperation(1);
        const store = new InMemoryOperationSyncStore();
        const processEvents = jest.fn<GatekeeperClient['processEvents']>();
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn(async () => ({ queued: 0, processed: 0, rejected: 1, total: 0, rejectedIndices: [0] })),
            processEvents,
        });
        const onPersistedPage = jest.fn(async () => { expect(await store.has(rejected.signature!.hash)).toBe(true); });
        try {
            await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [rejected], onPersistedPage }))
                .resolves.toMatchObject({ persistedIds: [rejected.signature!.hash], portableTerminalOperations: [], retryable: false });
            expect(onPersistedPage).toHaveBeenCalledWith({ acceptedOperations: [], portableTerminalOperations: [rejected] });
            expect(processEvents).not.toHaveBeenCalled();
        } finally {
            await pipeline.shutdown();
        }
    });

    it('keeps persisted data and accepts later work after a publication callback fails', async () => {
        const first = makeValidOperation(1);
        const second = makeValidOperation(2);
        const store = new InMemoryOperationSyncStore();
        let current = first;
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn(async () => ({ queued: 1, processed: 0, rejected: 0, total: 1, rejectedIndices: [] })),
            processEvents: jest.fn(async () => ({
                acceptedEvents: [{ registry: 'hyperswarm', time: current.created!, operation: current }],
            })),
        });
        try {
            await expect(pipeline.enqueue({
                kind: 'remote', name: 'peer-a', data: [first],
                onPersistedPage: async () => { throw new Error('publication failed'); },
            })).resolves.toMatchObject({ retryable: true });
            expect(await store.has(first.signature!.hash)).toBe(true);
            current = second;
            const onPersistedPage = jest.fn(async () => {});
            await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [second], onPersistedPage }))
                .resolves.toMatchObject({ persistedIds: [second.signature!.hash], acceptedOperations: [], retryable: false });
            expect(onPersistedPage).toHaveBeenCalledWith({ acceptedOperations: [second], portableTerminalOperations: [] });
            expect(await store.count()).toBe(2);
        } finally {
            await pipeline.shutdown();
        }
    });

    it('lets another node independently accept a portable terminal operation', async () => {
        const candidate = makeValidOperation(1);
        const rejecting = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch: jest.fn(async () => ({
                queued: 0, processed: 0, rejected: 1, total: 1,
                rejectedIndices: [0], capacityDeferredIndices: [], processedIndices: [],
            })),
        });
        const rejected = await rejecting.enqueue({ kind: 'remote', name: 'peer-a', data: [candidate] });
        const accepting = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch: jest.fn(async () => ({
                queued: 1, processed: 0, rejected: 0, total: 1,
                rejectedIndices: [], capacityDeferredIndices: [], processedIndices: [],
            })),
            processEvents: jest.fn(async () => ({
                added: 1, merged: 0, rejected: 0, pending: 0,
                acceptedHashes: [candidate.signature!.hash],
                acceptedEvents: [{ registry: 'hyperswarm', time: candidate.created!, operation: candidate }],
                hasMore: false,
            })),
        });

        expect(rejected.portableTerminalOperations).toEqual([candidate]);
        await expect(accepting.enqueue({
            kind: 'remote',
            name: 'peer-b',
            data: rejected.portableTerminalOperations,
        })).resolves.toMatchObject({
            acceptedOperations: [candidate],
            portableTerminalOperations: [],
        });

        await rejecting.shutdown();
        await accepting.shutdown();
    });

    it('does not remember a normally persisted operation as a terminal root', async () => {
        const { root, child } = await makeTerminalChain();
        const store = new InMemoryOperationSyncStore();
        const upsertMany = store.upsertMany.bind(store);
        let markWriteStarted!: () => void;
        const writeStarted = new Promise<void>(resolve => {
            markWriteStarted = resolve;
        });
        let releaseWrite!: () => void;
        const writeBlocked = new Promise<void>(resolve => {
            releaseWrite = resolve;
        });
        jest.spyOn(store, 'upsertMany').mockImplementationOnce(async records => {
            markWriteStarted();
            await writeBlocked;
            return upsertMany(records);
        });
        const pipeline = createPipeline(jest.fn(async () => true), store);
        const normal = pipeline.enqueue({
            kind: 'local_queue',
            phase: 'persist',
            name: 'local',
            data: [root],
        });
        await writeStarted;
        const terminal = pipeline.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [root],
        });

        releaseWrite();
        await expect(normal).resolves.toMatchObject({ persistedIds: [root.signature!.hash] });
        await expect(terminal).resolves.toMatchObject({
            knownIds: [root.signature!.hash],
            persistedIds: [],
        });
        await expect(pipeline.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [child],
        })).resolves.toMatchObject({ persistedIds: [] });
        expect((await store.getByIds([root.signature!.hash]))[0].syncOrder)
            .not.toBe(Number.MAX_SAFE_INTEGER);
        await expect(store.has(child.signature!.hash)).resolves.toBe(false);
        await pipeline.shutdown();
    });

    it('forgets terminal operation CIDs when the pipeline is rebuilt', async () => {
        const { root, child } = await makeTerminalChain();
        const store = new InMemoryOperationSyncStore();
        const first = createPipeline(jest.fn(async () => true), store);

        await expect(first.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [root],
        })).resolves.toMatchObject({
            persistedIds: [root.signature!.hash],
            portableTerminalOperations: [root],
        });
        await expect(first.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [child],
        })).resolves.toMatchObject({
            persistedIds: [child.signature!.hash],
            portableTerminalOperations: [child],
        });
        await first.shutdown();
        await expect(store.deleteBySyncOrder(Number.MAX_SAFE_INTEGER)).resolves.toBe(2);

        const rebuilt = createPipeline(jest.fn(async () => true), store);
        await expect(rebuilt.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [child],
        })).resolves.toMatchObject({ persistedIds: [] });
        await expect(store.has(child.signature!.hash)).resolves.toBe(false);
        await rebuilt.shutdown();
    });

    it('persists each processing page before requesting the next page', async () => {
        const operations = [makeValidOperation(1), makeValidOperation(2)];
        const store = new InMemoryOperationSyncStore();
        const order: string[] = [];
        const upsertMany = store.upsertMany.bind(store);
        jest.spyOn(store, 'upsertMany').mockImplementation(async records => {
            order.push(`persist-${records[0].id}`);
            return upsertMany(records);
        });
        const processEvents = jest.fn<GatekeeperClient['processEvents']>()
            .mockImplementationOnce(async () => {
                order.push('process-1');
                return {
                    added: 1, merged: 0, rejected: 0, pending: 1,
                    acceptedHashes: [operations[0].signature!.hash],
                    acceptedEvents: [{ registry: 'hyperswarm', time: operations[0].created!, operation: operations[0] }],
                    hasMore: true,
                };
            })
            .mockImplementationOnce(async () => {
                order.push('process-2');
                return {
                    added: 1, merged: 0, rejected: 0, pending: 0,
                    acceptedHashes: [operations[1].signature!.hash],
                    acceptedEvents: [{ registry: 'hyperswarm', time: operations[1].created!, operation: operations[1] }],
                    hasMore: false,
                };
            });
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn<GatekeeperClient['importBatch']>(async events => ({
                queued: events.length, processed: 0, rejected: 0, total: events.length,
                rejectedIndices: [], capacityDeferred: 0, capacityDeferredIndices: [], processedIndices: [],
            })),
            processEvents,
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: operations }))
            .resolves.toMatchObject({
                persistedIds: operations.map(op => op.signature!.hash),
                pendingIds: [],
                capacityDeferredIds: [],
                retryable: false,
            });
        expect(order).toEqual([
            'process-1',
            `persist-${operations[0].signature!.hash}`,
            'process-2',
            `persist-${operations[1].signature!.hash}`,
        ]);
        await pipeline.shutdown();
    });

    it('does not abort a request for unrelated processing-page capacity', async () => {
        const requested = Array.from({ length: 101 }, (_, index) => makeValidOperation(index + 1));
        const unrelated = makeValidOperation(102);
        const importBatch = jest.fn<GatekeeperClient['importBatch']>(async events => ({
            queued: events.length,
            processed: 0,
            rejected: 0,
            total: events.length,
            rejectedIndices: [],
            capacityDeferred: 0,
            capacityDeferredIndices: [],
            processedIndices: [],
        }));
        const processEvents = jest.fn<GatekeeperClient['processEvents']>()
            .mockResolvedValueOnce({
                added: 100,
                merged: 0,
                rejected: 0,
                pending: 0,
                acceptedHashes: requested.slice(0, 100).map(item => item.signature!.hash),
                acceptedEvents: requested.slice(0, 100).map(item => ({
                    registry: 'hyperswarm',
                    time: item.created!,
                    operation: item,
                })),
                capacityDeferred: 1,
                capacityDeferredHashes: [unrelated.signature!.hash],
                hasMore: false,
            })
            .mockResolvedValueOnce({
                added: 1,
                merged: 0,
                rejected: 0,
                pending: 0,
                acceptedHashes: [requested[100].signature!.hash],
                acceptedEvents: [{
                    registry: 'hyperswarm',
                    time: requested[100].created!,
                    operation: requested[100],
                }],
                hasMore: false,
            });
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents,
        });

        const result = await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: requested });

        expect(result).toMatchObject({
            persistedIds: requested.map(item => item.signature!.hash),
            pendingIds: [],
            capacityDeferredIds: [],
            retryable: false,
        });
        expect(importBatch).toHaveBeenCalledTimes(2);
        expect(processEvents).toHaveBeenCalledTimes(2);
        await pipeline.shutdown();
    });

    it('reports processing-page backpressure for the requested operation', async () => {
        const deferred = makeValidOperation(1);
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch: jest.fn<GatekeeperClient['importBatch']>(async () => ({
                queued: 1, processed: 0, rejected: 0, total: 1,
                rejectedIndices: [], capacityDeferred: 0,
                capacityDeferredIndices: [], processedIndices: [],
            })),
            processEvents: jest.fn<GatekeeperClient['processEvents']>(async () => ({
                added: 0, merged: 0, rejected: 0, pending: 0,
                capacityDeferred: 1,
                capacityDeferredHashes: [deferred.signature!.hash.toUpperCase()],
                hasMore: false,
            })),
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] }))
            .resolves.toMatchObject({
                persistedIds: [],
                pendingIds: [],
                capacityDeferredIds: [deferred.signature!.hash],
                retryable: false,
            });
        await pipeline.shutdown();
    });

    it('reports an unverified tail when backpressure stops a multi-chunk import', async () => {
        const operations = Array.from({ length: 101 }, (_, index) => makeValidOperation(index));
        operations[100].signature!.hash = 'f'.repeat(64);
        const importBatch = jest.fn<GatekeeperClient['importBatch']>(async events => ({
            queued: 0, processed: 0, rejected: 0, total: 0,
            rejectedIndices: [], capacityDeferred: events.length,
            capacityDeferredIndices: events.map((_event, index) => index), processedIndices: [],
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents: jest.fn<GatekeeperClient['processEvents']>(async () => ({ hasMore: false })),
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: operations }))
            .resolves.toMatchObject({
                capacityDeferredIds: operations.slice(0, 100).map(item => item.signature!.hash),
                unaddressableOperations: [operations[100]],
                retryable: false,
            });
        expect(importBatch).toHaveBeenCalledTimes(1);
        await pipeline.shutdown();
    });

    it('delays a capacity-deferred operation without refreshing its deadline on retransmission', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
        const deferred = makeValidOperation(1);
        const syncStats = createMediatorSyncStats();
        const importBatch = jest.fn(async () => ({
            queued: 0, processed: 0, rejected: 0, total: 0,
            rejectedIndices: [], capacityDeferred: 1, capacityDeferredIndices: [0], processedIndices: [],
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents: jest.fn<GatekeeperClient['processEvents']>(async () => ({ hasMore: false })),
        }, { syncStats });

        const first = await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });
        expect(first).toMatchObject({
            capacityDeferredIds: [deferred.signature!.hash],
            retryable: false,
        });
        expect(pipeline.getMetrics()).toEqual({ activeRetryDelayedIds: 1, persistenceRetries: 0 });
        expect(syncStats.hardening.gatekeeperCapacityOutcomes).toBe(1);
        expect(pipeline.filterRetryDelayedIds([
            deferred.signature!.hash,
            'a'.repeat(64),
        ])).toEqual({
            eligibleIds: ['a'.repeat(64)],
            pendingIds: [],
            capacityDeferredIds: [deferred.signature!.hash],
        });
        await jest.advanceTimersByTimeAsync(299_000);
        const repeated = await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });
        expect(repeated.capacityDeferredIds).toEqual([deferred.signature!.hash]);
        expect(importBatch).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1_000);
        expect(pipeline.getMetrics().activeRetryDelayedIds).toBe(0);
        expect(pipeline.filterRetryDelayedIds([deferred.signature!.hash])).toEqual({
            eligibleIds: [deferred.signature!.hash],
            pendingIds: [],
            capacityDeferredIds: [],
        });
        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });
        expect(importBatch).toHaveBeenCalledTimes(2);
        await pipeline.shutdown();
        jest.useRealTimers();
    });

    it('does not put an unverified capacity result into retry suppression', async () => {
        const invalid = makeValidOperation(1);
        invalid.signature!.hash = 'f'.repeat(64);
        const importBatch = jest.fn(async () => ({
            queued: 0, processed: 0, rejected: 0, total: 0,
            rejectedIndices: [], capacityDeferred: 1, capacityDeferredIndices: [0], processedIndices: [],
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents: jest.fn<GatekeeperClient['processEvents']>(async () => ({ hasMore: false })),
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [invalid] }))
            .resolves.toMatchObject({
                capacityDeferredIds: [],
                unaddressableOperations: [invalid],
                retryable: false,
            });
        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [invalid] });
        expect(importBatch).not.toHaveBeenCalled();
        await pipeline.shutdown();
    });

    it('does not let an unaddressable operation suppress genuine content with the claimed ID', async () => {
        const genuine = makeValidOperation(1);
        const forged = {
            ...genuine,
            mdip: { ...genuine.mdip, registry: 'local' },
        } as Operation;
        const importBatch = jest.fn<GatekeeperClient['importBatch']>(async () => ({
            queued: 1, processed: 0, rejected: 0, total: 1,
            rejectedIndices: [], capacityDeferredIndices: [], processedIndices: [],
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents: jest.fn(async () => ({
                added: 1, merged: 0, rejected: 0, pending: 0,
                acceptedHashes: [genuine.signature!.hash],
                acceptedEvents: [{ registry: 'hyperswarm', time: genuine.created!, operation: genuine }],
                hasMore: false,
            })),
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [forged] }))
            .resolves.toMatchObject({
                knownIds: [],
                persistedIds: [],
                unaddressableOperations: [forged],
            });
        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [genuine] }))
            .resolves.toMatchObject({
                persistedIds: [genuine.signature!.hash],
                acceptedOperations: [genuine],
            });
        expect(importBatch).toHaveBeenCalledTimes(1);
        await pipeline.shutdown();
    });

    it('delays resubmission when an already-pending operation remains unresolved after a drain', async () => {
        const pending = makeValidOperation(1);
        const importBatch = jest.fn(async () => ({
            queued: 0, processed: 1, rejected: 0, total: 1,
            rejectedIndices: [], capacityDeferred: 0, capacityDeferredIndices: [], processedIndices: [0],
        }));
        const processEvents = jest.fn<GatekeeperClient['processEvents']>(async () => ({ hasMore: false, pending: 1 }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents,
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [pending] }))
            .resolves.toMatchObject({
                persistedIds: [],
                pendingIds: [pending.signature!.hash],
                capacityDeferredIds: [],
                retryable: false,
            });
        expect(pipeline.filterRetryDelayedIds([pending.signature!.hash])).toEqual({
            eligibleIds: [],
            pendingIds: [pending.signature!.hash],
            capacityDeferredIds: [],
        });
        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [pending] });

        expect(importBatch).toHaveBeenCalledTimes(1);
        expect(processEvents).toHaveBeenCalledTimes(1);
        await pipeline.shutdown();
    });

    it('reports a delayed operation accepted while processing its dependency', async () => {
        const pending = makeValidOperation(1);
        const dependency = makeValidOperation(2);
        const importBatch = jest.fn<GatekeeperClient['importBatch']>()
            .mockResolvedValueOnce({
                queued: 0, processed: 1, rejected: 0, total: 1,
                rejectedIndices: [], capacityDeferred: 0,
                capacityDeferredIndices: [], processedIndices: [0],
            })
            .mockResolvedValueOnce({
                queued: 1, processed: 0, rejected: 0, total: 2,
                rejectedIndices: [], capacityDeferred: 0,
                capacityDeferredIndices: [], processedIndices: [],
            });
        const processEvents = jest.fn<GatekeeperClient['processEvents']>()
            .mockResolvedValueOnce({ hasMore: false, pending: 1 })
            .mockImplementation(async () => ({
                added: 2,
                merged: 0,
                rejected: 0,
                pending: 0,
                acceptedHashes: [pending.signature!.hash, dependency.signature!.hash],
                acceptedEvents: [pending, dependency].map(item => ({
                    registry: 'hyperswarm',
                    time: item.created!,
                    operation: item,
                })),
                hasMore: false,
            }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents,
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [pending] }))
            .resolves.toMatchObject({ pendingIds: [pending.signature!.hash] });
        await expect(pipeline.enqueue({
            kind: 'remote',
            name: 'peer-a',
            data: [pending, dependency],
        })).resolves.toMatchObject({
            persistedIds: expect.arrayContaining([
                pending.signature!.hash,
                dependency.signature!.hash,
            ]),
            acceptedOperations: expect.arrayContaining([pending, dependency]),
            pendingIds: [],
            capacityDeferredIds: [],
            retryable: false,
        });
        expect(importBatch.mock.calls[1][0]).toHaveLength(1);
        expect(importBatch.mock.calls[1][0][0].operation).toBe(dependency);
        await pipeline.shutdown();
    });

    it('processes admitted work after an import response is lost', async () => {
        const admitted = makeValidOperation(1);
        const importBatch = jest.fn<GatekeeperClient['importBatch']>()
            .mockRejectedValueOnce(new Error('import response lost'))
            .mockResolvedValueOnce({
                queued: 0, processed: 1, rejected: 0, total: 1,
                rejectedIndices: [], capacityDeferred: 0,
                capacityDeferredIndices: [], processedIndices: [0],
            });
        const processEvents = jest.fn<GatekeeperClient['processEvents']>(async () => ({
            added: 1,
            merged: 0,
            rejected: 0,
            pending: 0,
            acceptedHashes: [admitted.signature!.hash],
            acceptedEvents: [{
                registry: 'hyperswarm',
                time: admitted.created!,
                operation: admitted,
            }],
            hasMore: false,
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents,
        });

        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [admitted] }))
            .resolves.toMatchObject({ retryable: true });
        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [admitted] }))
            .resolves.toMatchObject({
                persistedIds: [admitted.signature!.hash],
                pendingIds: [],
                retryable: false,
            });

        expect(processEvents).toHaveBeenCalledTimes(1);
        await pipeline.shutdown();
    });

    it('bounds retry delays with FIFO eviction', async () => {
        const syncStats = createMediatorSyncStats();
        const operations = Array.from({ length: 25_001 }, (_, index) => makeValidOperation(index));
        const importBatch = jest.fn(async (events: GatekeeperEvent[]) => ({
            queued: 0, processed: 0, rejected: 0, total: 0,
            rejectedIndices: [], capacityDeferred: events.length,
            capacityDeferredIndices: events.map((_event, index) => index), processedIndices: [],
        }));
        const pipeline = createPipeline(jest.fn(async () => true), new InMemoryOperationSyncStore(), {
            importBatch,
            processEvents: jest.fn<GatekeeperClient['processEvents']>(async () => ({ hasMore: false })),
        }, { syncStats });

        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: operations });
        expect(pipeline.getMetrics().activeRetryDelayedIds).toBe(25_000);
        expect(syncStats.hardening.retryDelayEvictions).toBe(1);
        await pipeline.enqueue({
            kind: 'remote',
            name: 'peer-a',
            data: [operations[0], operations.at(-1)!],
        });

        expect(importBatch).toHaveBeenCalledTimes(2);
        expect(importBatch.mock.calls[1][0]).toHaveLength(1);
        expect(importBatch.mock.calls[1][0][0].operation.signature!.hash)
            .toBe(operations[0].signature!.hash);
        await pipeline.shutdown();
    });

    it('clears a retry delay when the operation is found in the sync store', async () => {
        const deferred = makeValidOperation(1);
        const store = new InMemoryOperationSyncStore();
        const importBatch = jest.fn(async () => ({
            queued: 0, processed: 0, rejected: 0, total: 0,
            rejectedIndices: [], capacityDeferred: 1, capacityDeferredIndices: [0], processedIndices: [],
        }));
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch,
            processEvents: jest.fn<GatekeeperClient['processEvents']>(async () => ({ hasMore: false })),
        });

        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });
        await store.upsertMany(mapAcceptedOperationsToSyncRecords([deferred]).records);
        await expect(pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] }))
            .resolves.toMatchObject({ knownIds: [deferred.signature!.hash] });
        await store.reset();
        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });

        expect(importBatch).toHaveBeenCalledTimes(2);
        await pipeline.shutdown();
    });

    it('keeps retry delays when pruning them during an index refresh fails', async () => {
        const deferred = makeValidOperation(1);
        const store = new InMemoryOperationSyncStore();
        const pipeline = createPipeline(jest.fn(async () => true), store, {
            importBatch: jest.fn(async () => ({
                queued: 0, processed: 0, rejected: 0, total: 0,
                rejectedIndices: [], capacityDeferred: 1,
                capacityDeferredIndices: [0], processedIndices: [],
            })),
            processEvents: jest.fn<GatekeeperClient['processEvents']>(async () => ({ hasMore: false })),
            exportIndex: jest.fn(async () => ({
                mode: 'snapshot' as const,
                dids: [],
                blocks: [],
                cursor: '0',
                checkpointCursor: '0',
                hasMore: false,
                indexEpoch: 'epoch-a',
            })),
        });

        await pipeline.enqueue({ kind: 'remote', name: 'peer-a', data: [deferred] });
        const getByIds = jest.spyOn(store, 'getByIds').mockRejectedValueOnce(new Error('lookup failed'));

        await expect(pipeline.refreshIndex('test')).resolves.toMatchObject({ snapshotComplete: true });
        expect(getByIds).toHaveBeenCalledWith([deferred.signature!.hash]);
        await pipeline.shutdown();
    });
});
