import { createRequire } from 'module';
import { childLogger } from '@mdip/common/logger';
import type { SyncStoreCursor } from '../db/types.js';
import type { OperationSyncStore } from '../db/types.js';
import {
    buildInitialHistoryWindow,
    buildNextHistoryPage,
    buildRoundCapSplitWindow,
    MDIP_EPOCH_SECONDS,
} from './windows.js';

const log = childLogger({ service: 'hyperswarm-negentropy-adapter' });

const MIN_FRAME_SIZE_LIMIT = 4096;
const DEFAULT_ITERATE_LIMIT = 1000;
const DEFAULT_MAX_RECORDS_PER_WINDOW = 25_000;
const DEFAULT_MAX_ROUNDS_PER_SESSION = 64;
const require = createRequire(import.meta.url);

type NegentropyFrameValue = string | Uint8Array;
type NegentropyFrameMessage = NegentropyFrameValue | null;
type NegentropyFrameList = Array<NegentropyFrameValue>;
type NegentropyStorageValue = string | Uint8Array | Buffer;

interface NegentropyInstance {
    wantUint8ArrayOutput?: boolean;
    initiate(): Promise<NegentropyFrameValue>;
    reconcile(
        msg: NegentropyFrameValue
    ): Promise<[NegentropyFrameValue | null, Array<NegentropyFrameValue>, Array<NegentropyFrameValue>]>;
}

interface NegentropyStorageVectorInstance {
    insert(timestamp: number, id: NegentropyStorageValue): void;
    seal(): void;
}

interface NegentropyModule {
    Negentropy: new (storage: NegentropyStorageVectorInstance, frameSizeLimit?: number) => NegentropyInstance;
    NegentropyStorageVector: new () => NegentropyStorageVectorInstance;
}

export interface NegentropyAdapterOptions {
    syncStore: OperationSyncStore;
    frameSizeLimit?: number;
    iterateLimit?: number;
    wantUint8ArrayOutput?: boolean;
    maxRecordsPerWindow?: number;
    maxRoundsPerSession?: number;
    deferInitialBuild?: boolean;
}

export interface ReconciliationWindow {
    name: string;
    fromTs: number;
    toTs: number;
    maxRecords: number;
    order: number;
    after?: SyncStoreCursor;
}

export interface NegentropyReconcileResult {
    nextMsg: NegentropyFrameMessage;
    haveIds: NegentropyFrameList;
    needIds: NegentropyFrameList;
}

export interface NegentropyAdapterStats {
    loaded: number;
    skipped: number;
    durationMs: number;
    frameSizeLimit: number;
}

export interface NegentropyWindowStats extends NegentropyAdapterStats {
    windowName: string;
    fromTs: number;
    toTs: number;
    rounds: number;
    completed: boolean;
    cappedByRecords: boolean;
    cappedByRounds: boolean;
    lastCursor: SyncStoreCursor | null;
}

export interface NegentropySessionStats {
    windowCount: number;
    rounds: number;
    loaded: number;
    skipped: number;
    durationMs: number;
    windows: NegentropyWindowStats[];
}

export interface NegentropyWindowSessionOptions {
    nowTs?: number;
    nowMs?: number;
    maxRoundsPerSession?: number;
}

function cloneCursor(cursor?: SyncStoreCursor | null): SyncStoreCursor | null {
    if (!cursor) {
        return null;
    }

    return {
        ts: cursor.ts,
        id: cursor.id,
    };
}

export default class NegentropyAdapter {
    private readonly syncStore: OperationSyncStore;
    private readonly frameSizeLimit: number;
    private readonly iterateLimit: number;
    private readonly wantUint8ArrayOutput: boolean;
    private readonly maxRecordsPerWindow: number;
    private readonly maxRoundsPerSession: number;
    private readonly mod: NegentropyModule;
    private ne: NegentropyInstance | null = null;
    private stats: NegentropyAdapterStats = {
        loaded: 0,
        skipped: 0,
        durationMs: 0,
        frameSizeLimit: 0,
    };
    private lastWindowStats: NegentropyWindowStats | null = null;
    private lastSessionStats: NegentropySessionStats | null = null;

