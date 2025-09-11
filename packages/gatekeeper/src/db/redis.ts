import { Redis } from 'ioredis';
import { InvalidDIDError } from '@mdip/common/errors';
import { GatekeeperDb, GatekeeperEvent, Operation, BlockId, BlockInfo } from '../types.js'

const REDIS_NOT_STARTED_ERROR = 'Redis not started. Call start() first.';

export default class DbRedis implements GatekeeperDb {
    private readonly dbName: string;
    private redis: Redis | null;

    private _lock: Promise<void> = Promise.resolve();
    private runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
        const run = async () => await fn();
        const chained = this._lock.then(run, run);
        this._lock = chained.then(() => undefined, () => undefined);
        return chained;
    }

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

        const key = this.didKey(did);
        const val = JSON.stringify(event);

        return this.redis.rpush(key, val);
    }

    async setEvents(did: string, events: GatekeeperEvent[]): Promise<void> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        const key = this.didKey(did);
        const payloads = events.map(e => JSON.stringify(e));

        await this.runExclusive(async () => {
            const multi = this.redis!.multi().del(key);
            if (payloads.length) {
                multi.rpush(key, ...payloads);
            }
            await multi.exec();
        });
    }

    private didKey(did: string): string {
        if (!did) {
            throw new InvalidDIDError();
        }
        const id = did.split(':').pop();
        if (!id) {
            throw new InvalidDIDError();
        }
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

        const hashes = batch
            .map(op => op.signature?.hash)
            .filter((h): h is string => !!h);

        if (hashes.length === 0) {
            return true;
        }

        const key = this.queueKey(registry);

        const script = `
                      local key = KEYS[1]
                      local n   = tonumber(ARGV[1])
                      local idx = 2
                      local want = {}
                      for i=1,n do
                        want[ARGV[idx]] = true
                        idx = idx + 1
                      end
                      local list = redis.call('LRANGE', key, 0, -1)
                      if #list == 0 then return 0 end
                      local keep = {}
                      for i=1,#list do
                        local ok, obj = pcall(cjson.decode, list[i])
                        if ok and obj and obj.signature and obj.signature.hash and want[obj.signature.hash] then
                          -- drop
                        else
                          table.insert(keep, list[i])
                        end
                      end
                      redis.call('DEL', key)
                      if #keep > 0 then
                        redis.call('RPUSH', key, unpack(keep))
                      end
                      return #list - #keep
                    `;

        return this.runExclusive(async () => {
            try {
                await this.redis!.eval(script, 1, key, hashes.length.toString(), ...hashes);
                return true;
            } catch (e) {
                console.error(e);
                return false;
            }
        });
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
