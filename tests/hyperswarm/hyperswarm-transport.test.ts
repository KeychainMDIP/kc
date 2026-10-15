import { EventEmitter } from 'node:events';

import { jest } from '@jest/globals';
import type { HyperswarmConnection } from 'hyperswarm';

import { createHyperswarmTransport } from '../../services/mediators/hyperswarm/src/hyperswarm-transport.ts';
import {
    createConnectionInfo,
    type ConnectionInfo,
} from '../../services/mediators/hyperswarm/src/mediator-state.ts';
import type {
    HyperMessage,
    PingMessage,
    QueueMessage,
    SyncMessage,
} from '../../services/mediators/hyperswarm/src/protocol-messages.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import {
    decodeFramedMessages,
    encodeFramedMessage,
} from '../../services/mediators/hyperswarm/src/transport-framing.ts';

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
    readonly pendingFlushes: Array<{
        resolve(value: boolean): void;
        reject(error: Error): void;
    }> = [];
    destroyed = false;
    pauseCalls = 0;
    resumeCalls = 0;
    autoCompleteWrites = true;
    writable = true;

    constructor(peerByte = 0x22) {
        super();
        this.remotePublicKey = Buffer.alloc(32, peerByte);
    }

    write(data: Uint8Array): boolean {
        this.writes.push(Buffer.from(data));
        return this.writable;
    }

    flush(): Promise<boolean> {
        if (this.autoCompleteWrites) {
            return Promise.resolve(true);
        }
        return new Promise<boolean>((resolve, reject) => {
            this.pendingFlushes.push({ resolve, reject });
        });
    }

    completeNextFlush(error?: Error | null): void {
        const flush = this.pendingFlushes.shift();
        if (error) {
            flush?.reject(error);
        }
        else {
            flush?.resolve(true);
        }
    }

    pause(): void {
        this.pauseCalls += 1;
    }

    resume(): void {
        this.resumeCalls += 1;
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

type TransportOptions = Parameters<typeof createHyperswarmTransport>[0];

function createTransport(overrides: {
    buildInitialPing?: () => Promise<PingMessage>;
    now?: () => number;
    onPing?: jest.Mock<(peerKey: string, message: PingMessage, connection: ConnectionInfo) => void | Promise<void>>;
    onQueue?: jest.Mock<(peerKey: string, message: QueueMessage, connection: ConnectionInfo) => void | Promise<void>>;
    onSyncMessage?: jest.Mock<(peerKey: string, message: SyncMessage, connection: ConnectionInfo) => void | Promise<void>>;
} & Partial<Pick<
    TransportOptions,
    | 'frameAssemblyTimeoutMs'
    | 'maxConnections'
    | 'maxInboundBytesPerConnection'
    | 'maxInboundBytesTotal'
    | 'maxMessageBytes'
    | 'maxOutboundBytesPerConnection'
    | 'maxOutboundBytesTotal'
    | 'writeTimeoutMs'
>> = {}) {
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
        frameAssemblyTimeoutMs: overrides.frameAssemblyTimeoutMs,
        maxConnections: overrides.maxConnections,
        maxInboundBytesPerConnection: overrides.maxInboundBytesPerConnection,
        maxInboundBytesTotal: overrides.maxInboundBytesTotal,
        maxMessageBytes: overrides.maxMessageBytes,
        maxOutboundBytesPerConnection: overrides.maxOutboundBytesPerConnection,
        maxOutboundBytesTotal: overrides.maxOutboundBytesTotal,
        writeTimeoutMs: overrides.writeTimeoutMs,
        buildInitialPing: overrides.buildInitialPing ?? (async () => ping({ node: 'local' })),
        onPing,
        onQueue,
        onSyncMessage,
        onDisconnected,
    });
    return { transport, syncStats, onPing, onQueue, onSyncMessage, onDisconnected };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return { promise, resolve };
}

