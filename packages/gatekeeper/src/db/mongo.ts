import { MongoClient, Db, ClientSession } from 'mongodb';
import { randomUUID } from 'crypto';
import { InvalidDIDError } from '@mdip/common/errors';
import { childLogger } from '@mdip/common/logger';
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
    IndexChangeRecord,
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
import { LIFECYCLE_VERSION, LIFECYCLE_PAGE_SIZE, isDIDLifecycle, isExpirationJob, isLifecycleMetadata, lifecycleLimit, projectLifecycle } from './lifecycle.js';
import { DB_HEALTH_TIMEOUT_MS, withHealthCheckTimeout } from './health.js';

interface DidsDoc {
    id: string
    events: GatekeeperEvent[]
}

interface QueueDoc {
    id: string
    ops: Operation[]
}

interface DuplicateQueueDoc {
    _id: string
    operationBatches: Operation[][]
    count: number
}

interface CounterDoc {
    id: string;
    value: number;
}

interface MetadataDoc {
    id: string;
    value: string;
}

interface MongoIndexInfo {
    name?: string;
    key?: Record<string, unknown>;
    unique?: boolean;
}

function isNamespaceNotFoundError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && (
            ('code' in error && error.code === 26)
            || ('codeName' in error && error.codeName === 'NamespaceNotFound')
        );
}

function isDuplicateKeyError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === 11000;
}

const MONGO_NOT_STARTED_ERROR = 'Mongo not started. Call start() first.';
const MONGO_TRANSACTIONS_REQUIRED_ERROR = 'MongoDB transactions require a replica set or sharded cluster. Configure KC_MONGODB_URL to point at a transaction-capable MongoDB deployment.';
const log = childLogger({ service: 'gatekeeper-db', module: 'mongo' });

export default class DbMongo implements GatekeeperDb {
    private readonly dbName: string
    private client: MongoClient | null
    private db: Db | null

    constructor(dbName: string) {
        this.dbName = dbName;
        this.client = null
        this.db = null
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
        this.client = new MongoClient(process.env.KC_MONGODB_URL || 'mongodb://localhost:27017/?replicaSet=rs0');

        try {
            await this.client.connect();
            await this.verifyTransactionSupport();
            this.db = this.client.db(this.dbName);
            await this.ensureIndex('dids', { id: 1 }, { name: 'dids_id_unique', unique: true });
            await this.ensureQueueIndex();
            await this.ensureIndex('blocks', { registry: 1, height: -1 }, { name: 'blocks_registry_height' });  // for latest and height lookups
            await this.ensureIndex('blocks', { registry: 1, hash: 1 }, { name: 'blocks_registry_hash_unique', unique: true });  // for hash lookup
            await this.ensureIndex('counters', { id: 1 }, { name: 'counters_id_unique', unique: true });
            await this.ensureIndex('metadata', { id: 1 }, { name: 'metadata_id_unique', unique: true });
            await this.ensureIndex('index_changes', { seq: 1 }, { name: 'index_changes_seq_unique', unique: true });
            await this.ensureIndexSeqCounter();
            await this.ensureIndexEpoch();
            await this.initializeLifecycleIndex();
        }
        catch (error) {
            try { await this.client.close(); } catch { /* Preserve the startup failure. */ }
            this.client = null;
            this.db = null;
            throw error;
        }
    }

    async stop(): Promise<void> {
        if (this.client) {
            await this.client.close()
            this.client = null
            this.db = null
        }
    }

    async isReady(): Promise<boolean> {
        if (!this.client || !this.db) {
            return false;
        }

        try {
            await withHealthCheckTimeout(
                this.client.db('admin').command(
                    { ping: 1 },
                    { timeoutMS: DB_HEALTH_TIMEOUT_MS }
                ),
                'Mongo readiness check timed out'
            );
            return true;
        }
        catch {
            return false;
        }
    }

