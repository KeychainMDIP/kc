import fs from 'fs';
import { MediatorDb } from '../types.js';
import AbstractDB from "./abstract-db.js";

export default class JsonFile extends AbstractDB {
    private readonly dataFolder: string;
    private readonly fileName: string;

    constructor(registry: string, dataFolder = 'data') {
        super();
        this.dataFolder = dataFolder;
        this.fileName = `${dataFolder}/${registry}-mediator.json`;
    }

    async saveDb(data: MediatorDb): Promise<boolean> {
        if (!fs.existsSync(this.dataFolder)) {
            fs.mkdirSync(this.dataFolder, { recursive: true });
        }

        const tmp = this.fileName + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 4));
        fs.renameSync(tmp, this.fileName);
        return true;
    }

    async loadDb(): Promise<MediatorDb | null> {
        if (!fs.existsSync(this.fileName)) {
            return null;
        }

        const data = fs.readFileSync(this.fileName, 'utf8');
        return JSON.parse(data) as MediatorDb;
    }
}
