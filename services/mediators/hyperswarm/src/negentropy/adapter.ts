import { createRequire } from 'module';
import { childLogger } from '@mdip/common/logger';
import type { SyncStoreCursor } from '../db/types.js';
import type { OperationSyncStore } from '../db/types.js';

const log = childLogger({ service: 'hyperswarm-negentropy-adapter' });

const MIN_FRAME_SIZE_LIMIT = 4096;
const DEFAULT_ITERATE_LIMIT = 1000;
const DEFAULT_RECENT_WINDOW_DAYS = 7;
const DEFAULT_OLDER_WINDOW_DAYS = 30;
const DEFAULT_MAX_RECORDS_PER_WINDOW = 25_000;
const DEFAULT_MAX_ROUNDS_PER_SESSION = 64;
const DAY_MS = 24 * 60 * 60 * 1000;
const require = createRequire(import.meta.url);

interface NegentropyInstance {
    wantUint8ArrayOutput?: boolean;
    initiate(): Promise<string | Uint8Array>;
    reconcile(
        msg: string | Uint8Array
    ): Promise<[string | Uint8Array | null, Array<string | Uint8Array>, Array<string | Uint8Array>]>;
}

interface NegentropyStorageVectorInstance {
    insert(timestamp: number, id: string | Uint8Array | Buffer): void;
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
    recentWindowDays?: number;
    olderWindowDays?: number;
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
}

export interface NegentropyReconcileResult {
    nextMsg: string | Uint8Array | null;
    haveIds: Array<string | Uint8Array>;
    needIds: Array<string | Uint8Array>;
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
    nowMs?: number;
    maxRoundsPerSession?: number;
}

export default class NegentropyAdapter {
    private readonly syncStore: OperationSyncStore;
    private readonly frameSizeLimit: number;
    private readonly iterateLimit: number;
    private readonly wantUint8ArrayOutput: boolean;
    private readonly recentWindowDays: number;
    private readonly olderWindowDays: number;
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
        this.recentWindowDays = options.recentWindowDays ?? DEFAULT_RECENT_WINDOW_DAYS;
        this.olderWindowDays = options.olderWindowDays ?? DEFAULT_OLDER_WINDOW_DAYS;
        this.maxRecordsPerWindow = options.maxRecordsPerWindow ?? DEFAULT_MAX_RECORDS_PER_WINDOW;
        this.maxRoundsPerSession = options.maxRoundsPerSession ?? DEFAULT_MAX_ROUNDS_PER_SESSION;
        this.mod = loadNegentropyModule();

        if (this.frameSizeLimit !== 0 && this.frameSizeLimit < MIN_FRAME_SIZE_LIMIT) {
            throw new Error(`negentropy frameSizeLimit must be 0 or >= ${MIN_FRAME_SIZE_LIMIT}`);
        }

        assertPositiveInteger(this.iterateLimit, 'iterateLimit');
        assertPositiveInteger(this.recentWindowDays, 'recentWindowDays');
        assertPositiveInteger(this.olderWindowDays, 'olderWindowDays');
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

    async planWindows(nowMs: number = Date.now(), earliestTsOverride?: number): Promise<ReconciliationWindow[]> {
        if (!Number.isFinite(nowMs)) {
            throw new Error('nowMs must be a finite timestamp');
        }

        const earliestTs = typeof earliestTsOverride === 'number'
            ? earliestTsOverride
            : await this.getEarliestTimestamp();

        if (earliestTs == null) {
            return [];
        }

        const windows: ReconciliationWindow[] = [];
        const recentSpanMs = this.recentWindowDays * DAY_MS;
        const olderSpanMs = this.olderWindowDays * DAY_MS;
        const recentStart = Math.max(earliestTs, nowMs - recentSpanMs);

        windows.push({
            name: 'recent',
            fromTs: recentStart,
            toTs: nowMs,
            maxRecords: this.maxRecordsPerWindow,
            order: 0,
        });

        let cursorTo = recentStart - 1;
        let order = 1;
        while (cursorTo >= earliestTs) {
            const fromTs = Math.max(earliestTs, cursorTo - olderSpanMs + 1);
            windows.push({
                name: `older_${order}`,
                fromTs,
                toTs: cursorTo,
                maxRecords: this.maxRecordsPerWindow,
                order,
            });
            cursorTo = fromTs - 1;
            order += 1;
        }

        return windows;
    }

    async runWindowedSessionWithPeer(
        peer: NegentropyAdapter,
        options: NegentropyWindowSessionOptions = {},
    ): Promise<NegentropySessionStats> {
        const startedAt = Date.now();
        const sessionNowMs = options.nowMs ?? Date.now();
        const maxRoundsPerSession = options.maxRoundsPerSession ?? this.maxRoundsPerSession;
        assertPositiveInteger(maxRoundsPerSession, 'maxRoundsPerSession');

        const [localEarliest, peerEarliest] = await Promise.all([
            this.getEarliestTimestamp(),
            peer.getEarliestTimestamp(),
        ]);
        const earliestCandidates = [localEarliest, peerEarliest]
            .filter((value): value is number => typeof value === 'number');

        const windows = earliestCandidates.length === 0
            ? []
            : await this.planWindows(sessionNowMs, Math.min(...earliestCandidates));

        const windowStats: NegentropyWindowStats[] = [];
        let totalLoaded = 0;
        let totalSkipped = 0;
        let totalRounds = 0;

        for (const window of windows) {
            const localWindowStats = await this.rebuildForWindow(window);
            await peer.rebuildForWindow(window);

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

    getStats(): NegentropyAdapterStats {
        return { ...this.stats };
    }

    getLastWindowStats(): NegentropyWindowStats | null {
        return this.lastWindowStats ? { ...this.lastWindowStats } : null;
    }

    getLastSessionStats(): NegentropySessionStats | null {
        if (!this.lastSessionStats) {
            return null;
        }

        return {
            ...this.lastSessionStats,
            windows: this.lastSessionStats.windows.map(window => ({ ...window })),
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
        let after: SyncStoreCursor | undefined;

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

    private async getEarliestTimestamp(): Promise<number | null> {
        const rows = await this.syncStore.iterateSorted({ limit: 1 });
        if (rows.length === 0) {
            return null;
        }
        return rows[0].ts;
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
