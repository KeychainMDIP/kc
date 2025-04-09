import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { MediatorDb, MediatorDbInterface } from '../types.js';

export default class JsonSQLite implements MediatorDbInterface {
    private readonly fileName: string;
    private db?: Database;

    static async create(registry: string, dataFolder = 'data'): Promise<JsonSQLite> {
        const json = new JsonSQLite(registry, dataFolder);
        await json.connect();
        return json;
    }

    constructor(registry: string, dataFolder = 'data') {
        this.fileName = `${dataFolder}/${registry}-mediator.db`;
    }

    async connect(): Promise<void> {
        this.db = await open({
            filename: this.fileName,
            driver: sqlite3.Database
        });

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS json (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL
            )
        `);
    }

    async disconnect(): Promise<void> {
        if (this.db) {
            await this.db.close();
            this.db = undefined;
        }
    }

    async saveDb(data: MediatorDb): Promise<boolean> {
        if (!this.db) {
            throw new Error('SQLite database is not connected. Call connect() first.');
        }
        await this.db.run('DELETE FROM json');
        await this.db.run('INSERT INTO json (data) VALUES (?)', JSON.stringify(data));
        return true;
    }

    async loadDb(): Promise<MediatorDb | null> {
        if (!this.db) {
            throw new Error('SQLite database is not connected. Call connect() first.');
        }
        const row = await this.db.get('SELECT data FROM json LIMIT 1');

        if (!row) {
            return null;
        }

        return JSON.parse(row.data) as MediatorDb;
    }
}
