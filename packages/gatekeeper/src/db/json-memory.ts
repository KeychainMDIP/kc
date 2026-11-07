import { JsonDbFile } from '../types.js';
import { AbstractJson } from "./abstract-json.js";
import { randomUUID } from 'crypto';
import { LIFECYCLE_VERSION } from './lifecycle.js';

export default class DbJsonMemory extends AbstractJson {
    private dbCache: string | null = null;

    constructor(name: string, folder: string = 'data') {
        super(name, folder);
        this.loadDb();
    }

    protected loadDb(): JsonDbFile {
        if (!this.dbCache) {
            const epoch = randomUUID();
            this.dbCache = JSON.stringify({
                dids: {}, indexEpoch: epoch, lifecycle: {}, expirationJobs: {},
                lifecycleMetadata: { version: LIFECYCLE_VERSION, epoch, complete: true, checkedCursor: '0' },
            });
        }
        return JSON.parse(this.dbCache);
    }

    protected writeDb(db: JsonDbFile): void {
        this.dbCache = JSON.stringify(db);
    }

    async resetDb(): Promise<JsonDbFile> {
        return this.runExclusive(() => {
            this.dbCache = null;
            return this.loadDb();
        });
    }
}
