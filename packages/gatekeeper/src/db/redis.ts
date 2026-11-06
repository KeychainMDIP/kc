import { Redis } from 'ioredis';
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
import { LIFECYCLE_VERSION, LIFECYCLE_PAGE_SIZE, expirationKey, isDIDLifecycle, isExpirationJob, isLifecycleMetadata, lifecycleLimit, projectLifecycle } from './lifecycle.js';
import { withHealthCheckTimeout } from './health.js';

const REDIS_NOT_STARTED_ERROR = 'Redis not started. Call start() first.';
const log = childLogger({ service: 'gatekeeper-db', module: 'redis' });

// Decode and validate every lifecycle key before the event script starts writing.
const lifecyclePrepare = `
    local base = lifecycleBase
    local lifeKeys = {base..'/rows', base..'/due', base..'/controllers', base..'/unknown', base..'/jobs', base..'/job-index'}
    local lifeTypes = {'hash', 'zset', 'zset', 'set', 'hash', 'zset'}
    for i, key in ipairs(lifeKeys) do
        local kind = redis.call('TYPE', key).ok
        if kind ~= 'none' and kind ~= lifeTypes[i] then error('WRONGTYPE lifecycle key '..key) end
    end
    local oldRaw = redis.call('HGET', lifeKeys[1], lifecycleId)
    local oldLife = oldRaw and cjson.decode(oldRaw) or nil
    if oldLife and (type(oldLife) ~= 'table' or type(oldLife.record) ~= 'table'
        or (oldLife.dueKey and type(oldLife.dueKey) ~= 'string')
        or (oldLife.controllerKey and type(oldLife.controllerKey) ~= 'string')) then error('Invalid lifecycle record') end
    local nextLife = cjson.decode(lifecyclePayload)
    if nextLife == cjson.null then nextLife = nil end
    if nextLife and nextLife.keep then
        local revision = nextLife.revision
        nextLife = oldRaw and cjson.decode(oldRaw) or nil
        if nextLife then nextLife.record.revision = revision end
    end
    if nextLife and nextLife.delete then
        local revision = nextLife.revision
        nextLife = oldRaw and cjson.decode(oldRaw) or nil
        if nextLife then
            if nextLife.record.controllerUnknown and nextLife.record.expiresAt
                and (nextLife.record.type == 'agent' or nextLife.record.type == 'asset') then
                nextLife.record.unresolved = nil
            end
            nextLife.record.controller = nil
            nextLife.record.controllerUnknown = nil
            nextLife.record.revision = revision
            nextLife.controllerKey = nil
            if not nextLife.record.expiresAt and not nextLife.record.unresolved then nextLife = nil end
        end
    end
    local nextRaw = nextLife and cjson.encode(nextLife) or nil
    if nextRaw and nextLife.expiresAtText then
        nextRaw = string.gsub(nextRaw, '("expiresAt":)[^,}]+', '%1'..nextLife.expiresAtText)
    end
    local oldJobRaw = redis.call('HGET', lifeKeys[5], lifecycleId)
    local oldJob = oldJobRaw and cjson.decode(oldJobRaw) or nil
    if oldJob and (type(oldJob) ~= 'table' or oldJob.type ~= 'agent' or type(oldJob.expiresAt) ~= 'number') then
        error('Invalid expiration cleanup record')
    end
`;

