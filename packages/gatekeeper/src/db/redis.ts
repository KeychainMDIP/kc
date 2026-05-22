import { Redis } from 'ioredis';
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
    IndexExportChangesOptions
} from '../types.js'
import {
    buildIndexChangesResponse,
    buildIndexSnapshotResponseFromPageKeys,
    normalizeIndexExportLimit,
    parseIndexExportCursor
} from './index-export.js';

const REDIS_NOT_STARTED_ERROR = 'Redis not started. Call start() first.';
const log = childLogger({ service: 'gatekeeper-db', module: 'redis' });

export default class DbRedis implements GatekeeperDb {
    private readonly dbName: string;
    private redis: Redis | null;

    constructor(dbName: string) {
        this.dbName = dbName;
        this.redis = null;
    }

    async start(): Promise<void> {
        const url = process.env.KC_REDIS_URL || 'redis://localhost:6379';
        this.redis = new Redis(url);

        try {
            await this.ensureDidIndex();
        }
        catch (error) {
            try {
                await this.redis.quit();
            }
            catch {
                // Preserve the migration error.
            }
            this.redis = null;
            throw error;
        }
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

    async addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        const key = this.didKey(did);
        const id = this.didId(did);
        const val = JSON.stringify(event);
        const script = `
            ${this.checkRedisTypesScript(['list', 'string', 'zset', 'zset'])}
            local change = cjson.decode(ARGV[2])
            local seq = redis.call('INCR', KEYS[2])
            local count = redis.call('RPUSH', KEYS[1], ARGV[1])
            change.seq = seq
            redis.call('ZADD', KEYS[3], seq, cjson.encode(change))
            redis.call('ZADD', KEYS[4], 0, ARGV[3])
            return count
        `;

        const result = await this.evalAtomicMutation(
            script,
            [key, this.indexSeqKey(), this.indexChangesKey(), this.didIndexKey()],
            [val, JSON.stringify({ kind: 'did', did }), id]
        );

        return Number(result ?? 0);
    }

    async setEvents(did: string, events: GatekeeperEvent[]): Promise<void> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        const key = this.didKey(did);
        const id = this.didId(did);
        const payloads = events.map(e => JSON.stringify(e));

        const script = `
            ${this.checkRedisTypesScript(['list', 'string', 'zset', 'zset'])}
            local count = tonumber(ARGV[1])
            if count == nil then
                error('invalid event count')
            end
            local change = cjson.decode(ARGV[count + 2])
            local id = ARGV[count + 3]
            local seq = redis.call('INCR', KEYS[2])
            redis.call('DEL', KEYS[1])
            for i = 1, count do
                redis.call('RPUSH', KEYS[1], ARGV[i + 1])
            end
            change.seq = seq
            redis.call('ZADD', KEYS[3], seq, cjson.encode(change))
            redis.call('ZADD', KEYS[4], 0, id)
            return count
        `;

