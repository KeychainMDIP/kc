import fs from 'fs';
import { InvalidDIDError } from '@mdip/common/errors';
import { JsonDbFile, GatekeeperDb, GatekeeperEvent, Operation } from '../gatekeeper.js'

export default class DbJsonCache implements GatekeeperDb {
    private readonly dataFolder: string
    private readonly dbName: string
    private dbCache: JsonDbFile | null
    private saveLoopTimeoutId: NodeJS.Timeout | null

    constructor(name: string, folder: string = 'data') {
        this.dataFolder = folder;
        this.dbName = `${this.dataFolder}/${name}.json`;
        this.dbCache = null;
        this.saveLoopTimeoutId = null;

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
            console.log(`DID db saved to ${this.dbName}`);
        } catch (error) {
            console.error(`Error in saveLoop: ${error}`);
        }

        this.saveLoopTimeoutId = setTimeout(() => this.saveLoop(), 20 * 1000);
    }

    loadDb(): JsonDbFile {
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

    private writeDb(db: JsonDbFile): void {
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
        let events: GatekeeperEvent[] = []

        try {
            const db = this.loadDb();
            const suffix = did.split(':').pop() as string;
            const updates = db.dids[suffix];

            if (updates && updates.length > 0) {
                events = updates;
            }
        }
        catch {
        }

        return JSON.parse(JSON.stringify(events));
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

        if (Object.keys(db.queue).includes(registry)) {
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
            const queue = db.queue?.[registry];
            return queue ?? [];
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
