import { jest } from '@jest/globals';
import type { GatekeeperEvent, IndexExportResponse, Operation } from '@mdip/gatekeeper/types';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import {
    bootstrapSyncStoreFromGatekeeper,
    HYPR_INDEX_SYNC_STATE_KEYS,
} from '../../services/mediators/hyperswarm/src/bootstrap.ts';

const h = (c: string) => c.repeat(64);

function makeOperation(hashChar: string, signed: string): Operation {
    return {
        type: 'create',
        signature: {
            hash: h(hashChar),
            signed,
            value: `sig-${hashChar}`,
        },
    };
}

function makeEvent(operation: Operation, did = `did:test:${operation.signature?.hash?.[0]}`): GatekeeperEvent {
    return {
        registry: 'hyperswarm',
        time: new Date().toISOString(),
        did,
        operation,
    };
}

function snapshotResponse(params: {
    did: string;
    events: GatekeeperEvent[];
    cursor: string | null;
    checkpointCursor: string | null;
    hasMore?: boolean;
}): IndexExportResponse {
    return {
        mode: 'snapshot',
        cursor: params.cursor,
        checkpointCursor: params.checkpointCursor,
        hasMore: params.hasMore ?? false,
        dids: [{
            did: params.did,
            events: params.events,
        }],
        blocks: [],
    };
}

function changesResponse(params: {
    cursor: string | null;
    checkpointCursor?: string | null;
    operations?: GatekeeperEvent[];
    didEvents?: GatekeeperEvent[];
    hasMore?: boolean;
}): IndexExportResponse {
    return {
        mode: 'changes',
        cursor: params.cursor,
        checkpointCursor: params.checkpointCursor ?? params.cursor ?? '0',
        hasMore: params.hasMore ?? false,
        dids: [{
            did: 'did:test:fallback',
            events: params.didEvents ?? [],
        }],
        blocks: [],
        ...(params.operations && {
            operations: params.operations.map((event, index) => ({
                seq: index + 1,
                did: event.did ?? 'did:test:op',
                event,
                operationHash: event.operation?.signature?.hash,
            })),
        }),
    };
}

