import { JsonDbFile } from '../types.js'
import { AbstractJson } from "./abstract-json.js";
import { loadJsonDbFile, writeJsonDbFile } from './json-file.js';

export default class DbJsonCache extends AbstractJson {
    private dbCache: JsonDbFile | null = null;

    constructor(name: string, folder: string = 'data') {
        super(name, folder);
    }

    async start(): Promise<void> {
        this.loadDb();
    }

    protected loadDb(): JsonDbFile {
        if (!this.dbCache) {
            this.dbCache = loadJsonDbFile(this.dbName, this.dataFolder);
        }

        return this.dbCache;
    }

    protected writeDb(db: JsonDbFile): void {
        try {
            writeJsonDbFile(this.dbName, this.dataFolder, db);
            this.dbCache = db;
        }
        catch (error) {
            this.dbCache = null;
            throw error;
        }
    }

    async resetDb(): Promise<JsonDbFile> {
        const db = { dids: {} };
        this.writeDb(db);
        return db;
    }
}
