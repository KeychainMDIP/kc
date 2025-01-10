import fs from 'fs';
import { InvalidDIDError } from '@mdip/common/errors';

export default class DbJson {
    constructor(name, folder='data') {
        this.dataFolder = folder;
        this.dbName = `${this.dataFolder}/${name}.json`;
    }

    loadDb() {
        try {
            return JSON.parse(fs.readFileSync(this.dbName));
        }
        catch (err) {
            const db = { dids: {} };
            this.writeDb(db);
            return db;
        }
    }

    writeDb(db) {
        if (!fs.existsSync(this.dataFolder)) {
            fs.mkdirSync(this.dataFolder, { recursive: true });
        }

        fs.writeFileSync(this.dbName, JSON.stringify(db, null, 4));
    }

    async resetDb() {
        if (fs.existsSync(this.dbName)) {
            fs.rmSync(this.dbName);
        }
    }

    async addEvent(did, event) {
        const db = this.loadDb();

        if (!did) {
            throw new InvalidDIDError();
        }

        const suffix = did.split(':').pop();

        if (Object.keys(db.dids).includes(suffix)) {
            db.dids[suffix].push(event);
        }
        else {
            db.dids[suffix] = [event];
        }

        this.writeDb(db);
    }

    async getEvents(did) {
        try {
            const db = this.loadDb();
            const suffix = did.split(':').pop();
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

    async setEvents(did, events) {
        if (!did) {
            throw new InvalidDIDError();
        }

        const db = this.loadDb();
        const suffix = did.split(':').pop();

        db.dids[suffix] = events;
        this.writeDb(db);
    }

    async deleteEvents(did) {
        const db = this.loadDb();
        const suffix = did.split(':').pop();

        if (db.dids[suffix]) {
            delete db.dids[suffix];
            this.writeDb(db);
        }
    }

    async queueOperation(registry, op) {
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
    }

    async getQueue(registry) {
        try {
            const db = this.loadDb();
            const queue = db.queue[registry];

            if (queue) {
                return queue;
            }
            else {
                return [];
            }
        }
        catch {
            return [];
        }
    }

    async clearQueue(registry, batch) {
        try {
            const db = this.loadDb();

            if (!db.queue) {
                return true;
            }

            const oldQueue = db.queue[registry];

            if (!oldQueue) {
                return true;
            }

            const newQueue = oldQueue.filter(item => !batch.some(op => op.signature.value === item.signature.value));

            db.queue[registry] = newQueue;
            this.writeDb(db);

            return true;
        }
        catch (error) {
            return false;
        }
    }

    async getAllKeys() {
        const db = this.loadDb();
        return Object.keys(db.dids);
    }
}
