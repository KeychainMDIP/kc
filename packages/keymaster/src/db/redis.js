import Redis from 'ioredis';

export default class WalletRedis {
    constructor(walletKey = 'wallet') {
        const url = process.env.KC_REDIS_URL || 'redis://localhost:6379';
        this.redis = new Redis(url);
        this.walletKey = walletKey;
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
