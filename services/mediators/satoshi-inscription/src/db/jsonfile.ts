import fs from 'fs';
import { MediatorDb, MediatorDbInterface } from '../types.js';

export default class JsonFile implements MediatorDbInterface {
    private readonly dataFolder: string;
    private readonly fileName: string;

    constructor(registry: string, dataFolder = 'data') {
        this.dataFolder = dataFolder;
        this.fileName = `${dataFolder}/${registry}-mediator.json`;
    }

    async saveDb(data: MediatorDb): Promise<boolean> {
        if (!fs.existsSync(this.dataFolder)) {
            fs.mkdirSync(this.dataFolder, { recursive: true });
        }

        fs.writeFileSync(this.fileName, JSON.stringify(data, null, 4));
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
