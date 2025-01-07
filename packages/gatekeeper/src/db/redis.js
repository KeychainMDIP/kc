import Redis from 'ioredis';
import { InvalidDIDError } from '@mdip/common/errors';

export default class DbRedis {
    constructor(dbName) {
        let url = process.env.KC_REDIS_URL || 'redis://localhost:6379';

        this.redis = new Redis(url);
        this.dbName = dbName;
    }

    async start() {
    }

    async stop() {
        await this.redis.quit();
    }

    async resetDb() {
        let cursor = '0';
        let totalDeleted = 0;
        do {
            // Scan for keys that match the pattern
            const [newCursor, keys] = await this.redis.scan(cursor, 'MATCH', `${this.dbName}/*`, 'COUNT', 1000);
            cursor = newCursor;

            if (keys.length > 0) {
                // Delete the keys found
                const deletedCount = await this.redis.del(...keys);
                totalDeleted += deletedCount; // Increment the total count
            }
        } while (cursor !== '0'); // Continue scanning until cursor returns to 0

        return totalDeleted;
    }

    async addEvent(did, event) {
        if (!did) {
            throw new InvalidDIDError();
        }

        const key = didKey(did);
        const val = JSON.stringify(event);

        return this.redis.rpush(key, val);
    }

    async setEvents(did, events) {
        await deleteEvents(did);

        // Add new events
        for (const event of events) {
            await this.addEvent(did, event);
        }
    }

    didKey(did) {
        const id = did.split(':').pop();
        return `${this.dbName}/dids/${id}`;
    }

    async getEvents(did) {
        const events = await this.redis.lrange(this.didKey(did), 0, -1);
        return events.map(event => JSON.parse(event));
    }

    async deleteEvents(did) {
        if (!did) {
            throw new InvalidDIDError();
        }

        return this.redis.del(this.didKey(did));
    }

    async getAllKeys() {
        const keys = await this.redis.keys(`${this.dbName}/dids/*`);
        return keys.map(key => key.split('/').pop()); // Extract the id part from the key
    }

    async queueOperation(registry, op) {
        await this.redis.rpush(`${this.dbName}/queue/${registry}`, JSON.stringify(op));
    }

    async getQueue(registry) {
        try {
            const ops = await this.redis.lrange(`${this.dbName}/queue/${registry}`, 0, -1);
            return ops.map(op => JSON.parse(op));
        } catch {
            return [];
        }
    }

    async clearQueue(registry, batch) {
        try {
            const ops = await this.getQueue(registry);
            const newOps = ops.filter(op => !batch.some(b => b.signature.value === op.signature.value));

            // Clear the current queue and add back the filtered operations
            await this.redis.del(`${this.dbName}/queue/${registry}`);
            if (newOps.length > 0) {
                await this.redis.rpush(`${this.dbName}/queue/${registry}`, ...newOps.map(op => JSON.stringify(op)));
            }

            return true;
        } catch (error) {
            console.error(error);
            return false;
        }
    }
}
