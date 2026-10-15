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
} from './transport-framing.js';
import { createPeerAdmissionPolicy } from './peer-admission.js';
import {
    validateHyperMessageEnvelope,
    validateHyperMessagePayload,
    type ProtocolPayloadLimits,
} from './protocol-validation.js';

const log = childLogger({ service: 'hyperswarm-transport' });
const DEFAULT_PING_INTERVAL_MS = 10 * 1_000;

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
}

function shortName(peerKey: string): string {
    return peerKey.slice(0, 4) + '-' + peerKey.slice(-4);
}

export function createHyperswarmTransport(options: HyperswarmTransportOptions) {
    const connections: Record<string, ConnectionInfo> = {};
    const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_FRAMED_MESSAGE_BYTES;
    const now = options.now ?? (() => Date.now());
    const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    const staleConnectionMs = options.staleConnectionMs ?? 3 * 60 * 1000;
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
        connection.inboundBuffer = Buffer.alloc(0);
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

    function writeFramedJson(connection: HyperswarmConnection, json: string): void {
        const framed = encodeFramedMessage(json, maxMessageBytes);
        options.syncStats.bytesSent += framed.length;
        connection.write(framed);
    }

    function send(
        peerKey: string,
        message: HyperMessage,
        expectedConnection?: ConnectionInfo,
    ): boolean {
        const connection = connections[peerKey];
        if (!connection
            || (expectedConnection && connection !== expectedConnection)
            || connection.terminationStarted
            || (message.type !== 'ping' && !connection.initialPingSent)) {
            return false;
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
            writeFramedJson(connection.connection, JSON.stringify(message));
            return true;
        } catch (error) {
            log.error({ error, peer: shortName(peerKey), type: message.type }, 'failed to send hyperswarm message');
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
        if (send(peerKey, ping, connection)) {
            connection.initialPingSent = true;
            log.debug(`* sent ping to: ${shortName(peerKey)}`);
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

    async function processInboundPeerData(
        peerKey: string,
        chunk: Buffer | string,
        expectedConnection?: ConnectionInfo,
    ): Promise<void> {
        const connection = connections[peerKey];
        if (!connection
            || (expectedConnection && connection !== expectedConnection)
            || connection.terminationStarted) {
            return;
        }

        const incoming = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
        options.syncStats.bytesReceived += incoming.length;

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
                return;
            }

            connection.inboundBuffer = parsed.remaining;
            for (const message of parsed.messages) {
                await receiveJson(peerKey, message, connection);
                if (connections[peerKey] !== connection || connection.terminationStarted) {
                    return;
                }
            }
        }
    }

    function queueInboundPeerData(peerKey: string, chunk: Buffer | string, connection: ConnectionInfo): void {
        if (connections[peerKey] !== connection || connection.terminationStarted) {
            return;
        }

        connection.inboundReceiveChain = connection.inboundReceiveChain
            .then(() => processInboundPeerData(peerKey, chunk, connection))
            .catch(error => {
                log.error({ error, peer: shortName(peerKey) }, 'inbound hyperswarm message processing failed');
                terminatePeer(peerKey, 'inbound_processing_failed', connection);
            });
    }

    function addConnection(connection: HyperswarmConnection): void {
        const peerKey = b4a.toString(connection.remotePublicKey, 'hex');
        const peerName = shortName(peerKey);
        if (rejectRestrictedPeer(peerKey, connection)) {
            return;
        }

        const previous = connections[peerKey];
        if (previous) {
            terminatePeer(peerKey, 'connection_replaced', previous);
        }

        const state = createConnectionInfo({
            connection,
            peerName,
            requireInitialPing: true,
        });
        connections[peerKey] = state;

        connection.once('close', () => closePeer(peerKey, 'connection_closed', state));
        connection.once('error', error => {
            if (connections[peerKey] !== state) {
                return;
            }
            log.warn({ error, peer: peerName }, 'hyperswarm peer connection error');
            terminatePeer(peerKey, 'connection_error', state);
        });
        connection.on('data', data => queueInboundPeerData(peerKey, data, state));

        state.initialPingPromise = sendInitialPing(peerKey, state).catch(error => {
            log.error({ error, peer: peerName }, 'failed to build initial hyperswarm ping');
            terminatePeer(peerKey, 'initial_ping_failed', state);
        });
        log.info(`received connection from: ${peerName}`);
    }

    async function relay(message: HyperMessage): Promise<void> {
        for (const peerKey of Object.keys(connections)) {
            if (!message.relays.includes(peerKey)) {
                send(peerKey, message);
            }
        }
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
        processInboundPeerData,
        receiveMessage(peerKey: string, message: unknown): Promise<void> {
            return routeMessage(peerKey, message);
        },
        relay,
        reset(): void {
            for (const peerKey of Object.keys(connections)) {
                delete connections[peerKey];
            }
            admission.reset();
        },
        sendInitialPing,
        sendToPeer(peerKey: string, message: HyperMessage): boolean {
            return send(peerKey, message);
        },
        setConnection(peerKey: string, connection: ConnectionInfo): void {
            connections[peerKey] = connection;
        },
        getAdmissionCounts: admission.counts,
        reportProtocolViolation,
        terminatePeer,
        waitForInitialPing,
    };
}