function nextTurn(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

function decodeWrite(write: Buffer): HyperMessage {
    const decoded = decodeFramedMessages(write);
    expect(decoded.error).toBeUndefined();
    expect(decoded.messages).toHaveLength(1);
    return JSON.parse(decoded.messages[0].toString('utf8')) as HyperMessage;
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
        const onPing = jest.fn<(peerKey: string, message: PingMessage, connection: ConnectionInfo) => void>();
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
        await nextTurn();
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

describe('hyperswarm transport resource bounds', () => {
    const queueMessage = (node: string): QueueMessage => ({
        type: 'queue',
        time: '',
        node,
        relays: [],
        data: [],
    });

    it('caps unique connections while allowing a same-key replacement', async () => {
        const { transport } = createTransport({ maxConnections: 2 });
        const first = new FakeConnection(0x31);
        const second = new FakeConnection(0x32);
        transport.addConnection(first as unknown as HyperswarmConnection);
        transport.addConnection(second as unknown as HyperswarmConnection);
        await nextTurn();

        const excess = new FakeConnection(0x33);
        transport.addConnection(excess as unknown as HyperswarmConnection);
        expect(excess.destroyed).toBe(true);
        expect(transport.getAccounting().connections).toBe(2);

        const replacement = new FakeConnection(0x31);
        transport.addConnection(replacement as unknown as HyperswarmConnection);
        await nextTurn();
        expect(first.destroyed).toBe(true);
        expect(replacement.destroyed).toBe(false);
        expect(transport.getConnection(replacement.remotePublicKey.toString('hex'))?.connection)
            .toBe(replacement);
        expect(transport.getAccounting().connections).toBe(2);

        await transport.shutdown();
    });

    it('drains a replaced connection whose initial ping is still being built', async () => {
        const firstPing = deferred<PingMessage>();
        let builds = 0;
        const { transport } = createTransport({
            buildInitialPing: () => builds++ === 0
                ? firstPing.promise
                : Promise.resolve(ping({ node: 'replacement' })),
        });
        const first = new FakeConnection(0x40);
        const replacement = new FakeConnection(0x40);

        transport.addConnection(first as unknown as HyperswarmConnection);
        await nextTurn();
        transport.addConnection(replacement as unknown as HyperswarmConnection);
        await nextTurn();

        const excessReplacement = new FakeConnection(0x40);
        transport.addConnection(excessReplacement as unknown as HyperswarmConnection);
        expect(excessReplacement.destroyed).toBe(true);
        expect(transport.getConnection(replacement.remotePublicKey.toString('hex'))?.connection)
            .toBe(replacement);

        let stopped = false;
        const shutdown = transport.shutdown().then(() => { stopped = true; });
        await nextTurn();
        expect(stopped).toBe(false);

        firstPing.resolve(ping({ node: 'first' }));
        await shutdown;
        expect(stopped).toBe(true);
    });

    it('allows only one draining connection for a peer across later replacements', async () => {
        const firstPing = deferred<PingMessage>();
        let builds = 0;
        const { transport } = createTransport({
            buildInitialPing: () => builds++ === 0
                ? firstPing.promise
                : Promise.resolve(ping({ node: 'replacement' })),
        });
        const first = new FakeConnection(0x41);
        const replacement = new FakeConnection(0x41);

        transport.addConnection(first as unknown as HyperswarmConnection);
        await nextTurn();
        transport.addConnection(replacement as unknown as HyperswarmConnection);
        await nextTurn();
        replacement.destroy();
        await nextTurn();

        const reconnect = new FakeConnection(0x41);
        transport.addConnection(reconnect as unknown as HyperswarmConnection);
        expect(reconnect.destroyed).toBe(true);
        expect(transport.getConnection(reconnect.remotePublicKey.toString('hex'))).toBeUndefined();

        firstPing.resolve(ping({ node: 'first' }));
        await transport.shutdown();
    });

    it('bounds connections still draining after they leave the active set', async () => {
        const pendingPing = deferred<PingMessage>();
        const { transport } = createTransport({
            buildInitialPing: () => pendingPing.promise,
            maxConnections: 1,
        });
        const first = new FakeConnection(0x42);
        const second = new FakeConnection(0x43);
        const excess = new FakeConnection(0x44);

        transport.addConnection(first as unknown as HyperswarmConnection);
        transport.terminatePeer(first.remotePublicKey.toString('hex'), 'test');
        transport.addConnection(second as unknown as HyperswarmConnection);
        transport.terminatePeer(second.remotePublicKey.toString('hex'), 'test');
        transport.addConnection(excess as unknown as HyperswarmConnection);

        expect(excess.destroyed).toBe(true);
        expect(transport.getAccounting().connections).toBe(0);
        pendingPing.resolve(ping());
        await transport.shutdown();
    });

    it('accounts synchronous inbound chunks before asynchronous processing', async () => {
        const { transport, syncStats } = createTransport({
            maxInboundBytesPerConnection: 8,
            maxInboundBytesTotal: 8,
        });
        const connection = new FakeConnection(0x34);
        const peerKey = connection.remotePublicKey.toString('hex');
        transport.addConnection(connection as unknown as HyperswarmConnection);
        await nextTurn();

        const header = Buffer.alloc(4);
        header.writeUInt32BE(100);
        connection.emit('data', header);
        connection.emit('data', Buffer.alloc(5));
        await nextTurn();

        expect(connection.destroyed).toBe(true);
        expect(connection.pauseCalls).toBe(1);
        expect(transport.getConnection(peerKey)).toBeUndefined();
        expect(transport.getAccounting().inboundBytes).toBe(0);
        expect(syncStats.protocolViolationCooldowns).toBe(0);
    });

    it('applies the inbound budget across peers and releases it on shutdown', async () => {
        const { transport } = createTransport({
            maxInboundBytesPerConnection: 8,
            maxInboundBytesTotal: 7,
        });
        const first = new FakeConnection(0x35);
        const second = new FakeConnection(0x36);
        const firstKey = first.remotePublicKey.toString('hex');
        const secondKey = second.remotePublicKey.toString('hex');
        transport.setConnection(firstKey, createConnectionInfo({
            connection: first as unknown as HyperswarmConnection,
            peerName: 'first',
        }));
        transport.setConnection(secondKey, createConnectionInfo({
            connection: second as unknown as HyperswarmConnection,
            peerName: 'second',
        }));
        const partial = Buffer.alloc(4);
        partial.writeUInt32BE(100);

        await transport.processInboundPeerData(firstKey, partial);
        await transport.processInboundPeerData(secondKey, partial);

        expect(first.destroyed).toBe(false);
        expect(second.destroyed).toBe(true);
        expect(transport.getAccounting().inboundBytes).toBe(4);
        await transport.shutdown();
        expect(transport.getAccounting().inboundBytes).toBe(0);
    });

    it('pauses while handling a frame and releases its bytes before resuming', async () => {
        const blocked = deferred<void>();
        const onPing = jest.fn(async () => blocked.promise);
        const { transport } = createTransport({ onPing });
        const connection = new FakeConnection(0x37);
        const peerKey = connection.remotePublicKey.toString('hex');
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));
        const framed = encodeFramedMessage(JSON.stringify(ping()));

        const processing = transport.processInboundPeerData(peerKey, framed);
        await nextTurn();
        expect(connection.pauseCalls).toBe(1);
        expect(connection.resumeCalls).toBe(0);
        expect(transport.getAccounting().inboundBytes).toBe(framed.length);

        blocked.resolve();
        await processing;
        expect(transport.getAccounting().inboundBytes).toBe(0);
        expect(connection.resumeCalls).toBe(1);
        await transport.shutdown();
    });

    it('retains a coalesced input buffer until every decoded message settles', async () => {
        const secondBlocked = deferred<void>();
        const onQueue = jest.fn(async () => secondBlocked.promise);
        const { transport, onPing } = createTransport({ onQueue });
        const connection = new FakeConnection(0x3e);
        const peerKey = connection.remotePublicKey.toString('hex');
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));
        const first = encodeFramedMessage(JSON.stringify(ping({ node: 'first' })));
        const second = encodeFramedMessage(JSON.stringify(queueMessage('second')));
        const input = Buffer.concat([first, second]);

        const processing = transport.processInboundPeerData(peerKey, input);
        await nextTurn();

        expect(onPing).toHaveBeenCalledTimes(1);
        expect(onQueue).toHaveBeenCalledTimes(1);
        expect(transport.getAccounting().inboundBytes).toBe(input.length);

        secondBlocked.resolve();
        await processing;
        expect(transport.getAccounting().inboundBytes).toBe(0);
        await transport.shutdown();
    });

    it('closes a partial frame after the absolute assembly deadline', async () => {
        jest.useFakeTimers();
        try {
            const { transport, syncStats } = createTransport({ frameAssemblyTimeoutMs: 10 });
            const connection = new FakeConnection(0x38);
            const peerKey = connection.remotePublicKey.toString('hex');
            transport.setConnection(peerKey, createConnectionInfo({
                connection: connection as unknown as HyperswarmConnection,
                peerName: 'peer',
            }));
            const partial = Buffer.alloc(4);
            partial.writeUInt32BE(100);

            await transport.processInboundPeerData(peerKey, partial);
            expect(transport.getAccounting().inboundBytes).toBe(4);
            await jest.advanceTimersByTimeAsync(10);

            expect(connection.destroyed).toBe(true);
            expect(transport.getAccounting().inboundBytes).toBe(0);
            expect(syncStats.protocolViolationCooldowns).toBe(0);
        }
        finally {
            jest.useRealTimers();
        }
    });

    it('serializes writes and preserves admission order', async () => {
        const { transport } = createTransport();
        const connection = new FakeConnection(0x39);
        connection.autoCompleteWrites = false;
        const peerKey = connection.remotePublicKey.toString('hex');
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));

        const first = transport.sendBulkToPeer(peerKey, queueMessage('first'));
        const second = transport.sendBulkToPeer(peerKey, queueMessage('second'));
        expect(connection.writes).toHaveLength(1);
        expect(transport.getAccounting().outboundBytes).toBeGreaterThan(0);

        connection.completeNextFlush();
        await nextTurn();
        expect(connection.writes).toHaveLength(2);
        expect(decodeWrite(connection.writes[0]).node).toBe('first');
        expect(decodeWrite(connection.writes[1]).node).toBe('second');

        connection.completeNextFlush();
        await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
        expect(transport.getAccounting().outboundBytes).toBe(0);
        await transport.shutdown();
    });

    it('retains an outbound reservation until the Hyperswarm stream flushes', async () => {
        const { transport } = createTransport();
        const connection = new FakeConnection(0x3a);
        connection.autoCompleteWrites = false;
        const peerKey = connection.remotePublicKey.toString('hex');
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));

        let settled = false;
        const sent = transport.sendBulkToPeer(peerKey, queueMessage('blocked'))
            .then(value => {
                settled = true;
                return value;
            });
        await nextTurn();
        expect(settled).toBe(false);
        expect(transport.getAccounting().outboundBytes).toBeGreaterThan(0);

        connection.completeNextFlush();
        await expect(sent).resolves.toBe(true);
        expect(transport.getAccounting().outboundBytes).toBe(0);
        await transport.shutdown();
    });

    it('falls back to drain for compatible streams without flush', async () => {
        const { transport } = createTransport();
        const connection = new FakeConnection(0x4c);
        connection.flush = undefined as unknown as typeof connection.flush;
        connection.writable = false;
        const peerKey = connection.remotePublicKey.toString('hex');
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));

        let settled = false;
        const sent = transport.sendBulkToPeer(peerKey, queueMessage('blocked'))
            .then(value => {
                settled = true;
                return value;
            });
        await nextTurn();
        expect(settled).toBe(false);

        connection.emit('drain');
        await expect(sent).resolves.toBe(true);
        await transport.shutdown();
    });

    it('terminates a connection whose Hyperswarm flush fails', async () => {
        const { transport } = createTransport();
        const connection = new FakeConnection(0x4d);
        connection.flush = async () => false;
        const peerKey = connection.remotePublicKey.toString('hex');
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));

        await expect(transport.sendBulkToPeer(peerKey, queueMessage('failed'))).resolves.toBe(false);
        expect(connection.destroyed).toBe(true);
        expect(transport.getAccounting().outboundBytes).toBe(0);
    });

    it('terminates a stalled writer and releases queued bytes', async () => {
        jest.useFakeTimers();
        try {
            const { transport, syncStats } = createTransport({ writeTimeoutMs: 10 });
            const connection = new FakeConnection(0x3b);
            connection.autoCompleteWrites = false;
            const peerKey = connection.remotePublicKey.toString('hex');
            transport.setConnection(peerKey, createConnectionInfo({
                connection: connection as unknown as HyperswarmConnection,
                peerName: 'peer',
            }));

            const sent = transport.sendBulkToPeer(peerKey, queueMessage('stalled'));
            await jest.advanceTimersByTimeAsync(10);

            await expect(sent).resolves.toBe(false);
            expect(connection.destroyed).toBe(true);
            expect(transport.getAccounting().outboundBytes).toBe(0);
            expect(syncStats.protocolViolationCooldowns).toBe(0);
            connection.completeNextFlush();
            await Promise.resolve();
            expect(transport.getAccounting().outboundBytes).toBe(0);
        }
        finally {
            jest.useRealTimers();
        }
    });

    it('does not allow application messages to overtake the initial ping', async () => {
        const { transport } = createTransport();
        const connection = new FakeConnection(0x3c);
        connection.autoCompleteWrites = false;
        const peerKey = connection.remotePublicKey.toString('hex');
        transport.addConnection(connection as unknown as HyperswarmConnection);
        await nextTurn();

        expect(connection.writes).toHaveLength(1);
        expect(transport.sendToPeer(peerKey, queueMessage('too-early'))).toBe(false);
        connection.completeNextFlush();
        await transport.getConnection(peerKey)?.initialPingPromise;

        const sent = transport.sendBulkToPeer(peerKey, queueMessage('after-ping'));
        expect(connection.writes).toHaveLength(2);
        expect(decodeWrite(connection.writes[0]).type).toBe('ping');
        expect(decodeWrite(connection.writes[1]).type).toBe('queue');
        connection.completeNextFlush();
        await expect(sent).resolves.toBe(true);
        await transport.shutdown();
    });

    it('does not allow another ping to overtake an initial ping still being built', async () => {
        const initialPing = deferred<PingMessage>();
        const { transport } = createTransport({ buildInitialPing: () => initialPing.promise });
        const connection = new FakeConnection(0x4b);
        const peerKey = connection.remotePublicKey.toString('hex');
        transport.addConnection(connection as unknown as HyperswarmConnection);

        expect(transport.sendToPeer(peerKey, ping({ node: 'periodic' }))).toBe(false);
        expect(connection.writes).toHaveLength(0);

        initialPing.resolve(ping({ node: 'initial' }));
        await transport.getConnection(peerKey)?.initialPingPromise;
        expect(connection.writes).toHaveLength(1);
        expect(decodeWrite(connection.writes[0])).toMatchObject({ type: 'ping', node: 'initial' });
        await transport.shutdown();
    });

    it('closes a connection when its initial ping cannot be admitted', async () => {
        const { transport } = createTransport({ maxOutboundBytesTotal: 1 });
        const connection = new FakeConnection(0x3f);
        const peerKey = connection.remotePublicKey.toString('hex');

        transport.addConnection(connection as unknown as HyperswarmConnection);
        await nextTurn();

        expect(connection.writes).toHaveLength(0);
        expect(connection.destroyed).toBe(true);
        expect(transport.getConnection(peerKey)).toBeUndefined();
        expect(transport.getAccounting().connections).toBe(0);
        await transport.shutdown();
    });

    it('waits for an active inbound handler while shutdown rejects writers', async () => {
        const blocked = deferred<void>();
        const onPing = jest.fn(async () => blocked.promise);
        const { transport } = createTransport({ onPing });
        const connection = new FakeConnection(0x3d);
        connection.autoCompleteWrites = false;
        const peerKey = connection.remotePublicKey.toString('hex');
        transport.setConnection(peerKey, createConnectionInfo({
            connection: connection as unknown as HyperswarmConnection,
            peerName: 'peer',
        }));
        const inbound = transport.processInboundPeerData(
            peerKey,
            encodeFramedMessage(JSON.stringify(ping())),
        );
        await nextTurn();
        const outbound = transport.sendBulkToPeer(peerKey, queueMessage('queued'));

        let stopped = false;
        const shutdown = transport.shutdown().then(() => { stopped = true; });
        await nextTurn();
        expect(stopped).toBe(false);
        await expect(outbound).resolves.toBe(false);

        blocked.resolve();
        await inbound;
        await shutdown;
        expect(transport.getAccounting()).toEqual({ inboundBytes: 0, outboundBytes: 0, connections: 0 });
    });
});
