import type { HyperswarmConnection } from 'hyperswarm';
import b4a from 'b4a';

import { childLogger } from '@mdip/common/logger';
import {
    createConnectionInfo,
    type ConnectionInfo,
} from './mediator-state.js';
import {
    isHyperMessage,
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
    decodeLegacyJsonMessages,
    encodeFramedMessage,
} from './transport-framing.js';

const log = childLogger({ service: 'hyperswarm-transport' });
const MALFORMED_PEER_STRIKE_WINDOW_MS = 5 * 60 * 1000;
const MALFORMED_PEER_COOLDOWN_MS = 5 * 60 * 1000;
const MALFORMED_PEER_REJECT_LOG_INTERVAL_MS = 60 * 1000;
const MALFORMED_PEER_MAX_STRIKES = 3;

interface MalformedPeerState {
    strikes: number;
    firstSeenAt: number;
    lastSeenAt: number;
    cooldownUntil: number;
    lastReason: string;
    rejectedConnections: number;
    lastRejectLogAt: number;
}

export interface HyperswarmTransportOptions {
    framingVersion: number;
    syncStats: MediatorSyncStats;
    buildInitialPing(): Promise<PingMessage>;
    onPing(peerKey: string, message: PingMessage, connection: ConnectionInfo): void | Promise<void>;
    onQueue(peerKey: string, message: QueueMessage, connection: ConnectionInfo): void | Promise<void>;
    onSyncMessage(peerKey: string, message: SyncMessage, connection: ConnectionInfo): void | Promise<void>;
    onDisconnected(peerKey: string, reason: string): void;
    onQuarantined(peerKey: string, reason: string, connection: ConnectionInfo): void;
    maxMessageBytes?: number;
    staleConnectionMs?: number;
}

function shortName(peerKey: string): string {
    return peerKey.slice(0, 4) + '-' + peerKey.slice(-4);
}