        await this.evalAtomicMutation(
            script,
            [key, this.indexSeqKey(), this.indexChangesKey(), this.didIndexKey()],
            [
                payloads.length.toString(),
                ...payloads,
                JSON.stringify({ kind: 'did', did }),
                id,
            ]
        );
    }

    private didId(did: string): string {
        if (!did) {
            throw new InvalidDIDError();
        }
        const id = did.split(':').pop();
        if (!id) {
            throw new InvalidDIDError();
        }
        return id;
    }

    private didKey(did: string): string {
        return `${this.dbName}/dids/${this.didId(did)}`;
    }

    private indexSeqKey(): string {
        return `${this.dbName}/index/seq`;
    }

    private indexChangesKey(): string {
        return `${this.dbName}/index/changes/zset`;
    }

    private didIndexKey(): string {
        return `${this.dbName}/index/dids`;
    }

    private didIndexRebuildKey(): string {
        return `${this.didIndexKey()}:rebuild`;
    }

    private assertStarted(): Redis {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR);
        }

        return this.redis;
    }

    private extractDidIdFromKey(key: string): string | null {
        const prefix = `${this.dbName}/dids/`;

        if (!key.startsWith(prefix)) {
            return null;
        }

        const id = key.slice(prefix.length);
        return id.length > 0 && !id.includes('/')
            ? id
            : null;
    }

    private async ensureDidIndex(): Promise<void> {
        const redis = this.assertStarted();
        const indexKey = this.didIndexKey();
        const rebuildKey = this.didIndexRebuildKey();
        const indexType = await redis.type(indexKey);

        if (indexType === 'zset') {
            return;
        }

        if (indexType !== 'none') {
            throw new Error(`Unsupported Redis DID index key type for ${indexKey}: ${indexType}`);
        }

        await redis.del(rebuildKey);

        let hasDids = false;
        let cursor = '0';
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${this.dbName}/dids/*`, 'COUNT', 1000);
            cursor = nextCursor;

            for (const key of keys) {
                const id = this.extractDidIdFromKey(key);

                if (id) {
                    hasDids = true;
                    await redis.zadd(rebuildKey, 0, id);
                }
            }
        } while (cursor !== '0');

        if (!hasDids) {
            await redis.del(rebuildKey);
            return;
        }

        const published = await redis.renamenx(rebuildKey, indexKey);

        if (published === 0) {
            await redis.del(rebuildKey);

            const publishedType = await redis.type(indexKey);
            if (publishedType !== 'zset') {
                throw new Error(`Unsupported Redis DID index key type for ${indexKey}: ${publishedType}`);
            }
        }
    }

    private async evalAtomicMutation(script: string, keys: string[], args: string[]): Promise<unknown> {
        const redis = this.assertStarted();
        return redis.eval(script, keys.length, ...keys, ...args);
    }

    private checkRedisTypesScript(expectedTypes: string[]): string {
        return expectedTypes.map((expectedType, index) => `
            local type${index + 1} = redis.call('TYPE', KEYS[${index + 1}]).ok
            if type${index + 1} ~= 'none' and type${index + 1} ~= '${expectedType}' then
                error('WRONGTYPE key ' .. KEYS[${index + 1}] .. ' expected ${expectedType}')
            end
        `).join('\n');
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

        const script = `
            ${this.checkRedisTypesScript(['list', 'string', 'zset', 'zset'])}
            local change = cjson.decode(ARGV[1])
            local id = ARGV[2]
            local removed = redis.call('DEL', KEYS[1])
            redis.call('ZREM', KEYS[4], id)
            if removed > 0 then
                local seq = redis.call('INCR', KEYS[2])
                change.seq = seq
                redis.call('ZADD', KEYS[3], seq, cjson.encode(change))
            end
            return removed
        `;

        const removed = await this.evalAtomicMutation(
            script,
            [this.didKey(did), this.indexSeqKey(), this.indexChangesKey(), this.didIndexKey()],
            [JSON.stringify({ kind: 'did', did, removed: true }), this.didId(did)]
        );

        return Number(removed ?? 0);
    }

    async getAllKeys(): Promise<string[]> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        return this.redis.zrangebylex(this.didIndexKey(), '-', '+');
    }

    private async getIndexCheckpointCursor(): Promise<string> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        return await this.redis.get(this.indexSeqKey()) ?? '0';
    }

    async exportIndexSnapshot(_options?: IndexExportSnapshotOptions): Promise<IndexExportResponse> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        const options = _options ?? {};
        const limit = normalizeIndexExportLimit(options.limit);
        const cursor = options.cursor ?? null;
        const checkpointCursor = options.checkpointCursor ?? await this.getIndexCheckpointCursor();
        const min = cursor ? `(${cursor}` : '-';
        const ids = await this.redis.zrangebylex(
            this.didIndexKey(),
            min,
            '+',
            'LIMIT',
            0,
            limit + 1
        );

        return buildIndexSnapshotResponseFromPageKeys(
            ids,
            id => this.getEvents(id),
            options,
            checkpointCursor
        );
    }

    async exportIndexChanges(_options?: IndexExportChangesOptions): Promise<IndexExportResponse> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        const options = _options ?? {};
        const afterSeq = parseIndexExportCursor(options.cursor);
        const limit = normalizeIndexExportLimit(options.limit);
        const payloads = await this.redis.zrangebyscore(
            this.indexChangesKey(),
            `(${afterSeq}`,
            '+inf',
            'LIMIT',
            0,
            limit + 1
        );
        const changes = payloads.map(payload => JSON.parse(payload) as IndexChangeRecord);
        const page = changes.slice(0, limit);

        return buildIndexChangesResponse(
            page,
            payloads.length > limit,
            options,
            did => this.getEvents(did)
        );
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

        try {
            await this.redis!.eval(script, 1, key, hashes.length.toString(), ...hashes);
            return true;
        } catch (e) {
            log.error({ error: e }, 'Redis eval error');
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

        try {
            const script = `
                ${this.checkRedisTypesScript(['string', 'hash', 'string', 'string', 'zset'])}
                local block = cjson.decode(ARGV[1])
                local height = tonumber(ARGV[2])
                if height == nil then
                    error('invalid block height')
                end
                local hash = ARGV[3]
                local change = cjson.decode(ARGV[4])
                local currentMaxHeight = redis.call('GET', KEYS[3])
                if currentMaxHeight ~= false and tonumber(currentMaxHeight) == nil then
                    error('invalid current max height')
                end

                redis.call('SET', KEYS[1], cjson.encode(block))
                redis.call('HSET', KEYS[2], ARGV[2], hash)

                if currentMaxHeight == false or height > tonumber(currentMaxHeight) then
                    redis.call('SET', KEYS[3], ARGV[2])
                end

                local seq = redis.call('INCR', KEYS[4])
                change.seq = seq
                redis.call('ZADD', KEYS[5], seq, cjson.encode(change))
                return 1
            `;

            await this.evalAtomicMutation(
                script,
                [blockKey, heightMapKey, maxHeightKey, this.indexSeqKey(), this.indexChangesKey()],
                [
                    JSON.stringify(blockInfo),
                    height.toString(),
                    hash,
                    JSON.stringify({
                        kind: 'block',
                        registry,
                        block: blockInfo,
                    }),
                ]
            );
        } catch {
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
        } catch {
            return null;
        }
    }
}
