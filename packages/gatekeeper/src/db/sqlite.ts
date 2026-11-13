import * as sqlite from 'sqlite';
import sqlite3 from 'sqlite3';
import { randomUUID } from 'crypto';
import { InvalidDIDError } from '@mdip/common/errors';
import { childLogger } from '@mdip/common/logger';
import { LIFECYCLE_VERSION, LIFECYCLE_PAGE_SIZE, isDIDLifecycle, isExpirationJob, isLifecycleMetadata, lifecycleLimit, projectLifecycle } from './lifecycle.js';
import {
    DIDLifecycle,
    DeleteEventsOptions,
    DueDIDCursor,
    ExpirationJob,
    LifecycleMetadata,
    GatekeeperDb,
    GatekeeperEvent,
    Operation,
    BlockId,
    BlockInfo,
    IndexExportSnapshotOptions,
    IndexExportResponse,
    IndexExportChangesOptions,
    SetEventsOptions,
} from '../types.js'
import {
    buildIndexChangesResponse,
    buildIndexSnapshotResponseFromPageKeys,
    normalizeIndexExportLimit,
    parseIndexExportCursor
} from './index-export.js';

interface DidsRow {
    id: string
    events: string
}

interface QueueRow {
    id: string
    ops: string
}

interface IndexChangeRow {
    seq: number;
    kind: string;
    did?: string | null;
    registry?: string | null;
    block?: string | null;
    event?: string | null;
    removed: number;
}

const SQLITE_NOT_STARTED_ERROR = 'SQLite DB not open. Call start() first.';
const log = childLogger({ service: 'gatekeeper-db', module: 'sqlite' });


export default class DbSqlite implements GatekeeperDb {
    private readonly dbName: string;
    private db: sqlite.Database | null;

    constructor(name: string, dataFolder: string = 'data') {
        this.dbName = `${dataFolder}/${name}.db`;
        this.db = null
    }

