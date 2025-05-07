import { Redis } from 'ioredis';
import { InvalidDIDError } from '@mdip/common/errors';
import { GatekeeperDb, GatekeeperEvent, Operation, BlockId, BlockInfo } from '../types.js'

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

    private queueKey(registry: string): string {
        return `${this.dbName}/registry/${registry}/queue`;
    }

    async queueOperation(registry: string, op: Operation): Promise<number> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        const queueKey = this.queueKey(registry);
        return this.redis.rpush(queueKey, JSON.stringify(op));
    }

    async getQueue(registry: string): Promise<Operation[]> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        try {
            const queueKey = this.queueKey(registry);
            const ops = await this.redis.lrange(queueKey, 0, -1);
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
            const queueKey = this.queueKey(registry);
            await this.redis.del(queueKey);
            if (newOps.length > 0) {
                await this.redis.rpush(queueKey, ...newOps.map(op => JSON.stringify(op)));
            }

            return true;
        } catch (error) {
            console.error(error);
            return false;
        }
    }

    private blockKey(registry: string, hash: string): string {
        return `${this.dbName}/registry/${registry}/blocks/${hash}`;
    }

    private heightMapKey(registry: string): string {
        return `${this.dbName}/registry/${registry}/heightMap`;
    }

    private maxHeightKey(registry: string): string {
        return `${this.dbName}/registry/${registry}/maxHeight`;
    }


    async addBlock(registry: string, blockInfo: BlockInfo): Promise<boolean> {
        if (!this.redis) throw new Error(REDIS_NOT_STARTED_ERROR);
        const { hash, height } = blockInfo;

        if (!hash || height == null) {
            throw new Error(`Invalid blockInfo: ${JSON.stringify(blockInfo)}`);
        }

        const blockKey = this.blockKey(registry, hash);
        const heightMapKey = this.heightMapKey(registry);
        const maxHeightKey = this.maxHeightKey(registry);
        const maxHeight = await this.redis.get(maxHeightKey);
        const currentMaxHeight = maxHeight ? parseInt(maxHeight) : -1;

        try {
            await this.redis.multi()
                .set(blockKey, JSON.stringify(blockInfo))
                .hset(heightMapKey, height.toString(), hash)
                .set(maxHeightKey, Math.max(height, currentMaxHeight))
                .exec();
        } catch (error) {
            return false
        }

        return true;
    }

    async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR);
        }

        try {
            let blockHash: string | null;

            if (blockId === undefined) {
                // No blockId provided → get latest by max height
                const maxHeightStr = await this.redis.get(this.maxHeightKey(registry));
                if (!maxHeightStr) return null;
                blockId = parseInt(maxHeightStr);
            }

            if (typeof blockId === 'number') {
                const heightMapKey = this.heightMapKey(registry);
                blockHash = await this.redis.hget(heightMapKey, blockId.toString());
            } else {
                blockHash = blockId;
            }

            if (!blockHash) return null;

            const blockKey = this.blockKey(registry, blockHash);
            const blockInfo = await this.redis.get(blockKey);

            return blockInfo ? JSON.parse(blockInfo) : null;
        } catch (error) {
            return null;
        }
    }
}