    static async create(options: NegentropyAdapterOptions): Promise<NegentropyAdapter> {
        const adapter = new NegentropyAdapter(options);
        if (!options.deferInitialBuild) {
            await adapter.rebuildFromStore();
        }
        return adapter;
    }

    constructor(options: NegentropyAdapterOptions) {
        this.syncStore = options.syncStore;
        this.frameSizeLimit = options.frameSizeLimit ?? 0;
        this.iterateLimit = options.iterateLimit ?? DEFAULT_ITERATE_LIMIT;
        this.wantUint8ArrayOutput = options.wantUint8ArrayOutput ?? false;
        this.maxRecordsPerWindow = options.maxRecordsPerWindow ?? DEFAULT_MAX_RECORDS_PER_WINDOW;
        this.maxRoundsPerSession = options.maxRoundsPerSession ?? DEFAULT_MAX_ROUNDS_PER_SESSION;
        this.mod = loadNegentropyModule();

        if (this.frameSizeLimit !== 0 && this.frameSizeLimit < MIN_FRAME_SIZE_LIMIT) {
            throw new Error(`negentropy frameSizeLimit must be 0 or >= ${MIN_FRAME_SIZE_LIMIT}`);
        }

        assertPositiveInteger(this.iterateLimit, 'iterateLimit');
        assertPositiveInteger(this.maxRecordsPerWindow, 'maxRecordsPerWindow');
        assertPositiveInteger(this.maxRoundsPerSession, 'maxRoundsPerSession');
    }

    async rebuildFromStore(): Promise<NegentropyAdapterStats> {
        const stats = await this.rebuildWindowAdapter({
            name: 'full_history',
            fromTs: Number.MIN_SAFE_INTEGER,
            toTs: Number.MAX_SAFE_INTEGER,
            maxRecords: Number.MAX_SAFE_INTEGER,
            order: 0,
        });

        return {
            loaded: stats.loaded,
            skipped: stats.skipped,
            durationMs: stats.durationMs,
            frameSizeLimit: stats.frameSizeLimit,
        };
    }

    async rebuildForWindow(window: ReconciliationWindow): Promise<NegentropyWindowStats> {
        return this.rebuildWindowAdapter(window);
    }

    async runWindowedSessionWithPeer(
        peer: NegentropyAdapter,
        options: NegentropyWindowSessionOptions = {},
    ): Promise<NegentropySessionStats> {
        const startedAt = Date.now();
        const sessionNowTs = options.nowTs ?? normalizeEpochMsToSeconds(options.nowMs) ?? currentEpochSeconds();
        const maxRoundsPerSession = options.maxRoundsPerSession ?? this.maxRoundsPerSession;
        assertPositiveInteger(maxRoundsPerSession, 'maxRoundsPerSession');

        const [localEarliest, peerEarliest] = await Promise.all([
            this.getEarliestTimestamp(),
            peer.getEarliestTimestamp(),
        ]);
        const earliestCandidates = [localEarliest, peerEarliest]
            .filter((value): value is number => typeof value === 'number');

        const windowStats: NegentropyWindowStats[] = [];
        let totalLoaded = 0;
        let totalSkipped = 0;
        let totalRounds = 0;

        let nextOrder = 0;
        let window: ReconciliationWindow | null = buildInitialHistoryWindow(
            earliestCandidates.length > 0 ? Math.min(...earliestCandidates) : MDIP_EPOCH_SECONDS,
            sessionNowTs,
            this.maxRecordsPerWindow,
            undefined,
            nextOrder,
        );

        while (window) {
            const localWindowStats = await this.rebuildForWindow(window);
            const peerWindowStats = await peer.rebuildForWindow(window);

            const roundsResult = await this.reconcileWindowWithPeer(peer, maxRoundsPerSession);
            const mergedStats: NegentropyWindowStats = {
                ...localWindowStats,
                rounds: roundsResult.rounds,
                completed: roundsResult.completed,
                cappedByRounds: roundsResult.cappedByRounds,
            };

            windowStats.push(mergedStats);
            totalLoaded += mergedStats.loaded;
            totalSkipped += mergedStats.skipped;
            totalRounds += mergedStats.rounds;

            (log as any).debug?.(
                {
                    windowName: mergedStats.windowName,
                    fromTs: mergedStats.fromTs,
                    toTs: mergedStats.toTs,
                    loaded: mergedStats.loaded,
                    skipped: mergedStats.skipped,
                    durationMs: mergedStats.durationMs,
                    rounds: mergedStats.rounds,
                    completed: mergedStats.completed,
                    cappedByRecords: mergedStats.cappedByRecords,
                    cappedByRounds: mergedStats.cappedByRounds,
                },
                'negentropy window session'
            );

            if (roundsResult.cappedByRounds) {
                window = buildRoundCapSplitWindow(window);
                continue;
            }

            if (!roundsResult.completed) {
                window = null;
                continue;
            }

            const continuationCursor = getHistoryContinuationCursor(localWindowStats, peerWindowStats);
            if (!continuationCursor) {
                window = null;
                continue;
            }

            nextOrder += 1;
            window = buildNextHistoryPage(window, continuationCursor, nextOrder);
        }

        const sessionStats: NegentropySessionStats = {
            windowCount: windowStats.length,
            rounds: totalRounds,
            loaded: totalLoaded,
            skipped: totalSkipped,
            durationMs: Date.now() - startedAt,
            windows: windowStats,
        };

        this.lastSessionStats = sessionStats;
        (log as any).debug?.(
            {
                windowCount: sessionStats.windowCount,
                rounds: sessionStats.rounds,
                loaded: sessionStats.loaded,
                skipped: sessionStats.skipped,
                durationMs: sessionStats.durationMs,
            },
            'negentropy windowed session summary'
        );
        return sessionStats;
    }

