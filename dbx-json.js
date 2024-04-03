import fs from 'fs';

const dataFolder = 'data';
export const dbName = `${dataFolder}/mdip-v2.json`;

function loadDb() {
    if (fs.existsSync(dbName)) {
        return JSON.parse(fs.readFileSync(dbName));
    }
    else {
        return {
            dids: {}
        }
    }
}

function writeDb(db) {
    if (!fs.existsSync(dataFolder)) {
        fs.mkdirSync(dataFolder, { recursive: true });
    }

    fs.writeFileSync(dbName, JSON.stringify(db, null, 4));
}

export function addUpdate(update) {
    const db = loadDb();
    const suffix = update.did.split(':').pop();

    if (Object.prototype.hasOwnProperty.call(db.dids, suffix)) {
        db.dids[suffix].push(update);
    }
    else {
        db.dids[suffix] = [update];
    }

    writeDb(db);
}

export function getAnchor(did) {
    const db = loadDb();
    const suffix = did.split(':').pop();
    const updates = db.dids[suffix];

    if (updates && updates.length > 0) {
        return updates[0].operation;
    }
}

export function fetchUpdates(did) {
    const db = loadDb();
    const suffix = did.split(':').pop();
    const updates = db.dids[suffix];

    if (updates && updates.length > 0) {
        return updates;
    }
    else {
        return [];
    }
}
