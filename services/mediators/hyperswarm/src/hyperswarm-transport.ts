import type { HyperswarmConnection } from 'hyperswarm';
import b4a from 'b4a';

import { childLogger } from '@mdip/common/logger';
import {
    createConnectionInfo,
    type ConnectionInfo,
} from './mediator-state.js';
import {
    isSyncMessage,
    type HyperMessage,
    type PingMessage,
    type QueueMessage,
    type SyncMessage,
} from './protocol-messages.js';
import type { MediatorSyncStats } from './sync-stats.js';
import {
    DEFAULT_MAX_FRAMED_MESSAGE_BYTES,
    decodeFramedMessages,
    encodeFramedMessage,
    FRAME_HEADER_BYTES,
} from './transport-framing.js';
import { createPeerAdmissionPolicy } from './peer-admission.js';
import {
    validateHyperMessageEnvelope,
    validateHyperMessagePayload,
    type ProtocolPayloadLimits,
} from './protocol-validation.js';
import { MAX_APPLICATION_CONNECTIONS } from './protocol-limits.js';

const log = childLogger({ service: 'hyperswarm-transport' });
const DEFAULT_PING_INTERVAL_MS = 10 * 1_000;
const DEFAULT_IO_TIMEOUT_MS = 2 * 60 * 1_000;
const OPERATION_FRAME_OVERHEAD_BYTES = 64 * 1024;

interface InboundState {
    reservedBytes: number;
    queuedChunks: number;
    paused: boolean;
    partialFrameTimer: ReturnType<typeof setTimeout> | null;
}

interface PendingWrite {
    bytes: number;
    framed: Buffer;
    settled: boolean;
    resolve(): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout> | null;
}

interface WriterState {
    reservedBytes: number;
    active: PendingWrite | null;
    queue: PendingWrite[];
    closed: boolean;
}

interface TransportAccounting {
    inboundBytes: number;
    outboundBytes: number;
    connections: number;
}

export interface HyperswarmTransportOptions {
    framingVersion: number;
    requiredNegentropyVersion: number;
    payloadLimits: ProtocolPayloadLimits;
    syncStats: MediatorSyncStats;
    buildInitialPing(): Promise<PingMessage>;
    onPing(peerKey: string, message: PingMessage, connection: ConnectionInfo): void | Promise<void>;
    onQueue(peerKey: string, message: QueueMessage, connection: ConnectionInfo): void | Promise<void>;
    onSyncMessage(peerKey: string, message: SyncMessage, connection: ConnectionInfo): void | Promise<void>;
    onDisconnected(peerKey: string, reason: string): void;
    maxMessageBytes?: number;
    maxPeerStates?: number;
    now?: () => number;
    pingIntervalMs?: number;
    staleConnectionMs?: number;
    frameAssemblyTimeoutMs?: number;
    writeTimeoutMs?: number;
    maxConnections?: number;
    maxInboundBytesPerConnection?: number;
    maxInboundBytesTotal?: number;
    maxOutboundBytesPerConnection?: number;
    maxOutboundBytesTotal?: number;
}

function shortName(peerKey: string): string {
    return peerKey.slice(0, 4) + '-' + peerKey.slice(-4);
}

