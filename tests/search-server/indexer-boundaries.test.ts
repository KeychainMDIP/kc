import { jest } from '@jest/globals';
import { setLogger } from '../../packages/common/src/logger.ts';
import DidIndexer from '../../services/search-server/src/DidIndexer.ts';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import type { BlockInfo, IndexExportResponse } from '@mdip/gatekeeper/types';
import type { GatekeeperEvent } from '../../services/search-server/src/types.ts';

const snapshotDid = 'did:test:z3v8AuabRMo7rU27NZxRvJL9nCzJdXCsBcuGwrr1mbYHobp4jGz';
const changesDid = 'did:test:z3v8AuahDNjhQ81fEAGPPkiz7JbkwBsM4UmN9bnL99wjVvC5dGp';
const snapshotCursor = 'opaque-snapshot-page-token';

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
        cursor: '7',
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
    const logger = {
        child: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    logger.child.mockReturnValue(logger);
    setLogger(logger as any);
});

describe('DidIndexer gatekeeper read boundary', () => {
    it('uses exportIndex only and never calls getDIDs or resolveDID during snapshot or changes sync', async () => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn().mockResolvedValue(true),
            exportIndex: jest.fn()
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

    it('does not start a refresh when gatekeeper is not ready or another refresh is active', async () => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn().mockResolvedValue(false),
            exportIndex: jest.fn(),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();
        expect(gatekeeper.exportIndex).not.toHaveBeenCalled();

        gatekeeper.isReady.mockResolvedValue(true);
        (indexer as any).refreshInProgress = true;

        await (indexer as any).refreshIndex();

        expect(gatekeeper.exportIndex).not.toHaveBeenCalled();
    });

    it('rejects invalid snapshot continuation state and malformed snapshot responses', async () => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn().mockResolvedValue(true),
            exportIndex: jest.fn(),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await db.saveSyncState('index.snapshot.cursor', 'page-1');
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
            checkpointCursor: undefined,
        });
        await expect((indexer as any).syncSnapshot())
            .rejects.toThrow('Snapshot export response missing checkpointCursor');
    });

    it('rejects snapshot pages that change checkpoint or do not advance cursor', async () => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn().mockResolvedValue(true),
            exportIndex: jest.fn(),
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
            isReady: jest.fn().mockResolvedValue(true),
            exportIndex: jest.fn(),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        gatekeeper.exportIndex.mockResolvedValueOnce(createSnapshotResponse());
        await expect((indexer as any).syncChanges())
            .rejects.toThrow('Expected changes export response, got snapshot');

        await db.saveSyncState('index.changes.cursor', '7');
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
        await db.saveSyncState('index.snapshot.complete', 'true');
        await db.saveSyncState('index.changes.cursor', '7');
        const gatekeeper = {
            isReady: jest.fn().mockResolvedValue(true),
            exportIndex: jest.fn()
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
            isReady: jest.fn().mockResolvedValue(true),
            exportIndex: jest.fn().mockRejectedValue(new Error('sync failed')),
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
            isReady: jest.fn().mockResolvedValue(true),
            exportIndex: jest.fn(),
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
