import { EventEmitter } from 'node:events';

import { jest } from '@jest/globals';
import type { HyperswarmConnection } from 'hyperswarm';

import { createHyperswarmTransport } from '../../services/mediators/hyperswarm/src/hyperswarm-transport.ts';
import {
    createConnectionInfo,
    type ConnectionInfo,
} from '../../services/mediators/hyperswarm/src/mediator-state.ts';
import type {
    PingMessage,
    QueueMessage,
    SyncMessage,
} from '../../services/mediators/hyperswarm/src/protocol-messages.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import { encodeFramedMessage } from '../../services/mediators/hyperswarm/src/transport-framing.ts';

const payloadLimits = {
    maxIdsPerRequest: 1_000,
    maxOpsPerPush: 300,
    maxBytesPerPush: 512 * 1024,
    maxFrameBytes: 64 * 1024,
    maxRecordsPerWindow: 25_000,
};

class FakeConnection extends EventEmitter {
    readonly remotePublicKey: Buffer;
    readonly writes: Buffer[] = [];
    destroyed = false;

    constructor(peerByte = 0x22) {
        super();
        this.remotePublicKey = Buffer.alloc(32, peerByte);
    }

    write(data: Uint8Array): boolean {
        this.writes.push(Buffer.from(data));
        return true;
    }

    destroy(): void {
        this.destroyed = true;
        this.emit('close');
    }
}

function ping(overrides: Record<string, unknown> = {}) {
    return {
        type: 'ping' as const,
        time: '',
        node: 'peer',
        relays: [],
        peers: [],
        transportFramingVersion: 1,
        capabilities: {
            negentropy: true,
            negentropyVersion: 2,
        },
        ...overrides,
    };
}

function createTransport(overrides: {
    now?: () => number;
    onPing?: jest.Mock<(peerKey: string, message: PingMessage, connection: ConnectionInfo) => void>;
    onQueue?: jest.Mock<(peerKey: string, message: QueueMessage, connection: ConnectionInfo) => void>;
    onSyncMessage?: jest.Mock<(peerKey: string, message: SyncMessage, connection: ConnectionInfo) => void>;
} = {}) {
    const syncStats = createMediatorSyncStats();
    const onPing = overrides.onPing ?? jest.fn<(peerKey: string, message: PingMessage, connection: ConnectionInfo) => void>();
    const onQueue = overrides.onQueue ?? jest.fn<(peerKey: string, message: QueueMessage, connection: ConnectionInfo) => void>();
    const onSyncMessage = overrides.onSyncMessage ?? jest.fn<(peerKey: string, message: SyncMessage, connection: ConnectionInfo) => void>();
    const onDisconnected = jest.fn();
    const transport = createHyperswarmTransport({
        framingVersion: 1,
        requiredNegentropyVersion: 2,
        payloadLimits,
        syncStats,
        now: overrides.now,
        buildInitialPing: async () => ping({ node: 'local' }),
        onPing,
        onQueue,
        onSyncMessage,
        onDisconnected,
    });
    return { transport, syncStats, onPing, onQueue, onSyncMessage, onDisconnected };
}

