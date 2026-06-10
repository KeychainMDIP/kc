import {
    GatekeeperEvent,
    IndexChangeRecord,
    IndexExportDIDRecord,
    IndexExportOperationRecord,
    IndexExportResponse,
    IndexExportChangesOptions,
    IndexExportSnapshotOptions,
} from '../types.js';

const DEFAULT_INDEX_EXPORT_LIMIT = 500;
const MAX_INDEX_EXPORT_LIMIT = 5000;

export function normalizeIndexExportLimit(limit?: number): number {
    if (!Number.isInteger(limit) || !limit || limit < 1) {
        return DEFAULT_INDEX_EXPORT_LIMIT;
    }

    return Math.min(limit, MAX_INDEX_EXPORT_LIMIT);
}

export function parseIndexExportCursor(cursor?: string | null): number {
    if (!cursor) {
        return 0;
    }

    const parsed = Number.parseInt(cursor, 10);

    if (!Number.isInteger(parsed) || parsed < 0) {
        return 0;
    }

    return parsed;
}

function getOperationHash(event: GatekeeperEvent): string | undefined {
    return typeof event.operation?.signature?.hash === 'string'
        ? event.operation.signature.hash
        : undefined;
}

function getDidFromEvents(key: string, events: GatekeeperEvent[]): string {
    const eventDid = events.find(event => typeof event.did === 'string' && event.did.length > 0)?.did;

    if (eventDid) {
        return eventDid;
    }

    const operationDid = events.find(
        event => typeof event.operation?.did === 'string' && event.operation.did.length > 0
    )?.operation.did;

    return operationDid ?? key;
}

function compareDIDs(a: IndexExportDIDRecord, b: IndexExportDIDRecord): number {
    if (a.did < b.did) {
        return -1;
    }

    if (a.did > b.did) {
        return 1;
    }

    return 0;
}

export async function buildIndexSnapshotResponseFromPageKeys(
    keys: string[],
    getEvents: (did: string) => Promise<GatekeeperEvent[]>,
    options: IndexExportSnapshotOptions = {},
    checkpointCursor: string | null
): Promise<IndexExportResponse> {
    const limit = normalizeIndexExportLimit(options.limit);
    const pageKeys = keys.slice(0, limit);
    const dids: IndexExportDIDRecord[] = [];

    for (const key of pageKeys) {
        const events = await getEvents(key);
        dids.push({
            did: getDidFromEvents(key, events),
            events,
        });
    }

    return {
        mode: 'snapshot',
        cursor: pageKeys.length > 0
            ? pageKeys[pageKeys.length - 1]
            : options.cursor ?? null,
        checkpointCursor,
        hasMore: keys.length > limit,
        dids,
        blocks: [],
    };
}

export async function exportIndexSnapshotFromAllKeysForLocalDb(
    getAllKeys: () => Promise<string[]>,
    getEvents: (did: string) => Promise<GatekeeperEvent[]>,
    options: IndexExportSnapshotOptions = {},
    getCheckpointCursor?: () => Promise<string | null>
): Promise<IndexExportResponse> {
    const limit = normalizeIndexExportLimit(options.limit);
    const cursor = options.cursor ?? null;
    const checkpointCursor = options.checkpointCursor ?? (getCheckpointCursor ? await getCheckpointCursor() : null);
    const keys = await getAllKeys();
    const records: IndexExportDIDRecord[] = [];

    for (const key of keys) {
        const events = await getEvents(key);
        records.push({
            did: getDidFromEvents(key, events),
            events,
        });
    }

    records.sort(compareDIDs);

    const filtered = cursor
        ? records.filter(record => record.did > cursor)
        : records;
    const page = filtered.slice(0, limit);
    const nextCursor = page.length > 0
        ? page[page.length - 1].did
        : cursor;

    return {
        mode: 'snapshot',
        cursor: nextCursor,
        checkpointCursor,
        hasMore: filtered.length > limit,
        dids: page,
        blocks: [],
    };
}

export async function buildIndexChangesResponse(
    changes: IndexChangeRecord[],
    hasMore: boolean,
    options: IndexExportChangesOptions = {},
    checkpointCursor: string | null,
    getEvents: (did: string) => Promise<GatekeeperEvent[]>
): Promise<IndexExportResponse> {
    const afterSeq = parseIndexExportCursor(options.cursor);
    const cursor = changes.length > 0
        ? changes[changes.length - 1].seq.toString()
        : afterSeq.toString();
    const operations: IndexExportOperationRecord[] | undefined = options.includeOperations
        ? changes
            .filter(change => change.kind === 'did' && change.did && change.event)
            .map(change => ({
                seq: change.seq,
                did: change.did!,
                event: change.event!,
                operationHash: getOperationHash(change.event!),
            }))
        : undefined;
    const didChanges = new Map<string, IndexChangeRecord>();
    const blockChanges = new Map<string, IndexChangeRecord>();

    for (const change of changes) {
        if (change.kind === 'did' && change.did) {
            didChanges.delete(change.did);
            didChanges.set(change.did, change);
        }

        if (change.kind === 'block' && change.registry && change.block) {
            blockChanges.set(`${change.registry}/${change.block.hash}`, change);
        }
    }

    const dids: IndexExportDIDRecord[] = [];
    const eventsByDid = new Map<string, GatekeeperEvent[]>();

    for (const [did, change] of didChanges.entries()) {
        if (change.removed) {
            dids.push({
                did,
                events: [],
                removed: true,
            });
            continue;
        }

        const events = eventsByDid.get(did) ?? await getEvents(did);
        eventsByDid.set(did, events);
        dids.push({ did, events });
    }

    const blocks = Array.from(blockChanges.values())
        .filter(change => change.registry && change.block)
        .map(change => ({
            registry: change.registry!,
            block: change.block!,
            removed: change.removed,
        }));

    const response: IndexExportResponse = {
        mode: 'changes',
        cursor,
        checkpointCursor,
        hasMore,
        dids,
        blocks,
    };

    if (operations) {
        response.operations = operations;
    }

    return response;
}
