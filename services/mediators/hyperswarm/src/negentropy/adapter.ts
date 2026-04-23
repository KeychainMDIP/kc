import { createHash } from 'crypto';
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

export interface NegentropyWindowDebugInfo {
    loaded: number;
    skipped: number;
    cappedByRecords: boolean;
    firstCursor: SyncStoreCursor | null;
    lastCursor: SyncStoreCursor | null;
    pageHash: string;
    headSample: string[];
    tailSample: string[];
}

export interface NegentropyWindowSnapshot {
    window: ReconciliationWindow;
    stats: NegentropyWindowStats;
    debug: NegentropyWindowDebugInfo;
    storage: NegentropyStorageVectorInstance;
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

function cloneWindow(window: ReconciliationWindow): ReconciliationWindow {
    return {
        ...window,
        after: cloneCursor(window.after) ?? undefined,
    };
}

function cloneWindowStats(stats: NegentropyWindowStats): NegentropyWindowStats {
    return {
        ...stats,
        lastCursor: cloneCursor(stats.lastCursor),
    };
}

function cloneWindowDebugInfo(debug: NegentropyWindowDebugInfo): NegentropyWindowDebugInfo {
    return {
        ...debug,
        firstCursor: cloneCursor(debug.firstCursor),
        lastCursor: cloneCursor(debug.lastCursor),
        headSample: [...debug.headSample],
        tailSample: [...debug.tailSample],
    };
}

function formatWindowDebugEntry(ts: number, id: string): string {
    return `${ts}:${id}`;
}

export class NegentropyWindowEngine {
    private readonly ne: NegentropyInstance;

    constructor(
        mod: NegentropyModule,
        snapshot: NegentropyWindowSnapshot,
        frameSizeLimit: number,
        wantUint8ArrayOutput: boolean,
    ) {
        this.ne = new mod.Negentropy(snapshot.storage, frameSizeLimit);
        if (wantUint8ArrayOutput) {
            this.ne.wantUint8ArrayOutput = true;
        }
    }

    getInstance(): NegentropyInstance {
        return this.ne;
    }

    async initiate(): Promise<NegentropyFrameValue> {
        return this.ne.initiate();
    }

    async reconcile(msg: NegentropyFrameValue): Promise<NegentropyReconcileResult> {
        const [nextMsg, haveIds, needIds] = await this.ne.reconcile(msg);
        return { nextMsg, haveIds, needIds };
    }

    async respond(msg: NegentropyFrameValue): Promise<NegentropyFrameValue | null> {
        const result = await this.reconcile(msg);
        return result.nextMsg;
    }
}

export default class NegentropyAdapter {
    private readonly syncStore: OperationSyncStore;
    private readonly frameSizeLimit: number;
    private readonly iterateLimit: number;
    private readonly wantUint8ArrayOutput: boolean;
    private readonly maxRecordsPerWindow: number;
    private readonly maxRoundsPerSession: number;
    private readonly mod: NegentropyModule;
    private currentSnapshot: NegentropyWindowSnapshot | null = null;
    private currentEngine: NegentropyWindowEngine | null = null;
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
        const snapshot = await this.buildWindowSnapshot({
            name: 'full_history',
            fromTs: Number.MIN_SAFE_INTEGER,
            toTs: Number.MAX_SAFE_INTEGER,
            maxRecords: Number.MAX_SAFE_INTEGER,
            order: 0,
        });
        this.useSnapshot(snapshot);

        const stats = snapshot.stats;

        return {
            loaded: stats.loaded,
            skipped: stats.skipped,
            durationMs: stats.durationMs,
            frameSizeLimit: stats.frameSizeLimit,
        };
    }

    async rebuildForWindow(window: ReconciliationWindow): Promise<NegentropyWindowStats> {
        const snapshot = await this.buildWindowSnapshot(window);
        this.useSnapshot(snapshot);
        return cloneWindowStats(snapshot.stats);
    }

    async buildSnapshotForWindow(window: ReconciliationWindow): Promise<NegentropyWindowSnapshot> {
        return this.buildWindowSnapshot(window);
    }

    createEngineForSnapshot(snapshot: NegentropyWindowSnapshot): NegentropyWindowEngine {
        return new NegentropyWindowEngine(
            this.mod,
            snapshot,
            this.frameSizeLimit,
            this.wantUint8ArrayOutput,
        );
    }

    getCurrentSnapshot(): NegentropyWindowSnapshot | null {
        if (!this.currentSnapshot) {
            return null;
        }

        return {
            window: cloneWindow(this.currentSnapshot.window),
            stats: cloneWindowStats(this.currentSnapshot.stats),
            debug: cloneWindowDebugInfo(this.currentSnapshot.debug),
            storage: this.currentSnapshot.storage,
        };
    }

