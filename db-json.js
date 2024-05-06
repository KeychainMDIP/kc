import fs from 'fs';

const dataFolder = 'data';
let dbName;

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

export async function start(name = 'mdip') {
    dbName = `${dataFolder}/${name}.json`;
}

export async function stop() {
}

export async function resetDb() {
    if (fs.existsSync(dbName)) {
        fs.rmSync(dbName);
    }
}

export async function addEvent(did, event) {
    const db = loadDb();

    if (!did) {
        throw "Invalid DID";
    }

    const suffix = did.split(':').pop();

    if (Object.prototype.hasOwnProperty.call(db.dids, suffix)) {
        db.dids[suffix].push(event);
    }
    else {
        db.dids[suffix] = [event];
    }

    writeDb(db);
}

export async function getEvents(did) {
    try {
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
    catch {
        return [];
    }
}

export async function setEvents(did, events) {
    if (!did) {
        throw "Invalid DID";
    }

    const db = loadDb();
    const suffix = did.split(':').pop();

    db.dids[suffix] = events;
    writeDb(db);
}

export async function deleteEvents(did) {
    const db = loadDb();
    const suffix = did.split(':').pop();

    if (db.dids[suffix]) {
        delete db.dids[suffix];
        writeDb(db);
    }
}

export async function queueOperation(registry, op) {
    const db = loadDb();

    if (!db.queue) {
        db.queue = {};
    }

    if (Object.prototype.hasOwnProperty.call(db.queue, registry)) {
        db.queue[registry].push(op);
    }
    else {
        db.queue[registry] = [op];
    }

    writeDb(db);
}

export async function getQueue(registry) {
    try {
        const db = loadDb();
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

export async function clearQueue(registry, batch) {
    try {
        const db = loadDb();
        const oldQueue = db.queue[registry];

        if (!oldQueue) {
            throw `Unknown registry ${registry}`;
        }

        const newQueue = oldQueue.filter(item => !batch.some(op => op.signature.value === item.signature.value));

        db.queue[registry] = newQueue;
        writeDb(db);

        return true;
    }
    catch (error) {
        console.error(error);
        return false;
    }
}

export async function getAllKeys() {
    const db = loadDb();
    const ids = Object.keys(db.dids);
    return ids;
}