    async getEarliestTimestamp(): Promise<number | null> {
        const rows = await this.syncStore.iterateSorted({ limit: 1 });
        if (rows.length === 0) {
            return null;
        }
        return rows[0].ts;
    }

    getStats(): NegentropyAdapterStats {
        return { ...this.stats };
    }

    getLastWindowStats(): NegentropyWindowStats | null {
        return this.lastWindowStats
            ? {
                ...this.lastWindowStats,
                lastCursor: cloneCursor(this.lastWindowStats.lastCursor),
            }
            : null;
    }

    getLastSessionStats(): NegentropySessionStats | null {
        if (!this.lastSessionStats) {
            return null;
        }

        return {
            ...this.lastSessionStats,
            windows: this.lastSessionStats.windows.map(window => ({
                ...window,
                lastCursor: cloneCursor(window.lastCursor),
            })),
        };
    }

    async initiate(): Promise<string | Uint8Array> {
        if (!this.ne) {
            throw new Error('negentropy adapter not initialized');
        }
        return this.ne.initiate();
    }

    async reconcile(msg: string | Uint8Array): Promise<NegentropyReconcileResult> {
        if (!this.ne) {
            throw new Error('negentropy adapter not initialized');
        }

        const [nextMsg, haveIds, needIds] = await this.ne.reconcile(msg);
        return { nextMsg, haveIds, needIds };
    }

    async respond(msg: string | Uint8Array): Promise<string | Uint8Array | null> {
        const result = await this.reconcile(msg);
        return result.nextMsg;
    }

