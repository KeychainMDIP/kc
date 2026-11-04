import {JsonDbFile} from '../types.js'
import {AbstractJson} from "./abstract-json.js";
import { loadJsonDbFile, writeJsonDbFile } from './json-file.js';

export default class DbJson extends AbstractJson {
    constructor(name: string, folder: string = 'data') {
        super(name, folder);
    }

    protected loadDb(): JsonDbFile {
        return loadJsonDbFile(this.dbName, this.dataFolder);
    }

    protected writeDb(db: JsonDbFile): void {
        writeJsonDbFile(this.dbName, this.dataFolder, db);
    }

    async start(): Promise<void> {
        this.loadDb();
    }

    async resetDb(): Promise<void> {
        this.writeDb({ dids: {} });
    }
}
