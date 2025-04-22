import fs from 'fs';
import {JsonDbFile} from '../types.js'
import {AbstractJson} from "./abstract-json.ts";

export default class DbJson extends AbstractJson {
    constructor(name: string, folder: string = 'data') {
        super(name, folder);
    }

    protected loadDb(): JsonDbFile {
        try {
            return JSON.parse(fs.readFileSync(this.dbName, 'utf-8'));
        }
        catch (err) {
            const db = { dids: {} };
            this.writeDb(db);
            return db;
        }
    }

    protected writeDb(db: JsonDbFile): void {
        if (!fs.existsSync(this.dataFolder)) {
            fs.mkdirSync(this.dataFolder, { recursive: true });
        }

        fs.writeFileSync(this.dbName, JSON.stringify(db, null, 4));
    }

    async resetDb(): Promise<void> {
        if (fs.existsSync(this.dbName)) {
            fs.rmSync(this.dbName);
        }
    }
}
