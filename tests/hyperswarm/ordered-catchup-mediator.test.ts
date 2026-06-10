import { jest } from '@jest/globals';
import type { Operation } from '@mdip/gatekeeper/types';
import type {
    OperationSyncStore,
    SyncOperationRecord,
    SyncStoreListOptions,
    SyncStoreOrderedListOptions,
    SyncStorePage,
    SyncStoreWriteResult,
} from '../../services/mediators/hyperswarm/src/db/types.ts';
import {
    normalizePeerCapabilities,
} from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';
import {
    decodeFramedMessages,
} from '../../services/mediators/hyperswarm/src/transport-framing.ts';

type MediatorTestApi = typeof import('../../services/mediators/hyperswarm/src/hyperswarm-mediator.ts')['__test'];

const ORIGINAL_ENV = { ...process.env };

let mediatorTest: MediatorTestApi;

const hexId = (value: number): string => value.toString(16).padStart(64, '0');

function makeOperation(id: string, index: number): Operation {
    return {
        type: 'create',
        mdip: {
            version: 1,
            type: 'asset',
            registry: 'hyperswarm',
        },
        signature: {
            signed: new Date((1_700_000_000 + index) * 1000).toISOString(),
            hash: id,
            value: `sig-${index}`,
        },
    };
}

function makeOrderedRecord(index: number): SyncOperationRecord {
    const id = hexId(index);
    const signedTs = 1_700_000_000 + index;

    return {
        id,
        syncOrder: index,
        signedTs,
        ts: signedTs,
        operation: makeOperation(id, index),
        insertedAt: signedTs,
    };
}

function createOrderedSyncStore(records: SyncOperationRecord[]): OperationSyncStore {
    return {
        start: async () => undefined,
        stop: async () => undefined,
        reset: async () => undefined,
        upsertMany: async (): Promise<SyncStoreWriteResult> => ({ inserted: 0, updated: 0 }),
        applySyncPage: async (_page: SyncStorePage): Promise<SyncStoreWriteResult> => ({ inserted: 0, updated: 0 }),
        loadSyncState: async () => null,
        saveSyncState: async () => undefined,
        getByIds: async (ids: string[]) => records.filter(record => ids.includes(record.id)),
        iterateSorted: async (options: SyncStoreListOptions = {}) => records.slice(0, options.limit ?? records.length),
        iterateOrdered: async (options: SyncStoreOrderedListOptions = {}) => {
            const startIndex = options.after
                ? records.findIndex(record => record.syncOrder === options.after!.syncOrder && record.id === options.after!.id) + 1
                : 0;
            const limit = options.limit ?? records.length;

            return records.slice(Math.max(startIndex, 0), Math.max(startIndex, 0) + limit);
        },
        has: async (id: string) => records.some(record => record.id === id),
        count: async () => records.length,
        countOrdered: async () => records.filter(record => record.syncOrder !== undefined).length,
    };
}

function decodeWrittenMessageTypes(writes: Buffer[]): string[] {
    const framed = decodeFramedMessages(Buffer.concat(writes));
    expect(framed.error).toBeUndefined();
    expect(framed.remaining.length).toBe(0);

    return framed.messages.map(message => JSON.parse(message.toString('utf8')).type);
}

