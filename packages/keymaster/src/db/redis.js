import Redis from 'ioredis';

export default class WalletRedis {
    static async create(walletKey = 'wallet') {
        const wallet = new WalletRedis(walletKey);
        await wallet.connect();
        return wallet;
    }

    constructor(walletKey = 'wallet') {
        this.url = process.env.KC_REDIS_URL || 'redis://localhost:6379';
        this.walletKey = walletKey;
    }

    async connect() {
        this.redis = new Redis(this.url);
    }

    async disconnect() {
        await this.redis.quit();
    }

    async saveWallet(wallet, overwrite = false) {
        const exists = await this.redis.exists(this.walletKey);
        if (exists && !overwrite) {
            return false;
        }

        await this.redis.set(this.walletKey, JSON.stringify(wallet));
        return true;
    }

    async loadWallet() {
        const walletJson = await this.redis.get(this.walletKey);
        if (!walletJson) {
            return null;
        }

        return JSON.parse(walletJson);
    }
}
