import CipherNode from '@mdip/cipher/node';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type {
    GatekeeperEvent,
    ImportBatchResult,
    Operation,
    ProcessEventsResult,
} from '@mdip/gatekeeper/types';

const cipher = new CipherNode();

export interface EventBatchImportResult {
    imported: ImportBatchResult;
    processed: ProcessEventsResult;
    complete: boolean;
    capacityDeferred: boolean;
}

function verifiedOperationId(operation: Operation): string | undefined {
    const claimed = operation.signature?.hash;
    if (typeof claimed !== 'string') {
        return undefined;
    }
    const unsigned = { ...operation };
    delete unsigned.signature;
    return cipher.hashJSON(unsigned).toLowerCase() === claimed.toLowerCase()
        ? claimed.toLowerCase()
        : undefined;
}

export async function importEventBatch(
    gatekeeper: Pick<GatekeeperClient, 'importBatch' | 'processEvents'>,
    events: GatekeeperEvent[],
): Promise<EventBatchImportResult> {
    const imported = await gatekeeper.importBatch(events);
    const remaining = new Set(events.map((_, index) => index));
    const capacityIndices = new Set<number>();
    const indicesById = new Map<string, number[]>();
    const indicesByFingerprint = new Map<string, number[]>();
    let capacityReported = (imported.capacityDeferred ?? 0) > 0;
    const isBatchIndex = (index: number): boolean => (
        Number.isInteger(index) && index >= 0 && index < events.length
    );

    events.forEach((event, index) => {
        const id = verifiedOperationId(event.operation);
        if (id) {
            indicesById.set(id, [...indicesById.get(id) ?? [], index]);
        }
        const fingerprint = cipher.hashJSON(event.operation);
        indicesByFingerprint.set(fingerprint, [...indicesByFingerprint.get(fingerprint) ?? [], index]);
    });
    for (const index of imported.rejectedIndices ?? []) {
        if (isBatchIndex(index)) {
            remaining.delete(index);
        }
    }
    for (const index of imported.capacityDeferredIndices ?? []) {
        if (isBatchIndex(index)) {
            capacityIndices.add(index);
        }
    }

    const acceptedHashes = new Set<string>();
    const acceptedEvents: GatekeeperEvent[] = [];
    const rejectedOperations: Operation[] = [];
    let busy = false;

    if (imported.queued > 0) {
        let hasMore = true;
        while (hasMore) {
            const page = await gatekeeper.processEvents();
            if (page.busy) {
                busy = true;
                break;
            }
            for (const hash of page.acceptedHashes ?? []) {
                const id = hash.toLowerCase();
                const indices = indicesById.get(id);
                if (!indices) {
                    continue;
                }
                acceptedHashes.add(id);
                for (const index of indices) {
                    remaining.delete(index);
                }
            }
            for (const event of page.acceptedEvents ?? []) {
                const id = verifiedOperationId(event.operation);
                const indices = id ? indicesById.get(id) : undefined;
                if (id && indices) {
                    acceptedHashes.add(id);
                    acceptedEvents.push(event);
                    for (const index of indices) {
                        remaining.delete(index);
                    }
                }
            }
            for (const operation of page.rejectedOperations ?? []) {
                const indices = indicesByFingerprint.get(cipher.hashJSON(operation));
                if (!indices) {
                    continue;
                }
                rejectedOperations.push(operation);
                for (const index of indices) {
                    remaining.delete(index);
                }
            }
            const pageCapacityHashes = page.capacityDeferredHashes ?? [];
            for (const hash of pageCapacityHashes) {
                for (const index of indicesById.get(hash.toLowerCase()) ?? []) {
                    capacityIndices.add(index);
                }
            }
            // An absent hash list cannot identify whether the backpressure belongs to this item.
            capacityReported ||= (page.capacityDeferred ?? 0) > 0 && pageCapacityHashes.length === 0;
            hasMore = page.hasMore === true;
        }
    }

    const processed: ProcessEventsResult = {
        ...(busy ? { busy: true } : {}),
        acceptedHashes: Array.from(acceptedHashes),
        acceptedEvents,
        rejectedOperations,
        ...(!busy ? { hasMore: false } : {}),
        capacityDeferred: capacityIndices.size,
        capacityDeferredHashes: Array.from(capacityIndices)
            .map(index => verifiedOperationId(events[index].operation))
            .filter((id): id is string => !!id),
    };
    return {
        imported,
        processed,
        complete: !busy && !capacityReported && capacityIndices.size === 0 && remaining.size === 0,
        capacityDeferred: capacityReported || capacityIndices.size > 0,
    };
}