    private _lock: Promise<void> = Promise.resolve();
    private runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
        const run = async () => await fn();
        const chained = this._lock.then(run, run);
        this._lock = chained.then(() => undefined, () => undefined);
        return chained;
    }

    private async withTx<T>(fn: () => Promise<T>): Promise<T> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }
        await this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = await fn();
            await this.db.exec('COMMIT');
            return result;
        } catch (e) {
            try {
                await this.db.exec('ROLLBACK');
            } catch {}
            throw e;
        }
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

    async start(): Promise<void> {
        this.db = await sqlite.open({
            filename: this.dbName,
            driver: sqlite3.Database
        });

        try {
            await this.db.exec(`CREATE TABLE IF NOT EXISTS dids (
            id TEXT PRIMARY KEY,
            events TEXT
        )`);

            await this.db.exec(`CREATE TABLE IF NOT EXISTS queue (
            id TEXT PRIMARY KEY,
            ops TEXT
        )`);

            await this.db.exec(`CREATE TABLE IF NOT EXISTS index_changes (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            did TEXT,
            registry TEXT,
            block TEXT,
            event TEXT,
            removed INTEGER NOT NULL DEFAULT 0
        )`);

            await this.db.exec(`CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )`);

            await this.db.exec(`CREATE TABLE IF NOT EXISTS blocks (
                registry TEXT NOT NULL,
                hash TEXT NOT NULL,
                height INTEGER NOT NULL,
                time TEXT NOT NULL,
                txns INTEGER NOT NULL,
                PRIMARY KEY (registry, hash)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_registry_height ON blocks (registry, height);
        `);

            await this.migrateSchema();
            await this.ensureIndexEpoch();
            const exists = await this.db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lifecycle'");
            if (!exists) await this.db.run("DELETE FROM metadata WHERE key = 'lifecycle'");
            await this.db.exec(`CREATE TABLE IF NOT EXISTS lifecycle (
                kind TEXT NOT NULL, id TEXT NOT NULL, record TEXT NOT NULL, expires_at INTEGER,
                controller TEXT, unresolved INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(kind, id));
                CREATE INDEX IF NOT EXISTS lifecycle_due ON lifecycle(kind, expires_at, id) WHERE expires_at IS NOT NULL;
                CREATE INDEX IF NOT EXISTS lifecycle_controller ON lifecycle(kind, controller, id) WHERE controller IS NOT NULL;
                CREATE INDEX IF NOT EXISTS lifecycle_unresolved ON lifecycle(kind, id) WHERE unresolved = 1;`);
            await this.initializeLifecycleIndex();
        } catch (error) {
            try { await this.stop(); } catch { /* Preserve the startup failure. */ }
            throw error;
        }
    }

    private async migrateSchema(): Promise<void> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        const indexChangeColumns = await this.db.all<{ name: string }[]>('PRAGMA table_info(index_changes)');
        const hasEventColumn = indexChangeColumns.some(column => column.name === 'event');

        if (!hasEventColumn) {
            await this.db.exec('ALTER TABLE index_changes ADD COLUMN event TEXT');
        }
        if (!indexChangeColumns.some(column => column.name === 'lifecycle_version')) {
            await this.db.exec('ALTER TABLE index_changes ADD COLUMN lifecycle_version INTEGER');
        }
        await this.db.exec(`CREATE INDEX IF NOT EXISTS index_changes_lifecycle_missing
            ON index_changes(seq) WHERE kind = 'did' AND lifecycle_version IS NOT 1`);
    }

    async stop(): Promise<void> {
        if (this.db) {
            await this.db.close();
            this.db = null;
        }
    }

    async isReady(): Promise<boolean> {
        if (!this.db) {
            return false;
        }

        try {
            await this.db.get('SELECT 1');
            return true;
        }
        catch {
            return false;
        }
    }


    async resetDb(): Promise<void> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }
        await this.runExclusive(async () => {
            await this.withTx(async () => {
                await this.db!.run('DELETE FROM lifecycle');
                await this.db!.run("DELETE FROM metadata WHERE key = 'lifecycle'");
                await this.db!.run('DELETE FROM dids');
                await this.db!.run('DELETE FROM queue');
                await this.db!.run('DELETE FROM blocks');
                await this.db!.run('DELETE FROM index_changes');
                await this.db!.run(
                    `INSERT INTO metadata (key, value)
                     VALUES ('indexEpoch', ?)
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
                    randomUUID()
                );
            });
        });
    }

    async addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        return this.addEventAndQueue(did, event, []);
    }

    async addEventAndQueue(did: string, event: GatekeeperEvent, queueRegistries: string[]): Promise<number> {
        if (!did) {
            throw new InvalidDIDError();
        }

        return this.runExclusive(() =>
            this.withTx(async () => {
                const id = this.splitSuffix(did);
                const events = await this.getEventsStrict(id);
                events.push(event);
                const changes = await this.setEventsStrict(id, events);
                await this.recordIndexChangeStrict({
                    kind: 'did',
                    did,
                    event,
                });
                for (const registry of queueRegistries) {
                    await this.queueOperationStrict(registry, event.operation);
                }
                return changes;
            })
        );
    }

    private async recordIndexChangeStrict(change: {
        kind: 'did' | 'block';
        did?: string;
        registry?: string;
        block?: BlockInfo;
        event?: GatekeeperEvent;
        removed?: boolean;
    }): Promise<void> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        await this.db.run(
            `INSERT INTO index_changes(kind, did, registry, block, removed, event, lifecycle_version)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            change.kind,
            change.did ?? null,
            change.registry ?? null,
            change.block ? JSON.stringify(change.block) : null,
            change.removed ? 1 : 0,
            change.event ? JSON.stringify(change.event) : null
        );
    }

    private async setEventsStrict(id: string, events: GatekeeperEvent[]): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }
        const res = await this.db.run(
            `INSERT OR REPLACE INTO dids(id, events) VALUES(?, ?)`,
            id,
            JSON.stringify(events)
        );
        await this.writeLifecycle(id, events);
        return res.changes ?? 0;
    }


    async setEvents(did: string, events: GatekeeperEvent[], options?: SetEventsOptions): Promise<number> {
        const id = this.splitSuffix(did);
        return this.runExclusive(() =>
            this.withTx(async () => {
                const changes = await this.setEventsStrict(id, events);
                const operationEvents = options?.operationEvents ?? [];

                if (operationEvents.length === 0) {
                    await this.recordIndexChangeStrict({
                        kind: 'did',
                        did,
                    });
                } else {
                    for (const event of operationEvents) {
                        await this.recordIndexChangeStrict({
                            kind: 'did',
                            did,
                            event,
                        });
                    }
                }

                return changes;
            })
        );
    }

    private async getEventsStrict(id: string): Promise<GatekeeperEvent[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }
        const row = await this.db!.get<DidsRow>('SELECT events FROM dids WHERE id = ?', id);
        if (!row) {
            return [];
        }
        const events = JSON.parse(row.events);
        if (!Array.isArray(events)) {
            throw new Error('events is not an array');
        }
        return events as GatekeeperEvent[];
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        const id = this.splitSuffix(did);
        return this.getEventsStrict(id);
    }

    async deleteEvents(did: string, expected?: DeleteEventsOptions): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        return this.runExclusive(() =>
            this.withTx(async () => {
                const id = this.splitSuffix(did);
                if (expected) {
                    const state = await this.getLifecycleMetadata();
                    const row = await this.getLifecycle(did);
                    if (state.epoch !== expected.epoch || row?.revision !== expected.revision) return 0;
                }
                const events = await this.getEventsStrict(id);
                const result = await this.db!.run('DELETE FROM dids WHERE id = ?', id);
                await this.db!.run("DELETE FROM lifecycle WHERE kind = 'did' AND id = ?", id);
                if ((result.changes ?? 0) > 0) {
                    if (events.length === 0) {
                        await this.recordIndexChangeStrict({ kind: 'did', did, removed: true });
                    }
                    for (const event of events) {
                        await this.recordIndexChangeStrict({ kind: 'did', did, event, removed: true });
                    }
                }
                return result.changes ?? 0;
            })
        );
    }

    private async queueOperationStrict(registry: string, op: Operation): Promise<number> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        const ops = await this.getQueueStrict(registry);
        ops.push(op);
        await this.db.run(
            `INSERT OR REPLACE INTO queue(id, ops) VALUES(?, ?)`,
            registry,
            JSON.stringify(ops)
        );
        return ops.length;
    }

    async queueOperation(registry: string, op: Operation): Promise<number> {
        return this.runExclusive(() =>
            this.withTx(() => this.queueOperationStrict(registry, op))
        );
    }

    private async getQueueStrict(registry: string): Promise<Operation[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        const row = await this.db.get<QueueRow>('SELECT ops FROM queue WHERE id = ?', registry);
        if (!row) {
            return [];
        }

        const ops = JSON.parse(row.ops);
        if (!Array.isArray(ops)) {
            throw new Error('queue row malformed: ops is not an array');
        }

        return ops as Operation[];
    }

    async getQueue(registry: string): Promise<Operation[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        try {
            return await this.getQueueStrict(registry);
        } catch {
            return [];
        }
    }

    async clearQueue(registry: string, batch: Operation[]): Promise<boolean> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        return this.runExclusive(async () =>
            this.withTx(async () => {
                const oldQueue = await this.getQueueStrict(registry);

                const batchHashes = new Set(
                    batch.map(b => b.signature?.hash).filter((h): h is string => h !== undefined)
                );
                const newQueue = oldQueue.filter(
                    item => !batchHashes.has(item.signature?.hash || '')
                );
                await this.db!.run(
                    `INSERT OR REPLACE INTO queue(id, ops) VALUES(?, ?)`,
                    registry,
                    JSON.stringify(newQueue)
                );
                return true;
            }).catch(err => {
                log.error({ error: err }, 'SQLite clearQueue error');
                return false;
            })
        );
    }

    private async writeLifecycle(did: string, events: GatekeeperEvent[]): Promise<void> {
        const suffix = this.splitSuffix(did);
        const row = projectLifecycle(did, events);
        await this.db!.run("DELETE FROM lifecycle WHERE kind = 'did' AND id = ?", suffix);
        if (row) await this.insertLifecycle(row);
        if (events.length === 0) return;
        const job = await this.db!.get<{ record: string }>("SELECT record FROM lifecycle WHERE kind = 'job' AND id = ?", suffix);
        if (job && (!row || row.type !== 'agent' || JSON.parse(job.record).expiresAt !== row.expiresAt)) {
            await this.db!.run("DELETE FROM lifecycle WHERE kind = 'job' AND id = ?", suffix);
        }
    }

    private async insertLifecycle(row: DIDLifecycle): Promise<void> {
        await this.db!.run(`INSERT INTO lifecycle(kind, id, record, expires_at, controller, unresolved)
            VALUES ('did', ?, ?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET record = excluded.record,
                expires_at = excluded.expires_at, controller = excluded.controller, unresolved = excluded.unresolved`,
        row.suffix, JSON.stringify(row), row.expiresAt ?? null, row.controller ?? null, row.controllerUnknown ? 1 : 0);
    }

    private async saveLifecycleMetadata(state: LifecycleMetadata): Promise<void> {
        await this.db!.run(`INSERT INTO metadata(key, value) VALUES ('lifecycle', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`, JSON.stringify(state));
    }

    async initializeLifecycleIndex(): Promise<void> {
        if (!this.db) throw new Error(SQLITE_NOT_STARTED_ERROR);
        await this.runExclusive(async () => {
            const epoch = await this.getIndexEpoch();
            const checkpoint = await this.getIndexCheckpointCursor();
            const stored = await this.db!.get<{ value: string }>("SELECT value FROM metadata WHERE key = 'lifecycle'");
            let state: LifecycleMetadata | undefined = stored && JSON.parse(stored.value);
            if (state !== undefined && !isLifecycleMetadata(state)) throw new Error('Invalid lifecycle metadata');
            const valid = state?.version === LIFECYCLE_VERSION && state.epoch === epoch
                && BigInt(state.checkedCursor) <= BigInt(checkpoint);
            const uncovered = state && await this.db!.get(`SELECT 1 FROM index_changes
                WHERE seq > ? AND kind = 'did' AND lifecycle_version IS NOT ${LIFECYCLE_VERSION} LIMIT 1`, state.checkedCursor);
            if (!valid || uncovered) {
                const discardJobs = state?.epoch !== epoch;
                state = { version: LIFECYCLE_VERSION, epoch, complete: false, checkedCursor: checkpoint };
                await this.withTx(async () => {
                    await this.db!.run("DELETE FROM lifecycle WHERE kind = 'did'");
                    if (discardJobs) await this.db!.run("DELETE FROM lifecycle WHERE kind = 'job'");
                    await this.saveLifecycleMetadata(state!);
                });
            }
            if (!state!.complete) {
                while (true) {
                    const page = await this.db!.all<{ id: string; events: string }[]>(
                        'SELECT id, events FROM dids WHERE id > ? ORDER BY id LIMIT ?', state!.backfillCursor ?? '', LIFECYCLE_PAGE_SIZE);
                    if (!page.length) break;
                    state!.backfillCursor = page[page.length - 1].id;
                    await this.withTx(async () => {
                        for (const { id, events } of page) {
                            const history: GatekeeperEvent[] = JSON.parse(events);
                            const row = projectLifecycle(id, history);
                            if (row) await this.insertLifecycle(row);
                        }
                        await this.saveLifecycleMetadata(state!);
                    });
                }
            }
            state = { version: LIFECYCLE_VERSION, epoch, complete: true, checkedCursor: checkpoint };
            await this.withTx(() => this.saveLifecycleMetadata(state!));
        });
    }

    async getLifecycleMetadata(): Promise<LifecycleMetadata> {
        if (!this.db) throw new Error(SQLITE_NOT_STARTED_ERROR);
        const stored = await this.db.get<{ value: string }>("SELECT value FROM metadata WHERE key = 'lifecycle'");
        const state: LifecycleMetadata | undefined = stored && JSON.parse(stored.value);
        if (!isLifecycleMetadata(state) || !state.complete || state.version !== LIFECYCLE_VERSION || state.epoch !== await this.getIndexEpoch()) {
            throw new Error('Lifecycle index is not initialized');
        }
        return state;
    }

    async getLifecycle(did: string): Promise<DIDLifecycle | null> {
        if (!this.db) throw new Error(SQLITE_NOT_STARTED_ERROR);
        const row = await this.db.get<{ record: string }>("SELECT record FROM lifecycle WHERE kind = 'did' AND id = ?", this.splitSuffix(did));
        return row ? this.parseLifecycle(row.record) : null;
    }

    private parseLifecycle(raw: string): DIDLifecycle {
        const value: unknown = JSON.parse(raw);
        if (!isDIDLifecycle(value)) throw new Error('Invalid lifecycle record');
        return value;
    }

    private parseExpirationJob(raw: string): ExpirationJob {
        const value: unknown = JSON.parse(raw);
        if (!isExpirationJob(value)) throw new Error('Invalid expiration cleanup record');
        return value;
    }

    async getDueDIDs(cutoff: number, limit: number, after?: DueDIDCursor): Promise<DIDLifecycle[]> {
        if (!this.db) throw new Error(SQLITE_NOT_STARTED_ERROR);
        const rows = await this.db.all<{ record: string }[]>(`SELECT record FROM lifecycle WHERE kind = 'did'
            AND unresolved = 0 AND COALESCE(json_extract(record, '$.unresolved'), 0) = 0 AND expires_at < ? AND (expires_at, id) > (?, ?) ORDER BY expires_at, id LIMIT ?`,
        cutoff, after?.expiresAt ?? -8_640_000_000_000_001, after?.suffix ?? '', lifecycleLimit(limit));
        return rows.map(row => this.parseLifecycle(row.record));
    }

    async getControlledDIDs(controller: string, limit: number, after?: string): Promise<DIDLifecycle[]> {
        if (!this.db) throw new Error(SQLITE_NOT_STARTED_ERROR);
        const rows = await this.db.all<{ record: string }[]>(`SELECT record FROM lifecycle WHERE kind = 'did'
            AND controller = ? AND id > ? AND json_extract(record, '$.type') = 'asset' ORDER BY id LIMIT ?`,
        this.splitSuffix(controller), after ?? '', lifecycleLimit(limit));
        return rows.map(row => this.parseLifecycle(row.record));
    }

    async hasUnresolvedLifecycle(): Promise<boolean> {
        if (!this.db) throw new Error(SQLITE_NOT_STARTED_ERROR);
        return !!await this.db.get("SELECT 1 FROM lifecycle WHERE kind = 'did' AND unresolved = 1 LIMIT 1");
    }

    async getExpirationJobs(limit: number, after?: string): Promise<ExpirationJob[]> {
        if (!this.db) throw new Error(SQLITE_NOT_STARTED_ERROR);
        const rows = await this.db.all<{ record: string }[]>(
            "SELECT record FROM lifecycle WHERE kind = 'job' AND id > ? ORDER BY id LIMIT ?", after ?? '', lifecycleLimit(limit));
        return rows.map(row => this.parseExpirationJob(row.record));
    }

    async getExpirationJob(suffix: string): Promise<ExpirationJob | null> {
        if (!this.db) throw new Error(SQLITE_NOT_STARTED_ERROR);
        const row = await this.db.get<{ record: string }>("SELECT record FROM lifecycle WHERE kind = 'job' AND id = ?", suffix);
        return row ? this.parseExpirationJob(row.record) : null;
    }

    async saveExpirationJob(suffix: string, job: ExpirationJob | null): Promise<void> {
        if (job && (!isExpirationJob(job) || job.suffix !== suffix)) throw new Error('Invalid expiration cleanup record');
        if (!this.db) throw new Error(SQLITE_NOT_STARTED_ERROR);
        await this.runExclusive(async () => {
            if (job) await this.db!.run(`INSERT INTO lifecycle(kind, id, record) VALUES ('job', ?, ?)
                ON CONFLICT(kind, id) DO UPDATE SET record = excluded.record`, suffix, JSON.stringify(job));
            else await this.db!.run("DELETE FROM lifecycle WHERE kind = 'job' AND id = ?", suffix);
        });
    }

    async getAllKeys(): Promise<string[]> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        const rows = await this.db.all('SELECT id FROM dids');
        return rows.map(row => row.id);
    }

    private async getIndexCheckpointCursor(): Promise<string> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        const row = await this.db.get<{ seq: number | null }>('SELECT COALESCE(MAX(seq), 0) AS seq FROM index_changes');
        return (row?.seq ?? 0).toString();
    }

    private async ensureIndexEpoch(): Promise<string> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        const existing = await this.db.get<{ value: string }>(
            `SELECT value FROM metadata WHERE key = 'indexEpoch'`
        );
        if (existing?.value) {
            return existing.value;
        }

        const epoch = randomUUID();
        await this.db.run(
            `INSERT INTO metadata (key, value) VALUES ('indexEpoch', ?)`,
            epoch
        );
        return epoch;
    }

    private async getIndexEpoch(): Promise<string> {
        return this.ensureIndexEpoch();
    }

    async exportIndexSnapshot(_options?: IndexExportSnapshotOptions): Promise<IndexExportResponse> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        const options = _options ?? {};
        const limit = normalizeIndexExportLimit(options.limit);
        const cursor = options.cursor ?? null;
        const checkpointCursor = options.checkpointCursor ?? await this.getIndexCheckpointCursor();
        const indexEpoch = await this.getIndexEpoch();
        const rows = await this.db.all<{ id: string }[]>(
            `SELECT id
             FROM dids
             WHERE (? IS NULL OR id > ?)
             ORDER BY id ASC
             LIMIT ?`,
            cursor,
            cursor,
            limit + 1
        );

        return buildIndexSnapshotResponseFromPageKeys(
            rows.map(row => row.id),
            id => this.getEvents(id),
            options,
            checkpointCursor,
            indexEpoch
        );
    }

    async exportIndexChanges(_options?: IndexExportChangesOptions): Promise<IndexExportResponse> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR)
        }

        const options = _options ?? {};
        const afterSeq = parseIndexExportCursor(options.cursor);
        const limit = normalizeIndexExportLimit(options.limit);
        const checkpointCursor = await this.getIndexCheckpointCursor();
        const indexEpoch = await this.getIndexEpoch();
        const rows = await this.db.all<IndexChangeRow[]>(
            `SELECT seq, kind, did, registry, block, event, removed
             FROM index_changes
             WHERE seq > ?
             ORDER BY seq ASC
             LIMIT ?`,
            afterSeq,
            limit + 1
        );
        const page = rows.slice(0, limit).map(row => ({
            seq: row.seq,
            kind: row.kind === 'block' ? 'block' as const : 'did' as const,
            did: row.did ?? undefined,
            registry: row.registry ?? undefined,
            block: row.block ? JSON.parse(row.block) as BlockInfo : undefined,
            event: row.event ? JSON.parse(row.event) as GatekeeperEvent : undefined,
            removed: row.removed === 1,
        }));

        return buildIndexChangesResponse(
            page,
            rows.length > limit,
            options,
            checkpointCursor,
            did => this.getEvents(did),
            indexEpoch
        );
    }

    async addBlock(registry: string, blockInfo: BlockInfo): Promise<boolean> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        try {
            // Insert or replace the block information
            await this.runExclusive(async () =>
                await this.withTx(async () => {
                    await this.db!.run(
                        `INSERT OR REPLACE INTO blocks (registry, hash, height, time, txns) VALUES (?, ?, ?, ?, ?)`,
                        registry,
                        blockInfo.hash,
                        blockInfo.height,
                        blockInfo.time,
                        0
                    );
                    await this.recordIndexChangeStrict({
                        kind: 'block',
                        registry,
                        block: blockInfo,
                    });
                })
            );

            return true;
        } catch {
            return false;
        }
    }

    async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
        if (!this.db) {
            throw new Error(SQLITE_NOT_STARTED_ERROR);
        }

        try {
            let blockRow: BlockInfo | undefined;

            if (blockId === undefined) {
                // Return block with max height
                blockRow = await this.db.get<BlockInfo>(
                    `SELECT * FROM blocks WHERE registry = ? ORDER BY height DESC LIMIT 1`,
                    registry
                );
            } else if (typeof blockId === 'number') {
                blockRow = await this.db.get<BlockInfo>(
                    `SELECT * FROM blocks WHERE registry = ? AND height = ?`,
                    registry,
                    blockId
                );
            } else {
                blockRow = await this.db.get<BlockInfo>(
                    `SELECT * FROM blocks WHERE registry = ? AND hash = ?`,
                    registry,
                    blockId
                );
            }

            return blockRow ?? null;
        } catch {
            return null;
        }
    }
}
