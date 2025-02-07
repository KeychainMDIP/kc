import { MongoClient } from 'mongodb';

export default class JsonMongo {
    static async create(registry) {
        const wallet = new JsonMongo(registry);
        await wallet.connect();
        return wallet;
    }

    constructor(registry) {
        const url = process.env.KC_MONGODB_URL || 'mongodb://localhost:27017';
        this.client = new MongoClient(url);
        this.dbName = 'sat-mediator';
        this.collectionName = registry;
    }

    async connect() {
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        this.collection = this.db.collection(this.collectionName);
    }

    async disconnect() {
        await this.client.close();
    }

    async saveDb(data) {
        return this.collection.replaceOne({}, data, { upsert: true });
    }

    async loadDb() {
        return this.collection.findOne({});
    }
}
