import { InvalidDIDError } from '@mdip/common/errors';
import { copyJSON } from '@mdip/common/utils';
import { randomUUID } from 'crypto';
import {
    DIDLifecycle,
    DeleteEventsOptions,
    DueDIDCursor,
    ExpirationJob,
    LifecycleMetadata,
    BlockId,
    BlockInfo,
    JsonDbFile,
    GatekeeperDb,
    GatekeeperEvent,
    IndexChangeRecord,
    IndexExportChangesOptions,
    IndexExportResponse,
    IndexExportSnapshotOptions,
    Operation,
    SetEventsOptions,
} from '../types.js';
import {
    buildIndexChangesResponse,
    exportIndexSnapshotFromAllKeysForLocalDb,
    normalizeIndexExportLimit,
    parseIndexExportCursor
} from './index-export.js';

import { LIFECYCLE_VERSION, LIFECYCLE_PAGE_SIZE, isExpirationJob, lifecycleLimit, lifecycleSuffix, projectLifecycle } from './lifecycle.js';

export abstract class AbstractJson implements GatekeeperDb {
    protected readonly dataFolder: string;
    protected readonly dbName: string;

    private _lock: Promise<void> = Promise.resolve();
    protected runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
        const run = async () => await fn();
        const chained = this._lock.then(run, run);
        this._lock = chained.then(() => undefined, () => undefined);
        return chained;
    }

    protected constructor(name: string, folder: string = 'data') {
        this.dataFolder = folder;
        this.dbName = `${this.dataFolder}/${name}.json`;
    }

    protected abstract loadDb(): JsonDbFile;

    protected abstract writeDb(db: JsonDbFile): void;

    abstract resetDb(): Promise<void | number | JsonDbFile>;

    private recordIndexChange(
        db: JsonDbFile,
        change: Omit<IndexChangeRecord, 'seq'>
    ): IndexChangeRecord {
        const seq = (db.indexSeq ?? 0) + 1;
        const record = { seq, ...change, ...(change.kind === 'did' && { lifecycleVersion: LIFECYCLE_VERSION }) };

        db.indexSeq = seq;
        if (!db.indexChanges) {
            db.indexChanges = [];
        }
        db.indexChanges.push(record);

        return record;
    }

    async start(): Promise<void> {
        await this.initializeLifecycleIndex();
    }

    async stop(): Promise<void> {
        return;
    }

    async isReady(): Promise<boolean> {
        return true;
    }

    private splitSuffix(did: string): string {
        if (!did) {
            throw new InvalidDIDError();
        }
        const suffix = did.split(':').pop();
        if (!suffix) {
            throw new InvalidDIDError();
        }
        return suffix;
    }

    async addEvent(did: string, event: GatekeeperEvent): Promise<void> {
        return this.addEventAndQueue(did, event, []);
    }

    async addEventAndQueue(did: string, event: GatekeeperEvent, queueRegistries: string[]): Promise<void> {
        const suffix = this.splitSuffix(did);
        return this.runExclusive(async () => {
            const db = this.loadDb();
            const previous = db.lifecycle?.[suffix] ?? (db.dids[suffix]?.length ? null : undefined);
            const stateEvents = event.operation.type === 'create' && db.dids[suffix]?.length ? [] : [event];
            if (db.dids[suffix]) {
                db.dids[suffix].push(event);
            } else {
                db.dids[suffix] = [event];
            }
            this.recordIndexChange(db, {
                kind: 'did',
                did,
                event,
            });
            this.updateLifecycle(db, did, stateEvents, previous);
            for (const registry of queueRegistries) {
                db.queue ??= {};
                db.queue[registry] ??= [];
                db.queue[registry].push(event.operation);
            }
            this.writeDb(db);
        });
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        const db = this.loadDb();
        const suffix = this.splitSuffix(did);
        const updates = db.dids[suffix] || [];
        return JSON.parse(JSON.stringify(updates));
    }

    async setEvents(did: string, events: GatekeeperEvent[], options?: SetEventsOptions): Promise<void> {
        const suffix = this.splitSuffix(did);
        return this.runExclusive(async () => {
            const db = this.loadDb();
            const operationEvents = options?.operationEvents ?? [];
            db.dids[suffix] = events;
            this.updateLifecycle(db, did, events);

            if (operationEvents.length === 0) {
                this.recordIndexChange(db, { kind: 'did', did });
                this.writeDb(db);
                return;
            }

            for (const event of operationEvents) {
                this.recordIndexChange(db, {
                    kind: 'did',
                    did,
                    event,
                });
            }
            this.writeDb(db);
        });
    }

    async deleteEvents(did: string, expected?: DeleteEventsOptions): Promise<number | void> {
        const suffix = this.splitSuffix(did);
        return this.runExclusive(async () => {
            const db = this.loadDb();
            if (expected && (!db.lifecycleMetadata?.complete ||
                db.lifecycleMetadata.version !== LIFECYCLE_VERSION ||
                db.lifecycleMetadata.epoch !== db.indexEpoch ||
                !expected.epoch || !expected.revision || db.indexEpoch !== expected.epoch ||
                db.lifecycle?.[suffix]?.revision !== expected.revision)) return 0;
            const events = db.dids[suffix];
            if (events) {
                delete db.lifecycle?.[suffix];
                delete db.dids[suffix];
                if (events.length === 0) {
                    this.recordIndexChange(db, { kind: 'did', did, removed: true });
                }
                for (const event of events) {
                    this.recordIndexChange(db, { kind: 'did', did, event, removed: true });
                }
                this.writeDb(db);
                return 1;
            }
            return 0;
        });
    }

    private updateLifecycle(db: JsonDbFile, did: string, events: GatekeeperEvent[], previous?: DIDLifecycle | null): void {
        const suffix = lifecycleSuffix(did);
        const row = projectLifecycle(did, events, previous);
        db.lifecycle ??= {};
        if (row) db.lifecycle[suffix] = row;
        else delete db.lifecycle[suffix];
        const job = db.expirationJobs?.[suffix];
        if (job && row && (row.type !== 'agent' || row.expiresAt !== job.expiresAt)) {
            delete db.expirationJobs![suffix];
        }
        if (job && !row && events.length > 0) delete db.expirationJobs![suffix];
    }

    async initializeLifecycleIndex(): Promise<void> {
        await this.runExclusive(() => {
            let db = this.loadDb();
            const epoch = db.indexEpoch ??= randomUUID();
            const state = db.lifecycleMetadata;
            const changes = db.indexChanges ?? [];
            let uncovered = false;
            for (let i = changes.length - 1; i >= 0; i--) {
                const change = changes[i];
                if (BigInt(change.seq) <= BigInt(state?.checkedCursor ?? '0')) break;
                if (change.kind === 'did' && change.lifecycleVersion !== LIFECYCLE_VERSION) {
                    uncovered = true;
                    break;
                }
            }
            const incompatible = state?.version !== LIFECYCLE_VERSION || state.epoch !== db.indexEpoch ||
                !db.lifecycle || !db.expirationJobs || uncovered ||
                BigInt(state.checkedCursor) > BigInt(db.indexSeq ?? 0);
            if (incompatible) {
                if (state?.epoch !== db.indexEpoch) db.expirationJobs = {};
                db.expirationJobs ??= {};
                db.lifecycle = {};
                db.lifecycleMetadata = {
                    version: LIFECYCLE_VERSION, epoch: db.indexEpoch, complete: false,
                    checkedCursor: String(db.indexSeq ?? 0),
                };
                this.writeDb(db);
            }
            if (!db.lifecycleMetadata!.complete) {
                const keys = Object.keys(db.dids).sort()
                    .filter(suffix => !db.lifecycleMetadata!.backfillCursor || suffix > db.lifecycleMetadata!.backfillCursor);
                for (let offset = 0; offset < keys.length; offset += LIFECYCLE_PAGE_SIZE) {
                    const page = keys.slice(offset, offset + LIFECYCLE_PAGE_SIZE);
                    for (const suffix of page) {
                        const events = db.dids[suffix];
                        const envelopeDID = events[0]?.did;
                        const did = envelopeDID && lifecycleSuffix(envelopeDID) === suffix ? envelopeDID : suffix;
                        this.updateLifecycle(db, did, events);
                    }
                    db.lifecycleMetadata!.backfillCursor = page[page.length - 1];
                    this.writeDb(db);
                    db = this.loadDb();
                    if (db.indexEpoch !== epoch) throw new Error('Lifecycle index epoch changed during backfill');
                }
            }
            if (db.lifecycleMetadata!.complete &&
                db.lifecycleMetadata!.checkedCursor === String(db.indexSeq ?? 0)) return;
            db.lifecycleMetadata = {
                version: LIFECYCLE_VERSION, epoch, complete: true,
                checkedCursor: String(db.indexSeq ?? 0),
            };
            this.writeDb(db);
        });
    }

    async getLifecycleMetadata(): Promise<LifecycleMetadata> {
        const db = this.loadDb();
        const state = db.lifecycleMetadata;
        if (!state?.complete || state.version !== LIFECYCLE_VERSION || state.epoch !== db.indexEpoch ||
            !db.lifecycle || !db.expirationJobs) {
            throw new Error('Lifecycle index is not initialized');
        }
        return { ...state };
    }

    async getLifecycle(did: string): Promise<DIDLifecycle | null> {
        return copyJSON(this.loadDb().lifecycle?.[lifecycleSuffix(did)] ?? null);
    }

    async getDueDIDs(cutoff: number, limit: number, after?: DueDIDCursor): Promise<DIDLifecycle[]> {
        return Object.values(this.loadDb().lifecycle ?? {})
            .filter(row => !row.unresolved && row.expiresAt !== undefined && row.expiresAt < cutoff
                && (!after || row.expiresAt > after.expiresAt
                    || (row.expiresAt === after.expiresAt && row.suffix > after.suffix)))
            .sort((a, b) => a.expiresAt! - b.expiresAt! || (a.suffix < b.suffix ? -1 : 1))
            .slice(0, lifecycleLimit(limit)).map(row => ({ ...row }));
    }

    async getControlledDIDs(controller: string, limit: number, after?: string): Promise<DIDLifecycle[]> {
        return Object.values(this.loadDb().lifecycle ?? {})
            .filter(row => row.type === 'asset' && row.controller === lifecycleSuffix(controller)
                && (!after || row.suffix > after))
            .sort((a, b) => a.suffix < b.suffix ? -1 : 1)
            .slice(0, lifecycleLimit(limit)).map(row => ({ ...row }));
    }

    async hasUnresolvedLifecycle(): Promise<boolean> {
        return Object.values(this.loadDb().lifecycle ?? {}).some(row => !!row.controllerUnknown);
    }

    async getExpirationJobs(limit: number, after?: string): Promise<ExpirationJob[]> {
        return Object.values(this.loadDb().expirationJobs ?? {})
            .filter(row => !after || row.suffix > after)
            .sort((a, b) => a.suffix < b.suffix ? -1 : 1)
            .slice(0, lifecycleLimit(limit)).map(row => ({ ...row }));
    }

    async getExpirationJob(suffix: string): Promise<ExpirationJob | null> {
        return copyJSON(this.loadDb().expirationJobs?.[suffix] ?? null);
    }

    async saveExpirationJob(suffix: string, job: ExpirationJob | null): Promise<void> {
        if (job && (!isExpirationJob(job) || job.suffix !== suffix)) {
            throw new Error('Invalid expiration cleanup job');
        }
        await this.runExclusive(() => {
            const db = this.loadDb();
            db.expirationJobs ??= {};
            if (job) db.expirationJobs[suffix] = { ...job };
            else delete db.expirationJobs[suffix];
            this.writeDb(db);
        });
    }

    async queueOperation(registry: string, op: Operation): Promise<number> {
        return this.runExclusive(async () => {
            const db = this.loadDb();
            if (!db.queue) {
                db.queue = {};
            }
            if (registry in db.queue) {
                db.queue[registry].push(op);
            }
            else db.queue[registry] = [op];
            this.writeDb(db);
            return db.queue[registry].length;
        });
    }

    async getQueue(registry: string): Promise<Operation[]> {
        try {
            const db = this.loadDb();
            if (!db.queue || !db.queue[registry]) {
                return [];
            }
            return db.queue[registry];
        } catch {
            return [];
        }
    }

    async clearQueue(registry: string, batch: Operation[]): Promise<boolean> {
        return this.runExclusive(async () => {
            try {
                const db = this.loadDb();
                if (!db.queue) {
                    return true;
                }
                const oldQueue = db.queue[registry];
                if (!oldQueue) {
                    return true;
                }
                db.queue[registry] = oldQueue.filter(
                    item => !batch.some(op => op.signature?.value === item.signature?.value)
                );
                this.writeDb(db);
                return true;
            } catch {
                return false;
            }
        });
    }

    async getAllKeys(): Promise<string[]> {
        const db = this.loadDb();
        return Object.keys(db.dids);
    }

    private async getIndexEpoch(): Promise<string> {
        const db = this.loadDb();
        if (!db.indexEpoch) {
            db.indexEpoch = randomUUID();
            this.writeDb(db);
        }
        return db.indexEpoch;
    }

    private async getIndexCheckpointCursor(): Promise<string> {
        const db = this.loadDb();
        return (db.indexSeq ?? 0).toString();
    }

    async exportIndexSnapshot(_options?: IndexExportSnapshotOptions): Promise<IndexExportResponse> {
        return exportIndexSnapshotFromAllKeysForLocalDb(
            () => this.getAllKeys(),
            did => this.getEvents(did),
            _options,
            () => this.getIndexCheckpointCursor(),
            () => this.getIndexEpoch()
        );
    }

    async exportIndexChanges(_options?: IndexExportChangesOptions): Promise<IndexExportResponse> {
        const options = _options ?? {};
        const afterSeq = parseIndexExportCursor(options.cursor);
        const limit = normalizeIndexExportLimit(options.limit);
        const db = this.loadDb();
        const checkpointCursor = await this.getIndexCheckpointCursor();
        const changes = (db.indexChanges ?? [])
            .filter(change => change.seq > afterSeq)
            .sort((a, b) => a.seq - b.seq);
        const page = changes.slice(0, limit);

        return buildIndexChangesResponse(
            page,
            changes.length > limit,
            options,
            checkpointCursor,
            did => this.getEvents(did),
            await this.getIndexEpoch()
        );
    }

    async addBlock(registry: string, blockInfo: BlockInfo): Promise<boolean> {
        return this.runExclusive(async () => {
            const db = this.loadDb();
            if (!db.blocks) {
                db.blocks = {};
            }
            if (!(registry in db.blocks)) {
                db.blocks[registry] = {};
            }
            db.blocks[registry][blockInfo.hash] = blockInfo;
            this.recordIndexChange(db, { kind: 'block', registry, block: blockInfo });
            this.writeDb(db);
            return true;
        });
    }

    async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
        const db = this.loadDb();

        const registryBlocks = db.blocks?.[registry] as Record<string, BlockInfo> | undefined;
        if (!registryBlocks) return null;

        const blockEntries = Object.entries(registryBlocks);

        if (blockEntries.length === 0) return null;

        if (blockId === undefined) {
            // Get block with max height
            let maxBlock: BlockInfo | null = null;
            for (const [, block] of blockEntries) {
                if (!maxBlock || block.height > maxBlock.height) {
                    maxBlock = block;
                }
            }
            return maxBlock;
        }

        if (typeof blockId === 'number') {
            // Search for block with matching height
            for (const [, block] of blockEntries) {
                if (block.height === blockId) return block;
            }
            return null;
        }

        // Lookup by hash (O(1))
        return registryBlocks[blockId] || null;
    }
}
