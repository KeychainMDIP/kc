import { MongoClient, Db } from 'mongodb';
import { InvalidDIDError } from '@mdip/common/errors';
import { GatekeeperDb, GatekeeperEvent, Operation, BlockId, BlockInfo } from '../types.js'

interface DidsDoc {
    id: string
    events: GatekeeperEvent[]
}

interface QueueDoc {
    id: string
    ops: Operation[]
}

const MONGO_NOT_STARTED_ERROR = 'Mongo not started. Call start() first.';

export default class DbMongo implements GatekeeperDb {
    private readonly dbName: string
    private client: MongoClient | null
    private db: Db | null

    constructor(dbName: string) {
        this.dbName = dbName;
        this.client = null
        this.db = null
    }

    async start(): Promise<void> {
        this.client = new MongoClient(process.env.KC_MONGODB_URL || 'mongodb://localhost:27017');
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        await this.db.collection('dids').createIndex({ id: 1 });
        await this.db.collection('blocks').createIndex({ registry: 1, height: -1 });  // for latest and height lookups
        await this.db.collection('blocks').createIndex({ registry: 1, hash: 1 }, { unique: true });  // for hash lookup
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
    }

    async addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        if (!did) {
            throw new InvalidDIDError();
        }

        const id = did.split(':').pop() || '';
        const result = await this.db.collection<DidsDoc>('dids').updateOne(
            { id },
            {
                $push: {
                    events: { $each: [event] }
                }
            },
            { upsert: true }
        );

        // Return how many docs were modified
        return result.modifiedCount + (result.upsertedCount ?? 0)
    }

    async setEvents(did: string, events: GatekeeperEvent[]): Promise<void> {
        await this.deleteEvents(did);

        // Add new events
        for (const event of events) {
            await this.addEvent(did, event);
        }
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }
        if (!did) {
            throw new InvalidDIDError();
        }

        try {
            const id = did.split(':').pop() || '';
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

        if (!did) {
            throw new InvalidDIDError();
        }

        const id = did.split(':').pop() || '';
        const result = await this.db.collection('dids').deleteOne({ id });
        return result.deletedCount ?? 0
    }

    async getAllKeys(): Promise<string[]> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const rows = await this.db.collection('dids').find().toArray();
        return rows.map(row => row.id);
    }

    async queueOperation(registry: string, op: Operation): Promise<number> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR)
        }

        const result = await this.db.collection<{ id: string, ops: Operation[] }>('queue').findOneAndUpdate(
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
            const queueCollection = this.db.collection<QueueDoc>('queue')
            const oldQueueDocument = await queueCollection.findOne({ id: registry });
            if (!oldQueueDocument?.ops) {
                return true
            }

            const oldQueue = oldQueueDocument.ops;
            const newQueue = oldQueue.filter(item => !batch.some(op => op.signature?.value === item.signature?.value));

            await queueCollection.updateOne(
                { id: registry },
                { $set: { ops: newQueue } },
                { upsert: true }
            );

            return true;
        }
        catch (error) {
            console.error(error);
            return false;
        }
    }

    async addBlock(registry: string, blockInfo: BlockInfo): Promise<boolean> {
        if (!this.db) {
            throw new Error(MONGO_NOT_STARTED_ERROR);
        }

        try {
            // Store block info in the "blocks" collection
            await this.db.collection('blocks').updateOne(
                { registry, hash: blockInfo.hash },
                { $set: blockInfo },
                { upsert: true }
            );

            return true;
        } catch (error) {
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
        } catch (error) {
            return null;
        }
    }
}
