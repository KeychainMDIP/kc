import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { jest } from '@jest/globals';
import type { Mock } from 'jest-mock';

import type { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import NegentropyAdapter from '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';
import {
    filterIndexRejectedOperations,
    mapAcceptedOperationsToSyncRecords,
} from '../../services/mediators/hyperswarm/src/sync-persistence.ts';
import { resolveAcceptedOperationsToPersist } from '../../services/mediators/hyperswarm/src/sync-store-mirroring.ts';
import { normalizePeerCapabilities } from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';
import {
    createMediatorNode,
    getMediatorNodeContext,
    type MediatorNode,
} from './hyperswarm-mediator-harness.ts';
import {
    createRecordingDuplexPair,
    type RecordedTransportWrite,
    type RecordingDuplexPair,
} from './recording-duplex.ts';

const DEFAULT_MAX_ITERATIONS = 2_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const REQUIRED_STABLE_OBSERVATIONS = 3;

export interface MediatorDriverOptions {
    operationsA: Operation[];
    operationsB: Operation[];
    publicKeyA?: Buffer;
    publicKeyB?: Buffer;
    maxRecordsPerWindow?: number;
    maxRoundsPerSession?: number;
    frameSizeLimit?: number;
    connectionMode?: 'framed' | 'unknown';
}

export type MediatorTranscriptEntry = RecordedTransportWrite;

export type QuiescenceExpectation = Iterable<string> | {
    a: Iterable<string>;
    b: Iterable<string>;
};

export interface QuiescenceOptions {
    maxIterations?: number;
    timeoutMs?: number;
}

export interface QuiescenceReport {
    iterations: number;
    elapsedMs: number;
    stableTurns: number;
    framedWrites: number;
    deliveries: number;
}

export interface DeferClientCallOptions {
    node: 'a' | 'b';
    client: 'gatekeeper' | 'keymaster' | 'kubo';
    method: string;
    label?: string;
}

export interface TrackedDeferredCall {
    readonly started: Promise<void>;
    readonly settled: boolean;
    resolve(): void;
    reject(error: unknown): void;
}

interface ActiveCallSummary {
    label: string;
    active: number;
}

interface HistoryCursorSummary {
    ts: number;
    id: string;
}

interface OrderedCursorSummary {
    syncOrder: number;
    id: string;
}

interface HistorySummary {
    count: number;
    digest: string;
    sample: string[];
}

interface StoreSummary extends HistorySummary {
    orderedCount: number;
    firstCursor: HistoryCursorSummary | null;
    lastCursor: HistoryCursorSummary | null;
    lastOrderedCursor: OrderedCursorSummary | null;
}

interface NodeSummary {
    gatekeeper: HistorySummary;
    store: StoreSummary;
}

interface NodeWork {
    readSummary(): Promise<NodeSummary>;
}

function normalizeIds(ids: Iterable<string>): string[] {
    return Array.from(new Set(Array.from(ids, id => id.toLowerCase()))).sort();
}

function operationIds(operations: Operation[]): string[] {
    return normalizeIds(operations.flatMap(operation => operation.signature?.hash ?? []));
}

function digestIds(ids: string[]): string {
    return createHash('sha256').update(ids.join('\n')).digest('hex');
}

function sampleIds(ids: string[]): string[] {
    return ids.length <= 6 ? [...ids] : [...ids.slice(0, 3), ...ids.slice(-3)];
}

async function seedNode(
    node: MediatorNode,
    store: InMemoryOperationSyncStore,
    operations: Operation[],
): Promise<void> {
    if (operations.length === 0) {
        return;
    }

    const events: GatekeeperEvent[] = operations.map((operation, index) => ({
        registry: 'hyperswarm',
        time: operation.signature?.signed ?? new Date(0).toISOString(),
        ordinal: [Date.parse(operation.signature?.signed ?? '') || 0, index],
        operation,
    }));
    const imported = await node.gatekeeper.importBatch(events);
    const acceptedCandidates = filterIndexRejectedOperations(operations, imported.rejectedIndices);
    const processed = await node.gatekeeper.processEvents();
    const accepted = resolveAcceptedOperationsToPersist(
        acceptedCandidates,
        processed.acceptedHashes,
        processed.acceptedEvents,
    );
    const expectedIds = operationIds(operations);
    const acceptedIds = operationIds(accepted);

    if (imported.rejected !== 0
        || (processed.rejected ?? 0) !== 0
        || (processed.pending ?? 0) !== 0
        || JSON.stringify(acceptedIds) !== JSON.stringify(expectedIds)) {
        throw new Error(`failed to seed ${node.name}: expected=${expectedIds.join(',')} accepted=${acceptedIds.join(',')}`);
    }

    const mapped = mapAcceptedOperationsToSyncRecords(accepted);
    if (mapped.invalid !== 0 || mapped.records.length !== expectedIds.length) {
        throw new Error(`failed to map seeded operations for ${node.name}`);
    }
    await store.upsertMany(mapped.records);
}

class DeferredCall implements TrackedDeferredCall {
    readonly started: Promise<void>;
    private readonly release: Promise<void>;
    private resolveStarted!: () => void;
    private resolveRelease!: () => void;
    private rejectRelease!: (error: unknown) => void;
    private isStarted = false;
    private isSettled = false;

    constructor(readonly label: string, private readonly onSettle: () => void) {
        this.started = new Promise(resolve => {
            this.resolveStarted = resolve;
        });
        this.release = new Promise((resolve, reject) => {
            this.resolveRelease = resolve;
            this.rejectRelease = reject;
        });
        this.release.catch(() => undefined);
    }

    get settled(): boolean {
        return this.isSettled;
    }

    markStarted(): void {
        if (this.isStarted) {
            return;
        }
        this.isStarted = true;
        this.resolveStarted();
    }

    wait(): Promise<void> {
        return this.release;
    }

    resolve(): void {
        if (this.isSettled) {
            return;
        }
        this.isSettled = true;
        this.onSettle();
        this.resolveRelease();
    }

    reject(error: unknown): void {
        if (this.isSettled) {
            return;
        }
        this.isSettled = true;
        this.onSettle();
        this.rejectRelease(error);
    }
}

class CallTracker {
    private readonly active = new Map<string, number>();
    private readonly unsettled = new Set<DeferredCall>();
    private callVersion = 0;
    private deferralVersion = 0;

    get activeCount(): number {
        return Array.from(this.active.values()).reduce((total, count) => total + count, 0);
    }

    get version(): number {
        return this.callVersion;
    }

    get deferredVersion(): number {
        return this.deferralVersion;
    }

    get activeCalls(): ActiveCallSummary[] {
        return Array.from(this.active.entries())
            .filter(([, count]) => count > 0)
            .map(([label, active]) => ({ label, active }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }

    get unsettledLabels(): string[] {
        return Array.from(this.unsettled, deferred => deferred.label).sort();
    }

    wrap<Args extends unknown[], Result>(
        label: string,
        implementation: (...args: Args) => Promise<Result>,
        nextDeferred?: () => DeferredCall | undefined,
    ): (...args: Args) => Promise<Result> {
        return async (...args: Args): Promise<Result> => {
            this.begin(label);
            try {
                const deferred = nextDeferred?.();
                if (deferred) {
                    deferred.markStarted();
                    await deferred.wait();
                }
                return await implementation(...args);
            }
            finally {
                this.finish(label);
            }
        };
    }

    createDeferred(label: string): DeferredCall {
        let deferred: DeferredCall;
        deferred = new DeferredCall(label, () => {
            this.unsettled.delete(deferred);
            this.deferralVersion += 1;
        });
        this.unsettled.add(deferred);
        this.deferralVersion += 1;
        return deferred;
    }

    private begin(label: string): void {
        this.active.set(label, (this.active.get(label) ?? 0) + 1);
        this.callVersion += 1;
    }

    private finish(label: string): void {
        const active = this.active.get(label) ?? 0;
        if (active <= 1) {
            this.active.delete(label);
        }
        else {
            this.active.set(label, active - 1);
        }
        this.callVersion += 1;
    }
}

class TrackedMethodControl {
    private readonly deferred: DeferredCall[] = [];

    constructor(private readonly tracker: CallTracker, private readonly label: string) {}

    deferNext(label?: string): TrackedDeferredCall {
        const deferred = this.tracker.createDeferred(label ?? this.label);
        this.deferred.push(deferred);
        return deferred;
    }

    takeDeferred(): DeferredCall | undefined {
        return this.deferred.shift();
    }
}

type UnknownAsyncMock = Mock<(...args: never[]) => Promise<unknown>>;

function trackClientDelegates(
    node: 'a' | 'b',
    client: DeferClientCallOptions['client'],
    delegates: object,
    tracker: CallTracker,
    controls: Map<string, TrackedMethodControl>,
): void {
    for (const [method, candidate] of Object.entries(delegates)) {
        if (!jest.isMockFunction(candidate)) {
            continue;
        }
        const mock = candidate as unknown as UnknownAsyncMock;
        const implementation = mock.getMockImplementation();
        if (!implementation) {
            throw new Error(`${node}.${client}.${method} mock implementation is unavailable`);
        }
        const key = `${node}.${client}.${method}`;
        const control = new TrackedMethodControl(tracker, key);
        mock.mockImplementation(tracker.wrap(key, implementation, () => control.takeDeferred()));
        controls.set(key, control);
    }
}

function trackNodeWork(
    nodeId: 'a' | 'b',
    node: MediatorNode,
    store: InMemoryOperationSyncStore,
    tracker: CallTracker,
): NodeWork {
    const readSorted = store.iterateSorted.bind(store);
    const readOrdered = store.iterateOrdered.bind(store);
    const readCount = store.count.bind(store);
    const readOrderedCount = store.countOrdered.bind(store);
    const upsertMany = store.upsertMany.bind(store);
    const iterateSorted = store.iterateSorted.bind(store);
    const iterateOrdered = store.iterateOrdered.bind(store);
    const getByIds = store.getByIds.bind(store);
    const count = store.count.bind(store);
    const countOrdered = store.countOrdered.bind(store);
    const applySyncPage = store.applySyncPage.bind(store);
    const loadSyncState = store.loadSyncState.bind(store);
    const saveSyncState = store.saveSyncState.bind(store);
    const has = store.has.bind(store);
    const reset = store.reset.bind(store);

    jest.spyOn(store, 'upsertMany').mockImplementation(tracker.wrap(`${nodeId}.syncStore.upsertMany`, upsertMany));
    jest.spyOn(store, 'iterateSorted').mockImplementation(tracker.wrap(`${nodeId}.syncStore.iterateSorted`, iterateSorted));
    jest.spyOn(store, 'iterateOrdered').mockImplementation(tracker.wrap(`${nodeId}.syncStore.iterateOrdered`, iterateOrdered));
    jest.spyOn(store, 'getByIds').mockImplementation(tracker.wrap(`${nodeId}.syncStore.getByIds`, getByIds));
    jest.spyOn(store, 'count').mockImplementation(tracker.wrap(`${nodeId}.syncStore.count`, count));
    jest.spyOn(store, 'countOrdered').mockImplementation(tracker.wrap(`${nodeId}.syncStore.countOrdered`, countOrdered));
    jest.spyOn(store, 'applySyncPage').mockImplementation(tracker.wrap(`${nodeId}.syncStore.applySyncPage`, applySyncPage));
    jest.spyOn(store, 'loadSyncState').mockImplementation(tracker.wrap(`${nodeId}.syncStore.loadSyncState`, loadSyncState));
    jest.spyOn(store, 'saveSyncState').mockImplementation(tracker.wrap(`${nodeId}.syncStore.saveSyncState`, saveSyncState));
    jest.spyOn(store, 'has').mockImplementation(tracker.wrap(`${nodeId}.syncStore.has`, has));
    jest.spyOn(store, 'reset').mockImplementation(tracker.wrap(`${nodeId}.syncStore.reset`, reset));

    return {
        async readSummary(): Promise<NodeSummary> {
            const [events, rows, orderedRows, countValue, orderedCountValue] = await Promise.all([
                node.gatekeeper.exportBatch(),
                readSorted({ limit: Number.MAX_SAFE_INTEGER }),
                readOrdered({ limit: Number.MAX_SAFE_INTEGER }),
                readCount(),
                readOrderedCount(),
            ]);
            const gatekeeperIds = operationIds(events.map(event => event.operation));
            const storeIds = normalizeIds(rows.map(row => row.id));
            const first = rows[0];
            const last = rows.at(-1);
            const lastOrdered = orderedRows.at(-1);

            return {
                gatekeeper: {
                    count: events.length,
                    digest: digestIds(gatekeeperIds),
                    sample: sampleIds(gatekeeperIds),
                },
                store: {
                    count: countValue,
                    orderedCount: orderedCountValue,
                    digest: digestIds(storeIds),
                    sample: sampleIds(storeIds),
                    firstCursor: first ? { ts: first.ts, id: first.id } : null,
                    lastCursor: last ? { ts: last.ts, id: last.id } : null,
                    lastOrderedCursor: lastOrdered?.syncOrder !== undefined
                        ? { syncOrder: lastOrdered.syncOrder, id: lastOrdered.id }
                        : null,
                },
            };
        },
    };
}

function hasActiveSession(state: Record<string, unknown> | null): boolean {
    return state?.activeSession != null;
}

function nextTurn(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

class QuiescenceDeadlineError extends Error {}

async function beforeDeadline<Result>(work: () => Promise<Result>, deadline: number): Promise<Result> {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
        throw new QuiescenceDeadlineError();
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new QuiescenceDeadlineError()), remaining);
        });
        return await Promise.race([work(), timeout]);
    }
    finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

