import { StoredWallet } from '../types.js';
import { AbstractBase } from './abstract-base.js';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

export default class WalletSQLite extends AbstractBase {
    private readonly walletName: string;
    private db: Database | null;

    static async create(walletFileName: string = 'wallet.db', dataFolder: string = 'data'): Promise<WalletSQLite> {
        const wallet = new WalletSQLite(walletFileName, dataFolder);
        await wallet.connect();
        return wallet;
    }

    constructor(walletFileName: string = 'wallet.db', dataFolder: string = 'data') {
        super();
        this.walletName = `${dataFolder}/${walletFileName}`;
        this.db = null
    }

    async connect(): Promise<void> {
        if (this.db) {
            return;
        }

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

    async disconnect(): Promise<void> {
        if (this.db) {
            await this.db.close()
            this.db = null
        }
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        await this.connect();

        if (!this.db) {
            throw new Error('DB failed to connect.')
        }

        const exists = await this.db.get('SELECT 1 FROM wallet LIMIT 1');
        if (exists && !overwrite) {
            return false;
        }

        await this.db.run('DELETE FROM wallet');
        await this.db.run('INSERT INTO wallet (data) VALUES (?)', JSON.stringify(wallet));
        return true;
    }

    async loadWallet(): Promise<StoredWallet | null> {
        await this.connect();

        if (!this.db) {
            throw new Error('DB failed to connect.')
        }

        const row = await this.db.get('SELECT data FROM wallet LIMIT 1');
        if (!row) {
            return null;
        }

        return JSON.parse(row.data);
    }
}
