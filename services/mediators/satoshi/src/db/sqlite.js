import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export default class JsonSQLite {
    static async create(registry, dataFolder = 'data') {
        const json = new JsonSQLite(registry, dataFolder);
        await json.connect();
        return json;
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
            CREATE TABLE IF NOT EXISTS json (
                id INTEGER PRIMARY KEY,
                data TEXT NOT NULL
            )
        `);
    }

    async disconnect() {
        await this.db.close();
    }

    async saveDb(data) {
        await this.db.run('DELETE FROM json');
        await this.db.run('INSERT INTO json (data) VALUES (?)', JSON.stringify(data));
        return true;
    }

    async loadDb() {
        const row = await this.db.get('SELECT data FROM json LIMIT 1');

        if (!row) {
            return null;
        }

        return JSON.parse(row.data);
    }
}
