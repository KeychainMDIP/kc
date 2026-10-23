import type { MdipDocument, GetStatusResult } from '@mdip/gatekeeper/types';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { GatekeeperStatusSample, SearchStoredStatistics } from '@mdip/keymaster/types';
import { INDEX_SYNC_STATE_KEYS as keys } from './sync-state.js';

export interface DIDStatisticsMetadata {
    type: string | null;
    registry: string | null;
    version: string | null;
    confirmed: boolean | number;
    ephemeral: boolean | number;
    invalid: boolean | number;
}

export interface StatisticsGroup extends DIDStatisticsMetadata {
    count: number | string;
}

export function projectStatistics(value?: object): DIDStatisticsMetadata {
    const doc = value as MdipDocument | undefined;
    const invalid = !doc || !!doc.didResolutionMetadata?.error;
    const version = doc?.didDocumentMetadata?.version;
    return {
        type: !invalid && typeof doc.mdip?.type === 'string' ? doc.mdip.type : null,
        registry: !invalid && typeof doc.mdip?.registry === 'string' ? doc.mdip.registry : null,
        version: !invalid && typeof version === 'string' && /^[1-9]\d*$/.test(version) ? version : null,
        confirmed: !invalid && !!doc.didDocumentMetadata?.confirmed,
        ephemeral: !invalid && !!doc.mdip?.validUntil,
        invalid,
    };
}

export function summarizeStatistics(
    groups: Iterable<StatisticsGroup>,
    state: Record<string, string>,
): SearchStoredStatistics {
    const dids: SearchStoredStatistics['dids'] = {
        total: 0,
        byType: { agents: 0, assets: 0, confirmed: 0, unconfirmed: 0, ephemeral: 0, invalid: 0 },
        byRegistry: {},
        byVersion: {},
    };
    const registries = new Map<string, number>();
    const versions = new Map<string, number>();
    for (const group of groups) {
        const count = Number(group.count);
        dids.total += count;
        if (group.invalid) {
            dids.byType.invalid += count;
            continue;
        }
        if (group.type === 'agent') dids.byType.agents += count;
        if (group.type === 'asset') dids.byType.assets += count;
        dids.byType[group.confirmed ? 'confirmed' : 'unconfirmed'] += count;
        if (group.ephemeral) dids.byType.ephemeral += count;
        if (group.registry) registries.set(group.registry, (registries.get(group.registry) ?? 0) + count);
        if (group.version) versions.set(group.version, (versions.get(group.version) ?? 0) + count);
    }
    dids.byRegistry = Object.fromEntries([...registries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    dids.byVersion = Object.fromEntries([...versions].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    const epoch = state[keys.epoch] ?? null;
    const snapshotComplete = state[keys.snapshotComplete] === 'true';
    const changesCursor = state[keys.changesCursor] ?? null;
    const caughtUpCursor = state[keys.caughtUpCursor] ?? null;
    const caughtUpAt = state[keys.caughtUpAt] ?? null;
    return {
        dids,
        sync: {
            snapshotComplete,
            snapshotCursor: state[keys.snapshotCursor] ?? null,
            snapshotCheckpointCursor: state[keys.snapshotCheckpointCursor] ?? null,
            changesCursor,
            lastSyncStartedAt: state[keys.lastSyncStartedAt] ?? null,
            lastSyncCompletedAt: state[keys.lastSyncCompletedAt] ?? null,
            lastSyncError: state[keys.lastSyncError] ?? null,
            lastSyncMode: state[keys.lastSyncMode] ?? null,
            lastPagesProcessed: Number.parseInt(state[keys.lastPagesProcessed] ?? '0', 10),
            lastDidsChanged: Number.parseInt(state[keys.lastDidsChanged] ?? '0', 10),
            lastBlocksStored: Number.parseInt(state[keys.lastBlocksStored] ?? '0', 10),
        },
        metrics: {
            lastRebuiltAt: state[keys.metricsLastRebuiltAt] ?? null,
            lastError: state[keys.metricsLastError] ?? null,
        },
        index: {
            epoch,
            snapshotComplete,
            snapshotCursor: state[keys.snapshotCursor] ?? null,
            changesCursor,
            appliedAt: state[keys.appliedAt] ?? null,
            caughtUpCursor,
            caughtUpAt,
            state: !snapshotComplete ? 'snapshot'
                : epoch && caughtUpAt && caughtUpCursor === changesCursor ? 'caught_up' : 'catching_up',
            lastError: state[keys.lastSyncError] ?? null,
        },
    };
}

function isOperationalStatus(value: unknown): value is GetStatusResult {
    if (!value || typeof value !== 'object') return false;
    const status = value as GetStatusResult;
    const queue = status.eventsQueue;
    const memory = status.memoryUsage;
    const nonNegative = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
    return nonNegative(status.uptimeSeconds) && !!queue && !!memory
        && [queue.staged, queue.pending, queue.processing, queue.total].every(nonNegative)
        && queue.staged + queue.pending + queue.processing === queue.total
        && typeof queue.active === 'boolean'
        && [memory.rss, memory.heapTotal, memory.heapUsed, memory.external, memory.arrayBuffers].every(nonNegative);
}

export async function sampleGatekeeperStatus(
    gatekeeper: Pick<GatekeeperClient, 'getStatus'>,
    signal?: AbortSignal,
): Promise<GatekeeperStatusSample> {
    try {
        const status = await gatekeeper.getStatus({ timeoutMs: 5_000, maxResponseBytes: 64 * 1024, signal });
        if (!isOperationalStatus(status)) {
            return { available: false, sampledAt: new Date().toISOString(), reason: 'unsupported_status' };
        }
        const { staged, pending, processing, total, active } = status.eventsQueue;
        const { rss, heapTotal, heapUsed, external, arrayBuffers } = status.memoryUsage;
        return {
            available: true,
            sampledAt: new Date().toISOString(),
            status: {
                uptimeSeconds: status.uptimeSeconds,
                eventsQueue: { staged, pending, processing, total, active },
                memoryUsage: { rss, heapTotal, heapUsed, external, arrayBuffers },
            },
        };
    }
    catch {
        return { available: false, sampledAt: new Date().toISOString(), reason: 'unavailable' };
    }
}
