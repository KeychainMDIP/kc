import { MongoClient } from 'mongodb';
import { InvalidDIDError } from '@mdip/common/errors';

export default class DbMongo {
    constructor(dbName) {
        this.dbName = dbName;
    }

    async start() {
        this.client = new MongoClient(process.env.KC_MONGODB_URL || 'mongodb://localhost:27017');
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        await this.db.collection('dids').createIndex({ id: 1 });
    }

    async stop() {
        await this.client.close();
    }

    async resetDb() {
        await this.db.collection('dids').deleteMany({});
        await this.db.collection('queue').deleteMany({});
    }

    async addEvent(did, event) {
        if (!did) {
            throw new InvalidDIDError();
        }

        const id = did.split(':').pop();

        return this.db.collection('dids').updateOne(
            { id: id },
            { $push: { events: event } },
            { upsert: true }
        );
    }

    async setEvents(did, events) {
        await this.deleteEvents(did);

        // Add new events
        for (const event of events) {
            await this.addEvent(did, event);
        }
    }

    async getEvents(did) {
        if (!did) {
            throw new InvalidDIDError();
        }

        try {
            const id = did.split(':').pop();
            const row = await this.db.collection('dids').findOne({ id: id });
            return row.events;
        }
        catch {
            return [];
        }
    }
    async deleteEvents(did) {
        if (!did) {
            throw new InvalidDIDError();
        }

        const id = did.split(':').pop();
        await this.db.collection('dids').deleteOne({ id: id });
    }

    async getAllKeys() {
        const rows = await this.db.collection('dids').find().toArray();
        return rows.map(row => row.id);
    }

    async queueOperation(registry, op) {
        const result = await this.db.collection('queue').findOneAndUpdate(
            { id: registry },
            { $push: { ops: op } },
            { upsert: true, returnDocument: 'after' }
        );

        return result.value.ops.length;
    }

    async getQueue(registry) {
        try {
            const row = await this.db.collection('queue').findOne({ id: registry });
            return row ? row.ops : [];
        }
        catch {
            return [];
        }
    }

    async clearQueue(registry, batch) {
        try {
            const queueCollection = this.db.collection('queue');
            const oldQueueDocument = await queueCollection.findOne({ id: registry });
            const oldQueue = oldQueueDocument.ops;
            const newQueue = oldQueue.filter(item => !batch.some(op => op.signature.value === item.signature.value));

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
}
