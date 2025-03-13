import { Redis } from 'ioredis';
import { InvalidDIDError } from '@mdip/common/errors';
import { GatekeeperDb, GatekeeperEvent, Operation } from '../types.js'

const REDIS_NOT_STARTED_ERROR = 'Redis not started. Call start() first.';

export default class DbRedis implements GatekeeperDb {
    private readonly dbName: string
    private redis: Redis | null

    constructor(dbName: string) {
        this.dbName = dbName;
        this.redis = null;
    }

    async start(): Promise<void> {
        const url = process.env.KC_REDIS_URL || 'redis://localhost:6379';
        this.redis = new Redis(url);
    }

    async stop(): Promise<void> {
        if (this.redis) {
            await this.redis.quit()
            this.redis = null
        }
    }

    async resetDb(): Promise<number> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }
        
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

    addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }
        
        if (!did) {
            throw new InvalidDIDError();
        }

        const key = this.didKey(did);
        const val = JSON.stringify(event);

        return this.redis.rpush(key, val);
    }

    async setEvents(did: string, events: GatekeeperEvent[]): Promise<void> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }
        
        await this.deleteEvents(did);

        // Add new events
        for (const event of events) {
            await this.addEvent(did, event);
        }
    }

    private didKey(did: string): string {
        const id = did.split(':').pop() || '';
        return `${this.dbName}/dids/${id}`;
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }
        
        const events = await this.redis.lrange(this.didKey(did), 0, -1);
        return events.map(event => JSON.parse(event));
    }

    async deleteEvents(did: string): Promise<number> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }
        
        if (!did) {
            throw new InvalidDIDError();
        }

        return this.redis.del(this.didKey(did));
    }

    async getAllKeys(): Promise<string[]> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }
        
        const keys = await this.redis.keys(`${this.dbName}/dids/*`);
        // Extract the id part from the key
        return keys.map(key => key.split('/').pop() || '');
    }

    async queueOperation(registry: string, op: Operation): Promise<number> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }
        
        return this.redis.rpush(`${this.dbName}/queue/${registry}`, JSON.stringify(op));
    }

    async getQueue(registry: string): Promise<Operation[]> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }
        
        try {
            const ops = await this.redis.lrange(`${this.dbName}/queue/${registry}`, 0, -1);
            return ops.map(op => JSON.parse(op));
        } catch {
            return [];
        }
    }

    async clearQueue(registry: string, batch: Operation[]): Promise<boolean> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }
        
        try {
            const ops = await this.getQueue(registry);
            const newOps = ops.filter(op => !batch.some(b => b.signature?.value === op.signature?.value));

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
