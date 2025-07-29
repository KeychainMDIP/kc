import { MongoClient, Db, Collection } from 'mongodb';
import { MediatorDb, MediatorDbInterface } from '../types.js';

export default class JsonMongo implements MediatorDbInterface {
    private client: MongoClient;
    private readonly dbName: string;
    private readonly collectionName: string;
    private db?: Db;
    private collection?: Collection<MediatorDb>;

    static async create(registry: string): Promise<JsonMongo> {
        const json = new JsonMongo(registry);
        await json.connect();
        return json;
    }

    constructor(registry: string) {
        const url = process.env.KC_MONGODB_URL || 'mongodb://localhost:27017';
        this.client = new MongoClient(url);
        this.dbName = 'sat-mediator';
        this.collectionName = registry;
    }

    async connect(): Promise<void> {
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        this.collection = this.db.collection(this.collectionName);
    }

    async disconnect(): Promise<void> {
        if (this.collection) {
            await this.client.close();
            this.collection = undefined;
            this.db = undefined;
        }
    }

    async saveDb(data: MediatorDb): Promise<boolean> {
        if (!this.collection) {
            throw new Error('Not connected to MongoDB. Call connect() first or use JsonMongo.create().')
        }
        await this.collection.replaceOne({}, data, { upsert: true });
        return true;
    }

    async loadDb(): Promise<MediatorDb | null> {
        if (!this.collection) {
            throw new Error('Not connected to MongoDB. Call connect() first or use JsonMongo.create().')
        }
        const db = await this.collection.findOne({});
        return db || null;
    }
}
