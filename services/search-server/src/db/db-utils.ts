import type { GatekeeperEvent } from '../types.js';
import type { DIDsDb } from '../types.js';

export function readDatabase<T>(db: DIDsDb, work: () => Promise<T>): Promise<T> {
    return db.withRead ? db.withRead(work) : work();
}

export function copyJSON<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function getOptionalISOString(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length === 0) {
        return undefined;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return undefined;
    }

    return date.toISOString();
}

export function getEventDisplayTime(event: GatekeeperEvent): string {
    return getOptionalISOString(event.operation.signature?.signed)
        ?? getOptionalISOString(event.time)
        ?? getOptionalISOString(event.operation.created)
        ?? '';
}

export function stableStringify(value: unknown): string {
    return JSON.stringify(sortJSON(value));
}

function sortJSON(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortJSON);
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, sortJSON(item)])
    );
}