export function createHyperswarmTransport(options: HyperswarmTransportOptions) {
    const connections: Record<string, ConnectionInfo> = {};
    const trackedConnections = new Set<ConnectionInfo>();
    const drainingConnections = new Map<string, Set<ConnectionInfo>>();
    const inboundStates = new WeakMap<ConnectionInfo, InboundState>();
    const writerStates = new WeakMap<ConnectionInfo, WriterState>();
    const writerIdleWaiters = new Set<() => void>();
    const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_FRAMED_MESSAGE_BYTES;
    const maxEncodedFrameBytes = maxMessageBytes + FRAME_HEADER_BYTES;
    const maxEncodedOperationFrameBytes = Math.min(
        maxEncodedFrameBytes,
        options.payloadLimits.maxBytesPerPush + OPERATION_FRAME_OVERHEAD_BYTES + FRAME_HEADER_BYTES,
    );
    const now = options.now ?? (() => Date.now());
    const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    const staleConnectionMs = options.staleConnectionMs ?? 3 * 60 * 1000;
    const frameAssemblyTimeoutMs = options.frameAssemblyTimeoutMs ?? DEFAULT_IO_TIMEOUT_MS;
    const writeTimeoutMs = options.writeTimeoutMs ?? DEFAULT_IO_TIMEOUT_MS;
    const maxConnections = options.maxConnections ?? MAX_APPLICATION_CONNECTIONS;
    const maxInboundBytesPerConnection = options.maxInboundBytesPerConnection ?? maxEncodedFrameBytes;
    const maxInboundBytesTotal = options.maxInboundBytesTotal
        ?? maxEncodedFrameBytes + (2 * maxEncodedOperationFrameBytes);
    const maxOutboundBytesPerConnection = options.maxOutboundBytesPerConnection
        ?? maxEncodedFrameBytes + maxEncodedOperationFrameBytes;
    const maxOutboundBytesTotal = options.maxOutboundBytesTotal
        ?? maxEncodedFrameBytes + (2 * maxEncodedOperationFrameBytes);
    let totalInboundBytes = 0;
    let totalOutboundBytes = 0;
    let accepting = true;
    let shutdownPromise: Promise<void> | null = null;

    function assertPositiveSafeInteger(value: number, name: string): void {
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new Error(`${name} must be a positive safe integer`);
        }
    }

    assertPositiveSafeInteger(maxMessageBytes, 'maxMessageBytes');
    assertPositiveSafeInteger(frameAssemblyTimeoutMs, 'frameAssemblyTimeoutMs');
    assertPositiveSafeInteger(writeTimeoutMs, 'writeTimeoutMs');
    assertPositiveSafeInteger(maxConnections, 'maxConnections');
    assertPositiveSafeInteger(maxInboundBytesPerConnection, 'maxInboundBytesPerConnection');
    assertPositiveSafeInteger(maxInboundBytesTotal, 'maxInboundBytesTotal');
    assertPositiveSafeInteger(maxOutboundBytesPerConnection, 'maxOutboundBytesPerConnection');
    assertPositiveSafeInteger(maxOutboundBytesTotal, 'maxOutboundBytesTotal');
    if (!Number.isFinite(pingIntervalMs) || pingIntervalMs <= 0) {
        throw new Error('pingIntervalMs must be a positive finite number');
    }
    if (!Number.isFinite(staleConnectionMs) || staleConnectionMs <= 0) {
        throw new Error('staleConnectionMs must be a positive finite number');
    }
    const admission = createPeerAdmissionPolicy({
        now,
        maxEntries: options.maxPeerStates,
    });
    const maxTrackedConnections = Math.min(Number.MAX_SAFE_INTEGER, maxConnections * 2);

    function getInboundState(connection: ConnectionInfo): InboundState {
        let state = inboundStates.get(connection);
        if (!state) {
            state = {
                reservedBytes: 0,
                queuedChunks: 0,
                paused: false,
                partialFrameTimer: null,
            };
            inboundStates.set(connection, state);
        }
        return state;
    }

    function getWriterState(connection: ConnectionInfo): WriterState {
        let state = writerStates.get(connection);
        if (!state) {
            state = {
                reservedBytes: 0,
                active: null,
                queue: [],
                closed: false,
            };
            writerStates.set(connection, state);
        }
        return state;
    }

    function rejectRestrictedPeer(peerKey: string, connection: HyperswarmConnection): boolean {
        const restriction = admission.noteRejectedConnection(peerKey);
        if (!restriction) {
            return false;
        }

        if (restriction.kind === 'punitive') {
            options.syncStats.protocolViolationConnectionsRejected += 1;
        } else {
            options.syncStats.compatibilityConnectionsRejected += 1;
        }
        const logPayload = {
            peer: shortName(peerKey),
            kind: restriction.kind,
            lastReason: restriction.reason,
            strikes: restriction.strikes,
            rejectedConnections: restriction.rejectedConnections,
            remainingMs: restriction.until - now(),
        };
        if (restriction.shouldWarn) {
            log.warn(logPayload, 'rejecting restricted hyperswarm peer');
        } else {
            log.debug(logPayload, 'rejecting restricted hyperswarm peer');
        }

        try {
            connection.destroy?.();
        } catch (error) {
            log.warn({ error, peer: shortName(peerKey) }, 'failed to destroy restricted peer connection');
        }
        return true;
    }

    function notifyDisconnected(peerKey: string, reason: string): void {
        try {
            options.onDisconnected(peerKey, reason);
        } catch (error) {
            log.error({ error, peer: shortName(peerKey), reason }, 'peer disconnect callback failed');
        }
    }

    function clearPartialFrameDeadline(connection: ConnectionInfo): void {
        const state = getInboundState(connection);
        if (state.partialFrameTimer) {
            clearTimeout(state.partialFrameTimer);
            state.partialFrameTimer = null;
        }
    }

    function releaseInboundBytes(connection: ConnectionInfo, bytes: number): void {
        if (bytes <= 0) {
            return;
        }
        const state = getInboundState(connection);
        const released = Math.min(bytes, state.reservedBytes);
        state.reservedBytes -= released;
        totalInboundBytes = Math.max(0, totalInboundBytes - released);
    }

    function releaseAllInbound(connection: ConnectionInfo): void {
        const state = getInboundState(connection);
        clearPartialFrameDeadline(connection);
        releaseInboundBytes(connection, state.reservedBytes);
        state.queuedChunks = 0;
        connection.inboundBuffer = Buffer.alloc(0);
    }

    function pauseConnection(connection: ConnectionInfo): void {
        const state = getInboundState(connection);
        if (state.paused) {
            return;
        }
        state.paused = true;
        try {
            connection.connection.pause?.();
        }
        catch (error) {
            log.warn({ error, peer: connection.peerName }, 'failed to pause hyperswarm peer');
        }
    }

    function resumeConnection(peerKey: string, connection: ConnectionInfo): void {
        const state = getInboundState(connection);
        if (!state.paused || state.queuedChunks !== 0 || !accepting
            || connections[peerKey] !== connection || connection.terminationStarted) {
            return;
        }
        state.paused = false;
        try {
            connection.connection.resume?.();
        }
        catch (error) {
            log.warn({ error, peer: connection.peerName }, 'failed to resume hyperswarm peer');
            terminatePeer(peerKey, 'inbound_resume_failed', connection);
        }
    }

    function releaseOutboundBytes(connection: ConnectionInfo, task: PendingWrite): void {
        if (task.bytes <= 0) {
            return;
        }
        const state = getWriterState(connection);
        const released = Math.min(task.bytes, state.reservedBytes);
        state.reservedBytes -= released;
        totalOutboundBytes = Math.max(0, totalOutboundBytes - released);
        task.bytes = 0;
        if (totalOutboundBytes === 0) {
            for (const resolve of writerIdleWaiters) {
                resolve();
            }
            writerIdleWaiters.clear();
        }
    }

    function waitForIdleWrites(): Promise<void> {
        return totalOutboundBytes === 0
            ? Promise.resolve()
            : new Promise(resolve => writerIdleWaiters.add(resolve));
    }

    function settleWrite(
        peerKey: string,
        connection: ConnectionInfo,
        task: PendingWrite,
        error?: Error,
    ): void {
        if (task.settled) {
            return;
        }
        task.settled = true;
        if (task.timer) {
            clearTimeout(task.timer);
            task.timer = null;
        }
        const state = getWriterState(connection);
        if (state.active === task) {
            state.active = null;
        } else {
            const index = state.queue.indexOf(task);
            if (index >= 0) {
                state.queue.splice(index, 1);
            }
        }
        releaseOutboundBytes(connection, task);
        if (error) {
            task.reject(error);
        } else {
            task.resolve();
        }
        processWriter(peerKey, connection);
    }

    function closeWriter(peerKey: string, connection: ConnectionInfo, reason: string): void {
        const state = getWriterState(connection);
        if (state.closed) {
            return;
        }
        state.closed = true;
        const error = new Error(`hyperswarm writer closed: ${reason}`);
        if (state.active) {
            settleWrite(peerKey, connection, state.active, error);
        }
        for (const task of [...state.queue]) {
            settleWrite(peerKey, connection, task, error);
        }
    }

    function cleanupConnection(peerKey: string, connection: ConnectionInfo, reason: string): void {
        releaseAllInbound(connection);
        closeWriter(peerKey, connection, reason);
        const draining = drainingConnections.get(peerKey) ?? new Set<ConnectionInfo>();
        draining.add(connection);
        drainingConnections.set(peerKey, draining);
        Promise.allSettled([
            connection.inboundReceiveChain,
            connection.initialPingPromise,
        ]).then(
            () => {
                trackedConnections.delete(connection);
                draining.delete(connection);
                if (draining.size === 0) {
                    drainingConnections.delete(peerKey);
                }
            },
        );
    }

    function destroyUnadmitted(connection: HyperswarmConnection, reason: string): void {
        try {
            connection.destroy?.();
        }
        catch (error) {
            log.warn({ error, reason }, 'failed to destroy unadmitted hyperswarm connection');
        }
    }

    function closePeer(
        peerKey: string,
        reason = 'connection_closed',
        expectedConnection?: ConnectionInfo,
    ): void {
        const connection = connections[peerKey];
        if (!connection || (expectedConnection && connection !== expectedConnection)) {
            return;
        }

        connection.terminationStarted = true;
        if (connections[peerKey] === connection) {
            delete connections[peerKey];
        }
        cleanupConnection(peerKey, connection, reason);
        notifyDisconnected(peerKey, reason);
        log.info(`* connection closed with: ${connection.peerName} (${connection.nodeName}) *`);
    }

    function terminatePeer(
        peerKey: string,
        reason: string,
        expectedConnection?: ConnectionInfo,
    ): void {
        const connection = connections[peerKey];
        if (!connection
            || (expectedConnection && connection !== expectedConnection)
            || connection.terminationStarted) {
            return;
        }

        connection.terminationStarted = true;
        if (connections[peerKey] === connection) {
            delete connections[peerKey];
        }
        cleanupConnection(peerKey, connection, reason);
        notifyDisconnected(peerKey, reason);
        try {
            if (typeof connection.connection.destroy === 'function') {
                connection.connection.destroy();
            } else {
                log.info(`* connection closed with: ${connection.peerName} (${connection.nodeName}) *`);
            }
        } catch (error) {
            log.warn({ error, peer: shortName(peerKey), reason }, 'failed to destroy peer connection');
        }
    }

    function reportProtocolViolation(
        peerKey: string,
        reason: string,
        expectedConnection: ConnectionInfo,
        details: Record<string, unknown> = {},
    ): void {
        const connection = connections[peerKey];
        if (!connection
            || connection !== expectedConnection
            || connection.protocolViolationReported
            || connection.terminationStarted) {
            return;
        }

        connection.protocolViolationReported = true;
        const restriction = admission.noteViolation(peerKey, reason);
        options.syncStats.protocolViolationCooldowns += 1;
        log.warn({
            peer: shortName(peerKey),
            reason,
            strikes: restriction.strikes,
            cooldownMs: restriction.until - now(),
            ...details,
        }, 'disconnecting peer after protocol violation');
        terminatePeer(peerKey, reason, connection);
    }

    function closeIncompatiblePeer(
        peerKey: string,
        reason: string,
        expectedConnection: ConnectionInfo,
        kind: 'transport_framing' | 'negentropy_version',
        details: Record<string, unknown> = {},
    ): void {
        const restriction = admission.noteCompatibilityMismatch(peerKey, reason);
        if (kind === 'transport_framing') {
            options.syncStats.transportFramingIncompatibilityClosures += 1;
        } else {
            options.syncStats.negentropyVersionIncompatibilityClosures += 1;
        }
        log.warn({
            peer: shortName(peerKey),
            reason,
            retryAfterMs: restriction.until - now(),
            ...details,
        }, 'disconnecting incompatible hyperswarm peer');
        terminatePeer(peerKey, reason, expectedConnection);
    }

    function writeTask(peerKey: string, connection: ConnectionInfo, task: PendingWrite): void {
        const complete = (): void => {
            if (task.settled) {
                return;
            }
            settleWrite(peerKey, connection, task);
        };
        const fail = (): void => {
            if (!task.settled) {
                terminatePeer(peerKey, 'outbound_write_failed', connection);
            }
        };

        task.timer = setTimeout(() => {
            terminatePeer(peerKey, 'outbound_write_timeout', connection);
        }, writeTimeoutMs);

        try {
            options.syncStats.bytesSent += task.framed.length;
            const writable = connection.connection.write(task.framed);
            if (connection.connection.flush) {
                Promise.resolve(connection.connection.flush()).then(
                    flushed => flushed === false ? fail() : complete(),
                    fail,
                );
            }
            else if (writable === false) {
                connection.connection.once('drain', () => {
                    complete();
                });
            }
            else {
                complete();
            }
        }
        catch {
            fail();
        }
    }

    function processWriter(peerKey: string, connection: ConnectionInfo): void {
        const state = getWriterState(connection);
        if (state.closed || state.active || state.queue.length === 0) {
            return;
        }
        if (!accepting || connections[peerKey] !== connection || connection.terminationStarted) {
            closeWriter(peerKey, connection, 'connection_unavailable');
            return;
        }
        const task = state.queue.shift()!;
        state.active = task;
        writeTask(peerKey, connection, task);
    }

    function enqueueWrite(
        peerKey: string,
        message: HyperMessage,
        expectedConnection?: ConnectionInfo,
        allowBeforeInitialPing = false,
    ): { accepted: false } | { accepted: true; completion: Promise<void> } {
        const connection = connections[peerKey];
        if (!accepting
            || !connection
            || (expectedConnection && connection !== expectedConnection)
            || connection.terminationStarted
            || (!allowBeforeInitialPing && !connection.initialPingSent)) {
            return { accepted: false };
        }

        try {
            const envelope = validateHyperMessageEnvelope(message);
            if (!envelope.ok) {
                throw new Error(envelope.reason);
            }
            const payload = validateHyperMessagePayload(message, options.payloadLimits);
            if (!payload.ok) {
                throw new Error(payload.reason);
            }
            const framed = encodeFramedMessage(JSON.stringify(message), maxMessageBytes);
            const state = getWriterState(connection);
            if (state.closed
                || state.reservedBytes + framed.length > maxOutboundBytesPerConnection
                || totalOutboundBytes + framed.length > maxOutboundBytesTotal) {
                return { accepted: false };
            }
            state.reservedBytes += framed.length;
            totalOutboundBytes += framed.length;

            let resolve!: () => void;
            let reject!: (error: Error) => void;
            const completion = new Promise<void>((res, rej) => {
                resolve = res;
                reject = rej;
            });
            state.queue.push({
                bytes: framed.length,
                framed,
                settled: false,
                resolve,
                reject,
                timer: null,
            });
            processWriter(peerKey, connection);
            return { accepted: true, completion };
        } catch (error) {
            log.error({ error, peer: shortName(peerKey), type: message.type }, 'failed to send hyperswarm message');
            return { accepted: false };
        }
    }

    function send(
        peerKey: string,
        message: HyperMessage,
        expectedConnection?: ConnectionInfo,
    ): boolean {
        const queued = enqueueWrite(peerKey, message, expectedConnection);
        if (!queued.accepted) {
            return false;
        }
        queued.completion.catch(error => {
            log.debug({ error, peer: shortName(peerKey), type: message.type }, 'hyperswarm control write failed');
        });
        return true;
    }

    async function sendAwaited(
        peerKey: string,
        message: HyperMessage,
        expectedConnection?: ConnectionInfo,
        allowBeforeInitialPing = false,
    ): Promise<boolean> {
        const queued = enqueueWrite(peerKey, message, expectedConnection, allowBeforeInitialPing);
        if (!queued.accepted) {
            return false;
        }
        try {
            await queued.completion;
            return true;
        }
        catch (error) {
            log.debug({ error, peer: shortName(peerKey), type: message.type }, 'hyperswarm bulk write failed');
            return false;
        }
    }

    async function sendInitialPing(peerKey: string, expectedConnection?: ConnectionInfo): Promise<void> {
        const ping = await options.buildInitialPing();
        const connection = connections[peerKey];
        if (!connection
            || (expectedConnection && connection !== expectedConnection)
            || connection.terminationStarted) {
            return;
        }
        if (await sendAwaited(peerKey, ping, connection, true)) {
            connection.initialPingSent = true;
            log.debug(`* sent ping to: ${shortName(peerKey)}`);
        } else {
            terminatePeer(peerKey, 'initial_ping_send_failed', connection);
        }
    }

    async function waitForInitialPing(peerKey: string, connection: ConnectionInfo): Promise<boolean> {
        await connection.initialPingPromise;
        return connections[peerKey] === connection
            && !connection.terminationStarted
            && connection.initialPingSent;
    }

    async function handlePing(peerKey: string, message: PingMessage, connection: ConnectionInfo): Promise<void> {
        const peerTransportFramingVersion = Number.isInteger(message.transportFramingVersion)
            ? Number(message.transportFramingVersion)
            : null;
        connection.peerTransportFramingVersion = peerTransportFramingVersion;
        if (peerTransportFramingVersion !== options.framingVersion) {
            closeIncompatiblePeer(
                peerKey,
                peerTransportFramingVersion === null
                    ? 'missing_transport_framing_version'
                    : 'unsupported_transport_framing_version',
                connection,
                'transport_framing',
                {
                    peerTransportFramingVersion,
                    requiredTransportFramingVersion: options.framingVersion,
                },
            );
            return;
        }

        const peerNegentropyVersion = Number.isInteger(message.capabilities?.negentropyVersion)
            ? Number(message.capabilities?.negentropyVersion)
            : null;
        if (message.capabilities?.negentropy !== true
            || peerNegentropyVersion !== options.requiredNegentropyVersion) {
            closeIncompatiblePeer(
                peerKey,
                peerNegentropyVersion === null
                    ? 'missing_negentropy_version'
                    : 'unsupported_negentropy_version',
                connection,
                'negentropy_version',
                {
                    peerNegentropyVersion,
                    requiredNegentropyVersion: options.requiredNegentropyVersion,
                },
            );
            return;
        }

        const receivedAt = now();
        connection.lastSeen = receivedAt;
        if (connection.initialPingReceived
            && (receivedAt - connection.lastProcessedPingAt) < pingIntervalMs) {
            return;
        }
        connection.initialPingReceived = true;
        connection.lastProcessedPingAt = receivedAt;
        connection.nodeName = typeof message.node === 'string' ? message.node : 'anon';
        await options.onPing(peerKey, message, connection);
    }

    async function routeMessage(
        peerKey: string,
        value: unknown,
        expectedConnection?: ConnectionInfo,
    ): Promise<void> {
        const connection = connections[peerKey];
        if (!connection
            || (expectedConnection && connection !== expectedConnection)
            || connection.terminationStarted) {
            return;
        }

        const envelope = validateHyperMessageEnvelope(value);
        if (!envelope.ok) {
            reportProtocolViolation(peerKey, 'invalid_message_envelope', connection, {
                validationError: envelope.reason,
            });
            return;
        }

        const message = envelope.value;
        connection.lastSeen = now();
        log.debug(`received ${message.type} from: ${shortName(peerKey)} (${typeof message.node === 'string' ? message.node : 'anon'})`);

        if (message.type === 'ping') {
            await handlePing(peerKey, message, connection);
            return;
        }

        if (!connection.initialPingReceived
            || connection.peerTransportFramingVersion !== options.framingVersion) {
            reportProtocolViolation(peerKey, 'message_before_compatible_ping', connection, {
                messageType: message.type,
                requiredTransportFramingVersion: options.framingVersion,
            });
            return;
        }
        if (!await waitForInitialPing(peerKey, connection)) {
            return;
        }

        if (message.type === 'queue') {
            const payload = validateHyperMessagePayload(message, options.payloadLimits);
            if (!payload.ok) {
                reportProtocolViolation(peerKey, 'invalid_queue_payload', connection, {
                    validationError: payload.reason,
                });
                return;
            }
            await options.onQueue(peerKey, message, connection);
        } else if (isSyncMessage(message)) {
            await options.onSyncMessage(peerKey, message, connection);
        }
    }

    async function receiveJson(
        peerKey: string,
        payload: Buffer | string,
        expectedConnection?: ConnectionInfo,
    ): Promise<void> {
        const connection = connections[peerKey];
        if (!connection
            || (expectedConnection && connection !== expectedConnection)
            || connection.terminationStarted) {
            return;
        }

        const json = typeof payload === 'string' ? payload : payload.toString('utf8');
        let value: unknown;
        try {
            value = JSON.parse(json);
        } catch {
            const jsonPreview = json.length > 80 ? `${json.slice(0, 40)}...${json.slice(-40)}` : json;
            log.warn({ peer: connection.peerName, jsonPreview }, 'received invalid hyperswarm JSON message');
            reportProtocolViolation(peerKey, 'invalid_hyperswarm_json_message', connection);
            return;
        }

        await routeMessage(peerKey, value, connection);
    }

    function armPartialFrameDeadline(peerKey: string, connection: ConnectionInfo): void {
        const state = getInboundState(connection);
        if (state.partialFrameTimer || connection.inboundBuffer.length === 0) {
            return;
        }
        state.partialFrameTimer = setTimeout(() => {
            state.partialFrameTimer = null;
            terminatePeer(peerKey, 'partial_frame_timeout', connection);
        }, frameAssemblyTimeoutMs);
    }

    async function processAdmittedPeerData(
        peerKey: string,
        incoming: Buffer,
        expectedConnection: ConnectionInfo,
    ): Promise<void> {
        const connection = connections[peerKey];
        if (!connection
            || connection !== expectedConnection
            || connection.terminationStarted) {
            return;
        }

        connection.inboundBuffer = connection.inboundBuffer.length === 0
            ? incoming
            : Buffer.concat([connection.inboundBuffer, incoming]);

        while (connection.inboundBuffer.length > 0) {
            const parsed = decodeFramedMessages(connection.inboundBuffer, maxMessageBytes);
            if (parsed.error) {
                log.warn({
                    peer: shortName(peerKey),
                    pendingBytes: connection.inboundBuffer.length,
                    error: parsed.error,
                }, 'received malformed framed hyperswarm message');
                reportProtocolViolation(peerKey, 'malformed_framed_message', connection, {
                    framingError: parsed.error,
                });
                return;
            }

            if (parsed.messages.length === 0) {
                connection.inboundBuffer = parsed.remaining;
                armPartialFrameDeadline(peerKey, connection);
                return;
            }

            clearPartialFrameDeadline(connection);
            connection.inboundBuffer = parsed.remaining;
            const decodedBytes = parsed.messages.reduce(
                (bytes, message) => bytes + FRAME_HEADER_BYTES + message.length,
                0,
            );
            try {
                for (const message of parsed.messages) {
                    await receiveJson(peerKey, message, connection);
                    if (connections[peerKey] !== connection || connection.terminationStarted) {
                        return;
                    }
                }
            }
            finally {
                // Decoded slices share the input buffer, so retain its accounting until the batch is done.
                releaseInboundBytes(connection, decodedBytes);
            }
        }
    }

    function queueInboundPeerData(
        peerKey: string,
        chunk: Buffer | string,
        connection: ConnectionInfo,
    ): Promise<void> {
        if (!accepting || connections[peerKey] !== connection || connection.terminationStarted) {
            return Promise.resolve();
        }

        const bytes = typeof chunk === 'string'
            ? Buffer.byteLength(chunk, 'utf8')
            : chunk.length;
        if (bytes === 0) {
            return connection.inboundReceiveChain;
        }
        const state = getInboundState(connection);
        if (state.reservedBytes + bytes > maxInboundBytesPerConnection
            || totalInboundBytes + bytes > maxInboundBytesTotal) {
            terminatePeer(peerKey, 'inbound_capacity_exceeded', connection);
            return Promise.resolve();
        }

        state.reservedBytes += bytes;
        totalInboundBytes += bytes;
        state.queuedChunks += 1;
        options.syncStats.bytesReceived += bytes;
        pauseConnection(connection);
        const incoming = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
        connection.inboundReceiveChain = connection.inboundReceiveChain
            .then(() => processAdmittedPeerData(peerKey, incoming, connection))
            .catch(error => {
                log.error({ error, peer: shortName(peerKey) }, 'inbound hyperswarm message processing failed');
                terminatePeer(peerKey, 'inbound_processing_failed', connection);
            })
            .finally(() => {
                const current = getInboundState(connection);
                current.queuedChunks = Math.max(0, current.queuedChunks - 1);
                resumeConnection(peerKey, connection);
            });
        return connection.inboundReceiveChain;
    }

    function addConnection(connection: HyperswarmConnection): void {
        const peerKey = b4a.toString(connection.remotePublicKey, 'hex');
        const peerName = shortName(peerKey);
        if (!accepting) {
            destroyUnadmitted(connection, 'transport_shutting_down');
            return;
        }
        if (rejectRestrictedPeer(peerKey, connection)) {
            return;
        }

        const previous = connections[peerKey];
        if (drainingConnections.has(peerKey)) {
            destroyUnadmitted(connection, 'connection_replacement_pending');
            return;
        }
        if (trackedConnections.size >= maxTrackedConnections) {
            destroyUnadmitted(connection, 'connection_drain_capacity');
            return;
        }
        if (!previous && Object.keys(connections).length >= maxConnections) {
            destroyUnadmitted(connection, 'connection_capacity');
            return;
        }
        if (previous) {
            terminatePeer(peerKey, 'connection_replaced', previous);
        }

        const state = createConnectionInfo({
            connection,
            peerName,
            requireInitialPing: true,
        });
        connections[peerKey] = state;
        trackedConnections.add(state);

        connection.once('close', () => closePeer(peerKey, 'connection_closed', state));
        connection.once('error', error => {
            if (connections[peerKey] !== state) {
                return;
            }
            log.warn({ error, peer: peerName }, 'hyperswarm peer connection error');
            terminatePeer(peerKey, 'connection_error', state);
        });
        connection.on('data', data => { void queueInboundPeerData(peerKey, data, state); });

        state.initialPingPromise = sendInitialPing(peerKey, state).catch(error => {
            log.error({ error, peer: peerName }, 'failed to build initial hyperswarm ping');
            terminatePeer(peerKey, 'initial_ping_failed', state);
        });
        log.info(`received connection from: ${peerName}`);
    }

    async function relay(message: HyperMessage): Promise<void> {
        const bulk = message.type === 'queue'
            || message.type === 'ordered_catchup_push'
            || message.type === 'ops_push';
        const pending: Promise<unknown>[] = [];
        for (const peerKey of Object.keys(connections)) {
            if (!message.relays.includes(peerKey)) {
                if (bulk) {
                    pending.push(sendAwaited(peerKey, message));
                } else {
                    send(peerKey, message);
                }
            }
        }
        await Promise.allSettled(pending);
    }

    function expireStaleConnections(now = Date.now()): void {
        for (const peerKey of Object.keys(connections)) {
            const connection = connections[peerKey];
            const timeSinceLastSeen = now - connection.lastSeen;
            if (timeSinceLastSeen > staleConnectionMs) {
                log.info(`Removing stale connection info for: ${connection.peerName} (${connection.nodeName}), last seen ${timeSinceLastSeen / 1000}s ago`);
                terminatePeer(peerKey, 'stale_connection', connection);
            }
        }
    }

    return {
        addConnection,
        closePeer,
        expireStaleConnections,
        getConnection(peerKey: string): ConnectionInfo | undefined {
            return connections[peerKey];
        },
        getPeerKeys(): string[] {
            return Object.keys(connections);
        },
        processInboundPeerData(peerKey: string, chunk: Buffer | string): Promise<void> {
            const connection = connections[peerKey];
            return connection
                ? queueInboundPeerData(peerKey, chunk, connection)
                : Promise.resolve();
        },
        receiveMessage(peerKey: string, message: unknown): Promise<void> {
            return routeMessage(peerKey, message);
        },
        relay,
        reset(): void {
            for (const peerKey of Object.keys(connections)) {
                const connection = connections[peerKey];
                delete connections[peerKey];
                connection.terminationStarted = true;
                cleanupConnection(peerKey, connection, 'transport_reset');
            }
            trackedConnections.clear();
            drainingConnections.clear();
            admission.reset();
        },
        sendInitialPing,
        sendToPeer(peerKey: string, message: HyperMessage): boolean {
            return send(peerKey, message);
        },
        sendBulkToPeer(peerKey: string, message: HyperMessage): Promise<boolean> {
            return sendAwaited(peerKey, message);
        },
        setConnection(peerKey: string, connection: ConnectionInfo): void {
            connections[peerKey] = connection;
            trackedConnections.add(connection);
        },
        stopAdmission(): void {
            accepting = false;
        },
        shutdown(): Promise<void> {
            if (!shutdownPromise) {
                accepting = false;
                const tracked = [...trackedConnections];
                for (const [peerKey, connection] of Object.entries(connections)) {
                    terminatePeer(peerKey, 'transport_shutdown', connection);
                }
                shutdownPromise = Promise.allSettled(tracked.flatMap(connection => [
                    connection.inboundReceiveChain,
                    connection.initialPingPromise,
                ])).then(() => undefined);
            }
            return shutdownPromise;
        },
        getAccounting(): TransportAccounting {
            return {
                inboundBytes: totalInboundBytes,
                outboundBytes: totalOutboundBytes,
                connections: Object.keys(connections).length,
            };
        },
        getAdmissionCounts: admission.counts,
        reportProtocolViolation,
        terminatePeer,
        waitForIdleWrites,
        waitForInitialPing,
    };
}
