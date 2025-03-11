import { StoredWallet, WalletBase } from '../types.js';
import { Redis } from 'ioredis'

export default class WalletRedis implements WalletBase {
    private walletKey: string;
    private url: string;
    private redis: Redis | null

    public static async create(walletKey: string = 'wallet'): Promise<WalletRedis> {
        const wallet = new WalletRedis(walletKey);
        await wallet.connect();
        return wallet;
    }

    constructor(walletKey: string = 'wallet') {
        this.url = process.env.KC_REDIS_URL || 'redis://localhost:6379';
        this.walletKey = walletKey;
        this.redis = null
    }

    async connect(): Promise<void> {
        this.redis = new Redis(this.url);
    }

    async disconnect() {
        if (this.redis) {
            await this.redis.quit()
            this.redis = null
        }
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        if (!this.redis) {
            throw new Error('Redis is not connected. Call connect() first or use WalletRedis.create().')
        }

        const exists = await this.redis.exists(this.walletKey);
        if (exists && !overwrite) {
            return false;
        }

        await this.redis.set(this.walletKey, JSON.stringify(wallet));
        return true;
    }

    async loadWallet(): Promise<StoredWallet> {
        if (!this.redis) {
            throw new Error('Redis is not connected. Call connect() first or use WalletRedis.create().')
        }

        const walletJson = await this.redis.get(this.walletKey);
        if (!walletJson) {
            return null;
        }

        return JSON.parse(walletJson);
    }
}