export function createHyperswarmTransport(options: HyperswarmTransportOptions) {
    const connections: Record<string, ConnectionInfo> = {};
    const malformedPeers: Record<string, MalformedPeerState> = {};
    const maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_FRAMED_MESSAGE_BYTES;
    const staleConnectionMs = options.staleConnectionMs ?? 3 * 60 * 1000;

    function getMalformedPeerCooldown(peerKey: string, nowMs = Date.now()): MalformedPeerState | null {
        const state = malformedPeers[peerKey];
        if (!state) {
            return null;
        }

        if (state.cooldownUntil <= nowMs) {
            if ((nowMs - state.lastSeenAt) > MALFORMED_PEER_STRIKE_WINDOW_MS) {
                delete malformedPeers[peerKey];
            }
            return null;
        }

        return state;
    }

    function noteMalformedPeer(peerKey: string, reason: string): void {
        const nowMs = Date.now();
        let state = malformedPeers[peerKey];
        if (!state || (nowMs - state.firstSeenAt) > MALFORMED_PEER_STRIKE_WINDOW_MS) {
            state = {
                strikes: 0,
                firstSeenAt: nowMs,
                lastSeenAt: nowMs,
                cooldownUntil: 0,
                lastReason: reason,
                rejectedConnections: 0,
                lastRejectLogAt: 0,
            };
            malformedPeers[peerKey] = state;
        }

        state.strikes += 1;
        state.lastSeenAt = nowMs;
        state.lastReason = reason;

        if (state.strikes >= MALFORMED_PEER_MAX_STRIKES && state.cooldownUntil <= nowMs) {
            state.cooldownUntil = nowMs + MALFORMED_PEER_COOLDOWN_MS;
            state.rejectedConnections = 0;
            state.lastRejectLogAt = 0;
            options.syncStats.malformedPeerCooldowns += 1;
            log.warn({
                peer: shortName(peerKey),
                reason,
                strikes: state.strikes,
                cooldownMs: MALFORMED_PEER_COOLDOWN_MS,
            }, 'peer entered malformed message cooldown');
        }
    }

    function rejectMalformedPeerIfCoolingDown(peerKey: string, connection: HyperswarmConnection): boolean {
        const state = getMalformedPeerCooldown(peerKey);
        if (!state) {
            return false;
        }

        const nowMs = Date.now();
        state.rejectedConnections += 1;
        options.syncStats.malformedPeerConnectionsRejected += 1;
        const logPayload = {
            peer: shortName(peerKey),
            lastReason: state.lastReason,
            strikes: state.strikes,
            rejectedConnections: state.rejectedConnections,
            remainingMs: state.cooldownUntil - nowMs,
        };
        if ((nowMs - state.lastRejectLogAt) >= MALFORMED_PEER_REJECT_LOG_INTERVAL_MS) {
            state.lastRejectLogAt = nowMs;
            log.warn(logPayload, 'rejecting hyperswarm peer during malformed message cooldown');
        } else {
            log.debug(logPayload, 'rejecting hyperswarm peer during malformed message cooldown');
        }

        try {
            connection.destroy?.();
        } catch (error) {
            log.warn({ error, peer: shortName(peerKey) }, 'failed to destroy rejected malformed peer connection');
        }
        return true;
    }

    function clearMalformedPeer(peerKey: string, reason: string): void {
        const state = malformedPeers[peerKey];
        if (!state) {
            return;
        }

        delete malformedPeers[peerKey];
        log.info({
            peer: shortName(peerKey),
            reason,
            strikes: state.strikes,
            rejectedConnections: state.rejectedConnections,
        }, 'cleared malformed peer cooldown state');
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
        if (!connection || (expectedConnection && connection !== expectedConnection)) {
            return;
        }

        notifyDisconnected(peerKey, reason);
        try {
            if (typeof connection.connection.destroy === 'function') {
                connection.connection.destroy();
            } else {
                closePeer(peerKey, reason, connection);
            }
        } catch (error) {
            log.warn({ error, peer: shortName(peerKey), reason }, 'failed to destroy peer connection');
            closePeer(peerKey, reason, connection);
        }
    }

    function quarantinePeer(
        peerKey: string,
        reason: string,
        expectedConnection: ConnectionInfo,
        details: Record<string, unknown> = {},
    ): void {
        const connection = connections[peerKey];
        if (!connection || connection !== expectedConnection || connection.legacyTransportQuarantined) {
            return;
        }

        connection.legacyTransportQuarantined = true;
        connection.inboundBuffer = Buffer.alloc(0);
        options.syncStats.legacyTransportConnectionsQuarantined += 1;
        try {
            options.onQuarantined(peerKey, reason, connection);
        } catch (error) {
            log.error({ error, peer: shortName(peerKey), reason }, 'peer quarantine callback failed');
        }
        log.warn({ peer: shortName(peerKey), ...details }, 'quarantined peer using an unsupported transport framing version');
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
            || connection.legacyTransportQuarantined
            || (message.type !== 'ping' && !connection.initialPingSent)) {
            return false;
        }

        try {
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
        if (!connection || (expectedConnection && connection !== expectedConnection)) {
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
            && connection.initialPingSent
            && !connection.legacyTransportQuarantined;
    }

    async function handlePing(peerKey: string, message: PingMessage, connection: ConnectionInfo): Promise<void> {
        const peerTransportFramingVersion = Number.isInteger(message.transportFramingVersion)
            ? Number(message.transportFramingVersion)
            : null;
        connection.peerTransportFramingVersion = peerTransportFramingVersion;
        if (peerTransportFramingVersion !== options.framingVersion) {
            quarantinePeer(
                peerKey,
                peerTransportFramingVersion === null
                    ? 'missing_transport_framing_version'
                    : 'unsupported_transport_framing_version',
                connection,
                {
                    peerTransportFramingVersion,
                    requiredTransportFramingVersion: options.framingVersion,
                },
            );
            return;
        }

        clearMalformedPeer(peerKey, 'valid_ping');
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
            || connection.legacyTransportQuarantined) {
            return;
        }

        if (!isHyperMessage(value)) {
            const messageType = value && typeof value === 'object' && 'type' in value
                ? (value as { type?: unknown }).type
                : undefined;
            log.warn(`unknown message type: ${String(messageType)}`);
            return;
        }

        const message = value;
        connection.lastSeen = Date.now();
        log.debug(`received ${message.type} from: ${shortName(peerKey)} (${typeof message.node === 'string' ? message.node : 'anon'})`);

        if (message.type === 'ping') {
            await handlePing(peerKey, message, connection);
            return;
        }

        if (connection.peerTransportFramingVersion !== options.framingVersion) {
            quarantinePeer(peerKey, 'missing_transport_framing_version', connection, {
                messageType: message.type,
                requiredTransportFramingVersion: options.framingVersion,
            });
            return;
        }
        if (!await waitForInitialPing(peerKey, connection)) {
            return;
        }

        if (message.type === 'queue') {
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
            || connection.legacyTransportQuarantined) {
            return;
        }

        const json = typeof payload === 'string' ? payload : payload.toString('utf8');
        let value: unknown;
        try {
            value = JSON.parse(json);
        } catch {
            const jsonPreview = json.length > 80 ? `${json.slice(0, 40)}...${json.slice(-40)}` : json;
            log.warn({ peer: connection.peerName, jsonPreview }, 'received invalid hyperswarm JSON message');
            noteMalformedPeer(peerKey, 'invalid_hyperswarm_json_message');
            terminatePeer(peerKey, 'invalid_hyperswarm_json_message', connection);
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
        if (!connection || (expectedConnection && connection !== expectedConnection)) {
            return;
        }

        const incoming = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
        options.syncStats.bytesReceived += incoming.length;
        if (connection.legacyTransportQuarantined) {
            connection.lastSeen = Date.now();
            return;
        }

        connection.inboundBuffer = connection.inboundBuffer.length === 0
            ? incoming
            : Buffer.concat([connection.inboundBuffer, incoming]);

        while (connection.inboundBuffer.length > 0) {
            const parsed = decodeFramedMessages(connection.inboundBuffer, maxMessageBytes);
            if (parsed.error) {
                const legacy = decodeLegacyJsonMessages(connection.inboundBuffer, maxMessageBytes, 1);
                if (!legacy.error) {
                    if (legacy.messages.length === 0) {
                        connection.inboundBuffer = legacy.remaining;
                        return;
                    }

                    const message = legacy.messages[0];
                    try {
                        const legacyMessage = JSON.parse(message.toString('utf8')) as { type?: unknown };
                        if (typeof legacyMessage.type !== 'string') {
                            throw new Error('unframed message type must be a string');
                        }
                        if (connection.initialInboundMessageReceived) {
                            quarantinePeer(peerKey, 'legacy_unframed_transport', connection, {
                                messageType: legacyMessage.type,
                            });
                            return;
                        }
                        if (legacyMessage.type !== 'ping') {
                            throw new Error('initial unframed message must be a ping');
                        }
                    } catch (error) {
                        log.warn({ error, peer: shortName(peerKey) }, 'received invalid unframed initial hyperswarm ping');
                        noteMalformedPeer(peerKey, 'invalid_unframed_initial_ping');
                        terminatePeer(peerKey, 'invalid_unframed_initial_ping', connection);
                        return;
                    }

                    connection.initialInboundMessageReceived = true;
                    connection.inboundBuffer = legacy.remaining;
                    await receiveJson(peerKey, message, connection);
                    if (connections[peerKey] !== connection) {
                        return;
                    }
                    continue;
                }
            }

            if (parsed.error) {
                log.warn({
                    peer: shortName(peerKey),
                    pendingBytes: connection.inboundBuffer.length,
                    error: parsed.error,
                }, 'received malformed framed hyperswarm message');
                noteMalformedPeer(peerKey, 'malformed_framed_message');
                terminatePeer(peerKey, 'malformed_framed_message', connection);
                return;
            }

            if (parsed.messages.length === 0) {
                connection.inboundBuffer = parsed.remaining;
                return;
            }

            connection.initialInboundMessageReceived = true;
            connection.inboundBuffer = parsed.remaining;
            for (const message of parsed.messages) {
                await receiveJson(peerKey, message, connection);
                if (connections[peerKey] !== connection) {
                    return;
                }
            }
        }
    }

    function queueInboundPeerData(peerKey: string, chunk: Buffer | string, connection: ConnectionInfo): void {
        if (connections[peerKey] !== connection) {
            return;
        }

        if (connection.legacyTransportQuarantined) {
            const incoming = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
            options.syncStats.bytesReceived += incoming.length;
            connection.lastSeen = Date.now();
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
        if (rejectMalformedPeerIfCoolingDown(peerKey, connection)) {
            return;
        }

        const previous = connections[peerKey];
        if (previous) {
            terminatePeer(peerKey, 'connection_replaced', previous);
        }

        const state = createConnectionInfo({
            connection,
            peerKey,
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
            for (const peerKey of Object.keys(malformedPeers)) {
                delete malformedPeers[peerKey];
            }
        },
        sendInitialPing,
        sendToPeer(peerKey: string, message: HyperMessage): boolean {
            return send(peerKey, message);
        },
        setConnection(peerKey: string, connection: ConnectionInfo): void {
            connections[peerKey] = connection;
        },
        terminatePeer,
        waitForInitialPing,
    };
}