describe('ordered catch-up mediator flow', () => {
    beforeAll(async () => {
        process.env = {
            ...ORIGINAL_ENV,
            KC_HYPR_DB: process.env.KC_HYPR_DB?.trim() || 'sqlite',
        };

        mediatorTest = (await import('../../services/mediators/hyperswarm/src/hyperswarm-mediator.ts')).__test;
    });

    afterEach(() => {
        mediatorTest.resetState();
    });

    afterAll(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    it('ignores inbound neg_open while ordered catch-up client session is active', async () => {
        const peerKey = 'e'.repeat(64);
        const connection = {
            write: jest.fn(),
            destroy: jest.fn(),
            once: jest.fn(),
            on: jest.fn(),
            remotePublicKey: Buffer.from(peerKey, 'hex'),
        };

        mediatorTest.addConnection(peerKey, {
            connection,
            capabilities: normalizePeerCapabilities({
                negentropy: true,
                negentropyVersion: 1,
                orderedCatchup: true,
                orderedCatchupVersion: 1,
                orderedCatchupReady: true,
                operationCount: 100,
                orderedOperationCount: 100,
            }),
            syncMode: 'negentropy',
            transportMode: 'framed',
            inboundTransportMode: 'framed',
            peerTransportFramingVersion: 1,
        });
        mediatorTest.setNegentropyAdapter({});
        mediatorTest.createOrderedCatchupClientSession(peerKey, 'ordered-client-session');

        await mediatorTest.receiveMsg(peerKey, {
            type: 'neg_open',
            time: '2026-06-09T00:00:00.000Z',
            node: 'peer',
            relays: [],
            sessionId: 'remote-negentropy-session',
            windowId: 'remote-window',
            window: {
                name: 'full_history',
                fromTs: 0,
                toTs: 1_800_000_000,
                maxRecords: 100,
                order: 0,
            },
            round: 0,
            frame: {
                encoding: 'utf8',
                data: '',
            },
        });

        expect(mediatorTest.getConnectionState(peerKey)).toMatchObject({
            activeSession: {
                mode: 'ordered_catchup',
                sessionId: 'ordered-client-session',
            },
            orderedCatchupClientSessionId: 'ordered-client-session',
        });
        expect(connection.write).not.toHaveBeenCalled();
    });

    it('suppresses outbound negentropy while serving ordered catch-up for a peer', async () => {
        const peerKey = 'f'.repeat(64);
        const writes: Buffer[] = [];
        const connection = {
            write: (data: Buffer | string) => {
                writes.push(Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data, 'utf8'));
            },
            destroy: jest.fn(),
            once: jest.fn(),
            on: jest.fn(),
            remotePublicKey: Buffer.from(peerKey, 'hex'),
        };
        const records = Array.from({ length: 257 }, (_value, index) => makeOrderedRecord(index + 1));

        mediatorTest.setNodeKey('0'.repeat(64));
        mediatorTest.setSyncStore(createOrderedSyncStore(records));
        mediatorTest.addConnection(peerKey, {
            connection,
            capabilities: normalizePeerCapabilities({
                negentropy: true,
                negentropyVersion: 1,
                orderedCatchup: true,
                orderedCatchupVersion: 1,
                orderedCatchupReady: true,
                operationCount: records.length,
                orderedOperationCount: records.length,
            }),
            syncMode: 'negentropy',
            transportMode: 'framed',
            inboundTransportMode: 'framed',
            peerTransportFramingVersion: 1,
        });

        await mediatorTest.sendOrderedCatchupPage(peerKey, {
            type: 'ordered_catchup_req',
            time: '2026-06-09T00:00:00.000Z',
            node: 'peer',
            relays: [],
            sessionId: 'server-session',
        });

        expect(mediatorTest.getConnectionState(peerKey)).toMatchObject({
            orderedCatchupServerSessionId: 'server-session',
        });
        expect(decodeWrittenMessageTypes(writes)).toStrictEqual(['ordered_catchup_push']);

        const writesAfterOrderedCatchupPage = writes.length;

        await mediatorTest.maybeStartPeerSync(peerKey, 'periodic');

        expect(writes).toHaveLength(writesAfterOrderedCatchupPage);
        expect(decodeWrittenMessageTypes(writes)).not.toContain('neg_open');
    });

    it('suppresses outbound negentropy while expecting an ordered catch-up request', async () => {
        const peerKey = 'f'.repeat(64);
        const writes: Buffer[] = [];
        const connection = {
            write: (data: Buffer | string) => {
                writes.push(Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data, 'utf8'));
            },
            destroy: jest.fn(),
            once: jest.fn(),
            on: jest.fn(),
            remotePublicKey: Buffer.from(peerKey, 'hex'),
        };
        const records = Array.from({ length: 257 }, (_value, index) => makeOrderedRecord(index + 1));

        mediatorTest.setNodeKey('0'.repeat(64));
        mediatorTest.setSyncStore(createOrderedSyncStore(records));
        mediatorTest.addConnection(peerKey, {
            connection,
            capabilities: normalizePeerCapabilities({
                negentropy: true,
                negentropyVersion: 1,
                orderedCatchup: true,
                orderedCatchupVersion: 1,
                orderedCatchupReady: false,
                operationCount: 0,
                orderedOperationCount: 0,
            }),
            syncMode: 'negentropy',
            transportMode: 'framed',
            inboundTransportMode: 'framed',
            peerTransportFramingVersion: 1,
        });

        await mediatorTest.maybeStartPeerSync(peerKey, 'connect');

        const pendingState = mediatorTest.getConnectionState(peerKey);
        expect(pendingState).toMatchObject({
            syncStarted: true,
            orderedCatchupServerPendingReason: 'enabled',
            orderedCatchupServerPendingGap: records.length,
        });
        expect(pendingState?.orderedCatchupServerPendingUntil).not.toBe(0);
        expect(writes).toHaveLength(0);

        await mediatorTest.maybeStartPeerSync(peerKey, 'periodic');

        expect(writes).toHaveLength(0);

        await mediatorTest.sendOrderedCatchupPage(peerKey, {
            type: 'ordered_catchup_req',
            time: '2026-06-09T00:00:00.000Z',
            node: 'peer',
            relays: [],
            sessionId: 'expected-server-session',
        });

        expect(mediatorTest.getConnectionState(peerKey)).toMatchObject({
            orderedCatchupServerSessionId: 'expected-server-session',
            orderedCatchupServerPendingUntil: 0,
            orderedCatchupServerPendingReason: null,
        });
        expect(decodeWrittenMessageTypes(writes)).toStrictEqual(['ordered_catchup_push']);
    });

    it('expires an ordered catch-up request expectation', async () => {
        const peerKey = 'f'.repeat(64);
        const records = Array.from({ length: 257 }, (_value, index) => makeOrderedRecord(index + 1));

        mediatorTest.setNodeKey('0'.repeat(64));
        mediatorTest.setSyncStore(createOrderedSyncStore(records));
        mediatorTest.addConnection(peerKey, {
            capabilities: normalizePeerCapabilities({
                negentropy: true,
                negentropyVersion: 1,
                orderedCatchup: true,
                orderedCatchupVersion: 1,
                orderedCatchupReady: false,
                operationCount: 0,
                orderedOperationCount: 0,
            }),
            syncMode: 'negentropy',
            transportMode: 'framed',
            inboundTransportMode: 'framed',
            peerTransportFramingVersion: 1,
        });

        await mediatorTest.maybeStartPeerSync(peerKey, 'connect');

        const pendingState = mediatorTest.getConnectionState(peerKey);
        const pendingUntil = pendingState?.orderedCatchupServerPendingUntil;
        expect(typeof pendingUntil).toBe('number');
        expect(pendingUntil).not.toBe(0);

        expect(mediatorTest.clearExpiredOrderedCatchupServerExpectation(peerKey, Number(pendingUntil) + 1)).toBe(true);
        expect(mediatorTest.getConnectionState(peerKey)).toMatchObject({
            orderedCatchupServerPendingUntil: 0,
            orderedCatchupServerPendingReason: null,
            orderedCatchupServerPendingGap: 0,
        });
    });
});
