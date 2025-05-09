import { JsonDbFile } from '../types.js';
import { AbstractJson } from "./abstract-json.js";

export default class DbJsonMemory extends AbstractJson {
    private dbCache: string | null = null;

    constructor(name: string, folder: string = 'data') {
        super(name, folder);
        this.loadDb();
    }

    protected loadDb(): JsonDbFile {
        if (!this.dbCache) {
            this.dbCache = JSON.stringify({ dids: {} });
        }
        return JSON.parse(this.dbCache);
    }

    protected writeDb(db: JsonDbFile): void {
        this.dbCache = JSON.stringify(db);
    }

    async resetDb(): Promise<JsonDbFile> {
        this.dbCache = null;
        return this.loadDb();
    }
}
