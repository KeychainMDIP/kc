import type {
    BlockId,
    BlockInfo,
    IndexExportBlockRecord,
    IndexExportRequest,
    IndexExportResponse,
} from "@mdip/gatekeeper/types";
import { childLogger } from "@mdip/common/logger";
import type {
    ApplyIndexPageResult,
    DIDProjectionUpdate,
    DIDsDb,
} from "./types.js";
import {
    buildDIDProjectionUpdate,
    ProjectionBlockLookup,
} from "./projections.js";

export interface GatekeeperIndexClient {
    isReady(): Promise<boolean>;
    exportIndex(request: IndexExportRequest): Promise<IndexExportResponse>;
}

export interface DidIndexerOptions {
    intervalMs: number;
    pageLimit?: number;
}

export const INDEX_SYNC_STATE_KEYS = {
    snapshotComplete: 'index.snapshot.complete',
    snapshotCursor: 'index.snapshot.cursor',
    snapshotCheckpointCursor: 'index.snapshot.checkpointCursor',
    changesCursor: 'index.changes.cursor',
    lastSyncStartedAt: 'index.lastSyncStartedAt',
    lastSyncCompletedAt: 'index.lastSyncCompletedAt',
    lastSyncError: 'index.lastSyncError',
    lastSyncMode: 'index.lastSyncMode',
    lastPagesProcessed: 'index.lastPagesProcessed',
    lastDidsChanged: 'index.lastDidsChanged',
    lastBlocksStored: 'index.lastBlocksStored',
} as const;

interface SyncRunStats {
    mode: 'snapshot' | 'changes';
    pages: number;
    changedDids: number;
    storedBlocks: number;
    removedBlocks: number;
    removedDids: number;
}

export default class DidIndexer {
    private gatekeeper: GatekeeperIndexClient;
    private db: DIDsDb;
    private readonly intervalMs: number;
    private readonly pageLimit: number;
    private timer: NodeJS.Timeout | null;
    private refreshInProgress: boolean;
    private log = childLogger({ service: 'search-server', module: 'DidIndexer' });

    constructor(
        gatekeeper: GatekeeperIndexClient,
        db: DIDsDb,
        options: DidIndexerOptions
    ) {
        this.gatekeeper = gatekeeper;
        this.db = db;
        this.intervalMs = options.intervalMs;
        this.pageLimit = options.pageLimit ?? 500;
        this.timer = null;
        this.refreshInProgress = false;
    }

    async startIndexing(): Promise<void> {
        this.log.info("Starting indexing...");
        await this.refreshIndex();

        this.timer = setInterval(() => {
            this.refreshIndex().catch((err) => {
                this.log.error({ error: err }, "refreshIndex error");
            });
        }, this.intervalMs);
    }