const lifecycleCommit = `
    if oldLife then
        if oldLife.dueKey then redis.call('ZREM', lifeKeys[2], oldLife.dueKey) end
        if oldLife.controllerKey then redis.call('ZREM', lifeKeys[3], oldLife.controllerKey) end
    end
    redis.call('SREM', lifeKeys[4], lifecycleId)
    if nextLife then
        redis.call('HSET', lifeKeys[1], lifecycleId, nextRaw)
        if nextLife.dueKey and not nextLife.record.unresolved then redis.call('ZADD', lifeKeys[2], 0, nextLife.dueKey) end
        if nextLife.controllerKey then redis.call('ZADD', lifeKeys[3], 0, nextLife.controllerKey) end
        if nextLife.record.controllerUnknown then redis.call('SADD', lifeKeys[4], lifecycleId) end
    else
        redis.call('HDEL', lifeKeys[1], lifecycleId)
    end
    if not preserveExpirationJob and oldJob and (not nextLife or nextLife.record.type ~= 'agent'
        or nextLife.record.expiresAt ~= oldJob.expiresAt) then
        redis.call('HDEL', lifeKeys[5], lifecycleId)
        redis.call('ZREM', lifeKeys[6], lifecycleId)
    end
`;

export default class DbRedis implements GatekeeperDb {
    private readonly dbName: string;
    private redis: Redis | null;
    private lastRedisErrorLogAt: number;

    constructor(dbName: string) {
        this.dbName = dbName;
        this.redis = null;
        this.lastRedisErrorLogAt = 0;
    }

    async start(): Promise<void> {
        const url = process.env.KC_REDIS_URL || 'redis://localhost:6379';
        this.redis = new Redis(url);
        this.redis.on('error', error => this.logRedisConnectionError(error));

        try {
            await this.redis.ping();
            await this.ensureDidIndex();
            await this.ensureIndexEpoch();
            await this.initializeLifecycleIndex();
        }
        catch (error) {
            try {
                await this.redis.quit();
            }
            catch {
                // Preserve the startup/bootstrap error.
            }
            finally {
                this.redis.removeAllListeners('error');
            }
            this.redis = null;
            throw error;
        }
    }

    async stop(): Promise<void> {
        if (this.redis) {
            const redis = this.redis;
            this.redis = null
            try {
                await redis.quit()
            }
            finally {
                redis.removeAllListeners('error');
            }
        }
    }

    async isReady(): Promise<boolean> {
        if (!this.redis) {
            return false;
        }
        if (this.redis.status !== 'ready') {
            return false;
        }

        try {
            const response = await withHealthCheckTimeout(
                this.redis.ping(),
                'Redis readiness check timed out'
            );
            return response === 'PONG';
        }
        catch {
            return false;
        }
    }

    private logRedisConnectionError(error: unknown): void {
        const now = Date.now();
        if (now - this.lastRedisErrorLogAt < 60_000) {
            return;
        }

        this.lastRedisErrorLogAt = now;
        log.error({ err: error }, 'Redis connection error');
    }

    async resetDb(): Promise<number> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        await this.redis.set(`${this.lifecycleKey()}/metadata`, JSON.stringify({
            version: LIFECYCLE_VERSION, epoch: await this.getIndexEpoch(), checkedCursor: '0', complete: false,
        }));
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

        await this.redis.set(this.indexEpochKey(), randomUUID());

