import type { Operation } from '@mdip/gatekeeper/types';
import { childLogger } from '@mdip/common/logger';

import type { OperationSyncStore, SyncStoreOrderedCursor } from './db/types.js';
import type { BootstrapResult } from './bootstrap.js';
import type { ImportPipeline } from './import-pipeline.js';
import type { ConnectionInfo } from './mediator-state.js';
import { addAggregateSample } from './negentropy/observability.js';
import { chunkOperationsForPush } from './negentropy/transfer.js';
import { normalizeInboundOpsPushBatch } from './operation-order.js';
import {
    getOrderedCursorFromRow,
    isOrderedCursorAfter,
    parseOrderedCatchupCursor,
} from './ordered-catchup.js';
import type {
    HyperMessage,
    HyperMessageBase,
    OrderedCatchupDoneMessage,
    OrderedCatchupPushMessage,
    OrderedCatchupReqMessage,
} from './protocol-messages.js';
import type { MediatorSyncStats } from './sync-stats.js';

const log = childLogger({ service: 'hyperswarm-mediator' });
const PREFETCH_BATCHES = 2;
const SERVER_EXPECTATION_MS = 5 * 1_000;

type OrderedCatchupMessage =
    | OrderedCatchupReqMessage
    | OrderedCatchupPushMessage
    | OrderedCatchupDoneMessage;
type OrderedCatchupTerminalReason = 'ordered_catchup_complete' | 'ordered_catchup_done';
type OrderedCatchupMessageType = OrderedCatchupMessage['type'];

interface ClientSession {
    peerKey: string;
    sessionId: string;
    cursor: SyncStoreOrderedCursor | null;
    pendingImports: number;
    requestOutstanding: boolean;
    terminalReason: OrderedCatchupTerminalReason | null;
    importsAborted: boolean;
    startedAt: number;
    lastActivity: number;
}

interface ClientTransition {
    session: ClientSession;
    outcomeRecorded: boolean;
}

interface ServerSession {
    sessionId: string;
    lastActivity: number;
}

interface ServerExpectation {
    since: number;
    until: number;
    reason: string;
    gap: number;
}

export interface OrderedCatchupOutcome {
    peerKey: string;
    sessionId: string;
    reason: string;
    durationMs: number;
}

type CreateBaseMessage = <T extends OrderedCatchupMessageType>(
    type: T,
) => Omit<HyperMessageBase, 'type'> & { type: T };

export interface OrderedCatchupCoordinatorOptions {
    version: number;
    maxOpsPerPage: number;
    maxBytesPerPage: number;
    idleTimeoutMs: number;
    syncStore: OperationSyncStore;
    importPipeline: ImportPipeline;
    syncStats: MediatorSyncStats;
    getConnection(peerKey: string): ConnectionInfo | undefined;
    createSessionId(peerKey: string): string;
    createBaseMessage: CreateBaseMessage;
    sendToPeer(peerKey: string, message: HyperMessage): boolean;
    onIndexRefreshed(source: string, result: BootstrapResult): Promise<void>;
    onComplete(outcome: OrderedCatchupOutcome): boolean | Promise<boolean>;
    onHandoffDeferred(): void | Promise<void>;
    onFailure(outcome: OrderedCatchupOutcome): void | Promise<void>;
}

function shortName(peerKey: string): string {
    return peerKey.slice(0, 4) + '-' + peerKey.slice(-4);
}

