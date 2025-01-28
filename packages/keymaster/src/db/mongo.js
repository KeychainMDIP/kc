import { MongoClient } from 'mongodb';

export default class WalletMongo {
    static async create() {
        const wallet = new WalletMongo();
        await wallet.connect();
        return wallet;
    }

    constructor(walletKey = 'wallet') {
        const url = process.env.KC_MONGODB_URL || 'mongodb://localhost:27017';
        this.client = new MongoClient(url);
        this.dbName = 'keymaster';
        this.collectionName = walletKey;
    }

    async connect() {
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        this.collection = this.db.collection(this.collectionName);
    }

    async saveWallet(wallet, overwrite = false) {
        const exists = await this.collection.findOne({});
        if (exists && !overwrite) {
            return false;
        }

        await this.collection.replaceOne({}, wallet, { upsert: true });
        return true;
    }

    async loadWallet() {
        const wallet = await this.collection.findOne({});
        if (!wallet) {
            return null;
        }

        return wallet;
    }
}