    async resetDb(): Promise<void> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        await this.withTransaction(async session => {
            for (const name of ['lifecycle', 'dids', 'queue', 'blocks', 'index_changes', 'counters']) {
                await this.db!.collection(name).deleteMany({}, { session });
            }
            await this.db!.collection('metadata').deleteOne({ id: 'lifecycle' }, { session });
            await this.db!.collection<MetadataDoc>('metadata').updateOne(
                { id: 'indexEpoch' }, { $set: { value: randomUUID() } }, { upsert: true, session });
        });
    }

    private indexKeyMatches(actual: Record<string, unknown> | undefined, expected: Record<string, 1 | -1>): boolean {
        if (!actual) {
            return false;
        }

        const actualEntries = Object.entries(actual);
        const expectedEntries = Object.entries(expected);

        return actualEntries.length === expectedEntries.length
            && expectedEntries.every(([key, value]) => actual[key] === value);
    }

    private async ensureIndex(
        collectionName: string,
        key: Record<string, 1 | -1>,
        options: { name: string; unique?: boolean }
    ): Promise<void> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        const collection = this.db.collection(collectionName);
        let indexes: MongoIndexInfo[];

        try {
            indexes = await collection.indexes() as MongoIndexInfo[];
        }
        catch (error) {
            if (!isNamespaceNotFoundError(error)) {
                throw error;
            }
            indexes = [];
        }

        const existing = indexes.find(index => this.indexKeyMatches(index.key, key));
        const unique = options.unique === true;

        if (existing) {
            if ((existing.unique === true) === unique) {
                return;
            }

            if (!existing.name) {
                throw new Error(`Cannot replace unnamed Mongo index on ${collectionName}`);
            }

            await collection.dropIndex(existing.name);
        }

        await collection.createIndex(key, options);
    }

    private async ensureQueueIndex(): Promise<void> {
        try {
            await this.ensureIndex('queue', { id: 1 }, { name: 'queue_id_unique', unique: true });
        }
        catch (error) {
            if (!isDuplicateKeyError(error)) {
                throw error;
            }

            await this.mergeDuplicateQueues();
            await this.ensureIndex('queue', { id: 1 }, { name: 'queue_id_unique', unique: true });
        }
    }

    private async mergeDuplicateQueues(): Promise<void> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        const collection = this.db.collection<QueueDoc>('queue');
        const duplicates = await collection.aggregate<DuplicateQueueDoc>([
            { $sort: { _id: 1 } },
            {
                $group: {
                    _id: '$id',
                    operationBatches: { $push: '$ops' },
                    count: { $sum: 1 },
                }
            },
            { $match: { count: { $gt: 1 } } },
        ]).toArray();

        if (duplicates.length === 0) {
            return;
        }

        await this.withTransaction(async session => {
            for (const duplicate of duplicates) {
                await collection.deleteMany({ id: duplicate._id }, { session });
                await collection.insertOne({
                    id: duplicate._id,
                    ops: duplicate.operationBatches.flat(),
                }, { session });
            }
        });
    }

    private isValidCounterValue(value: unknown): value is number {
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    }

    private async getMaxIndexChangeSeq(): Promise<number> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        const row = await this.db.collection<IndexChangeRecord>('index_changes')
            .find({}, { projection: { seq: 1 } })
            .sort({ seq: -1 })
            .limit(1)
            .next();

        return this.isValidCounterValue(row?.seq) ? row.seq : 0;
    }

    private async ensureIndexSeqCounter(): Promise<void> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        const maxSeq = await this.getMaxIndexChangeSeq();
        const counters = this.db.collection<CounterDoc>('counters');
        const counter = await counters.findOne({ id: 'indexSeq' });

        if (this.isValidCounterValue(counter?.value) && counter.value >= maxSeq) {
            return;
        }

        await counters.updateOne(
            { id: 'indexSeq' },
            { $set: { value: maxSeq } },
            { upsert: true }
        );
    }

    private async ensureIndexEpoch(): Promise<string> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        const metadata = this.db.collection<MetadataDoc>('metadata');
        const existing = await metadata.findOne({ id: 'indexEpoch' });
        if (typeof existing?.value === 'string' && existing.value.length > 0) {
            return existing.value;
        }

        const epoch = randomUUID();
        await metadata.updateOne(
            { id: 'indexEpoch' },
            { $setOnInsert: { value: epoch } },
            { upsert: true }
        );

        const saved = await metadata.findOne({ id: 'indexEpoch' });
        return typeof saved?.value === 'string' && saved.value.length > 0
            ? saved.value
            : epoch;
    }

    private async getIndexEpoch(): Promise<string> {
        return this.ensureIndexEpoch();
    }

    private async verifyTransactionSupport(): Promise<void> {
        if (!this.client) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        const hello = await this.client.db('admin').command({ hello: 1 });

        if (!hello.setName && hello.msg !== 'isdbgrid') {
            throw new Error(MONGO_TRANSACTIONS_REQUIRED_ERROR);
        }
    }

    private async withTransaction<T>(callback: (session: ClientSession) => Promise<T>): Promise<T> {
        if (!this.client) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        const session = this.client.startSession();

        try {
            return await session.withTransaction(async () => callback(session)) as T;
        }
        finally {
            await session.endSession();
        }
    }

    private async nextIndexSeq(session: ClientSession): Promise<number> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        const result = await this.db.collection<CounterDoc>('counters').findOneAndUpdate(
            { id: 'indexSeq' },
            { $inc: { value: 1 } },
            {
                upsert: true,
                returnDocument: 'after',
                session,
            }
        );

        return result?.value ?? 1;
    }

    private async recordIndexChange(change: Omit<IndexChangeRecord, 'seq'>, session: ClientSession): Promise<void> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        const seq = await this.nextIndexSeq(session);
        await this.db.collection('index_changes').insertOne({ seq, ...change, lifecycleVersion: LIFECYCLE_VERSION }, { session });
    }

    async addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        return this.addEventAndQueue(did, event, []);
    }

    async addEventAndQueue(did: string, event: GatekeeperEvent, queueRegistries: string[]): Promise<number> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const id = this.splitSuffix(did);

        return this.withTransaction(async session => {
            const collection = this.db!.collection<DidsDoc>('dids');
            const update = { $push: { events: { $each: [event] } } };
            const creating = event.operation.type === 'create';
            // An existing document can have an empty history after maintenance.
            const before = creating ? await collection.findOneAndUpdate({ id }, update,
                { upsert: true, session, returnDocument: 'before', projection: { events: { $slice: 1 } } }) : null;
            const result = creating ? null : await collection.updateOne({ id }, update, { upsert: true, session });

            const previous = event.operation.type === 'delete'
                ? (await this.db!.collection<{ record: DIDLifecycle }>('lifecycle').findOne({ kind: 'did', id }, { session }))?.record
                : null;
            if (creating && before?.events?.length) {
                await this.db!.collection('lifecycle').updateOne({ kind: 'did', id },
                    { $set: { 'record.revision': randomUUID() } }, { session });
            } else {
                await this.writeLifecycle(session, did, [event], previous ?? null);
            }
            // Return how many docs were modified
            const count = creating ? 1 : result!.modifiedCount + (result!.upsertedCount ?? 0);
            await this.recordIndexChange({
                kind: 'did',
                did,
                event,
            }, session);
            for (const registry of queueRegistries) {
                await this.db!.collection<QueueDoc>('queue').updateOne(
                    { id: registry },
                    { $push: { ops: event.operation } },
                    { upsert: true, session }
                );
            }
            return count
        });
    }

    async setEvents(did: string, events: GatekeeperEvent[], options?: SetEventsOptions): Promise<void> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const id = this.splitSuffix(did);

        await this.withTransaction(async session => {
            await this.db!
                .collection<DidsDoc>('dids')
                .updateOne(
                    { id },
                    { $set: { events } },
                    { upsert: true, session }
                );
            await this.writeLifecycle(session, did, events);
            const operationEvents = options?.operationEvents ?? [];

            if (operationEvents.length === 0) {
                await this.recordIndexChange({
                    kind: 'did',
                    did,
                }, session);
                return;
            }

            for (const event of operationEvents) {
                await this.recordIndexChange({
                    kind: 'did',
                    did,
                    event,
                }, session);
            }
        });
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const id = this.splitSuffix(did);
        const row = await this.db.collection<DidsDoc>('dids')
            .findOne({ id }, { timeoutMS: DB_HEALTH_TIMEOUT_MS });
        return row?.events ?? [];
    }

    async deleteEvents(did: string, expected?: DeleteEventsOptions): Promise<number> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const id = this.splitSuffix(did);

        return this.withTransaction(async session => {
            if (expected) {
                const epoch = (await this.db!.collection<MetadataDoc>('metadata').findOne({ id: 'indexEpoch' }, { session }))?.value;
                const stored = await this.db!.collection<MetadataDoc>('metadata').findOne({ id: 'lifecycle' }, { session });
                const state: unknown = stored && JSON.parse(stored.value);
                if (!isLifecycleMetadata(state) || !state.complete || state.version !== LIFECYCLE_VERSION || state.epoch !== epoch) {
                    throw new Error('Lifecycle index is not initialized');
                }
                const row = await this.db!.collection<{ record: DIDLifecycle }>('lifecycle').findOne({ kind: 'did', id }, { session });
                if (epoch !== expected.epoch || !row || this.parseLifecycle(row.record).revision !== expected.revision) return 0;
            }
            await this.db!.collection('lifecycle').deleteOne({ kind: 'did', id }, { session });
            const row = await this.db!.collection<DidsDoc>('dids').findOne({ id }, { session });
            const result = await this.db!.collection('dids').deleteOne({ id }, { session });
            if ((result.deletedCount ?? 0) > 0) {
                if (!row || row.events.length === 0) {
                    await this.recordIndexChange({ kind: 'did', did, removed: true }, session);
                }
                for (const event of row?.events ?? []) {
                    await this.recordIndexChange({ kind: 'did', did, event, removed: true }, session);
                }
            }
            return result.deletedCount ?? 0
        });
    }

    private async writeLifecycle(session: ClientSession, did: string, events: GatekeeperEvent[], previous?: DIDLifecycle | null): Promise<void> {
        const id = this.splitSuffix(did);
        const record = projectLifecycle(did, events, previous);
        const collection = this.db!.collection('lifecycle');
        if (record) {
            await collection.updateOne({ kind: 'did', id }, { $set: {
                record, expiresAt: record.expiresAt ?? null, controller: record.controller ?? null, unresolved: !!record.controllerUnknown,
            } }, { upsert: true, session });
        } else {
            await collection.deleteOne({ kind: 'did', id }, { session });
        }
        if (events.length === 0) return;
        const jobQuery = record?.type === 'agent' && !record.unresolved
            ? { kind: 'job', id, 'record.expiresAt': { $ne: record.expiresAt ?? null } }
            : { kind: 'job', id };
        await collection.deleteMany(jobQuery, { session });
    }

    private async saveLifecycleMetadata(state: LifecycleMetadata, session?: ClientSession): Promise<void> {
        await this.db!.collection('metadata').updateOne({ id: 'lifecycle' },
            { $set: { value: JSON.stringify(state) } }, { upsert: true, session });
    }

    async initializeLifecycleIndex(): Promise<void> {
        if (!this.db) throw new Error(MONGO_NOT_STARTED_ERROR);
        const lifecycleExists = !!await this.db.listCollections({ name: 'lifecycle' }, { nameOnly: true }).next();
        if (!lifecycleExists) await this.db.collection('metadata').deleteOne({ id: 'lifecycle' });
        await this.ensureIndex('lifecycle', { kind: 1, id: 1 }, { name: 'lifecycle_id', unique: true });
        await this.ensureIndex('lifecycle', { kind: 1, expiresAt: 1, id: 1 }, { name: 'lifecycle_due' });
        await this.ensureIndex('lifecycle', { kind: 1, controller: 1, id: 1 }, { name: 'lifecycle_controller' });
        await this.ensureIndex('lifecycle', { kind: 1, unresolved: 1, id: 1 }, { name: 'lifecycle_unresolved' });
        await this.ensureIndex('index_changes', { kind: 1, lifecycleVersion: 1, seq: 1 }, { name: 'index_changes_lifecycle_coverage' });
        const epoch = await this.getIndexEpoch();
        const checkpoint = await this.getIndexCheckpointCursor();
        const stored = await this.db.collection<MetadataDoc>('metadata').findOne({ id: 'lifecycle' });
        let state: LifecycleMetadata | undefined = stored ? JSON.parse(stored.value) : undefined;
        if (state !== undefined && !isLifecycleMetadata(state)) throw new Error('Invalid lifecycle metadata');
        const valid = state?.version === LIFECYCLE_VERSION && state.epoch === epoch
            && BigInt(state.checkedCursor) <= BigInt(checkpoint);
        const uncovered = state && await this.db.collection('index_changes').findOne({
            seq: { $gt: Number(state.checkedCursor) }, kind: 'did', lifecycleVersion: { $ne: LIFECYCLE_VERSION },
        }, { projection: { _id: 1 } });
        if (!valid || uncovered) {
            const discardJobs = state?.epoch !== epoch;
            state = { version: LIFECYCLE_VERSION, epoch, complete: false, checkedCursor: checkpoint };
            await this.withTransaction(async session => {
                await this.db!.collection('lifecycle').deleteMany({ kind: 'did' }, { session });
                if (discardJobs) await this.db!.collection('lifecycle').deleteMany({ kind: 'job' }, { session });
                await this.saveLifecycleMetadata(state!, session);
            });
        }
        if (!state!.complete) {
            while (true) {
                const page = await this.db.collection<DidsDoc>('dids').find({ id: { $gt: state!.backfillCursor ?? '' } })
                    .sort({ id: 1 }).limit(LIFECYCLE_PAGE_SIZE).toArray();
                if (!page.length) break;
                state!.backfillCursor = page[page.length - 1].id;
                await this.withTransaction(async session => {
                    for (const { id, events } of page) await this.writeLifecycle(session, id, events);
                    await this.saveLifecycleMetadata(state!, session);
                });
            }
        }
        await this.saveLifecycleMetadata({ version: LIFECYCLE_VERSION, epoch, complete: true, checkedCursor: checkpoint });
    }

    async getLifecycleMetadata(): Promise<LifecycleMetadata> {
        if (!this.db) throw new Error(MONGO_NOT_STARTED_ERROR);
        const stored = await this.db.collection<MetadataDoc>('metadata').findOne({ id: 'lifecycle' });
        const state: LifecycleMetadata | undefined = stored && JSON.parse(stored.value);
        if (!isLifecycleMetadata(state) || !state.complete || state.version !== LIFECYCLE_VERSION || state.epoch !== await this.getIndexEpoch()) {
            throw new Error('Lifecycle index is not initialized');
        }
        return state;
    }

    async getLifecycle(did: string): Promise<DIDLifecycle | null> {
        if (!this.db) throw new Error(MONGO_NOT_STARTED_ERROR);
        const row = await this.db.collection<{ kind: string; id: string; record: DIDLifecycle }>('lifecycle')
            .findOne({ kind: 'did', id: this.splitSuffix(did) });
        return row ? this.parseLifecycle(row.record) : null;
    }

    private parseLifecycle(value: unknown): DIDLifecycle {
        if (!isDIDLifecycle(value)) throw new Error('Invalid lifecycle record');
        return value;
    }

    private parseExpirationJob(value: unknown): ExpirationJob {
        if (!isExpirationJob(value)) throw new Error('Invalid expiration cleanup record');
        return value;
    }

    async getDueDIDs(cutoff: number, limit: number, after?: DueDIDCursor): Promise<DIDLifecycle[]> {
        if (!this.db) throw new Error(MONGO_NOT_STARTED_ERROR);
        const rows = await this.db.collection<{ record: DIDLifecycle }>('lifecycle').find({
            kind: 'did', unresolved: false, 'record.unresolved': { $ne: true }, expiresAt: { $lt: cutoff, $ne: null },
            ...(after && { $or: [{ expiresAt: { $gt: after.expiresAt, $lt: cutoff } },
                { expiresAt: after.expiresAt, id: { $gt: after.suffix } }] }),
        }).sort({ expiresAt: 1, id: 1 }).limit(lifecycleLimit(limit)).toArray();
        return rows.map(row => this.parseLifecycle(row.record));
    }

    async getControlledDIDs(controller: string, limit: number, after?: string): Promise<DIDLifecycle[]> {
        if (!this.db) throw new Error(MONGO_NOT_STARTED_ERROR);
        const rows = await this.db.collection<{ record: DIDLifecycle }>('lifecycle').find({
            kind: 'did', controller: this.splitSuffix(controller), id: { $gt: after ?? '' }, 'record.type': 'asset',
        }).sort({ id: 1 }).limit(lifecycleLimit(limit)).toArray();
        return rows.map(row => this.parseLifecycle(row.record));
    }

    async hasUnresolvedLifecycle(): Promise<boolean> {
        if (!this.db) throw new Error(MONGO_NOT_STARTED_ERROR);
        return !!await this.db.collection('lifecycle').findOne({ kind: 'did', unresolved: true }, { projection: { _id: 1 } });
    }

    async getExpirationJobs(limit: number, after?: string): Promise<ExpirationJob[]> {
        if (!this.db) throw new Error(MONGO_NOT_STARTED_ERROR);
        const rows = await this.db.collection<{ record: ExpirationJob }>('lifecycle').find({ kind: 'job', id: { $gt: after ?? '' } })
            .sort({ id: 1 }).limit(lifecycleLimit(limit)).toArray();
        return rows.map(row => this.parseExpirationJob(row.record));
    }

    async getExpirationJob(suffix: string): Promise<ExpirationJob | null> {
        if (!this.db) throw new Error(MONGO_NOT_STARTED_ERROR);
        const row = await this.db.collection<{ record: unknown }>('lifecycle').findOne({ kind: 'job', id: suffix });
        return row ? this.parseExpirationJob(row.record) : null;
    }

    async saveExpirationJob(suffix: string, job: ExpirationJob | null): Promise<void> {
        if (job && (!isExpirationJob(job) || job.suffix !== suffix)) throw new Error('Invalid expiration cleanup record');
        if (!this.db) throw new Error(MONGO_NOT_STARTED_ERROR);
        if (job) await this.db.collection('lifecycle').updateOne({ kind: 'job', id: suffix }, { $set: { record: job } }, { upsert: true });
        else await this.db.collection('lifecycle').deleteOne({ kind: 'job', id: suffix });
    }

    async getAllKeys(): Promise<string[]> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const rows = await this.db.collection('dids').find().toArray();
        return rows.map(row => row.id);
    }

    async exportIndexSnapshot(_options?: IndexExportSnapshotOptions): Promise<IndexExportResponse> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const options = _options ?? {};
        const limit = normalizeIndexExportLimit(options.limit);
        const cursor = options.cursor ?? null;
        const checkpointCursor = options.checkpointCursor ?? await this.getIndexCheckpointCursor();
        const indexEpoch = await this.getIndexEpoch();
        const docs = await this.db.collection<DidsDoc>('dids')
            .find(
                cursor ? { id: { $gt: cursor } } : {},
                { projection: { id: 1 }, timeoutMS: DB_HEALTH_TIMEOUT_MS }
            )
            .sort({ id: 1 })
            .limit(limit + 1)
            .toArray();

        return buildIndexSnapshotResponseFromPageKeys(
            docs.map(doc => doc.id),
            id => this.getEvents(id),
            options,
            checkpointCursor,
            indexEpoch
        );
    }

    private async getIndexCheckpointCursor(): Promise<string> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const row = await this.db.collection<IndexChangeRecord>('index_changes')
            .find({}, { timeoutMS: DB_HEALTH_TIMEOUT_MS })
            .sort({ seq: -1 })
            .limit(1)
            .next();

        return (row?.seq ?? 0).toString();
    }

    async exportIndexChanges(_options?: IndexExportChangesOptions): Promise<IndexExportResponse> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const options = _options ?? {};
        const afterSeq = parseIndexExportCursor(options.cursor);
        const limit = normalizeIndexExportLimit(options.limit);
        const checkpointCursor = await this.getIndexCheckpointCursor();
        const indexEpoch = await this.getIndexEpoch();
        const rows = await this.db.collection<IndexChangeRecord>('index_changes')
            .find({ seq: { $gt: afterSeq } }, { timeoutMS: DB_HEALTH_TIMEOUT_MS })
            .sort({ seq: 1 })
            .limit(limit + 1)
            .toArray();
        const page = rows.slice(0, limit);

        return buildIndexChangesResponse(
            page,
            rows.length > limit,
            options,
            checkpointCursor,
            did => this.getEvents(did),
            indexEpoch
        );
    }

    async queueOperation(registry: string, op: Operation): Promise<number> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const result = await this.db.collection<QueueDoc>('queue').findOneAndUpdate(
            { id: registry },
            {
                $push: {
                    ops: {
                        $each: [op]
                    }
                }
            },
            {
                upsert: true,
                returnDocument: 'after'
            }
        );

        return result?.ops.length ?? 0;
    }

    async getQueue(registry: string): Promise<Operation[]> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        try {
            const row = await this.db.collection('queue').findOne({ id: registry });
            return row?.ops ?? [];
        }
        catch {
            return [];
        }
    }

    async clearQueue(registry: string, batch: Operation[]): Promise<boolean> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        try {
            const hashes = batch
                .map(op => op.signature?.hash)
                .filter((h): h is string => !!h);

            if (hashes.length === 0) {
                return true;
            }

            await this.db
                .collection<QueueDoc>('queue')
                .updateOne(
                    { id: registry },
                    { $pull: { ops: { 'signature.hash': { $in: hashes } } } } as any
                );

            return true;
        }
        catch (error) {
            log.error({ error }, 'Mongo clearQueue error');
            return false;
        }
    }

    async addBlock(registry: string, blockInfo: BlockInfo): Promise<boolean> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        try {
            await this.withTransaction(async session => {
                // Store block info in the "blocks" collection
                await this.db!.collection('blocks').updateOne(
                    { registry, hash: blockInfo.hash },
                    { $set: blockInfo },
                    { upsert: true, session }
                );
                await this.recordIndexChange({
                    kind: 'block',
                    registry,
                    block: blockInfo,
                }, session);
            });

            return true;
        } catch {
            return false;
        }
    }

    async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        try {
            const blocks = this.db.collection<BlockInfo>('blocks');

            let query: Record<string, any>;

            if (blockId === undefined) {
                // Get block with max height
                query = { registry };
                return await blocks
                    .find(query)
                    .sort({ height: -1 })
                    .limit(1)
                    .next();  // more efficient than toArray()[0]
            }

            if (typeof blockId === 'number') {
                query = { registry, height: blockId };
            } else {
                query = { registry, hash: blockId };
            }

            return await blocks.findOne(query);
        } catch {
            return null;
        }
    }
}
