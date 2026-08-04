import { jest } from '@jest/globals';

import CipherNode from '@mdip/cipher/node';
import type { Operation } from '@mdip/gatekeeper/types';
import { generateCID } from '@mdip/ipfs/utils';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import {
    createImportPipeline,
    type ImportPipelineOptions,
} from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';

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
        onStoreChanged: jest.fn(),
    });
}

async function makeTerminalChain(): Promise<{ root: Operation; child: Operation }> {
    const cipher = new CipherNode();
    const rootUnsigned = {
        type: 'update' as const,
        did: 'did:test:legacy',
        doc: { root: true },
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
        doc: { child: true },
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
            doc: { legacy: true },
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
        })).resolves.toMatchObject({ persistedIds: [root.signature!.hash] });
        await expect(first.enqueue({
            kind: 'terminal',
            name: 'peer-a',
            data: [child],
        })).resolves.toMatchObject({ persistedIds: [child.signature!.hash] });
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
});
