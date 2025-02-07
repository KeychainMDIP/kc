import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export default class JsonSQLite {
    static async create(registry, dataFolder = 'data') {
        const wallet = new JsonSQLite(registry, dataFolder);
        await wallet.connect();
        return wallet;
    }

    constructor(registry, dataFolder = 'data') {
        this.fileName = `${dataFolder}/${registry}-mediator.db`;
    }

    async connect() {
        this.db = await open({
            filename: this.fileName,
            driver: sqlite3.Database
        });

        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS wallet (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL
            )
        `);
    }

    async disconnect() {
        await this.db.close();
    }

    async saveDb(data) {
        await this.db.run('DELETE FROM wallet');
        await this.db.run('INSERT INTO wallet (data) VALUES (?)', JSON.stringify(data));
        return true;
    }

    async loadDb() {
        const row = await this.db.get('SELECT data FROM wallet LIMIT 1');

        if (!row) {
            return null;
        }

        return JSON.parse(row.data);
    }
}
