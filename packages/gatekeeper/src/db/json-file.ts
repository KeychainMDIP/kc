import fs from 'fs';
import { randomUUID } from 'crypto';
import { JsonDbFile } from '../types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRecordOfArrays(value: unknown): boolean {
    return isRecord(value) && Object.values(value).every(Array.isArray);
}

function isJsonDbFile(value: unknown): value is JsonDbFile {
    if (!isRecord(value) || !isRecordOfArrays(value.dids)) {
        return false;
    }

    return (value.queue === undefined || isRecordOfArrays(value.queue)) &&
        (value.blocks === undefined ||
            (isRecord(value.blocks) && Object.values(value.blocks).every(isRecord))) &&
        (value.hashes === undefined || isRecord(value.hashes)) &&
        (value.indexSeq === undefined ||
            (typeof value.indexSeq === 'number' && Number.isSafeInteger(value.indexSeq) && value.indexSeq >= 0)) &&
        (value.indexChanges === undefined || Array.isArray(value.indexChanges)) &&
        (value.indexEpoch === undefined || typeof value.indexEpoch === 'string');
}

export function writeJsonDbFile(dbName: string, dataFolder: string, db: JsonDbFile): void {
    if (!fs.existsSync(dataFolder)) {
        fs.mkdirSync(dataFolder, { recursive: true });
    }

    const tempName = `${dbName}.${randomUUID()}.tmp`;
    const exists = fs.existsSync(dbName);
    const mode = exists ? fs.statSync(dbName).mode & 0o777 : 0o666;

    try {
        fs.writeFileSync(tempName, JSON.stringify(db, null, 4), {
            flag: 'wx',
            flush: true,
            mode,
        });
        if (exists) {
            fs.chmodSync(tempName, mode);
        }
        fs.renameSync(tempName, dbName);
    }
    catch (error) {
        try {
            fs.rmSync(tempName, { force: true });
        }
        catch {
            // Preserve the original write error if temporary-file cleanup fails.
        }
        throw error;
    }
}

export function loadJsonDbFile(dbName: string, dataFolder: string): JsonDbFile {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(dbName, 'utf-8'));
        if (!isJsonDbFile(parsed)) {
            throw new Error(`Invalid JSON database: ${dbName}`);
        }
        return parsed;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }

        const db = { dids: {} };
        writeJsonDbFile(dbName, dataFolder, db);
        return db;
    }
}