    stopIndexing(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async refreshIndex(): Promise<void> {
        if (!(await this.gatekeeper.isReady()) || this.refreshInProgress) {
            return;
        }
        this.refreshInProgress = true;

        try {
            const startedAt = new Date().toISOString();
            await this.db.saveSyncState(INDEX_SYNC_STATE_KEYS.lastSyncStartedAt, startedAt);

            const snapshotComplete = await this.isSnapshotComplete();
            const stats = snapshotComplete
                ? await this.syncChanges()
                : await this.syncSnapshot();

            await this.saveRunStats(stats);
            await this.db.saveSyncState(INDEX_SYNC_STATE_KEYS.lastSyncError, null);

            this.log.info(
                `Indexed ${stats.changedDids} changed DIDs from ${stats.pages} ${stats.mode} page(s). ` +
                `Stored ${stats.storedBlocks} block(s).`
            );
        } catch (err) {
            try {
                await this.db.saveSyncState(INDEX_SYNC_STATE_KEYS.lastSyncError, String(err));
            }
            catch (saveError) {
                this.log.warn({ error: saveError }, "Could not save sync error state");
            }

            this.log.error({ error: err }, "Error in refreshIndex");
        } finally {
            this.refreshInProgress = false;
        }
    }

    private async isSnapshotComplete(): Promise<boolean> {
        return await this.db.loadSyncState(INDEX_SYNC_STATE_KEYS.snapshotComplete) === 'true';
    }

    private async syncSnapshot(): Promise<SyncRunStats> {
        const stats = this.createStats('snapshot');
        let cursor = await this.db.loadSyncState(INDEX_SYNC_STATE_KEYS.snapshotCursor);
        let checkpointCursor = await this.db.loadSyncState(INDEX_SYNC_STATE_KEYS.snapshotCheckpointCursor);

        if (cursor && !checkpointCursor) {
            throw new Error('Snapshot cursor found without checkpointCursor');
        }
        if (!cursor && checkpointCursor) {
            throw new Error('Snapshot checkpointCursor found without cursor');
        }

        while (true) {
            const response = await this.gatekeeper.exportIndex({
                mode: 'snapshot',
                cursor,
                ...(checkpointCursor ? { checkpointCursor } : {}),
                limit: this.pageLimit,
            });

            if (response.mode !== 'snapshot') {
                throw new Error(`Expected snapshot export response, got ${response.mode}`);
            }
            if (response.checkpointCursor === undefined) {
                throw new Error('Snapshot export response missing checkpointCursor');
            }

            const responseCheckpointCursor = response.checkpointCursor ?? '0';
            if (checkpointCursor && responseCheckpointCursor !== checkpointCursor) {
                throw new Error(
                    `Snapshot export checkpoint changed from ${checkpointCursor} to ${responseCheckpointCursor}`
                );
            }
            checkpointCursor = checkpointCursor ?? responseCheckpointCursor;

            const nextCursor = response.cursor;
            const syncStateUpdates: Record<string, string | null> = {
                [INDEX_SYNC_STATE_KEYS.snapshotCursor]: nextCursor,
                [INDEX_SYNC_STATE_KEYS.snapshotCheckpointCursor]: checkpointCursor,
            };

            if (!response.hasMore) {
                syncStateUpdates[INDEX_SYNC_STATE_KEYS.snapshotComplete] = 'true';
                syncStateUpdates[INDEX_SYNC_STATE_KEYS.changesCursor] = checkpointCursor;
            }

            const result = await this.applyExportPage(response, syncStateUpdates);
            this.addPageStats(stats, result);

            stats.pages += 1;

            if (!response.hasMore) {
                return stats;
            }

            if (!nextCursor || nextCursor === cursor) {
                throw new Error('Snapshot export did not advance cursor');
            }

            cursor = nextCursor;
        }
    }

    private async syncChanges(): Promise<SyncRunStats> {
        const stats = this.createStats('changes');
        let cursor = await this.db.loadSyncState(INDEX_SYNC_STATE_KEYS.changesCursor);

        while (true) {
            const response = await this.gatekeeper.exportIndex({
                mode: 'changes',
                cursor,
                limit: this.pageLimit,
            });

            if (response.mode !== 'changes') {
                throw new Error(`Expected changes export response, got ${response.mode}`);
            }

            const nextCursor = response.cursor ?? cursor ?? '0';
            const result = await this.applyExportPage(response, {
                [INDEX_SYNC_STATE_KEYS.changesCursor]: nextCursor,
            });
            this.addPageStats(stats, result);

            stats.pages += 1;

            if (!response.hasMore) {
                return stats;
            }

            if (!nextCursor || nextCursor === cursor) {
                throw new Error('Changes export did not advance cursor');
            }

            cursor = nextCursor;
        }
    }

    private async applyExportPage(
        response: IndexExportResponse,
        syncStateUpdates: Record<string, string | null>
    ): Promise<ApplyIndexPageResult> {
        const getBlock = this.createPageBlockLookup(response.blocks);
        const dids: DIDProjectionUpdate[] = [];

        for (const record of response.dids) {
            dids.push(await buildDIDProjectionUpdate(this.db, record.did, record.events, {
                removed: record.removed,
                getBlock,
            }));
        }

        return this.db.applyIndexPage({
            dids,
            blocks: response.blocks,
            syncStateUpdates,
        });
    }

    private createPageBlockLookup(blocks: IndexExportBlockRecord[]): ProjectionBlockLookup {
        const byHash = new Map<string, BlockInfo>();
        const byHeight = new Map<string, BlockInfo>();
        const latestByRegistry = new Map<string, BlockInfo>();

        for (const record of blocks) {
            if (record.removed) {
                continue;
            }

            byHash.set(`${record.registry}\u0000${record.block.hash}`, record.block);
            byHeight.set(`${record.registry}\u0000${record.block.height}`, record.block);

            const latest = latestByRegistry.get(record.registry);
            if (!latest || record.block.height > latest.height) {
                latestByRegistry.set(record.registry, record.block);
            }
        }

        return async (registry: string, block?: BlockId): Promise<BlockInfo | null> => {
            if (block === undefined) {
                return latestByRegistry.get(registry) ?? this.db.getBlock(registry);
            }

            if (typeof block === 'number') {
                return byHeight.get(`${registry}\u0000${block}`) ?? this.db.getBlock(registry, block);
            }

            return byHash.get(`${registry}\u0000${block}`) ?? this.db.getBlock(registry, block);
        };
    }

    private createStats(mode: 'snapshot' | 'changes'): SyncRunStats {
        return {
            mode,
            pages: 0,
            changedDids: 0,
            storedBlocks: 0,
            removedBlocks: 0,
            removedDids: 0,
        };
    }

    private addPageStats(stats: SyncRunStats, result: ApplyIndexPageResult): void {
        stats.changedDids += result.changedDids.length;
        stats.storedBlocks += result.storedBlocks;
        stats.removedBlocks += result.removedBlocks;
        stats.removedDids += result.removedDids;
    }

    private async saveRunStats(stats: SyncRunStats): Promise<void> {
        await this.db.saveSyncState(INDEX_SYNC_STATE_KEYS.lastSyncCompletedAt, new Date().toISOString());
        await this.db.saveSyncState(INDEX_SYNC_STATE_KEYS.lastSyncMode, stats.mode);
        await this.db.saveSyncState(INDEX_SYNC_STATE_KEYS.lastPagesProcessed, stats.pages.toString());
        await this.db.saveSyncState(INDEX_SYNC_STATE_KEYS.lastDidsChanged, stats.changedDids.toString());
        await this.db.saveSyncState(INDEX_SYNC_STATE_KEYS.lastBlocksStored, stats.storedBlocks.toString());
    }
}
