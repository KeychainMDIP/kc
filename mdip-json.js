import fs from 'fs';

const dataFolder = 'data';
const dbName = `${dataFolder}/mdip.json`;

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

export async function start() {
}

export async function stop() {
}

export async function backupDb() {
//     if (!fs.existsSync(dbName)) {
//         return;
//     }

//     const today = new Date();
//     const dateString = today.toISOString().split('.')[0];
//     const backupFolder = `${dataFolder}/backup`;
//     const backupName = `${backupFolder}/mdip-v2.${dateString}.json`;

//     if (!fs.existsSync(backupFolder)) {
//         fs.mkdirSync(backupFolder);
//     }

//     fs.copyFileSync(dbName, backupName);
}

export async function resetDb() {
    fs.rmSync(dbName);
}

export async function addOperation(op) {
    const db = loadDb();
    const suffix = op.did.split(':').pop();

    if (Object.prototype.hasOwnProperty.call(db.dids, suffix)) {
        db.dids[suffix].push(op);
    }
    else {
        db.dids[suffix] = [op];
    }

    writeDb(db);
}

export async function getOperations(did) {
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

export async function getAllDIDs() {
    const db = loadDb();
    const cids = Object.keys(db.dids);
    const dids = [];

    for (const suffix of cids) {
        const ops = db.dids[suffix];
        dids.push(ops[0].did);
    }

    return dids;
}

export async function deleteDID(did) {
    const db = loadDb();
    const suffix = did.split(':').pop();

    if (db.dids[suffix]) {
        delete db.dids[suffix];
        writeDb(db);
    }
}
