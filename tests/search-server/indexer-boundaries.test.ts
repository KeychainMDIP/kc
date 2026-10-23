import { jest } from '@jest/globals';
import { setLogger } from '../../packages/common/src/logger.ts';
import DidIndexer, { INDEX_SYNC_STATE_KEYS, type GatekeeperIndexClient } from '../../services/search-server/src/DidIndexer.ts';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import type { BlockInfo, IndexExportResponse } from '@mdip/gatekeeper/types';
import type { GatekeeperEvent } from '../../services/search-server/src/types.ts';

const snapshotDid = 'did:test:z3v8AuabRMo7rU27NZxRvJL9nCzJdXCsBcuGwrr1mbYHobp4jGz';
const changesDid = 'did:test:z3v8AuahDNjhQ81fEAGPPkiz7JbkwBsM4UmN9bnL99wjVvC5dGp';
const snapshotCursor = 'opaque-snapshot-page-token';

function createLogger() {
    const logger = {
        child: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    logger.child.mockReturnValue(logger);
    return logger;
}

let logger: ReturnType<typeof createLogger>;

function createEvent(did: string, data: unknown, time: string): GatekeeperEvent {
    return {
        registry: 'local',
        time,
        ordinal: [0],
        did,
        operation: {
            type: 'create',
            created: time,
            mdip: {
                version: 1,
                type: 'asset',
                registry: 'local',
            },
            controller: did,
            data,
        },
    };
}

function createSnapshotResponse(): IndexExportResponse {
    return {
        mode: 'snapshot',
        indexEpoch: 'epoch-test',
        cursor: snapshotCursor,
        checkpointCursor: '4',
        hasMore: false,
        blocks: [],
        dids: [{
            did: snapshotDid,
            events: [
                createEvent(snapshotDid, { name: 'snapshot' }, '2026-04-01T10:00:00.000Z'),
            ],
        }],
    };
}

function createChangesResponse(): IndexExportResponse {
    return {
        mode: 'changes',
        indexEpoch: 'epoch-test',
        cursor: '7',
        checkpointCursor: '7',
        hasMore: false,
        blocks: [],
        dids: [{
            did: changesDid,
            events: [
                createEvent(changesDid, { name: 'changes' }, '2026-04-01T11:00:00.000Z'),
            ],
        }],
    };
}

beforeEach(() => {
    logger = createLogger();
    setLogger(logger as any);
});

describe('DidIndexer gatekeeper read boundary', () => {
    it('uses the applied changes cursor for freshness when an empty final page omits a new cursor', async () => {
        const db = new DIDsDbMemory();
        await db.saveSyncState(INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await db.saveSyncState(INDEX_SYNC_STATE_KEYS.epoch, 'epoch-test');
        await db.saveSyncState(INDEX_SYNC_STATE_KEYS.changesCursor, '7');
        const gatekeeper = {
            isReady: jest.fn(async () => true),
            exportIndex: jest.fn(async () => ({ ...createChangesResponse(), cursor: null, dids: [] })),
        };
        const indexer = new DidIndexer(gatekeeper, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();

        expect(await db.getStats()).toMatchObject({
            sync: { changesCursor: '7' },
            index: { changesCursor: '7', caughtUpCursor: '7', state: 'caught_up' },
        });
    });

    it.each([
        { dids: null },
        { dids: [null] },
        { blocks: [{ registry: 'local', block: null }] },
        { blocks: [{ registry: 'local', block: [] }] },
    ])('does not erase the current projection on a malformed replacement-epoch response: %j', async invalid => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValueOnce(createSnapshotResponse())
                .mockResolvedValueOnce({ ...createChangesResponse(), indexEpoch: 'replacement', ...invalid } as any),
        };
        const indexer = new DidIndexer(gatekeeper, db, { intervalMs: 60_000 });
        await (indexer as any).refreshIndex();
        const wipe = jest.spyOn(db, 'wipeDb');
        await (indexer as any).refreshIndex();
        expect(wipe).not.toHaveBeenCalled();
        expect(await db.getStats()).toMatchObject({
            dids: { total: 1 }, index: { epoch: 'epoch-test', lastError: 'Error: Invalid index export response' },
        });
    });

    it('rebuilds warm rows with an unknown source epoch instead of stamping them with a new one', async () => {
        const db = new DIDsDbMemory();
        const oldDid = 'did:test:old-without-epoch';
        await db.applyIndexPage({
            dids: [{ did: oldDid, events: [createEvent(oldDid, {}, '2026-04-01T10:00:00.000Z')], doc: {} }],
            blocks: [],
            syncStateUpdates: { [INDEX_SYNC_STATE_KEYS.snapshotComplete]: 'true' },
        });
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValueOnce(createChangesResponse()).mockResolvedValueOnce(createSnapshotResponse()),
        };
        const indexer = new DidIndexer(gatekeeper, db, { intervalMs: 60_000 });
        const wipe = jest.spyOn(db, 'wipeDb');
        await (indexer as any).refreshIndex();
        expect(wipe).toHaveBeenCalledTimes(1);
        expect(await db.getDID(oldDid)).toBeNull();
        expect(await db.getStats()).toMatchObject({
            dids: { total: 1 }, index: { epoch: 'epoch-test', state: 'catching_up' },
        });
    });

    it('distinguishes completed snapshots from caught-up changes and rebuilds after a source reset', async () => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValueOnce(createSnapshotResponse())
                .mockResolvedValueOnce(createChangesResponse())
                .mockResolvedValueOnce({ ...createChangesResponse(), indexEpoch: 'replacement' })
                .mockResolvedValueOnce({
                    ...createSnapshotResponse(), indexEpoch: 'replacement',
                    dids: [{ did: changesDid, events: [createEvent(changesDid, {}, '2026-04-01T12:00:00.000Z')] }],
                }),
        };
        const indexer = new DidIndexer(gatekeeper, db, { intervalMs: 60_000 });
        await (indexer as any).refreshIndex();
        expect(await db.getStats()).toMatchObject({ index: { snapshotComplete: true, state: 'catching_up' } });
        await (indexer as any).refreshIndex();
        expect(await db.getStats()).toMatchObject({ index: { epoch: 'epoch-test', state: 'caught_up', changesCursor: '7' } });
        const wipe = jest.spyOn(db, 'wipeDb');
        await (indexer as any).refreshIndex();
        expect(wipe).toHaveBeenCalledTimes(1);
        expect(await db.getDID(snapshotDid)).toBeNull();
        expect(await db.getStats()).toMatchObject({ dids: { total: 1 }, index: { epoch: 'replacement', state: 'catching_up' } });
    });

    it('does not advance counts or the watermark after an index page fails', async () => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValueOnce(createSnapshotResponse()).mockResolvedValueOnce(createChangesResponse()),
        };
        const indexer = new DidIndexer(gatekeeper, db, { intervalMs: 60_000 });
        await (indexer as any).refreshIndex();
        jest.spyOn(db, 'applyIndexPage').mockRejectedValueOnce(new Error('page failed'));
        await (indexer as any).refreshIndex();
        expect(await db.getStats()).toMatchObject({
            dids: { total: 1 }, index: { changesCursor: '4', caughtUpAt: null, lastError: 'Error: page failed' },
        });
    });
    it('moves an ambiguous projection when a later signed update establishes its prefix', async () => {
        const db = new DIDsDbMemory();
        const create = createEvent(snapshotDid, { name: 'ambiguous' }, '2026-04-01T10:00:00.000Z');
        const mdipDid = snapshotDid.replace('did:test:', 'did:mdip:');
        const update: GatekeeperEvent = {
            did: mdipDid,
            registry: 'local',
            time: '2026-04-01T11:00:00.000Z',
            operation: {
                type: 'update',
                did: mdipDid,
                doc: {
                    didDocument: { id: mdipDid },
                    didDocumentData: { name: 'classified' },
                    mdip: { version: 1, type: 'asset', registry: 'local' },
                },
            },
        };
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValueOnce({
                    ...createSnapshotResponse(),
                    dids: [{ did: snapshotDid, events: [create] }],
                })
                .mockResolvedValueOnce({
                    ...createChangesResponse(),
                    dids: [{ did: snapshotDid, events: [create, update] }],
                }),
        };
        const indexer = new DidIndexer(gatekeeper, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();
        expect(await db.findDIDBySuffix(snapshotDid.split(':').pop()!)).toBe(snapshotDid);

        await (indexer as any).refreshIndex();
        expect(await db.getDIDEvents(snapshotDid)).toStrictEqual([]);
        expect(await db.getDIDEvents(mdipDid)).toHaveLength(2);
        expect((await db.getDIDEvents(mdipDid))[1].operation).toMatchObject({
            type: 'update',
            did: mdipDid,
        });
        expect(await db.findDIDBySuffix(snapshotDid.split(':').pop()!)).toBe(mdipDid);
    });

    it('uses exportIndex only and never calls getDIDs or resolveDID during snapshot or changes sync', async () => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValueOnce(createSnapshotResponse())
                .mockResolvedValueOnce(createChangesResponse()),
            getDIDs: jest.fn(async () => {
                throw new Error('getDIDs must not be called by search-server indexing');
            }),
            resolveDID: jest.fn(async () => {
                throw new Error('resolveDID must not be called by search-server indexing');
            }),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();
        await (indexer as any).refreshIndex();

        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(1, {
            mode: 'snapshot',
            cursor: null,
            limit: 500,
        });
        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(2, {
            mode: 'changes',
            cursor: '4',
            limit: 500,
        });
        expect(gatekeeper.getDIDs).not.toHaveBeenCalled();
        expect(gatekeeper.resolveDID).not.toHaveBeenCalled();
        expect(await db.loadSyncState('index.snapshot.complete')).toBe('true');
        expect(await db.loadSyncState('index.snapshot.checkpointCursor')).toBe('4');
        expect(await db.loadSyncState('index.changes.cursor')).toBe('7');
    });

    it('removes records through their stored alias or exported DID', async () => {
        const db = new DIDsDbMemory();
        const storedDid = 'did:test:removed-existing';
        const exportedAlias = 'did:mdip:removed-existing';
        const missingDid = 'did:test:removed-missing';
        await db.applyIndexPage({
            dids: [{
                did: storedDid,
                events: [createEvent(storedDid, {}, '2026-04-01T10:00:00.000Z')],
            }],
            blocks: [],
        });
        const applyIndexPage = jest.spyOn(db, 'applyIndexPage');
        const indexer = new DidIndexer({
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>(),
        }, db, { intervalMs: 60_000 });

        await (indexer as any).applyExportPage({
            ...createChangesResponse(),
            dids: [
                { did: exportedAlias, events: [], removed: true },
                { did: missingDid, events: [], removed: true },
            ],
        }, {});

        expect(applyIndexPage).toHaveBeenLastCalledWith(expect.objectContaining({
            dids: [
                expect.objectContaining({ did: storedDid, removed: true }),
                expect.objectContaining({ did: missingDid, removed: true }),
            ],
        }));
    });

    it('does not start a refresh when gatekeeper is not ready or another refresh is active', async () => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(false),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>(),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();
        expect(gatekeeper.exportIndex).not.toHaveBeenCalled();

        gatekeeper.isReady.mockResolvedValue(true);
        (indexer as any).refreshInProgress = true;

        await (indexer as any).refreshIndex();

        expect(gatekeeper.exportIndex).not.toHaveBeenCalled();
    });

    it('does not install an interval after being stopped during the initial refresh', async () => {
        const db = new DIDsDbMemory();
        let resolveReady!: (ready: boolean) => void;
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>()
                .mockReturnValue(new Promise<boolean>(resolve => { resolveReady = resolve; })),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>(),
        };
        const setIntervalSpy = jest.spyOn(global, 'setInterval');
        try {
            const indexer = new DidIndexer(gatekeeper, db, { intervalMs: 60_000 });

            const starting = indexer.startIndexing();
            await Promise.resolve();

            let stopped = false;
            const stopping = indexer.stopIndexing().then(() => { stopped = true; });
            expect(stopped).toBe(false);

            resolveReady(false);
            await Promise.all([starting, stopping]);

            expect(stopped).toBe(true);
            expect(setIntervalSpy).not.toHaveBeenCalled();
            expect(gatekeeper.exportIndex).not.toHaveBeenCalled();

            await indexer.startIndexing();
            expect(gatekeeper.isReady).toHaveBeenCalledTimes(1);
        }
        finally {
            setIntervalSpy.mockRestore();
        }
    });

    it('treats a canceled readiness check as expected during shutdown', async () => {
        const db = new DIDsDbMemory();
        let rejectReady!: (error: Error) => void;
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>()
                .mockReturnValue(new Promise<boolean>((_resolve, reject) => { rejectReady = reject; })),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>(),
        };
        const indexer = new DidIndexer(gatekeeper, db, { intervalMs: 60_000 });
        const starting = indexer.startIndexing();
        await Promise.resolve();

        indexer.beginStopping();
        rejectReady(Object.assign(new Error('canceled'), { name: 'CanceledError', code: 'ERR_CANCELED' }));

        await expect(Promise.all([starting, indexer.stopIndexing()])).resolves.toBeDefined();
        expect(logger.error).not.toHaveBeenCalled();
        expect(await db.loadSyncState('index.lastSyncError')).toBeNull();
        expect(gatekeeper.exportIndex).not.toHaveBeenCalled();
    });

    it('treats a canceled index export as expected during shutdown', async () => {
        const db = new DIDsDbMemory();
        let rejectExport!: (error: unknown) => void;
        let markExportStarted!: () => void;
        const exportStarted = new Promise<void>(resolve => { markExportStarted = resolve; });
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>().mockImplementation(() => {
                markExportStarted();
                return new Promise<IndexExportResponse>((_resolve, reject) => { rejectExport = reject; });
            }),
        };
        const indexer = new DidIndexer(gatekeeper, db, { intervalMs: 60_000 });
        const starting = indexer.startIndexing();
        await exportStarted;

        indexer.beginStopping();
        // GatekeeperClient normalizes non-readiness request failures to their message.
        rejectExport('canceled');

        await expect(Promise.all([starting, indexer.stopIndexing()])).resolves.toBeDefined();
        expect(logger.error).not.toHaveBeenCalled();
        expect(await db.loadSyncState('index.lastSyncError')).toBeNull();
    });

    it('retains non-cancellation index errors during shutdown', async () => {
        const db = new DIDsDbMemory();
        let rejectExport!: (error: unknown) => void;
        let markExportStarted!: () => void;
        const exportStarted = new Promise<void>(resolve => { markExportStarted = resolve; });
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>().mockImplementation(() => {
                markExportStarted();
                return new Promise<IndexExportResponse>((_resolve, reject) => { rejectExport = reject; });
            }),
        };
        const indexer = new DidIndexer(gatekeeper, db, { intervalMs: 60_000 });
        const starting = indexer.startIndexing();
        await exportStarted;

        indexer.beginStopping();
        rejectExport('connection reset');

        await expect(Promise.all([starting, indexer.stopIndexing()])).resolves.toBeDefined();
        expect(logger.error).toHaveBeenCalledWith(
            { error: 'connection reset' },
            'Error in refreshIndex'
        );
        expect(await db.loadSyncState('index.lastSyncError')).toBe('connection reset');
    });

    it('rejects invalid snapshot continuation state and malformed snapshot responses', async () => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>(),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await db.saveSyncState('index.snapshot.cursor', 'page-1');
        await db.saveSyncState('index.epoch', 'epoch-test');
        await expect((indexer as any).syncSnapshot())
            .rejects.toThrow('Snapshot cursor found without checkpointCursor');

        await db.saveSyncState('index.snapshot.cursor', null);
        await db.saveSyncState('index.snapshot.checkpointCursor', '4');
        await expect((indexer as any).syncSnapshot())
            .rejects.toThrow('Snapshot checkpointCursor found without cursor');

        await db.saveSyncState('index.snapshot.checkpointCursor', null);
        gatekeeper.exportIndex.mockResolvedValueOnce(createChangesResponse());
        await expect((indexer as any).syncSnapshot())
            .rejects.toThrow('Expected snapshot export response, got changes');

        gatekeeper.exportIndex.mockResolvedValueOnce({
            ...createSnapshotResponse(),
            // @ts-expect-error Testing an invalid response.
            checkpointCursor: undefined,
        });
        await expect((indexer as any).syncSnapshot())
            .rejects.toThrow('Snapshot export response missing checkpointCursor');
    });

    it('rejects snapshot pages that change checkpoint or do not advance cursor', async () => {
        const db = new DIDsDbMemory();
        await db.saveSyncState('index.epoch', 'epoch-test');
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>(),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await db.saveSyncState('index.snapshot.cursor', 'page-1');
        await db.saveSyncState('index.snapshot.checkpointCursor', '4');
        gatekeeper.exportIndex.mockResolvedValueOnce({
            ...createSnapshotResponse(),
            checkpointCursor: '5',
        });
        await expect((indexer as any).syncSnapshot())
            .rejects.toThrow('Snapshot export checkpoint changed from 4 to 5');

        gatekeeper.exportIndex.mockResolvedValueOnce({
            ...createSnapshotResponse(),
            cursor: 'page-1',
            checkpointCursor: '4',
            hasMore: true,
            dids: [],
        });
        await expect((indexer as any).syncSnapshot())
            .rejects.toThrow('Snapshot export did not advance cursor');
    });

    it('rejects malformed changes responses and non-advancing changes pages', async () => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>(),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        gatekeeper.exportIndex.mockResolvedValueOnce(createSnapshotResponse());
        await expect((indexer as any).syncChanges())
            .rejects.toThrow('Expected changes export response, got snapshot');

        await db.saveSyncState('index.changes.cursor', '7');
        await db.saveSyncState('index.epoch', 'epoch-test');
        gatekeeper.exportIndex.mockResolvedValueOnce({
            ...createChangesResponse(),
            cursor: '7',
            hasMore: true,
            dids: [],
        });
        await expect((indexer as any).syncChanges())
            .rejects.toThrow('Changes export did not advance cursor');
    });

    it('continues through multiple changes pages while advancing the cursor', async () => {
        const db = new DIDsDbMemory();
        await db.saveSyncState('index.epoch', 'epoch-test');
        await db.saveSyncState('index.snapshot.complete', 'true');
        await db.saveSyncState('index.changes.cursor', '7');
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValueOnce({
                    ...createChangesResponse(),
                    cursor: '8',
                    hasMore: true,
                    dids: [],
                })
                .mockResolvedValueOnce({
                    ...createChangesResponse(),
                    cursor: '9',
                    hasMore: false,
                    dids: [],
                }),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();

        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(1, {
            mode: 'changes',
            cursor: '7',
            limit: 500,
        });
        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(2, {
            mode: 'changes',
            cursor: '8',
            limit: 500,
        });
        expect(await db.loadSyncState('index.changes.cursor')).toBe('9');
    });

    it('does not request operation payloads and ignores them when present in changes responses', async () => {
        const db = new DIDsDbMemory();
        const applyIndexPage = jest.spyOn(db, 'applyIndexPage');
        await db.saveSyncState('index.snapshot.complete', 'true');
        await db.saveSyncState('index.epoch', 'epoch-test');

        const operationsOnlyDid = 'did:test:z3v8AuapxSfMXs4gozSR8pPJWYWSqmhaYmX2MLFQQiQBy1aCNU9';
        const operationsOnlyEvent = createEvent(
            operationsOnlyDid,
            { name: 'ignored-operation-payload' },
            '2026-04-01T12:00:00.000Z'
        );
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValueOnce(createChangesResponse())
                .mockResolvedValueOnce({
                    ...createChangesResponse(),
                    cursor: '8',
                    dids: [],
                    operations: [{
                        seq: 8,
                        did: operationsOnlyDid,
                        event: operationsOnlyEvent,
                        operationHash: 'ignored-operation-hash',
                    }],
                    removedOperations: [{
                        seq: 9,
                        did: operationsOnlyDid,
                        operationHash: 'f'.repeat(64),
                    }],
                }),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();
        await (indexer as any).refreshIndex();

        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(1, {
            mode: 'changes',
            cursor: null,
            limit: 500,
        });
        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(2, {
            mode: 'changes',
            cursor: '7',
            limit: 500,
        });
        expect(applyIndexPage.mock.calls[0][0]).not.toHaveProperty('operations');
        expect(applyIndexPage.mock.calls[1][0]).toMatchObject({
            dids: [],
            blocks: [],
        });
        expect(applyIndexPage.mock.calls[1][0]).not.toHaveProperty('operations');
        expect(applyIndexPage.mock.calls[1][0]).not.toHaveProperty('removedOperations');
        await expect(db.getDIDEvents(changesDid)).resolves.toHaveLength(1);
        await expect(db.getDIDEvents(operationsOnlyDid)).resolves.toStrictEqual([]);
        expect(await db.loadSyncState('index.changes.cursor')).toBe('8');
    });

    it('logs when sync error state cannot be persisted', async () => {
        const db = new DIDsDbMemory();
        const saveSyncState = jest.spyOn(db, 'saveSyncState')
            .mockImplementation(async (key: string, value: string | null) => {
                if (key === 'index.lastSyncError') {
                    throw new Error('state write failed');
                }

                return DIDsDbMemory.prototype.saveSyncState.call(db, key, value);
            });
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockRejectedValue(new Error('sync failed')),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();

        expect(saveSyncState).toHaveBeenCalledWith('index.lastSyncError', 'Error: sync failed');
    });

    it('uses blocks from the current page before falling back to stored blocks', async () => {
        const pageBlockA: BlockInfo = { height: 10, hash: 'page-a', time: 1775037600 };
        const pageBlockB: BlockInfo = { height: 11, hash: 'page-b', time: 1775037900 };
        const removedPageBlock: BlockInfo = { height: 12, hash: 'removed-page', time: 1775038200 };
        const storedBlock: BlockInfo = { height: 20, hash: 'stored-a', time: 1775040000 };
        const db = new DIDsDbMemory();

        await db.applyIndexPage({
            dids: [],
            blocks: [{ registry: 'stored', block: storedBlock }],
        });

        const indexer = new DidIndexer({
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>(),
        }, db, { intervalMs: 60_000 });
        const lookup = (indexer as any).createPageBlockLookup([
            { registry: 'local', block: pageBlockA },
            { registry: 'local', block: pageBlockB },
            { registry: 'local', block: removedPageBlock, removed: true },
        ]);

        expect(await lookup('local')).toStrictEqual(pageBlockB);
        expect(await lookup('local', 10)).toStrictEqual(pageBlockA);
        expect(await lookup('local', 'page-b')).toStrictEqual(pageBlockB);
        expect(await lookup('local', 12)).toBeNull();
        expect(await lookup('stored')).toStrictEqual(storedBlock);
        expect(await lookup('stored', 20)).toStrictEqual(storedBlock);
        expect(await lookup('stored', 'stored-a')).toStrictEqual(storedBlock);
    });
});
