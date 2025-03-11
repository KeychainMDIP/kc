import { StoredWallet, WalletBase } from '../types.js';
import { MongoClient, Db, Collection } from 'mongodb'

export default class WalletMongo implements WalletBase {
    private client: MongoClient;
    private db?: Db;
    private collection?: Collection;
    private dbName = 'keymaster'
    private collectionName: string;

    public static async create(): Promise<WalletMongo> {
        const wallet = new WalletMongo();
        await wallet.connect();
        return wallet;
    }

    constructor(walletKey: string = 'wallet') {
        const url = process.env.KC_MONGODB_URL || 'mongodb://localhost:27017';
        this.client = new MongoClient(url);
        this.collectionName = walletKey;
    }

    async connect(): Promise<void> {
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        this.collection = this.db.collection(this.collectionName);
    }

    async disconnect(): Promise<void> {
        await this.client.close();
    }

    async saveWallet(wallet: Exclude<StoredWallet, null>, overwrite: boolean = false): Promise<boolean> {
        if (!this.collection) {
            throw new Error('Not connected to MongoDB. Call connect() first or use WalletMongo.create().')
        }

        const exists = await this.collection.findOne({});
        if (exists && !overwrite) {
            return false;
        }

        await this.collection.replaceOne({}, wallet, { upsert: true });
        return true;
    }

    async loadWallet(): Promise<StoredWallet> {
        if (!this.collection) {
            throw new Error('Not connected to MongoDB. Call connect() first or use WalletMongo.create().')
        }

        const wallet = await this.collection.findOne({});
        if (!wallet) {
            return null;
        }

        const { _id, ...rest } = wallet
        return rest as StoredWallet;
    }
}
