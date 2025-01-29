import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export default class WalletSQLite {
    static async create(walletFileName = 'wallet.db', dataFolder = 'data') {
        const wallet = new WalletSQLite(walletFileName, dataFolder);
        await wallet.connect();
        return wallet;
    }

    constructor(walletFileName = 'wallet.db', dataFolder = 'data') {
        this.walletName = `${dataFolder}/${walletFileName}`;
    }

    async connect() {
        this.db = await open({
            filename: this.walletName,
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

    async saveWallet(wallet, overwrite = false) {
        await this.connect();
        const exists = await this.db.get('SELECT 1 FROM wallet LIMIT 1');
        if (exists && !overwrite) {
            return false;
        }

        await this.db.run('DELETE FROM wallet');
        await this.db.run('INSERT INTO wallet (data) VALUES (?)', JSON.stringify(wallet));
        return true;
    }

    async loadWallet() {
        await this.connect();
        const row = await this.db.get('SELECT data FROM wallet LIMIT 1');
        if (!row) {
            return null;
        }

        return JSON.parse(row.data);
    }
}
