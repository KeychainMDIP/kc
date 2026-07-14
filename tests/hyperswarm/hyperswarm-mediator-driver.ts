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
} from './recording-duplex.ts';

const DEFAULT_MAX_STEPS = 2_000;
const REQUIRED_STABLE_OBSERVATIONS = 3;

export interface MediatorDriverOptions {
    operationsA: Operation[];
    operationsB: Operation[];
    publicKeyA?: Buffer;
    publicKeyB?: Buffer;
    maxRecordsPerWindow?: number;
    maxRoundsPerSession?: number;
    connectionMode?: 'framed' | 'unknown';
}

export type MediatorTranscriptEntry = RecordedTransportWrite;

interface WorkTracker {
    pending: number;
    version: number;
}

interface NodeWork {
    tracker: WorkTracker;
    readIds(): Promise<string[]>;
}

function normalizeIds(ids: Iterable<string>): string[] {
    return Array.from(new Set(Array.from(ids, id => id.toLowerCase()))).sort();
}

function operationIds(operations: Operation[]): string[] {
    return normalizeIds(operations.flatMap(operation => operation.signature?.hash ?? []));
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

function trackAsync<Args extends unknown[], Result>(
    tracker: WorkTracker,
    implementation: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
    return async (...args: Args): Promise<Result> => {
        tracker.pending += 1;
        tracker.version += 1;
        try {
            return await implementation(...args);
        }
        finally {
            tracker.pending -= 1;
            tracker.version += 1;
        }
    };
}

function requireMockImplementation<Args extends unknown[], Result>(
    mock: Mock<(...args: Args) => Promise<Result>>,
    name: string,
): (...args: Args) => Promise<Result> {
    const implementation = mock.getMockImplementation();
    if (!implementation) {
        throw new Error(`${name} mock implementation is unavailable`);
    }
    return implementation;
}

function trackNodeWork(node: MediatorNode, store: InMemoryOperationSyncStore): NodeWork {
    const tracker: WorkTracker = { pending: 0, version: 0 };
    const readSorted = store.iterateSorted.bind(store);
    const importBatch = requireMockImplementation(node.gatekeeperClient.importBatch, 'GatekeeperClient.importBatch');
    const processEvents = requireMockImplementation(node.gatekeeperClient.processEvents, 'GatekeeperClient.processEvents');
    const upsertMany = store.upsertMany.bind(store);
    const iterateSorted = store.iterateSorted.bind(store);
    const getByIds = store.getByIds.bind(store);

    node.gatekeeperClient.importBatch.mockImplementation(trackAsync(tracker, importBatch));
    node.gatekeeperClient.processEvents.mockImplementation(trackAsync(tracker, processEvents));
    jest.spyOn(store, 'upsertMany').mockImplementation(trackAsync(tracker, upsertMany));
    jest.spyOn(store, 'iterateSorted').mockImplementation(trackAsync(tracker, iterateSorted));
    jest.spyOn(store, 'getByIds').mockImplementation(trackAsync(tracker, getByIds));

    return {
        tracker,
        async readIds(): Promise<string[]> {
            const rows = await readSorted({ limit: Number.MAX_SAFE_INTEGER });
            return rows.map(row => row.id).sort();
        },
    };
}

function hasActiveSession(state: Record<string, unknown> | null): boolean {
    return state?.activeSession != null;
}

function nextTurn(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
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
            maxRecordsPerWindow,
            maxRoundsPerSession,
            deferInitialBuild: true,
        });
        const adapterB = await NegentropyAdapter.create({
            syncStore: storeB,
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

        const workA = trackNodeWork(nodeA, storeA);
        const workB = trackNodeWork(nodeB, storeB);
        const peerKeyA = publicKeyA.toString('hex');
        const peerKeyB = publicKeyB.toString('hex');
        const transport = createRecordingDuplexPair({
            publicKeyA,
            publicKeyB,
            receiveAtA: chunk => nodeA!.run(
                () => nodeA!.mediator.__test.processInboundPeerData(peerKeyB, chunk),
            ),
            receiveAtB: chunk => nodeB!.run(
                () => nodeB!.mediator.__test.processInboundPeerData(peerKeyA, chunk),
            ),
        });
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
            transport,
            transcript: transport.transcript,
            async startSync(): Promise<void> {
                if (started) {
                    throw new Error('mediator driver synchronization already started');
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
                    await nodeA!.run(() => nodeA!.mediator.__test.maybeStartPeerSync(peerKeyB));
                    await nodeB!.run(() => nodeB!.mediator.__test.maybeStartPeerSync(peerKeyA));
                }
            },
            async driveUntilQuiescent(expectedIds: Iterable<string>): Promise<void> {
                if (!started) {
                    throw new Error('mediator driver synchronization has not started');
                }

                const expected = normalizeIds(expectedIds);
                let stableObservations = 0;
                let previousSignature = '';
                let lastObservation: Record<string, unknown> = {};

                for (let step = 0; step < DEFAULT_MAX_STEPS; step += 1) {
                    await transport.deliverNext();
                    await nextTurn();

                    const [idsA, idsB, stateA, stateB] = await Promise.all([
                        workA.readIds(),
                        workB.readIds(),
                        nodeA!.run(() => nodeA!.mediator.__test.getConnectionState(peerKeyB)),
                        nodeB!.run(() => nodeB!.mediator.__test.getConnectionState(peerKeyA)),
                    ]);
                    const pendingWork = workA.tracker.pending + workB.tracker.pending;
                    const workVersion = workA.tracker.version + workB.tracker.version;
                    const matchesExpected = JSON.stringify(idsA) === JSON.stringify(expected)
                        && JSON.stringify(idsB) === JSON.stringify(expected);
                    const ready = transport.pendingCount === 0
                        && transport.pendingInboundCount === 0
                        && !hasActiveSession(stateA)
                        && !hasActiveSession(stateB)
                        && pendingWork === 0
                        && matchesExpected;
                    const signature = JSON.stringify({
                        idsA,
                        idsB,
                        transcriptLength: transport.transcript.length,
                        deliveryVersion: transport.deliveryVersion,
                        workVersion,
                    });

                    stableObservations = ready && signature === previousSignature
                        ? stableObservations + 1
                        : ready ? 1 : 0;
                    previousSignature = signature;
                    lastObservation = {
                        step,
                        idsA,
                        idsB,
                        expected,
                        pendingDeliveries: transport.pendingCount,
                        pendingInbound: transport.pendingInboundCount,
                        pendingWork,
                        workVersion,
                        stateA,
                        stateB,
                    };

                    if (stableObservations >= REQUIRED_STABLE_OBSERVATIONS) {
                        quiescent = true;
                        return;
                    }
                }

                const recentMessages = transport.transcript.slice(-20).map(entry => ({
                    sequence: entry.sequence,
                    direction: entry.direction,
                    framed: entry.framed,
                    type: entry.messageType,
                }));
                const recentDeliveries = transport.deliveries.slice(-20).map(entry => ({
                    sequence: entry.sequence,
                    writeSequences: entry.writeSequences,
                    direction: entry.direction,
                    action: entry.action,
                    types: entry.messageTypes,
                }));
                throw new Error(`mediator driver did not quiesce: ${JSON.stringify({
                    ...lastObservation,
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
                try {
                    await transport.destroy();
                }
                catch (error) {
                    errors.push(error);
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
