import { JsonDbFile } from '../types.js';
import { AbstractJson } from "./abstract-json.js";

export default class DbJsonMemory extends AbstractJson {
    private dbCache: JsonDbFile | null = null;

    constructor(name: string, folder: string = 'data') {
        super(name, folder);
        this.loadDb();
    }

    protected loadDb(): JsonDbFile {
        if (!this.dbCache) {
            this.dbCache = { dids: {} }; // Initialize an empty in-memory database
        }
        return JSON.parse(JSON.stringify(this.dbCache));
    }

    protected writeDb(db: JsonDbFile): void {
        this.dbCache = JSON.parse(JSON.stringify(db));
    }

    async resetDb(): Promise<JsonDbFile> {
        this.dbCache = null;
        return this.loadDb();
    }
}