        return totalDeleted;
    }

    async addEvent(did: string, event: GatekeeperEvent): Promise<number> {
        return this.addEventAndQueue(did, event, []);
    }

    async addEventAndQueue(did: string, event: GatekeeperEvent, queueRegistries: string[]): Promise<number> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        const key = this.didKey(did);
        const id = this.didId(did);
        const val = JSON.stringify(event);
        const change = JSON.stringify({
            kind: 'did',
            did,
            event,
            lifecycleVersion: LIFECYCLE_VERSION,
        });
        const queueKeys = queueRegistries.map(registry => this.queueKey(registry));
        const script = `
            ${this.checkRedisTypesScript(['list', 'string', 'zset', 'zset', ...queueKeys.map(() => 'list')])}
            local change = cjson.decode(ARGV[2])
            local lifecycleBase = ARGV[5]
            local lifecycleId = ARGV[3]
            local lifecyclePayload = ARGV[6]
            local preserveExpirationJob = false
            if ARGV[7] == 'create' and redis.call('LLEN', KEYS[1]) > 0 then
                lifecyclePayload = cjson.encode({keep = true, revision = ARGV[8]})
            end
            ${lifecyclePrepare}
            local seq = redis.call('INCR', KEYS[2])
            local count = redis.call('RPUSH', KEYS[1], ARGV[1])
            change.seq = seq
            redis.call('ZADD', KEYS[3], seq, cjson.encode(change))
            redis.call('ZADD', KEYS[4], 0, ARGV[3])
            for i = 5, #KEYS do
                redis.call('RPUSH', KEYS[i], ARGV[4])
            end
            ${lifecycleCommit}
            return count
        `;

        const result = await this.evalAtomicMutation(
            script,
            [key, this.indexSeqKey(), this.indexChangesKey(), this.didIndexKey(), ...queueKeys],
            [val, change, id, JSON.stringify(event.operation), this.lifecycleKey(), this.lifecyclePayload(did, [event], true),
                event.operation.type, event.operation.type === 'create' ? randomUUID() : '']
        );

        return Number(result ?? 0);
    }

    async setEvents(did: string, events: GatekeeperEvent[], options?: SetEventsOptions): Promise<void> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        const key = this.didKey(did);
        const id = this.didId(did);
        const payloads = events.map(e => JSON.stringify(e));
        const operationEvents = options?.operationEvents ?? [];
        const changes = operationEvents.length === 0
            ? [JSON.stringify({ kind: 'did', did, lifecycleVersion: LIFECYCLE_VERSION })]
            : operationEvents.map(event => JSON.stringify({
                kind: 'did',
                did,
                event,
                lifecycleVersion: LIFECYCLE_VERSION,
            }));

        const script = `
            ${this.checkRedisTypesScript(['list', 'string', 'zset', 'zset'])}
            local eventCount = tonumber(ARGV[1])
            local changeCount = tonumber(ARGV[2])
            if eventCount == nil then
                error('invalid event count')
            end
            if changeCount == nil then
                error('invalid change count')
            end
            local changes = {}
            for i = 1, changeCount do
                changes[i] = cjson.decode(ARGV[2 + eventCount + i])
            end
            local id = ARGV[2 + eventCount + changeCount + 1]
            local lifecycleId = id
            local lifecycleBase = ARGV[2 + eventCount + changeCount + 2]
            local lifecyclePayload = ARGV[2 + eventCount + changeCount + 3]
            local preserveExpirationJob = eventCount == 0
            ${lifecyclePrepare}
            redis.call('DEL', KEYS[1])
            for i = 1, eventCount do
                redis.call('RPUSH', KEYS[1], ARGV[i + 2])
            end
            for i = 1, changeCount do
                local change = changes[i]
                local seq = redis.call('INCR', KEYS[2])
                change.seq = seq
                redis.call('ZADD', KEYS[3], seq, cjson.encode(change))
            end
            redis.call('ZADD', KEYS[4], 0, id)
            ${lifecycleCommit}
            return eventCount
        `;

        await this.evalAtomicMutation(
            script,
            [key, this.indexSeqKey(), this.indexChangesKey(), this.didIndexKey()],
            [
                payloads.length.toString(),
                changes.length.toString(),
                ...payloads,
                ...changes,
                id,
                this.lifecycleKey(),
                this.lifecyclePayload(did, events),
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

    private indexEpochKey(): string {
        return `${this.dbName}/index/epoch`;
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

    private async ensureIndexEpoch(): Promise<string> {
        const redis = this.assertStarted();
        const key = this.indexEpochKey();
        const existing = await redis.get(key);
        if (existing) {
            return existing;
        }

        const epoch = randomUUID();
        const result = await redis.set(key, epoch, 'NX');
        return result === 'OK'
            ? epoch
            : await redis.get(key) ?? epoch;
    }

    private async getIndexEpoch(): Promise<string> {
        return this.ensureIndexEpoch();
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

    async deleteEvents(did: string, expected?: DeleteEventsOptions): Promise<number> {
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
            local lifecycleId = id
            local lifecycleBase = ARGV[3]
            local lifecyclePayload = 'null'
            local preserveExpirationJob = true
            ${lifecyclePrepare}
            if ARGV[4] ~= '' then
                local stateRaw = redis.call('GET', lifecycleBase..'/metadata')
                local state = stateRaw and cjson.decode(stateRaw) or nil
                if not state or state.complete ~= true or state.version ~= 1
                    or type(state.checkedCursor) ~= 'string' or #state.checkedCursor > 20
                    or not string.match(state.checkedCursor, '^%d+$')
                    or (#state.checkedCursor > 1 and string.sub(state.checkedCursor, 1, 1) == '0')
                    or redis.call('HGET', lifeKeys[1], '__version__') ~= '1'
                    or state.epoch ~= redis.call('GET', ARGV[5]) then error('Lifecycle index is not initialized') end
                if state.epoch ~= ARGV[4] or not oldLife or oldLife.record.revision ~= ARGV[6] then return 0 end
            end
            local events = redis.call('LRANGE', KEYS[1], 0, -1)
            local decodedEvents = {}
            for i, event in ipairs(events) do decodedEvents[i] = cjson.decode(event) end
            local removed = redis.call('DEL', KEYS[1])
            redis.call('ZREM', KEYS[4], id)
            if removed > 0 then
                if #events == 0 then
                    local seq = redis.call('INCR', KEYS[2])
                    change.seq = seq
                    redis.call('ZADD', KEYS[3], seq, cjson.encode(change))
                else
                    for _, event in ipairs(decodedEvents) do
                        local seq = redis.call('INCR', KEYS[2])
                        change.seq = seq
                        change.event = event
                        redis.call('ZADD', KEYS[3], seq, cjson.encode(change))
                    end
                end
            end
            ${lifecycleCommit}
            return removed
        `;

        const removed = await this.evalAtomicMutation(
            script,
            [this.didKey(did), this.indexSeqKey(), this.indexChangesKey(), this.didIndexKey()],
            [JSON.stringify({ kind: 'did', did, removed: true, lifecycleVersion: LIFECYCLE_VERSION }), this.didId(did),
                this.lifecycleKey(), expected?.epoch ?? '', this.indexEpochKey(), expected?.revision ?? '']
        );

        return Number(removed ?? 0);
    }

    private lifecycleKey(): string { return `${this.dbName}/lifecycle`; }

    private lifecyclePayload(did: string, events: GatekeeperEvent[], append = false): string {
        if (append && events[0]?.operation.type === 'delete') return JSON.stringify({ delete: true, revision: randomUUID() });
        const row = projectLifecycle(did, events);
        return JSON.stringify(row ? {
            record: row,
            ...(row.expiresAt !== undefined && { dueKey: expirationKey(row) }),
            ...(row.type === 'asset' && row.controller && { controllerKey: `${row.controller}/${row.suffix}` }),
            ...(row.expiresAt !== undefined && { expiresAtText: String(row.expiresAt) }),
        } : null);
    }

    async initializeLifecycleIndex(): Promise<void> {
        const redis = this.assertStarted();
        const base = this.lifecycleKey();
        const epoch = await this.getIndexEpoch();
        const checkpoint = await this.getIndexCheckpointCursor();
        const raw = await redis.get(`${base}/metadata`);
        let state: LifecycleMetadata | undefined = raw ? JSON.parse(raw) : undefined;
        if (state !== undefined && !isLifecycleMetadata(state)) throw new Error('Invalid lifecycle metadata');
        const rowsVersion = await redis.hget(`${base}/rows`, '__version__');
        const valid = state?.version === LIFECYCLE_VERSION && state.epoch === epoch
            && BigInt(state.checkedCursor) <= BigInt(checkpoint) && rowsVersion === String(LIFECYCLE_VERSION);
        let uncovered = false;
        if (valid) {
            let cursor = state!.checkedCursor;
            while (true) {
                const page = await redis.zrangebyscore(this.indexChangesKey(), `(${cursor}`, checkpoint, 'LIMIT', 0, LIFECYCLE_PAGE_SIZE);
                if (!page.length) break;
                const changes: IndexChangeRecord[] = page.map(item => JSON.parse(item));
                if (changes.some(change => change.kind === 'did' && change.lifecycleVersion !== LIFECYCLE_VERSION)) {
                    uncovered = true;
                    break;
                }
                const nextCursor = String(changes[changes.length - 1].seq);
                if (BigInt(nextCursor) <= BigInt(cursor)) throw new Error('Lifecycle source checkpoint did not advance');
                cursor = nextCursor;
            }
        }
        if (!valid || uncovered) {
            const discardJobs = state?.epoch !== epoch;
            state = { version: LIFECYCLE_VERSION, epoch, complete: false, checkedCursor: checkpoint };
            const keys = ['/rows', '/due', '/controllers', '/unknown', ...(discardJobs ? ['/jobs', '/job-index'] : [])].map(key => base + key);
            const results = await redis.multi().del(...keys)
                .hset(`${base}/rows`, '__version__', String(LIFECYCLE_VERSION))
                .set(`${base}/metadata`, JSON.stringify(state)).exec();
            const failed = results?.find(([error]) => error);
            if (failed) throw failed[0];
        }
        if (!state!.complete) {
            while (true) {
                const keys = await redis.zrangebylex(this.didIndexKey(), state!.backfillCursor ? `(${state!.backfillCursor}` : '-', '+',
                    'LIMIT', 0, LIFECYCLE_PAGE_SIZE);
                if (!keys.length) break;
                for (const id of keys) {
                    const events = await this.getEvents(id);
                    const did = id;
                    await redis.eval(`local lifecycleBase = ARGV[1]
                        local lifecycleId = ARGV[2]
                        local lifecyclePayload = ARGV[3]
                        local preserveExpirationJob = true
                        ${lifecyclePrepare}
                        ${lifecycleCommit}
                        return 1`, 0, base, id, this.lifecyclePayload(did, events));
                }
                state!.backfillCursor = keys[keys.length - 1];
                await redis.set(`${base}/metadata`, JSON.stringify(state));
            }
        }
        await redis.set(`${base}/metadata`, JSON.stringify({ version: LIFECYCLE_VERSION, epoch, complete: true, checkedCursor: checkpoint }));
    }

    async getLifecycleMetadata(): Promise<LifecycleMetadata> {
        const raw = await this.assertStarted().get(`${this.lifecycleKey()}/metadata`);
        const state: LifecycleMetadata | undefined = raw ? JSON.parse(raw) : undefined;
        if (!isLifecycleMetadata(state) || !state.complete || state.version !== LIFECYCLE_VERSION || state.epoch !== await this.getIndexEpoch()
            || await this.assertStarted().hget(`${this.lifecycleKey()}/rows`, '__version__') !== String(LIFECYCLE_VERSION)) {
            throw new Error('Lifecycle index is not initialized');
        }
        return state;
    }

    async getLifecycle(did: string): Promise<DIDLifecycle | null> {
        const raw = await this.assertStarted().hget(`${this.lifecycleKey()}/rows`, this.didId(did));
        return raw ? this.parseLifecycle(raw) : null;
    }

    private parseLifecycle(raw: string): DIDLifecycle {
        const value: unknown = JSON.parse(raw).record;
        if (!isDIDLifecycle(value)) throw new Error('Invalid lifecycle record');
        return value;
    }

    private parseExpirationJob(raw: string): ExpirationJob {
        const value: unknown = JSON.parse(raw);
        if (!isExpirationJob(value)) throw new Error('Invalid expiration cleanup record');
        return value;
    }

    private async lifecycleRows(ids: string[]): Promise<DIDLifecycle[]> {
        if (!ids.length) return [];
        const rows = await this.assertStarted().hmget(`${this.lifecycleKey()}/rows`, ...ids);
        return rows.map(raw => {
            if (!raw) throw new Error('Missing indexed lifecycle record');
            return this.parseLifecycle(raw);
        });
    }

    async getDueDIDs(cutoff: number, limit: number, after?: DueDIDCursor): Promise<DIDLifecycle[]> {
        const keys = await this.assertStarted().zrangebylex(`${this.lifecycleKey()}/due`, after ? `(${expirationKey(after)}` : '-',
            `(${expirationKey({ expiresAt: cutoff, suffix: '' })}`, 'LIMIT', 0, lifecycleLimit(limit));
        return this.lifecycleRows(keys.map(key => key.split('/').pop()!));
    }

    async getControlledDIDs(controller: string, limit: number, after?: string): Promise<DIDLifecycle[]> {
        const prefix = `${this.didId(controller)}/`;
        const keys = await this.assertStarted().zrangebylex(`${this.lifecycleKey()}/controllers`,
            after ? `(${prefix}${after}` : `[${prefix}`, `[${prefix}\uffff`, 'LIMIT', 0, lifecycleLimit(limit));
        return this.lifecycleRows(keys.map(key => key.slice(prefix.length)));
    }

    async hasUnresolvedLifecycle(): Promise<boolean> {
        return await this.assertStarted().scard(`${this.lifecycleKey()}/unknown`) > 0;
    }

    async getExpirationJobs(limit: number, after?: string): Promise<ExpirationJob[]> {
        const redis = this.assertStarted();
        const ids = await redis.zrangebylex(`${this.lifecycleKey()}/job-index`, after ? `(${after}` : '-', '+', 'LIMIT', 0, lifecycleLimit(limit));
        if (!ids.length) return [];
        return (await redis.hmget(`${this.lifecycleKey()}/jobs`, ...ids)).map(raw => {
            if (!raw) throw new Error('Missing indexed expiration cleanup record');
            return this.parseExpirationJob(raw);
        });
    }

    async getExpirationJob(suffix: string): Promise<ExpirationJob | null> {
        const raw = await this.assertStarted().hget(`${this.lifecycleKey()}/jobs`, suffix);
        return raw ? this.parseExpirationJob(raw) : null;
    }

    async saveExpirationJob(suffix: string, job: ExpirationJob | null): Promise<void> {
        if (job && (!isExpirationJob(job) || job.suffix !== suffix)) throw new Error('Invalid expiration cleanup record');
        const script = `
            ${this.checkRedisTypesScript(['hash', 'zset'])}
            local job = cjson.decode(ARGV[2])
            if job == cjson.null then
                redis.call('HDEL', KEYS[1], ARGV[1])
                redis.call('ZREM', KEYS[2], ARGV[1])
            else
                redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
                redis.call('ZADD', KEYS[2], 0, ARGV[1])
            end
            return 1`;
        await this.evalAtomicMutation(script, [`${this.lifecycleKey()}/jobs`, `${this.lifecycleKey()}/job-index`], [suffix, JSON.stringify(job)]);
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
        const indexEpoch = await this.getIndexEpoch();
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
            checkpointCursor,
            indexEpoch
        );
    }

    async exportIndexChanges(_options?: IndexExportChangesOptions): Promise<IndexExportResponse> {
        if (!this.redis) {
            throw new Error(REDIS_NOT_STARTED_ERROR)
        }

        const options = _options ?? {};
        const afterSeq = parseIndexExportCursor(options.cursor);
        const limit = normalizeIndexExportLimit(options.limit);
        const checkpointCursor = await this.getIndexCheckpointCursor();
        const indexEpoch = await this.getIndexEpoch();
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
            checkpointCursor,
            did => this.getEvents(did),
            indexEpoch
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
