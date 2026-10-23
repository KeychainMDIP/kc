import type { GatekeeperEvent } from '../types.js';

export const RESET_SEARCH_SCHEMA_SQL = `
    DROP VIEW IF EXISTS published_credentials_classified;
    DROP VIEW IF EXISTS did_classifications_effective;
    DROP VIEW IF EXISTS did_reference_prefixes;
    DROP TABLE IF EXISTS network_metric_snapshots;
    DROP TABLE IF EXISTS sync_state;
    DROP TABLE IF EXISTS challenge_receipts;
    DROP TABLE IF EXISTS did_prefix_references;
    DROP TABLE IF EXISTS identity_fields;
    DROP TABLE IF EXISTS identity_schemas;
    DROP TABLE IF EXISTS published_credentials;
    DROP TABLE IF EXISTS did_classifications;
    DROP TABLE IF EXISTS did_docs;
    DROP TABLE IF EXISTS did_events;
    DROP TABLE IF EXISTS blocks;
`;

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