describe('bootstrapSyncStoreFromGatekeeper', () => {
    it('hydrates from index snapshot without resetting existing sync-store records', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.upsertMany([{
            id: h('z'),
            ts: Math.floor(Date.parse('2026-02-10T09:00:00.000Z') / 1000),
            operation: makeOperation('z', '2026-02-10T09:00:00.000Z'),
        }]);

        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        const opB = makeOperation('b', '2026-02-10T11:00:00.000Z');
        const gatekeeper = {
            exportIndex: jest.fn(async () => snapshotResponse({
                did: 'did:test:a',
                events: [makeEvent(opA), makeEvent(opB)],
                cursor: 'did:test:a',
                checkpointCursor: '7',
            })),
            getDIDs: jest.fn(),
            exportBatch: jest.fn(),
        };

        const result = await bootstrapSyncStoreFromGatekeeper(store, gatekeeper);

        expect(result).toMatchObject({
            countBefore: 1,
            countAfter: 3,
            mode: 'snapshot',
            pages: 1,
            exported: 2,
            mapped: 2,
            invalid: 0,
            inserted: 2,
            updated: 0,
            snapshotComplete: true,
        });
        expect(gatekeeper.exportIndex).toHaveBeenCalledWith({
            mode: 'snapshot',
            cursor: null,
            limit: 500,
        });
        expect(gatekeeper.getDIDs).not.toHaveBeenCalled();
        expect(gatekeeper.exportBatch).not.toHaveBeenCalled();
        expect(await store.has(h('z'))).toBe(true);
        await expect(store.getByIds([h('a'), h('b')])).resolves.toMatchObject([
            {
                id: h('a'),
                syncOrder: undefined,
                signedTs: Math.floor(Date.parse(opA.signature!.signed) / 1000),
            },
            {
                id: h('b'),
                syncOrder: undefined,
                signedTs: Math.floor(Date.parse(opB.signature!.signed) / 1000),
            },
        ]);
        expect(await store.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete)).toBe('true');
        expect(await store.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor)).toBe('7');
    });

    it('continues snapshot pages with the first checkpoint cursor', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();

        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        const opB = makeOperation('b', '2026-02-10T11:00:00.000Z');
        const gatekeeper = {
            exportIndex: jest.fn()
                .mockResolvedValueOnce(snapshotResponse({
                    did: 'did:test:a',
                    events: [makeEvent(opA)],
                    cursor: 'did:test:a',
                    checkpointCursor: '12',
                    hasMore: true,
                }))
                .mockResolvedValueOnce(snapshotResponse({
                    did: 'did:test:b',
                    events: [makeEvent(opB)],
                    cursor: 'did:test:b',
                    checkpointCursor: '12',
                    hasMore: false,
                })),
        };

        const result = await bootstrapSyncStoreFromGatekeeper(store, gatekeeper, { pageLimit: 1 });

        expect(result.pages).toBe(2);
        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(1, {
            mode: 'snapshot',
            cursor: null,
            limit: 1,
        });
        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(2, {
            mode: 'snapshot',
            cursor: 'did:test:a',
            checkpointCursor: '12',
            limit: 1,
        });
        expect(await store.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotCursor)).toBe('did:test:b');
        expect(await store.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotCheckpointCursor)).toBe('12');
        expect(await store.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor)).toBe('12');
    });

    it('polls changes from the saved cursor after snapshot is complete', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '12');

        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        const opB = makeOperation('b', '2026-02-10T11:00:00.000Z');
        const gatekeeper = {
            exportIndex: jest.fn(async () => changesResponse({
                cursor: '13',
                operations: [makeEvent(opA, 'did:test:a')],
                didEvents: [makeEvent(opB, 'did:test:b')],
            })),
        };

        const result = await bootstrapSyncStoreFromGatekeeper(store, gatekeeper, { pageLimit: 25 });

        expect(result).toMatchObject({
            mode: 'changes',
            pages: 1,
            exported: 1,
            mapped: 1,
            inserted: 1,
            updated: 0,
        });
        expect(gatekeeper.exportIndex).toHaveBeenCalledWith({
            mode: 'changes',
            cursor: '12',
            limit: 25,
            includeOperations: true,
        });
        expect(await store.has(h('a'))).toBe(true);
        expect(await store.has(h('b'))).toBe(false);
        await expect(store.getByIds([h('a')])).resolves.toMatchObject([{
            id: h('a'),
            syncOrder: 1,
            signedTs: Math.floor(Date.parse(opA.signature!.signed) / 1000),
        }]);
        expect(await store.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor)).toBe('13');
    });

    it('resets a stale completed sync store when gatekeeper checkpoint is behind the saved changes cursor', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.upsertMany([{
            id: h('z'),
            ts: Math.floor(Date.parse('2026-02-10T09:00:00.000Z') / 1000),
            operation: makeOperation('z', '2026-02-10T09:00:00.000Z'),
        }]);
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '118597');

        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        const gatekeeper = {
            exportIndex: jest.fn()
                .mockResolvedValueOnce(changesResponse({
                    cursor: '118597',
                    checkpointCursor: '0',
                    operations: [],
                }))
                .mockResolvedValueOnce(snapshotResponse({
                    did: 'did:test:a',
                    events: [makeEvent(opA, 'did:test:a')],
                    cursor: 'did:test:a',
                    checkpointCursor: '0',
                })),
        };

        const result = await bootstrapSyncStoreFromGatekeeper(store, gatekeeper);

        expect(result).toMatchObject({
            countBefore: 1,
            countAfter: 1,
            mode: 'snapshot',
            pages: 1,
            exported: 1,
            mapped: 1,
            invalid: 0,
            inserted: 1,
            updated: 0,
            snapshotComplete: true,
            resetReason: 'gatekeeper_checkpoint_behind_sync_cursor',
        });
        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(1, {
            mode: 'changes',
            cursor: '118597',
            limit: 500,
            includeOperations: true,
        });
        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(2, {
            mode: 'snapshot',
            cursor: null,
            limit: 500,
        });
        expect(await store.has(h('z'))).toBe(false);
        expect(await store.has(h('a'))).toBe(true);
        expect(await store.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete)).toBe('true');
        expect(await store.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor)).toBe('0');
    });

    it('rejects changes responses without checkpoint cursor metadata', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '12');

        const gatekeeper = {
            exportIndex: jest.fn(async () => {
                const response = changesResponse({
                    cursor: '13',
                    operations: [],
                });
                delete (response as { checkpointCursor?: string | null }).checkpointCursor;
                return response;
            }),
        };

        await expect(bootstrapSyncStoreFromGatekeeper(store, gatekeeper))
            .rejects
            .toThrow('Changes export response missing checkpointCursor');
        expect(await store.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor)).toBe('12');
    });

    it('rejects changes responses without operation records', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '12');

        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        const gatekeeper = {
            exportIndex: jest.fn(async () => changesResponse({
                cursor: '13',
                didEvents: [makeEvent(opA, 'did:test:a')],
            })),
        };

        await expect(bootstrapSyncStoreFromGatekeeper(store, gatekeeper))
            .rejects
            .toThrow('Changes export response missing operations');
        await expect(store.getByIds([h('a')])).resolves.toStrictEqual([]);
        expect(await store.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor)).toBe('12');
    });

    it('rejects inconsistent saved snapshot cursor state', async () => {
        const storeWithCursorOnly = new InMemoryOperationSyncStore();
        await storeWithCursorOnly.start();
        await storeWithCursorOnly.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotCursor, 'did:test:a');

        await expect(bootstrapSyncStoreFromGatekeeper(storeWithCursorOnly, {
            exportIndex: jest.fn(),
        })).rejects.toThrow('Snapshot cursor found without checkpointCursor');

        const storeWithCheckpointOnly = new InMemoryOperationSyncStore();
        await storeWithCheckpointOnly.start();
        await storeWithCheckpointOnly.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotCheckpointCursor, '12');

        await expect(bootstrapSyncStoreFromGatekeeper(storeWithCheckpointOnly, {
            exportIndex: jest.fn(),
        })).rejects.toThrow('Snapshot checkpointCursor found without cursor');
    });

    it('rejects malformed snapshot export responses', async () => {
        const wrongModeStore = new InMemoryOperationSyncStore();
        await wrongModeStore.start();

        await expect(bootstrapSyncStoreFromGatekeeper(wrongModeStore, {
            exportIndex: jest.fn(async () => changesResponse({ cursor: '1', operations: [] })),
        })).rejects.toThrow('Expected snapshot export response, got changes');

        const missingCheckpointStore = new InMemoryOperationSyncStore();
        await missingCheckpointStore.start();

        await expect(bootstrapSyncStoreFromGatekeeper(missingCheckpointStore, {
            exportIndex: jest.fn(async () => {
                const response = snapshotResponse({
                    did: 'did:test:a',
                    events: [],
                    cursor: 'did:test:a',
                    checkpointCursor: '12',
                });
                delete (response as { checkpointCursor?: string | null }).checkpointCursor;
                return response;
            }),
        })).rejects.toThrow('Snapshot export response missing checkpointCursor');

        const stalledCursorStore = new InMemoryOperationSyncStore();
        await stalledCursorStore.start();

        await expect(bootstrapSyncStoreFromGatekeeper(stalledCursorStore, {
            exportIndex: jest.fn(async () => snapshotResponse({
                did: 'did:test:a',
                events: [],
                cursor: null,
                checkpointCursor: '12',
                hasMore: true,
            })),
        })).rejects.toThrow('Snapshot export did not advance cursor');
    });

    it('handles paginated changes and rejects malformed changes export responses', async () => {
        const paginatedStore = new InMemoryOperationSyncStore();
        await paginatedStore.start();
        await paginatedStore.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await paginatedStore.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '12');

        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        const opB = makeOperation('b', '2026-02-10T11:00:00.000Z');
        const paginatedGatekeeper = {
            exportIndex: jest.fn()
                .mockResolvedValueOnce(changesResponse({
                    cursor: '13',
                    operations: [makeEvent(opA, 'did:test:a')],
                    hasMore: true,
                }))
                .mockResolvedValueOnce(changesResponse({
                    cursor: '14',
                    operations: [makeEvent(opB, 'did:test:b')],
                })),
        };

        const result = await bootstrapSyncStoreFromGatekeeper(paginatedStore, paginatedGatekeeper);

        expect(result).toMatchObject({
            mode: 'changes',
            pages: 2,
            inserted: 2,
        });
        expect(paginatedGatekeeper.exportIndex).toHaveBeenNthCalledWith(2, {
            mode: 'changes',
            cursor: '13',
            limit: 500,
            includeOperations: true,
        });
        expect(await paginatedStore.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor)).toBe('14');

        const wrongModeStore = new InMemoryOperationSyncStore();
        await wrongModeStore.start();
        await wrongModeStore.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');

        await expect(bootstrapSyncStoreFromGatekeeper(wrongModeStore, {
            exportIndex: jest.fn(async () => snapshotResponse({
                did: 'did:test:a',
                events: [],
                cursor: 'did:test:a',
                checkpointCursor: '12',
            })),
        })).rejects.toThrow('Expected changes export response, got snapshot');

        const stalledCursorStore = new InMemoryOperationSyncStore();
        await stalledCursorStore.start();
        await stalledCursorStore.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await stalledCursorStore.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '12');

        await expect(bootstrapSyncStoreFromGatekeeper(stalledCursorStore, {
            exportIndex: jest.fn(async () => changesResponse({
                cursor: '12',
                operations: [],
                hasMore: true,
            })),
        })).rejects.toThrow('Changes export did not advance cursor');
    });

    it('allows empty and non-numeric saved changes cursors when checking gatekeeper checkpoint compatibility', async () => {
        const emptyCursorStore = new InMemoryOperationSyncStore();
        await emptyCursorStore.start();
        await emptyCursorStore.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await emptyCursorStore.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '');

        await expect(bootstrapSyncStoreFromGatekeeper(emptyCursorStore, {
            exportIndex: jest.fn(async () => changesResponse({
                cursor: '0',
                checkpointCursor: '0',
                operations: [],
            })),
        })).resolves.toMatchObject({
            mode: 'changes',
            pages: 1,
        });

        const nonNumericCursorStore = new InMemoryOperationSyncStore();
        await nonNumericCursorStore.start();
        await nonNumericCursorStore.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await nonNumericCursorStore.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, 'not-a-number');

        await expect(bootstrapSyncStoreFromGatekeeper(nonNumericCursorStore, {
            exportIndex: jest.fn(async () => changesResponse({
                cursor: '0',
                checkpointCursor: '0',
                operations: [],
            })),
        })).resolves.toMatchObject({
            mode: 'changes',
            pages: 1,
        });
    });

    it('does not save the next cursor if page persistence fails', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '12');
        store.applySyncPage = jest.fn(async () => {
            throw new Error('persist failed');
        });

        const gatekeeper = {
            exportIndex: jest.fn(async () => changesResponse({
                cursor: '13',
                operations: [makeEvent(makeOperation('a', '2026-02-10T10:00:00.000Z'))],
            })),
        };

        await expect(bootstrapSyncStoreFromGatekeeper(store, gatekeeper))
            .rejects
            .toThrow('persist failed');
        expect(store.applySyncPage).toHaveBeenCalledWith({
            records: [expect.objectContaining({
                id: h('a'),
                syncOrder: 1,
            })],
            syncStateUpdates: {
                [HYPR_INDEX_SYNC_STATE_KEYS.changesCursor]: '13',
            },
        });
        expect(await store.loadSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor)).toBe('12');
    });

    it('rejects snapshot continuations that change checkpoint cursor', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotCursor, 'did:test:a');
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotCheckpointCursor, '12');

        const gatekeeper = {
            exportIndex: jest.fn(async () => snapshotResponse({
                did: 'did:test:b',
                events: [],
                cursor: 'did:test:b',
                checkpointCursor: '13',
            })),
        };

        await expect(bootstrapSyncStoreFromGatekeeper(store, gatekeeper))
            .rejects
            .toThrow('Snapshot export checkpoint changed from 12 to 13');
    });

    it('backfills syncOrder for an existing peer-imported operation during changes sync', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '12');

        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        await store.upsertMany([{
            id: h('a'),
            signedTs: Math.floor(Date.parse(opA.signature!.signed) / 1000),
            operation: opA,
        }]);

        await expect(store.getByIds([h('a')])).resolves.toMatchObject([{
            id: h('a'),
            syncOrder: undefined,
        }]);
        expect(await store.countOrdered()).toBe(0);

        const gatekeeper = {
            exportIndex: jest.fn(async () => changesResponse({
                cursor: '13',
                operations: [makeEvent(opA, 'did:test:a')],
            })),
        };

        const result = await bootstrapSyncStoreFromGatekeeper(store, gatekeeper);

        expect(result).toMatchObject({
            mode: 'changes',
            inserted: 0,
            updated: 1,
        });
        await expect(store.getByIds([h('a')])).resolves.toMatchObject([{
            id: h('a'),
            syncOrder: 1,
        }]);
        expect(await store.countOrdered()).toBe(1);
    });

    it('does not overwrite an existing syncOrder during changes sync', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.snapshotComplete, 'true');
        await store.saveSyncState(HYPR_INDEX_SYNC_STATE_KEYS.changesCursor, '12');

        const opA = makeOperation('a', '2026-02-10T10:00:00.000Z');
        await store.upsertMany([{
            id: h('a'),
            syncOrder: 7,
            signedTs: Math.floor(Date.parse(opA.signature!.signed) / 1000),
            operation: opA,
        }]);

        const gatekeeper = {
            exportIndex: jest.fn(async () => changesResponse({
                cursor: '13',
                operations: [makeEvent(opA, 'did:test:a')],
            })),
        };

        const result = await bootstrapSyncStoreFromGatekeeper(store, gatekeeper);

        expect(result).toMatchObject({
            mode: 'changes',
            inserted: 0,
            updated: 0,
        });
        await expect(store.getByIds([h('a')])).resolves.toMatchObject([{
            id: h('a'),
            syncOrder: 7,
        }]);
    });
});
