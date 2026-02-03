import fs from 'fs';
import { JsonDbFile } from '../types.js'
import { AbstractJson } from "./abstract-json.js";
import { childLogger } from '@mdip/common/logger';

const log = childLogger({ service: 'gatekeeper-db', module: 'json-cache' });

export default class DbJsonCache extends AbstractJson {
    private dbCache: JsonDbFile | null = null;
    private saveLoopTimeoutId: NodeJS.Timeout | null = null;

    constructor(name: string, folder: string = 'data') {
        super(name, folder);
        this.loadDb();
    }

    async start(): Promise<void> {
        await this.saveLoop();
    }

    async stop(): Promise<void> {
        this.saveDb(); // Save the current state one last time

        if (this.saveLoopTimeoutId !== null) {
            clearTimeout(this.saveLoopTimeoutId); // Cancel the next scheduled saveLoop
            this.saveLoopTimeoutId = null; // Reset the timeout ID
        }
    }

    async saveLoop(): Promise<void> {
        try {
            this.saveDb();
            log.debug(`DID db saved to ${this.dbName}`);
        } catch (error) {
            log.error({ error }, 'Error in saveLoop');
        }

        this.saveLoopTimeoutId = setTimeout(() => this.saveLoop(), 20 * 1000);
    }

    protected loadDb(): JsonDbFile {
        if (!this.dbCache) {
            try {
                const raw = fs.readFileSync(this.dbName, 'utf-8')
                const parsed: JsonDbFile = JSON.parse(raw)
                this.dbCache = JSON.parse(fs.readFileSync(this.dbName, 'utf-8'));

                if (!parsed.dids) {
                    throw new Error();
                }
                this.dbCache = parsed
            }
            catch (err) {
                this.dbCache = { dids: {} };
                this.saveDb();
            }
        }

        return this.dbCache;
    }

    protected writeDb(db: JsonDbFile): void {
        this.dbCache = db
    }

    private saveDb(): void {
        if (!fs.existsSync(this.dataFolder)) {
            fs.mkdirSync(this.dataFolder, { recursive: true });
        }
        if (!this.dbCache) {
            this.dbCache = { dids: {} }
        }
        fs.writeFileSync(this.dbName, JSON.stringify(this.dbCache, null, 4));
    }

    async resetDb(): Promise<JsonDbFile> {
        if (fs.existsSync(this.dbName)) {
            fs.rmSync(this.dbName);
        }
        this.dbCache = null;
        return this.loadDb();
    }
}