    useSnapshot(snapshot: NegentropyWindowSnapshot): NegentropyWindowEngine {
        this.currentSnapshot = {
            window: cloneWindow(snapshot.window),
            stats: cloneWindowStats(snapshot.stats),
            debug: cloneWindowDebugInfo(snapshot.debug),
            storage: snapshot.storage,
        };
        this.currentEngine = this.createEngineForSnapshot(snapshot);
        this.stats = {
            loaded: snapshot.stats.loaded,
            skipped: snapshot.stats.skipped,
            durationMs: snapshot.stats.durationMs,
            frameSizeLimit: snapshot.stats.frameSizeLimit,
        };
        this.lastWindowStats = cloneWindowStats(snapshot.stats);
        return this.currentEngine;
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
            const localSnapshot = await this.buildSnapshotForWindow(window);
            const peerSnapshot = await peer.buildSnapshotForWindow(window);
            const localWindowStats = cloneWindowStats(localSnapshot.stats);
            const peerWindowStats = cloneWindowStats(peerSnapshot.stats);

            const roundsResult = await this.reconcileWindowWithPeer(
                this.createEngineForSnapshot(localSnapshot),
                peer.createEngineForSnapshot(peerSnapshot),
                maxRoundsPerSession,
            );
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
            ? cloneWindowStats(this.lastWindowStats)
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
        if (!this.currentEngine) {
            throw new Error('negentropy adapter not initialized');
        }
        return this.currentEngine.initiate();
    }

    async reconcile(msg: string | Uint8Array): Promise<NegentropyReconcileResult> {
        if (!this.currentEngine) {
            throw new Error('negentropy adapter not initialized');
        }
        return this.currentEngine.reconcile(msg);
    }

    async respond(msg: string | Uint8Array): Promise<string | Uint8Array | null> {
        const result = await this.reconcile(msg);
        return result.nextMsg;
    }

    private async buildWindowSnapshot(window: ReconciliationWindow): Promise<NegentropyWindowSnapshot> {
        const startedAt = Date.now();
        const storage = new this.mod.NegentropyStorageVector();
        const pageHasher = createHash('sha256');

        let loaded = 0;
        let skipped = 0;
        let processed = 0;
        let cappedByRecords = false;
        let after = cloneCursor(window.after) ?? undefined;
        let firstCursor: SyncStoreCursor | null = null;
        let lastCursor = cloneCursor(window.after);
        const headSample: string[] = [];
        const tailSample: string[] = [];

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

                if (!isValidSyncId(row.id) || !Number.isFinite(row.ts)) {
                    skipped += 1;
                    continue;
                }

                processed += 1;
                const cursor = cloneCursor({ ts: row.ts, id: row.id });
                firstCursor ??= cloneCursor(cursor);
                lastCursor = cursor;
                storage.insert(row.ts, row.id);
                pageHasher.update(formatWindowDebugEntry(row.ts, row.id));
                pageHasher.update('\n');
                const sampleEntry = formatWindowDebugEntry(row.ts, row.id);
                if (headSample.length < 5) {
                    headSample.push(sampleEntry);
                }
                tailSample.push(sampleEntry);
                if (tailSample.length > 5) {
                    tailSample.shift();
                }
                loaded += 1;
            }

            const last = rows[rows.length - 1];
            after = { ts: last.ts, id: last.id };

            if (cappedByRecords) {
                break;
            }
        }

        storage.seal();

        const durationMs = Date.now() - startedAt;
        const stats: NegentropyAdapterStats = {
            loaded,
            skipped,
            durationMs,
            frameSizeLimit: this.frameSizeLimit,
        };

        const windowStats: NegentropyWindowStats = {
            ...stats,
            windowName: window.name,
            fromTs: window.fromTs,
            toTs: window.toTs,
            rounds: 0,
            completed: true,
            cappedByRecords,
            cappedByRounds: false,
            lastCursor,
        };

        const debug: NegentropyWindowDebugInfo = {
            loaded,
            skipped,
            cappedByRecords,
            firstCursor,
            lastCursor,
            pageHash: pageHasher.digest('hex'),
            headSample,
            tailSample,
        };

        (log as any).debug?.(
            {
                windowName: window.name,
                fromTs: window.fromTs,
                toTs: window.toTs,
                windowAfter: cloneCursor(window.after),
                loaded,
                skipped,
                durationMs,
                cappedByRecords,
                firstCursor,
                lastCursor,
                pageHash: debug.pageHash,
                headSample,
                tailSample,
                frameSizeLimit: this.frameSizeLimit,
            },
            'negentropy adapter rebuilt'
        );

        return {
            window: cloneWindow(window),
            stats: cloneWindowStats(windowStats),
            debug: cloneWindowDebugInfo(debug),
            storage,
        };
    }

    private async reconcileWindowWithPeer(
        localEngine: NegentropyWindowEngine,
        peerEngine: NegentropyWindowEngine,
        maxRounds: number,
    ): Promise<{ rounds: number; completed: boolean; cappedByRounds: boolean }> {
        let msg: string | Uint8Array | null = await localEngine.initiate();
        let rounds = 0;

        while (msg !== null && rounds < maxRounds) {
            rounds += 1;
            const response = await peerEngine.respond(msg);
            if (response === null) {
                msg = null;
                break;
            }

            const reconcileResult = await localEngine.reconcile(response);
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

function minCursor(a: SyncStoreCursor | null, b: SyncStoreCursor): SyncStoreCursor {
    if (!a) {
        return cloneCursor(b)!;
    }

    if (a.ts !== b.ts) {
        return a.ts < b.ts ? cloneCursor(a)! : cloneCursor(b)!;
    }

    return a.id.localeCompare(b.id) <= 0
        ? cloneCursor(a)!
        : cloneCursor(b)!;
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
