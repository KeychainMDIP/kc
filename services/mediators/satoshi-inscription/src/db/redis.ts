import { Redis } from 'ioredis'
import { MediatorDb, MediatorDbInterface } from '../types.js';

export default class JsonRedis implements MediatorDbInterface {
    private readonly url: string;
    private readonly dbKey: string;
    private redis?: Redis;

    static async create(registry: string): Promise<JsonRedis> {
        const json = new JsonRedis(registry);
        await json.connect();
        return json;
    }

    constructor(registry: string) {
        this.url = process.env.KC_REDIS_URL || 'redis://localhost:6379';
        this.dbKey = `sat-mediator/${registry}`;
    }

    async connect(): Promise<void> {
        this.redis = new Redis(this.url);
    }

    async disconnect(): Promise<void> {
        if (this.redis) {
            await this.redis.quit();
            this.redis = undefined;
        }
    }

    async saveDb(data: MediatorDb): Promise<boolean> {
        if (!this.redis) {
            throw new Error('Redis client not connected. Call connect() first.');
        }
        await this.redis.set(this.dbKey, JSON.stringify(data));
        return true;
    }

    async loadDb(): Promise<MediatorDb | null> {
        if (!this.redis) {
            throw new Error('Redis client not connected. Call connect() first.');
        }
        const data = await this.redis.get(this.dbKey);

        if (!data) {
            return null;
        }

        return JSON.parse(data) as MediatorDb;
    }
}
