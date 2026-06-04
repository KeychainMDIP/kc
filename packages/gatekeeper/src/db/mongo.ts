import { MongoClient, Db, ClientSession } from 'mongodb';
import { InvalidDIDError } from '@mdip/common/errors';
import { childLogger } from '@mdip/common/logger';
import {
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

interface DidsDoc {
    id: string
    events: GatekeeperEvent[]
}

interface QueueDoc {
    id: string
    ops: Operation[]
}

interface CounterDoc {
    id: string;
    value: number;
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
            await this.ensureIndex('blocks', { registry: 1, height: -1 }, { name: 'blocks_registry_height' });  // for latest and height lookups
            await this.ensureIndex('blocks', { registry: 1, hash: 1 }, { name: 'blocks_registry_hash_unique', unique: true });  // for hash lookup
            await this.ensureIndex('counters', { id: 1 }, { name: 'counters_id_unique', unique: true });
            await this.ensureIndex('index_changes', { seq: 1 }, { name: 'index_changes_seq_unique', unique: true });
        }
        catch (error) {
            await this.client.close();
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

    async resetDb(): Promise<void> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        await this.db.collection('dids').deleteMany({});
        await this.db.collection('queue').deleteMany({});
        await this.db.collection('blocks').deleteMany({});
        await this.db.collection('index_changes').deleteMany({});
        await this.db.collection('counters').deleteMany({});
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
        await this.db.collection('index_changes').insertOne({ seq, ...change }, { session });
    }

    async addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const id = this.splitSuffix(did);

        return this.withTransaction(async session => {
            const result = await this.db!.collection<DidsDoc>('dids').updateOne(
                { id },
                {
                    $push: {
                        events: { $each: [event] }
                    }
                },
                { upsert: true, session }
            );

            // Return how many docs were modified
            const count = result.modifiedCount + (result.upsertedCount ?? 0);
            await this.recordIndexChange({
                kind: 'did',
                did,
                event,
            }, session);
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

        try {

            const row = await this.db.collection('dids').findOne({ id });
            return row?.events ?? [];
        }
        catch {
            return [];
        }
    }

    async deleteEvents(did: string): Promise<number> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const id = this.splitSuffix(did);

        return this.withTransaction(async session => {
            const result = await this.db!.collection('dids').deleteOne({ id }, { session });
            if ((result.deletedCount ?? 0) > 0) {
                await this.recordIndexChange({
                    kind: 'did',
                    did,
                    removed: true,
                }, session);
            }
            return result.deletedCount ?? 0
        });
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
        const docs = await this.db.collection<DidsDoc>('dids')
            .find(cursor ? { id: { $gt: cursor } } : {}, { projection: { id: 1 } })
            .sort({ id: 1 })
            .limit(limit + 1)
            .toArray();

        return buildIndexSnapshotResponseFromPageKeys(
            docs.map(doc => doc.id),
            id => this.getEvents(id),
            options,
            checkpointCursor
        );
    }

    private async getIndexCheckpointCursor(): Promise<string> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const row = await this.db.collection<IndexChangeRecord>('index_changes')
            .find()
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
        const rows = await this.db.collection<IndexChangeRecord>('index_changes')
            .find({ seq: { $gt: afterSeq } })
            .sort({ seq: 1 })
            .limit(limit + 1)
            .toArray();
        const page = rows.slice(0, limit);

        return buildIndexChangesResponse(
            page,
            rows.length > limit,
            options,
            did => this.getEvents(did)
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
