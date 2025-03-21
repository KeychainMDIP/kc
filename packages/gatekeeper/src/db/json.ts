import fs from 'fs';
import { InvalidDIDError } from '@mdip/common/errors';
import { JsonDbFile, GatekeeperDb, GatekeeperEvent, Operation } from '../types.js'

export default class DbJson implements GatekeeperDb {
    private readonly dataFolder: string;
    private readonly dbName: string;

    constructor(name: string, folder: string = 'data') {
        this.dataFolder = folder;
        this.dbName = `${this.dataFolder}/${name}.json`;
    }

    private loadDb(): JsonDbFile {
        try {
            return JSON.parse(fs.readFileSync(this.dbName, 'utf-8'));
        }
        catch (err) {
            const db = { dids: {} };
            this.writeDb(db);
            return db;
        }
    }

    private writeDb(db: JsonDbFile): void {
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

    async addEvent(did: string, event: GatekeeperEvent): Promise<void> {
        const db = this.loadDb();

        if (!did) {
            throw new InvalidDIDError();
        }

        const suffix = did.split(':').pop() as string;

        if (Object.keys(db.dids).includes(suffix)) {
            db.dids[suffix].push(event);
        }
        else {
            db.dids[suffix] = [event];
        }

        this.writeDb(db);
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        try {
            const db = this.loadDb();
            const suffix = did.split(':').pop() as string;
            const updates = db.dids[suffix];

            if (updates && updates.length > 0) {
                return updates;
            }
            else {
                return [];
            }
        }
        catch {
            return [];
        }
    }

    async setEvents(did: string, events: GatekeeperEvent[]): Promise<void> {
        if (!did) {
            throw new InvalidDIDError();
        }

        const db = this.loadDb();
        const suffix = did.split(':').pop() as string;

        db.dids[suffix] = events;
        this.writeDb(db);
    }

    async deleteEvents(did: string): Promise<void> {
        const db = this.loadDb();
        const suffix = did.split(':').pop() as string;

        if (db.dids[suffix]) {
            delete db.dids[suffix];
            this.writeDb(db);
        }
    }

    async queueOperation(registry: string, op: Operation): Promise<number> {
        const db = this.loadDb();

        if (!db.queue) {
            db.queue = {};
        }

        if (registry in db.queue) {
            db.queue[registry].push(op);
        }
        else {
            db.queue[registry] = [op];
        }

        this.writeDb(db);

        return db.queue[registry].length;
    }

    async getQueue(registry: string): Promise<Operation[]> {
        try {
            const db = this.loadDb();
            if (!db.queue || !db.queue[registry]) {
                return []
            }
            return db.queue[registry]
        }
        catch {
            return [];
        }
    }

    async clearQueue(registry: string, batch: Operation[]): Promise<boolean> {
        try {
            const db = this.loadDb();

            if (!db.queue) {
                return true;
            }

            const oldQueue = db.queue[registry];

            if (!oldQueue) {
                return true;
            }

            const newQueue = oldQueue.filter(item => !batch.some(op => op.signature?.value === item.signature?.value));

            db.queue[registry] = newQueue;
            this.writeDb(db);

            return true;
        }
        catch (error) {
            return false;
        }
    }

    async getAllKeys(): Promise<string[]> {
        const db = this.loadDb();
        return Object.keys(db.dids);
    }
}
