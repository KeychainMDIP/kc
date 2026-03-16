import { Pool } from 'pg';
import { MediatorDb } from '../types.js';
import AbstractDB from './abstract-db.js';

interface MediatorStateRow {
    data: MediatorDb | string;
}

export default class JsonPostgres extends AbstractDB {
    private readonly url: string;
    private readonly mediator: string;
    private readonly registry: string;
    private pool: Pool | null;

    static async create(registry: string): Promise<JsonPostgres> {
        const json = new JsonPostgres(registry);
        await json.connect();
        return json;
    }

    constructor(registry: string) {
        super();
        this.url = process.env.KC_POSTGRES_URL || 'postgresql://mdip:mdip@localhost:5432/mdip';
        this.mediator = 'satoshi-inscription';
        this.registry = registry;
        this.pool = null;
    }

    async connect(): Promise<void> {
        if (this.pool) {
            return;
        }

        this.pool = new Pool({ connectionString: this.url });

        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS satoshi_mediator_state (
                mediator TEXT NOT NULL,
                registry TEXT NOT NULL,
                data JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (mediator, registry)
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
            throw new Error('Postgres client not connected. Call connect() first.');
        }

        return this.pool;
    }

    async saveDb(data: MediatorDb): Promise<boolean> {
        const pool = this.getPool();

        await pool.query(
            `INSERT INTO satoshi_mediator_state (mediator, registry, data, updated_at)
             VALUES ($1, $2, $3::jsonb, NOW())
             ON CONFLICT (mediator, registry)
             DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
            [this.mediator, this.registry, JSON.stringify(data)]
        );

        return true;
    }

    async loadDb(): Promise<MediatorDb | null> {
        const pool = this.getPool();
        const result = await pool.query<MediatorStateRow>(
            `SELECT data
             FROM satoshi_mediator_state
             WHERE mediator = $1 AND registry = $2
             LIMIT 1`,
            [this.mediator, this.registry]
        );

        if (result.rowCount === 0) {
            return null;
        }

        const rowData = result.rows[0].data;

        if (typeof rowData === 'string') {
            return JSON.parse(rowData) as MediatorDb;
        }

        return rowData;
    }
}