describe('hyperswarm transport routing', () => {
    it('routes decoded ping, queue, and current sync messages to their handlers', async () => {
        const peerKey = Buffer.alloc(32, 0x22).toString('hex');
        const routes: string[] = [];
        const connection = new FakeConnection();
        const { transport } = createTransport({
            onPing: jest.fn(() => { routes.push('ping'); }),
            onQueue: jest.fn(() => { routes.push('queue'); }),
            onSyncMessage: jest.fn(() => { routes.push('sync'); }),
        });
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));

        const messages = [
            ping(),
            { type: 'queue', time: '', node: 'peer', relays: [], data: [] },
            { type: 'neg_close', time: '', node: 'peer', relays: [], sessionId: 's', windowId: 'w', round: 0 },
        ].map(message => encodeFramedMessage(JSON.stringify(message)));

        await transport.processInboundPeerData(peerKey, Buffer.concat(messages));

        expect(routes).toEqual(['ping', 'queue', 'sync']);
    });

    it('rejects a raw initial ping as malformed framing', async () => {
        const peerKey = Buffer.alloc(32, 0x23).toString('hex');
        const connection = new FakeConnection(0x23);
        const { transport, syncStats, onPing } = createTransport();
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));

        await transport.processInboundPeerData(peerKey, JSON.stringify(ping()));

        expect(onPing).not.toHaveBeenCalled();
        expect(connection.destroyed).toBe(true);
        expect(transport.getConnection(peerKey)).toBeUndefined();
        expect(syncStats.protocolViolationCooldowns).toBe(1);
        expect(transport.getAdmissionCounts()).toMatchObject({ punitive: 1, total: 1 });
    });

    it('ignores coalesced messages after closing an incompatible peer', async () => {
        const peerKey = Buffer.alloc(32, 0x24).toString('hex');
        const connection = new FakeConnection(0x24);
        const { transport, syncStats, onPing, onQueue } = createTransport();
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));
        const input = Buffer.concat([
            encodeFramedMessage(JSON.stringify(ping({ transportFramingVersion: 2 }))),
            encodeFramedMessage(JSON.stringify({ type: 'queue', time: '', node: 'peer', relays: [], data: [] })),
        ]);

        await transport.processInboundPeerData(peerKey, input);

        expect(onPing).not.toHaveBeenCalled();
        expect(onQueue).not.toHaveBeenCalled();
        expect(connection.destroyed).toBe(true);
        expect(syncStats.transportFramingIncompatibilityClosures).toBe(1);
        expect(syncStats.protocolViolationCooldowns).toBe(0);
        expect(transport.getAdmissionCounts()).toMatchObject({ compatibility: 1, total: 1 });
    });

    it.each([
        ['missing', undefined],
        ['unsupported', { negentropy: true, negentropyVersion: 1 }],
    ])('closes a peer with %s Negentropy capabilities before routing application traffic', async (
        _case,
        capabilities,
    ) => {
        const peerKey = Buffer.alloc(32, 0x29).toString('hex');
        const connection = new FakeConnection(0x29);
        const { transport, syncStats, onPing, onQueue } = createTransport();
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));
        const input = Buffer.concat([
            encodeFramedMessage(JSON.stringify(ping({ capabilities }))),
            encodeFramedMessage(JSON.stringify({ type: 'queue', time: '', node: 'peer', relays: [], data: [] })),
        ]);

        await transport.processInboundPeerData(peerKey, input);

        expect(onPing).not.toHaveBeenCalled();
        expect(onQueue).not.toHaveBeenCalled();
        expect(connection.destroyed).toBe(true);
        expect(syncStats.negentropyVersionIncompatibilityClosures).toBe(1);
        expect(syncStats.protocolViolationCooldowns).toBe(0);
        expect(transport.getAdmissionCounts()).toMatchObject({ compatibility: 1, total: 1 });
    });

    it('throttles repeated valid ping side effects while refreshing liveness', async () => {
        let currentTime = 1_000;
        const peerKey = Buffer.alloc(32, 0x25).toString('hex');
        const connection = new FakeConnection(0x25);
        const onPing = jest.fn();
        const { transport } = createTransport({ now: () => currentTime, onPing });
        const state = createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
            now: currentTime,
        });
        transport.setConnection(peerKey, state);

        await transport.receiveMessage(peerKey, ping());
        currentTime += 9_999;
        await transport.receiveMessage(peerKey, ping({ node: 'too-soon' }));

        expect(onPing).toHaveBeenCalledTimes(1);
        expect(state.lastSeen).toBe(currentTime);
        expect(state.nodeName).toBe('peer');

        currentTime += 1;
        await transport.receiveMessage(peerKey, ping({ node: 'accepted' }));
        expect(onPing).toHaveBeenCalledTimes(2);
        expect(state.nodeName).toBe('accepted');
    });

    it('refuses a quarantined reconnect without extending the cooldown', async () => {
        let currentTime = 10_000;
        const first = new FakeConnection(0x26);
        const peerKey = first.remotePublicKey.toString('hex');
        const { transport, syncStats } = createTransport({ now: () => currentTime });
        transport.addConnection(first as unknown as HyperswarmConnection);
        await Promise.resolve();
        await transport.processInboundPeerData(peerKey, JSON.stringify(ping()));

        const rejected = new FakeConnection(0x26);
        transport.addConnection(rejected as unknown as HyperswarmConnection);
        expect(rejected.destroyed).toBe(true);
        expect(syncStats.protocolViolationConnectionsRejected).toBe(1);

        const rejectedAgain = new FakeConnection(0x26);
        transport.addConnection(rejectedAgain as unknown as HyperswarmConnection);
        expect(rejectedAgain.destroyed).toBe(true);
        expect(syncStats.protocolViolationConnectionsRejected).toBe(2);

        const failedDestroy = {
            remotePublicKey: Buffer.alloc(32, 0x26),
            destroy: () => { throw new Error('destroy failed'); },
        } as unknown as HyperswarmConnection;
        expect(() => transport.addConnection(failedDestroy)).not.toThrow();

        currentTime += 60_000;
        const admitted = new FakeConnection(0x26);
        transport.addConnection(admitted as unknown as HyperswarmConnection);
        await Promise.resolve();
        expect(admitted.destroyed).toBe(false);
        expect(transport.getConnection(peerKey)).toBeDefined();
    });

    it('does not penalize a replacement for a late violation from the old connection', () => {
        const peerKey = Buffer.alloc(32, 0x27).toString('hex');
        const { transport } = createTransport();
        const oldConnection = createConnectionInfo({
            connection: new FakeConnection(0x27) as unknown as HyperswarmConnection,
            peerName: 'old',
        });
        const replacement = createConnectionInfo({
            connection: new FakeConnection(0x27) as unknown as HyperswarmConnection,
            peerName: 'new',
        });
        transport.setConnection(peerKey, replacement);

        transport.reportProtocolViolation(peerKey, 'late_failure', oldConnection);

        expect(transport.getConnection(peerKey)).toBe(replacement);
        expect(transport.getAdmissionCounts()).toMatchObject({ punitive: 0, total: 0 });
    });

    it('rejects invalid timing options', () => {
        expect(() => createHyperswarmTransport({
            framingVersion: 1,
            requiredNegentropyVersion: 2,
            payloadLimits,
            syncStats: createMediatorSyncStats(),
            pingIntervalMs: 0,
            buildInitialPing: async () => ping(),
            onPing: () => undefined,
            onQueue: () => undefined,
            onSyncMessage: () => undefined,
            onDisconnected: () => undefined,
        })).toThrow('pingIntervalMs must be a positive finite number');
        expect(() => createHyperswarmTransport({
            framingVersion: 1,
            requiredNegentropyVersion: 2,
            payloadLimits,
            syncStats: createMediatorSyncStats(),
            staleConnectionMs: Number.NaN,
            buildInitialPing: async () => ping(),
            onPing: () => undefined,
            onQueue: () => undefined,
            onSyncMessage: () => undefined,
            onDisconnected: () => undefined,
        })).toThrow('staleConnectionMs must be a positive finite number');
    });

    it('rejects invalid outbound envelopes and payloads before writing', () => {
        const peerKey = Buffer.alloc(32, 0x28).toString('hex');
        const connection = new FakeConnection(0x28);
        const { transport } = createTransport();
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));

        expect(transport.sendToPeer(peerKey, {
            type: 'queue', time: 1, node: 'local', relays: [], data: [],
        } as never)).toBe(false);
        expect(transport.sendToPeer(peerKey, {
            type: 'queue', time: '', node: 'local', relays: [], data: 'invalid',
        } as never)).toBe(false);
        expect(connection.writes).toHaveLength(0);
    });

    it('rejects invalid queue payloads and invalid framed JSON', async () => {
        const queuePeerKey = Buffer.alloc(32, 0x29).toString('hex');
        const queueConnection = new FakeConnection(0x29);
        const first = createTransport();
        const queueState = createConnectionInfo({
            connection: queueConnection as unknown as HyperswarmConnection,
            peerName: 'peer',
        });
        queueState.initialPingReceived = true;
        queueState.peerTransportFramingVersion = 1;
        first.transport.setConnection(queuePeerKey, queueState);

        await first.transport.receiveMessage(queuePeerKey, {
            type: 'queue', time: '', node: 'peer', relays: [], data: 'invalid',
        });
        expect(first.onQueue).not.toHaveBeenCalled();
        expect(queueConnection.destroyed).toBe(true);

        const jsonPeerKey = Buffer.alloc(32, 0x2a).toString('hex');
        const jsonConnection = new FakeConnection(0x2a);
        const second = createTransport();
        second.transport.setConnection(jsonPeerKey, createConnectionInfo({
            connection: jsonConnection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));
        await second.transport.processInboundPeerData(
            jsonPeerKey,
            encodeFramedMessage('not-json'),
        );
        expect(jsonConnection.destroyed).toBe(true);
    });

    it('terminates a peer even when its connection has no destroy method and clears admission state', () => {
        const peerKey = Buffer.alloc(32, 0x2b).toString('hex');
        const { transport } = createTransport();
        const state = createConnectionInfo({
            connection: {
                remotePublicKey: Buffer.alloc(32, 0x2b),
                write: () => true,
            } as unknown as HyperswarmConnection,
            peerName: 'peer',
        });
        transport.setConnection(peerKey, state);

        transport.reportProtocolViolation(peerKey, 'bad-message', state);
        expect(transport.getConnection(peerKey)).toBeUndefined();
        expect(transport.getAdmissionCounts().punitive).toBe(1);

        transport.reset();
        expect(transport.getAdmissionCounts().total).toBe(0);
    });
});
