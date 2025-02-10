import Redis from 'ioredis';

export default class JsonRedis {
    static async create(registry) {
        const json = new JsonRedis(registry);
        await json.connect();
        return json;
    }

    constructor(registry) {
        this.url = process.env.KC_REDIS_URL || 'redis://localhost:6379';
        this.dbKey = `sat-mediator/${registry}`;
    }

    async connect() {
        this.redis = new Redis(this.url);
    }

    async disconnect() {
        await this.redis.quit();
    }

    async saveDb(data) {
        await this.redis.set(this.dbKey, JSON.stringify(data));
        return true;
    }

    async loadDb() {
        const data = await this.redis.get(this.dbKey);

        if (!data) {
            return null;
        }

        return JSON.parse(data);
    }
}