    private async rebuildWindowAdapter(window: ReconciliationWindow): Promise<NegentropyWindowStats> {
        const startedAt = Date.now();
        const storage = new this.mod.NegentropyStorageVector();

        let loaded = 0;
        let skipped = 0;
        let processed = 0;
        let cappedByRecords = false;
        let after = cloneCursor(window.after) ?? undefined;
        let lastCursor = cloneCursor(window.after);

        while (true) {
            const rows = await this.syncStore.iterateSorted({
                after,
                limit: this.iterateLimit,
                fromTs: window.fromTs,
                toTs: window.toTs,
            });

            if (rows.length === 0) {
                break;
            }

            for (const row of rows) {
                if (processed >= window.maxRecords) {
                    cappedByRecords = true;
                    break;
                }

                processed += 1;
                lastCursor = cloneCursor({ ts: row.ts, id: row.id });
                if (!isValidSyncId(row.id) || !Number.isFinite(row.ts)) {
                    skipped += 1;
                    continue;
                }

                storage.insert(row.ts, row.id);
                loaded += 1;
            }

            const last = rows[rows.length - 1];
            after = { ts: last.ts, id: last.id };

            if (cappedByRecords) {
                break;
            }
        }

        storage.seal();
        this.ne = new this.mod.Negentropy(storage, this.frameSizeLimit);
        if (this.wantUint8ArrayOutput) {
            this.ne.wantUint8ArrayOutput = true;
        }

        const durationMs = Date.now() - startedAt;
        this.stats = {
            loaded,
            skipped,
            durationMs,
            frameSizeLimit: this.frameSizeLimit,
        };

        const windowStats: NegentropyWindowStats = {
            ...this.stats,
            windowName: window.name,
            fromTs: window.fromTs,
            toTs: window.toTs,
            rounds: 0,
            completed: true,
            cappedByRecords,
            cappedByRounds: false,
            lastCursor,
        };

        this.lastWindowStats = windowStats;

        (log as any).debug?.(
            {
                windowName: window.name,
                fromTs: window.fromTs,
                toTs: window.toTs,
                loaded,
                skipped,
                durationMs,
                cappedByRecords,
                frameSizeLimit: this.frameSizeLimit,
            },
            'negentropy adapter rebuilt'
        );

        return windowStats;
    }

    private async reconcileWindowWithPeer(
        peer: NegentropyAdapter,
        maxRounds: number,
    ): Promise<{ rounds: number; completed: boolean; cappedByRounds: boolean }> {
        let msg: string | Uint8Array | null = await this.initiate();
        let rounds = 0;

        while (msg !== null && rounds < maxRounds) {
            rounds += 1;
            const response = await peer.respond(msg);
            if (response === null) {
                msg = null;
                break;
            }

            const reconcileResult = await this.reconcile(response);
            msg = reconcileResult.nextMsg;
        }

        const completed = msg === null;
        return {
            rounds,
            completed,
            cappedByRounds: !completed && rounds >= maxRounds,
        };
    }
}

function currentEpochSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

function minCursor(a: SyncStoreCursor | null, b: SyncStoreCursor | null): SyncStoreCursor | null {
    if (!a) {
        return cloneCursor(b);
    }

    if (!b) {
        return cloneCursor(a);
    }

    if (a.ts !== b.ts) {
        return a.ts < b.ts ? cloneCursor(a) : cloneCursor(b);
    }

    return a.id.localeCompare(b.id) <= 0
        ? cloneCursor(a)
        : cloneCursor(b);
}

function getHistoryContinuationCursor(
    localWindowStats: NegentropyWindowStats,
    peerWindowStats: NegentropyWindowStats,
): SyncStoreCursor | null {
    let cursor: SyncStoreCursor | null = null;

    if (localWindowStats.cappedByRecords && localWindowStats.lastCursor) {
        cursor = cloneCursor(localWindowStats.lastCursor);
    }

    if (peerWindowStats.cappedByRecords && peerWindowStats.lastCursor) {
        cursor = minCursor(cursor, peerWindowStats.lastCursor);
    }

    return cursor;
}

function normalizeEpochMsToSeconds(value: number | undefined): number | undefined {
    if (typeof value !== 'number') {
        return undefined;
    }

    return Math.floor(value / 1000);
}

function isValidSyncId(id: string): boolean {
    return typeof id === 'string' && /^[a-f0-9]{64}$/i.test(id);
}

function assertPositiveInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
}

function loadNegentropyModule(): NegentropyModule {
    const cjs = require('./Negentropy.cjs');
    const Negentropy = cjs?.Negentropy;
    const NegentropyStorageVector = cjs?.NegentropyStorageVector;

    if (typeof Negentropy !== 'function' || typeof NegentropyStorageVector !== 'function') {
        throw new Error('Invalid local negentropy module exports');
    }

    return { Negentropy, NegentropyStorageVector };
}
