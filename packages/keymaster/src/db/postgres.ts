import { Pool } from 'pg';
import { StoredWallet, WalletBase } from '../types.js';

interface WalletRow {
    data: StoredWallet | string;
}

export default class WalletPostgres implements WalletBase {
    private readonly url: string;
    private readonly walletKey: string;
    private pool: Pool | null;

    public static async create(walletKey: string = 'wallet'): Promise<WalletPostgres> {
        const wallet = new WalletPostgres(walletKey);
        await wallet.connect();
        return wallet;
    }

    constructor(walletKey: string = 'wallet') {
        this.url = process.env.KC_POSTGRES_URL || 'postgresql://mdip:mdip@localhost:5432/mdip';
        this.walletKey = walletKey;
        this.pool = null;
    }

    async connect(): Promise<void> {
        if (this.pool) {
            return;
        }

        this.pool = new Pool({ connectionString: this.url });
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS wallet (
                id TEXT PRIMARY KEY,
                data JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
    }

    async disconnect(): Promise<void> {
        if (this.pool) {
            await this.pool.end();
            this.pool = null;
        }
    }

    private getPool(): Pool {
        if (!this.pool) {
            throw new Error('Postgres is not connected. Call connect() first or use WalletPostgres.create().');
        }

        return this.pool;
    }

    async saveWallet(wallet: StoredWallet, overwrite: boolean = false): Promise<boolean> {
        await this.connect();
        const pool = this.getPool();
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const existing = await client.query(
                'SELECT id FROM wallet WHERE id = $1 FOR UPDATE',
                [this.walletKey]
            );

            if (existing.rowCount && !overwrite) {
                await client.query('COMMIT');
                return false;
            }

            await client.query(
                `INSERT INTO wallet (id, data, updated_at)
                 VALUES ($1, $2::jsonb, NOW())
                 ON CONFLICT (id)
                 DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
                [this.walletKey, JSON.stringify(wallet)]
            );

            await client.query('COMMIT');
            return true;
        }
        catch (error) {
            try {
                await client.query('ROLLBACK');
            }
            catch {
                // Ignore rollback errors and rethrow original error.
            }
            throw error;
        }
        finally {
            client.release();
        }
    }

    async loadWallet(): Promise<StoredWallet | null> {
        await this.connect();
        const pool = this.getPool();

        const result = await pool.query<WalletRow>(
            'SELECT data FROM wallet WHERE id = $1 LIMIT 1',
            [this.walletKey]
        );

        if (result.rowCount === 0) {
            return null;
        }

        const data = result.rows[0].data;

        if (typeof data === 'string') {
            return JSON.parse(data);
        }

        return data;
    }
}