export async function createMediatorDriver(options: MediatorDriverOptions) {
    const publicKeyA = Buffer.from(options.publicKeyA ?? Buffer.alloc(32, 0x11));
    const publicKeyB = Buffer.from(options.publicKeyB ?? Buffer.alloc(32, 0x22));
    const maxRecordsPerWindow = options.maxRecordsPerWindow ?? 25_000;
    const maxRoundsPerSession = options.maxRoundsPerSession ?? 64;
    const connectionMode = options.connectionMode ?? 'framed';

    if (publicKeyA.compare(publicKeyB) === 0) {
        throw new Error('node public keys must differ');
    }

    const env = {
        KC_HYPR_NEGENTROPY_ENABLE: 'true',
        KC_HYPR_ORDERED_CATCHUP_ENABLE: 'false',
        KC_HYPR_LEGACY_SYNC_ENABLE: 'false',
        KC_HYPR_NEGENTROPY_MAX_RECORDS_PER_WINDOW: String(maxRecordsPerWindow),
        KC_HYPR_NEGENTROPY_MAX_ROUNDS_PER_SESSION: String(maxRoundsPerSession),
    };
    let nodeA: MediatorNode | null = null;
    let nodeB: MediatorNode | null = null;
    let storeA: InMemoryOperationSyncStore | null = null;
    let storeB: InMemoryOperationSyncStore | null = null;

    try {
        nodeA = await createMediatorNode({ name: 'node-a', publicKey: publicKeyA, env });
        nodeB = await createMediatorNode({ name: 'node-b', publicKey: publicKeyB, env });
        storeA = new InMemoryOperationSyncStore();
        storeB = new InMemoryOperationSyncStore();
        await storeA.start();
        await storeB.start();
        await seedNode(nodeA, storeA, options.operationsA);
        await seedNode(nodeB, storeB, options.operationsB);

        const adapterA = await NegentropyAdapter.create({
            syncStore: storeA,
            frameSizeLimit: options.frameSizeLimit,
            maxRecordsPerWindow,
            maxRoundsPerSession,
            deferInitialBuild: true,
        });
        const adapterB = await NegentropyAdapter.create({
            syncStore: storeB,
            frameSizeLimit: options.frameSizeLimit,
            maxRecordsPerWindow,
            maxRoundsPerSession,
            deferInitialBuild: true,
        });

        nodeA.run(() => {
            const context = getMediatorNodeContext();
            context.syncStore = storeA;
            context.negentropyAdapter = adapterA;
            nodeA!.mediator.__test.setSyncStore(storeA!);
            nodeA!.mediator.__test.setNegentropyAdapter(adapterA);
        });
        nodeB.run(() => {
            const context = getMediatorNodeContext();
            context.syncStore = storeB;
            context.negentropyAdapter = adapterB;
            nodeB!.mediator.__test.setSyncStore(storeB!);
            nodeB!.mediator.__test.setNegentropyAdapter(adapterB);
        });

        const tracker = new CallTracker();
        const clientControls = new Map<string, TrackedMethodControl>();
        trackClientDelegates('a', 'gatekeeper', nodeA.gatekeeperClient, tracker, clientControls);
        trackClientDelegates('a', 'keymaster', nodeA.keymasterClient, tracker, clientControls);
        trackClientDelegates('a', 'kubo', nodeA.kuboClient, tracker, clientControls);
        trackClientDelegates('b', 'gatekeeper', nodeB.gatekeeperClient, tracker, clientControls);
        trackClientDelegates('b', 'keymaster', nodeB.keymasterClient, tracker, clientControls);
        trackClientDelegates('b', 'kubo', nodeB.kuboClient, tracker, clientControls);
        const workA = trackNodeWork('a', nodeA, storeA, tracker);
        const workB = trackNodeWork('b', nodeB, storeB, tracker);
        const peerKeyA = publicKeyA.toString('hex');
        const peerKeyB = publicKeyB.toString('hex');
        const createTransport = (): RecordingDuplexPair => createRecordingDuplexPair({
            publicKeyA,
            publicKeyB,
            receiveAtA: chunk => nodeA!.run(
                () => nodeA!.mediator.__test.processInboundPeerData(peerKeyB, chunk),
            ),
            receiveAtB: chunk => nodeB!.run(
                () => nodeB!.mediator.__test.processInboundPeerData(peerKeyA, chunk),
            ),
        });
        let transport = createTransport();
        const links = [transport];
        let started = false;
        let quiescent = true;
        let disposed = false;

        const driver = {
            nodeA,
            nodeB,
            storeA,
            storeB,
            adapterA,
            adapterB,
            links,
            get transport(): RecordingDuplexPair {
                return transport;
            },
            get transcript(): RecordedTransportWrite[] {
                return links.flatMap(link => link.transcript);
            },
            deferNextClientCall(options: DeferClientCallOptions): TrackedDeferredCall {
                const key = `${options.node}.${options.client}.${options.method}`;
                const control = clientControls.get(key);
                if (!control) {
                    throw new Error(`tracked client method is unavailable: ${key}`);
                }
                return control.deferNext(options.label);
            },
            async disconnect(): Promise<void> {
                if (!started) {
                    throw new Error('mediator driver synchronization has not started');
                }
                quiescent = false;
                nodeA!.run(() => nodeA!.mediator.__test.disconnectPeer(peerKeyB));
                nodeB!.run(() => nodeB!.mediator.__test.disconnectPeer(peerKeyA));
                while (transport.dropNext()) {
                    // In-flight writes are lost when the connection closes.
                }
                try {
                    await transport.destroy();
                }
                finally {
                    while (transport.dropNext()) {
                        // Inbound work may have written while the duplex was settling.
                    }
                }
            },
            async reconnect(): Promise<void> {
                if (started && !quiescent) {
                    throw new Error('mediator driver cannot reconnect before quiescence');
                }
                await transport.destroy();
                transport = createTransport();
                links.push(transport);
                started = false;
                quiescent = true;
            },
            async startSync(source: 'connect' | 'periodic' = 'connect'): Promise<void> {
                if (started) {
                    throw new Error('mediator driver synchronization already started');
                }
                if (source === 'periodic' && connectionMode !== 'framed') {
                    throw new Error('periodic synchronization requires a negotiated framed connection');
                }
                started = true;
                quiescent = false;
                const createConnectionOverrides = () => connectionMode === 'framed'
                    ? {
                        capabilities: normalizePeerCapabilities({
                            negentropy: true,
                            negentropyVersion: 1,
                            orderedCatchup: false,
                        }),
                        transportMode: 'framed',
                        inboundTransportMode: 'framed',
                        peerTransportFramingVersion: 1,
                        ...(source === 'periodic' ? { syncMode: 'negentropy' } : {}),
                    }
                    : {};
                nodeA!.run(() => nodeA!.mediator.__test.addConnection(peerKeyB, {
                    connection: transport.connectionA,
                    ...createConnectionOverrides(),
                }));
                nodeB!.run(() => nodeB!.mediator.__test.addConnection(peerKeyA, {
                    connection: transport.connectionB,
                    ...createConnectionOverrides(),
                }));
                if (connectionMode === 'unknown') {
                    await nodeA!.run(() => nodeA!.mediator.__test.sendPingToPeer(peerKeyB, 'initial'));
                    await nodeB!.run(() => nodeB!.mediator.__test.sendPingToPeer(peerKeyA, 'initial'));
                }
                else {
                    await nodeA!.run(() => nodeA!.mediator.__test.maybeStartPeerSync(peerKeyB, source));
                    await nodeB!.run(() => nodeB!.mediator.__test.maybeStartPeerSync(peerKeyA, source));
                }
            },
            async driveUntilQuiescent(
                expectedIds: QuiescenceExpectation,
                quiescenceOptions: QuiescenceOptions = {},
            ): Promise<QuiescenceReport> {
                if (!started) {
                    throw new Error('mediator driver synchronization has not started');
                }

                const expectedByNode = 'a' in Object(expectedIds)
                    ? {
                        a: normalizeIds((expectedIds as Exclude<QuiescenceExpectation, Iterable<string>>).a),
                        b: normalizeIds((expectedIds as Exclude<QuiescenceExpectation, Iterable<string>>).b),
                    }
                    : {
                        a: normalizeIds(expectedIds as Iterable<string>),
                        b: normalizeIds(expectedIds as Iterable<string>),
                    };
                const expectedDigest = {
                    a: digestIds(expectedByNode.a),
                    b: digestIds(expectedByNode.b),
                };
                const maxIterations = quiescenceOptions.maxIterations ?? DEFAULT_MAX_ITERATIONS;
                const timeoutMs = quiescenceOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
                if (!Number.isInteger(maxIterations) || maxIterations <= 0) {
                    throw new Error('quiescence maxIterations must be a positive integer');
                }
                if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
                    throw new Error('quiescence timeoutMs must be positive');
                }

                const startedAt = performance.now();
                const deadline = startedAt + timeoutMs;
                let stableObservations = 0;
                let previousSignature = '';
                let lastObservation: Record<string, unknown> = {};
                let guardReason = 'iteration_limit';
                let iterations = 0;
                let summaryA: NodeSummary | null = null;
                let summaryB: NodeSummary | null = null;
                let stateA: Record<string, unknown> | null = null;
                let stateB: Record<string, unknown> | null = null;
                const readState = () => Promise.all([
                    workA.readSummary(),
                    workB.readSummary(),
                    nodeA!.run(() => nodeA!.mediator.__test.getConnectionState(peerKeyB)),
                    nodeB!.run(() => nodeB!.mediator.__test.getConnectionState(peerKeyA)),
                ] as const);
                const readLinkState = () => {
                    const nextPending = transport.peekNext();
                    return {
                        pendingAToB: transport.pendingAToB,
                        pendingBToA: transport.pendingBToA,
                        pendingInboundAtA: transport.pendingInboundAtA,
                        pendingInboundAtB: transport.pendingInboundAtB,
                        next: nextPending
                            ? {
                                sequence: nextPending.sequence,
                                direction: nextPending.direction,
                                types: nextPending.messageTypes,
                            }
                            : null,
                    };
                };

                try {
                    [summaryA, summaryB, stateA, stateB] = await beforeDeadline(readState, deadline);

                    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
                        iterations = iteration;
                        await beforeDeadline(() => transport.deliverNext(), deadline);
                        await beforeDeadline(nextTurn, deadline);

                        [summaryA, summaryB, stateA, stateB] = await beforeDeadline(readState, deadline);
                        const framedMessages = transport.transcript.filter(entry => entry.framed);
                        const latestFramedWriteSequence = framedMessages.at(-1)?.sequence ?? 0;
                        const linkState = readLinkState();
                        const activeCalls = tracker.activeCalls;
                        const unsettledDeferrals = tracker.unsettledLabels;
                        const matchesExpected = [
                            [summaryA, expectedByNode.a, expectedDigest.a],
                            [summaryB, expectedByNode.b, expectedDigest.b],
                        ].every(([summary, expected, digest]) => {
                            const nodeSummary = summary as NodeSummary;
                            const nodeExpected = expected as string[];
                            return nodeSummary.gatekeeper.count === nodeExpected.length
                                && nodeSummary.gatekeeper.digest === digest
                                && nodeSummary.store.count === nodeExpected.length
                                && nodeSummary.store.digest === digest;
                        });
                        const ready = linkState.pendingAToB === 0
                            && linkState.pendingBToA === 0
                            && linkState.pendingInboundAtA === 0
                            && linkState.pendingInboundAtB === 0
                            && !hasActiveSession(stateA)
                            && !hasActiveSession(stateB)
                            && tracker.activeCount === 0
                            && unsettledDeferrals.length === 0
                            && matchesExpected;
                        const signature = JSON.stringify({
                            latestFramedWriteSequence,
                            framedWrites: framedMessages.length,
                            deliveryVersion: transport.deliveryVersion,
                            callVersion: tracker.version,
                            deferredVersion: tracker.deferredVersion,
                            summaryA,
                            summaryB,
                        });

                        stableObservations = ready && signature === previousSignature
                            ? stableObservations + 1
                            : ready ? 1 : 0;
                        previousSignature = signature;
                        const elapsedMs = performance.now() - startedAt;
                        lastObservation = {
                            iteration,
                            elapsedMs: Math.round(elapsedMs),
                            stableObservations,
                            expected: {
                                a: {
                                    count: expectedByNode.a.length,
                                    digest: expectedDigest.a,
                                    sample: sampleIds(expectedByNode.a),
                                },
                                b: {
                                    count: expectedByNode.b.length,
                                    digest: expectedDigest.b,
                                    sample: sampleIds(expectedByNode.b),
                                },
                            },
                            linkState,
                            activeCalls,
                            callVersion: tracker.version,
                            unsettledDeferrals,
                            deferredVersion: tracker.deferredVersion,
                            latestFramedWriteSequence,
                            framedWrites: framedMessages.length,
                            nodeA: summaryA,
                            nodeB: summaryB,
                            stateA,
                            stateB,
                        };

                        if (elapsedMs >= timeoutMs) {
                            guardReason = 'wall_clock_timeout';
                            break;
                        }
                        if (stableObservations >= REQUIRED_STABLE_OBSERVATIONS) {
                            quiescent = true;
                            return {
                                iterations: iteration,
                                elapsedMs: Math.round(elapsedMs),
                                stableTurns: stableObservations,
                                framedWrites: framedMessages.length,
                                deliveries: transport.deliveryVersion,
                            };
                        }
                    }
                }
                catch (error) {
                    if (!(error instanceof QuiescenceDeadlineError)) {
                        throw error;
                    }
                    guardReason = 'wall_clock_timeout';
                }

                const recentMessages = transport.transcript.slice(-20).map(entry => ({
                    sequence: entry.sequence,
                    direction: entry.direction,
                    transportMode: entry.transportMode,
                    types: entry.messageTypes,
                    bytes: entry.raw.length,
                }));
                const recentDeliveries = transport.deliveries.slice(-20).map(entry => ({
                    sequence: entry.sequence,
                    writeSequences: entry.writeSequences,
                    direction: entry.direction,
                    action: entry.action,
                    types: entry.messageTypes,
                    bytes: entry.raw.length,
                }));
                throw new Error(`mediator driver did not quiesce: ${JSON.stringify({
                    ...lastObservation,
                    guardReason,
                    iterations,
                    elapsedMs: Math.round(performance.now() - startedAt),
                    linkState: readLinkState(),
                    activeCalls: tracker.activeCalls,
                    unsettledDeferrals: tracker.unsettledLabels,
                    nodeA: summaryA,
                    nodeB: summaryB,
                    stateA,
                    stateB,
                    recentMessages,
                    recentDeliveries,
                })}`);
            },
            async dispose(): Promise<void> {
                if (disposed) {
                    return;
                }
                disposed = true;
                const unfinished = started && !quiescent;
                const errors: unknown[] = [];
                for (const link of [...links].reverse()) {
                    try {
                        await link.destroy();
                    }
                    catch (error) {
                        errors.push(error);
                    }
                }
                for (const node of [nodeB!, nodeA!]) {
                    try {
                        await node.dispose();
                    }
                    catch (error) {
                        errors.push(error);
                    }
                }
                if (unfinished) {
                    errors.unshift(new Error('mediator driver disposed before reaching quiescence'));
                }
                if (errors.length > 0) {
                    throw new AggregateError(errors, 'mediator driver disposal failed');
                }
            },
        };

        return driver;
    }
    catch (error) {
        const cleanupErrors: unknown[] = [];
        for (const node of [nodeB, nodeA]) {
            if (!node) {
                continue;
            }
            try {
                await node.dispose();
            }
            catch (cleanupError) {
                cleanupErrors.push(cleanupError);
            }
        }
        for (const store of [storeB, storeA]) {
            try {
                await store?.stop();
            }
            catch (cleanupError) {
                cleanupErrors.push(cleanupError);
            }
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError([error, ...cleanupErrors], 'mediator driver setup failed');
        }
        throw error;
    }
}
