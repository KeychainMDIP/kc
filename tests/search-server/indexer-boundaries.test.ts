import { jest } from '@jest/globals';
import { setLogger } from '../../packages/common/src/logger.ts';
import DidIndexer from '../../services/search-server/src/DidIndexer.ts';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import type { IndexExportResponse } from '@mdip/gatekeeper/types';
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
});