export function createOrderedCatchupCoordinator(
    options: OrderedCatchupCoordinatorOptions,
) {
    const clients = new Map<string, ClientSession>();
    const servers = new Map<string, ServerSession>();
    const expectations = new Map<string, ServerExpectation>();
    const transitions = new Map<string, ClientTransition>();
    const activeWork = new Set<Promise<unknown>>();
    let accepting = true;
    let generation = 0;
    let shutdownPromise: Promise<void> | null = null;

    function trackWork<T>(task: Promise<T>): Promise<T> {
        activeWork.add(task);
        task.then(
            () => activeWork.delete(task),
            () => activeWork.delete(task),
        );
        return task;
    }

    function sendMessage(peerKey: string, message: HyperMessage): boolean {
        return accepting && options.sendToPeer(peerKey, message);
    }

    function touchClient(session: ClientSession): void {
        session.lastActivity = Date.now();
    }

    function clearExpectation(peerKey: string, reason: string): void {
        const expectation = expectations.get(peerKey);
        if (!expectation) {
            return;
        }
        expectations.delete(peerKey);
        log.debug({ peer: shortName(peerKey), ...expectation, clearReason: reason }, 'ordered catch-up server request expectation cleared');
    }

    function clearServer(peerKey: string, sessionId: string, reason: string): void {
        const server = servers.get(peerKey);
        if (!server || server.sessionId !== sessionId) {
            return;
        }
        servers.delete(peerKey);
        log.debug({ peer: shortName(peerKey), sessionId, reason }, 'ordered catch-up server state cleared');
    }

    function setServer(peerKey: string, sessionId: string): void {
        clearExpectation(peerKey, 'ordered_catchup_server_state_set');
        const previousSessionId = servers.get(peerKey)?.sessionId ?? null;
        servers.set(peerKey, { sessionId, lastActivity: Date.now() });
        if (previousSessionId !== sessionId) {
            log.debug({ peer: shortName(peerKey), previousSessionId, sessionId }, 'ordered catch-up server state set');
        }
    }

    function outcome(session: ClientSession, reason: string): OrderedCatchupOutcome {
        return {
            peerKey: session.peerKey,
            sessionId: session.sessionId,
            reason,
            durationMs: Date.now() - session.startedAt,
        };
    }

    async function reportFailure(session: ClientSession, reason: string): Promise<void> {
        const failure = outcome(session, reason);
        options.syncStats.orderedCatchupSessionsFailed += 1;
        addAggregateSample(options.syncStats.syncDurationMs, failure.durationMs);
        log.debug({ peer: shortName(session.peerKey), sessionId: session.sessionId, reason }, 'ordered catch-up client failed');
        try {
            await options.onFailure(failure);
        }
        catch (error) {
            log.error({ error, peer: shortName(session.peerKey), reason }, 'ordered catch-up failure callback failed');
        }
    }

    function failClient(peerKey: string, reason: string): void {
        const session = clients.get(peerKey);
        if (!session) {
            return;
        }
        clients.delete(peerKey);
        void trackWork(reportFailure(session, reason));
    }

    async function failTransition(transition: ClientTransition, reason: string): Promise<void> {
        if (transition.outcomeRecorded) {
            return;
        }
        transition.outcomeRecorded = true;
        await reportFailure(transition.session, reason);
    }

    function sendDone(peerKey: string, sessionId: string): boolean {
        const message: OrderedCatchupDoneMessage = {
            ...options.createBaseMessage('ordered_catchup_done'),
            sessionId,
        };
        const sent = sendMessage(peerKey, message);
        clearServer(peerKey, sessionId, sent ? 'ordered_catchup_done_sent' : 'send_ordered_catchup_done_failed');
        return sent;
    }

    function sendRequest(session: ClientSession): boolean {
        const message: OrderedCatchupReqMessage = {
            ...options.createBaseMessage('ordered_catchup_req'),
            sessionId: session.sessionId,
            cursor: session.cursor ?? undefined,
        };
        const sent = sendMessage(session.peerKey, message);
        if (sent) {
            session.requestOutstanding = true;
        }
        return sent;
    }

    function refillPrefetch(session: ClientSession): boolean {
        if (clients.get(session.peerKey) !== session
            || session.terminalReason
            || session.requestOutstanding
            || session.pendingImports > PREFETCH_BATCHES) {
            return true;
        }
        return sendRequest(session);
    }

    async function finishClient(session: ClientSession): Promise<void> {
        if (clients.get(session.peerKey) !== session || session.pendingImports > 0 || !session.terminalReason) {
            return;
        }

        clients.delete(session.peerKey);
        if (transitions.has(session.peerKey)) {
            return;
        }
        const transition: ClientTransition = { session, outcomeRecorded: false };
        transitions.set(session.peerKey, transition);
        let completed = false;
        let handoffStarted = false;
        try {
            await options.importPipeline.waitForIdle();
            if (!accepting || transitions.get(session.peerKey) !== transition) {
                return;
            }
            const source = 'ordered_catchup_complete';
            const sync = await options.importPipeline.refreshIndex(source);
            if (!accepting) {
                return;
            }
            await options.onIndexRefreshed(source, sync);
            if (!accepting || transitions.get(session.peerKey) !== transition) {
                return;
            }
            const completion = outcome(session, session.terminalReason);
            transition.outcomeRecorded = true;
            options.syncStats.orderedCatchupSessionsCompleted += 1;
            addAggregateSample(options.syncStats.syncDurationMs, completion.durationMs);
            completed = true;
            log.debug(completion, 'ordered catch-up handoff ready');
            handoffStarted = await options.onComplete(completion);
        }
        catch (error) {
            if (!completed && accepting) {
                await failTransition(transition, 'ordered_catchup_post_import_failed');
            }
            log.error({ error, peer: shortName(session.peerKey) }, 'ordered catch-up completion failed');
        }
        finally {
            if (!handoffStarted && transitions.get(session.peerKey) === transition) {
                transitions.delete(session.peerKey);
            }
        }
        if (completed && !handoffStarted && accepting) {
            try {
                await options.onHandoffDeferred();
            }
            catch (error) {
                log.error({ error, peer: shortName(session.peerKey) }, 'ordered catch-up follow-up scheduling failed');
            }
        }
    }

    function maybeFinishClient(session: ClientSession): void {
        if (clients.get(session.peerKey) !== session || session.pendingImports > 0 || !session.terminalReason) {
            return;
        }
        void trackWork(finishClient(session));
    }

    function settleImport(session: ClientSession, retryable: boolean): void {
        session.pendingImports = Math.max(0, session.pendingImports - 1);
        if (retryable) {
            session.importsAborted = true;
        }
        if (clients.get(session.peerKey) !== session) {
            return;
        }
        if (retryable) {
            failClient(session.peerKey, 'ordered_catchup_import_retryable');
            return;
        }
        touchClient(session);
        if (!refillPrefetch(session)) {
            failClient(session.peerKey, 'send_ordered_catchup_req_failed');
            return;
        }
        maybeFinishClient(session);
    }

    function queueImport(session: ClientSession, batch: Operation[]): void {
        session.pendingImports += 1;
        options.importPipeline.enqueue(
            {
                kind: 'remote',
                name: session.peerKey,
                data: batch,
                cancelled: () => session.importsAborted,
            },
            imported => {
                try {
                    settleImport(session, imported.retryable);
                }
                catch (error) {
                    log.error({ error, peer: shortName(session.peerKey), sessionId: session.sessionId }, 'ordered catch-up import completion failed');
                }
            },
        ).catch(error => {
            log.error({ error, peer: shortName(session.peerKey), sessionId: session.sessionId }, 'ordered catch-up import failed');
            settleImport(session, true);
        });
    }

    async function handleRequest(peerKey: string, message: OrderedCatchupReqMessage): Promise<void> {
        const requestGeneration = generation;
        const connection = options.getConnection(peerKey);
        if (!connection) {
            return;
        }
        clearExpectation(peerKey, 'ordered_catchup_req_received');
        if (connection.capabilities.orderedCatchup !== true
            || connection.capabilities.orderedCatchupVersion !== options.version) {
            log.warn({ peer: shortName(peerKey), sessionId: message.sessionId }, 'ignoring ordered catch-up request from unsupported peer');
            return;
        }

        const cursor = parseOrderedCatchupCursor(message.cursor);
        if (cursor === null) {
            log.warn({ peer: shortName(peerKey), sessionId: message.sessionId }, 'ignoring ordered catch-up request with invalid cursor');
            return;
        }

        const continuing = servers.get(peerKey)?.sessionId === message.sessionId;
        if (!continuing) {
            const status = await readLocalStatus();
            if (!accepting
                || generation !== requestGeneration
                || options.getConnection(peerKey) !== connection) {
                return;
            }
            if (!status.ready) {
                log.info({ peer: shortName(peerKey), sessionId: message.sessionId, ...status }, 'ordered catch-up requested but local store is not ready');
                sendDone(peerKey, message.sessionId);
                return;
            }
        }

        setServer(peerKey, message.sessionId);
        const rows = await options.syncStore.iterateOrdered({
            after: cursor,
            limit: options.maxOpsPerPage + 1,
        });
        if (!accepting
            || generation !== requestGeneration
            || options.getConnection(peerKey) !== connection
            || servers.get(peerKey)?.sessionId !== message.sessionId) {
            return;
        }
        const candidates = rows.slice(0, options.maxOpsPerPage);
        const [batch = []] = chunkOperationsForPush(candidates.map(row => row.operation), {
            maxOpsPerPush: options.maxOpsPerPage,
            maxBytesPerPush: options.maxBytesPerPage,
        });
        const pageRows = candidates.slice(0, batch.length);
        const lastRow = pageRows[pageRows.length - 1];
        const nextCursor = lastRow ? getOrderedCursorFromRow(lastRow) : null;
        if (pageRows.length === 0 || !nextCursor) {
            sendDone(peerKey, message.sessionId);
            return;
        }

        const push: OrderedCatchupPushMessage = {
            ...options.createBaseMessage('ordered_catchup_push'),
            sessionId: message.sessionId,
            cursor: nextCursor,
            hasMore: rows.length > pageRows.length,
            data: batch,
        };
        if (!sendMessage(peerKey, push)) {
            clearServer(peerKey, message.sessionId, 'send_ordered_catchup_push_failed');
            return;
        }
        options.syncStats.orderedCatchupPagesSent += 1;
        options.syncStats.orderedCatchupOpsSent += batch.length;
        if (!push.hasMore) {
            clearServer(peerKey, message.sessionId, 'ordered_catchup_final_page_sent');
        }
    }

    async function handlePush(peerKey: string, message: OrderedCatchupPushMessage): Promise<void> {
        const session = clients.get(peerKey);
        if (!session || session.sessionId !== message.sessionId) {
            log.warn({ peer: shortName(peerKey), sessionId: message.sessionId }, 'ignoring ordered catch-up push for unknown session');
            return;
        }
        if (session.terminalReason) {
            log.debug({ peer: shortName(peerKey), sessionId: message.sessionId }, 'ignoring ordered catch-up push after terminal message');
            return;
        }
        if (!session.requestOutstanding && session.pendingImports > PREFETCH_BATCHES) {
            failClient(peerKey, 'ordered_catchup_prefetch_overflow');
            return;
        }
        const cursor = parseOrderedCatchupCursor(message.cursor);
        if (!cursor) {
            failClient(peerKey, 'invalid_ordered_catchup_cursor');
            return;
        }
        if (session.cursor && !isOrderedCursorAfter(cursor, session.cursor)) {
            failClient(peerKey, 'non_advancing_ordered_catchup_cursor');
            return;
        }

        session.requestOutstanding = false;
        const batch = normalizeInboundOpsPushBatch(message.data);
        options.syncStats.orderedCatchupPagesReceived += 1;
        options.syncStats.orderedCatchupOpsReceived += batch.length;
        touchClient(session);
        session.cursor = cursor;
        if (batch.length > 0) {
            queueImport(session, batch);
        }
        if (message.hasMore === true) {
            if (!refillPrefetch(session)) {
                failClient(peerKey, 'send_ordered_catchup_req_failed');
            }
            return;
        }
        session.terminalReason = 'ordered_catchup_complete';
        maybeFinishClient(session);
    }

    async function handleDone(peerKey: string, message: OrderedCatchupDoneMessage): Promise<void> {
        const session = clients.get(peerKey);
        if (!session || session.sessionId !== message.sessionId) {
            log.warn({ peer: shortName(peerKey), sessionId: message.sessionId }, 'ignoring ordered catch-up done for unknown session');
            return;
        }
        session.requestOutstanding = false;
        session.terminalReason = 'ordered_catchup_done';
        touchClient(session);
        maybeFinishClient(session);
    }

    async function readLocalStatus(): Promise<{ operationCount: number; orderedOperationCount: number; ready: boolean }> {
        const [operationCount, orderedOperationCount] = await Promise.all([
            options.syncStore.count(),
            options.syncStore.countOrdered(),
        ]);
        return {
            operationCount,
            orderedOperationCount,
            ready: operationCount > 0 && operationCount === orderedOperationCount,
        };
    }

    async function dispatchMessage(peerKey: string, message: OrderedCatchupMessage): Promise<void> {
        if (message.type === 'ordered_catchup_req') {
            await handleRequest(peerKey, message);
        }
        else if (message.type === 'ordered_catchup_push') {
            await handlePush(peerKey, message);
        }
        else {
            await handleDone(peerKey, message);
        }
    }

    function reset(failureReason?: string): void {
        generation += 1;
        const cancelledClients = failureReason ? [...clients.values()] : [];
        const cancelledTransitions = failureReason
            ? [...transitions.values()].filter(transition => !transition.outcomeRecorded)
            : [];
        for (const session of clients.values()) {
            session.importsAborted = true;
        }
        clients.clear();
        servers.clear();
        expectations.clear();
        transitions.clear();
        if (failureReason) {
            for (const session of cancelledClients) {
                void trackWork(reportFailure(session, failureReason));
            }
            for (const transition of cancelledTransitions) {
                void trackWork(failTransition(transition, failureReason));
            }
        }
    }

    function createClientSession(peerKey: string, sessionId: string): ClientSession | null {
        if (!accepting || clients.has(peerKey) || transitions.has(peerKey) || !options.getConnection(peerKey)) {
            return null;
        }
        const now = Date.now();
        const session: ClientSession = {
            peerKey,
            sessionId,
            cursor: null,
            pendingImports: 0,
            requestOutstanding: false,
            terminalReason: null,
            importsAborted: false,
            startedAt: now,
            lastActivity: now,
        };
        clients.set(peerKey, session);
        options.syncStats.orderedCatchupSessionsStarted += 1;
        return session;
    }

    return {
        getLocalStatus(): Promise<{ operationCount: number; orderedOperationCount: number; ready: boolean }> {
            if (!accepting) {
                return Promise.reject(new Error('ordered catch-up coordinator is shutting down'));
            }
            return trackWork(readLocalStatus());
        },
        startClient(peerKey: string, reason: string, gap: number): boolean {
            const session = createClientSession(peerKey, options.createSessionId(peerKey));
            if (!session) {
                return false;
            }
            log.info({ peer: shortName(peerKey), mode: 'ordered_catchup', sessionId: session.sessionId, reason, gap }, 'peer ordered catch-up selected');
            if (!sendRequest(session)) {
                failClient(peerKey, 'send_ordered_catchup_req_failed');
            }
            return true;
        },
        createClientSession(peerKey: string, sessionId: string): boolean {
            return createClientSession(peerKey, sessionId) !== null;
        },
        expectServerRequest(peerKey: string, reason: string, gap: number): void {
            const now = Date.now();
            const current = expectations.get(peerKey);
            if (!accepting || !options.getConnection(peerKey) || (current && current.until > now)) {
                return;
            }
            const expectation = { since: now, until: now + SERVER_EXPECTATION_MS, reason, gap };
            expectations.set(peerKey, expectation);
            log.info({ peer: shortName(peerKey), reason, gap, pendingMs: SERVER_EXPECTATION_MS, pendingUntil: new Date(expectation.until).toISOString() }, 'ordered catch-up server request expected');
        },
        expireServerExpectation(peerKey: string, now = Date.now()): boolean {
            const expectation = expectations.get(peerKey);
            if (!expectation || expectation.until > now) {
                return false;
            }
            clearExpectation(peerKey, 'server_expectation_timeout');
            return true;
        },
        handleMessage(peerKey: string, message: OrderedCatchupMessage): Promise<void> {
            if (!accepting) {
                return Promise.resolve();
            }
            return trackWork(dispatchMessage(peerKey, message));
        },
        hasActiveForPeer(peerKey: string): boolean {
            return clients.has(peerKey)
                || servers.has(peerKey)
                || (expectations.get(peerKey)?.until ?? 0) > Date.now();
        },
        hasActiveOutbound(): boolean {
            return clients.size > 0 || transitions.size > 0;
        },
        getActiveSessionId(peerKey: string): string | null {
            return clients.get(peerKey)?.sessionId ?? servers.get(peerKey)?.sessionId ?? null;
        },
        getPeerState(peerKey: string) {
            const server = servers.get(peerKey);
            const expectation = expectations.get(peerKey);
            return {
                clientSessionId: clients.get(peerKey)?.sessionId ?? null,
                serverSessionId: server?.sessionId ?? null,
                serverLastActivity: server?.lastActivity ?? 0,
                serverPendingSince: expectation?.since ?? 0,
                serverPendingUntil: expectation?.until ?? 0,
                serverPendingReason: expectation?.reason ?? null,
                serverPendingGap: expectation?.gap ?? 0,
                transitionActive: transitions.has(peerKey),
            };
        },
        finishTransition(peerKey: string): void {
            transitions.delete(peerKey);
        },
        expire(now = Date.now()): void {
            for (const [peerKey, session] of clients) {
                if (now - session.lastActivity > options.idleTimeoutMs) {
                    failClient(peerKey, 'idle_timeout');
                }
            }
            for (const [peerKey, expectation] of expectations) {
                if (expectation.until <= now) {
                    clearExpectation(peerKey, 'server_expectation_timeout');
                }
            }
            for (const [peerKey, server] of servers) {
                if (now - server.lastActivity > options.idleTimeoutMs) {
                    clearServer(peerKey, server.sessionId, 'server_idle_timeout');
                }
            }
        },
        removePeer(peerKey: string, reason: string): void {
            clearExpectation(peerKey, reason);
            const server = servers.get(peerKey);
            if (server) {
                clearServer(peerKey, server.sessionId, reason);
            }
            failClient(peerKey, reason);
            const transition = transitions.get(peerKey);
            if (transition) {
                transitions.delete(peerKey);
                void trackWork(failTransition(transition, reason));
            }
        },
        reset,
        shutdown(): Promise<void> {
            if (!shutdownPromise) {
                accepting = false;
                reset();
                shutdownPromise = Promise.allSettled([...activeWork]).then(() => undefined);
            }
            return shutdownPromise;
        },
    };
}
