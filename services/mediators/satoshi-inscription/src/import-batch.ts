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
    const claimed = operation?.signature?.hash;
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
    const remaining = new Set(events.map((_, index) => index));
    const capacityIndices = new Set<number>();
    const rejectedIndices = new Set<number>();
    const processedIndices = new Set<number>();
    const indicesById = new Map<string, number[]>();
    const indicesByFingerprint = new Map<string, number[]>();
    let capacityReported = false;
    const imported: ImportBatchResult = {
        queued: 0,
        processed: 0,
        rejected: 0,
        total: 0,
        rejectedIndices: [],
    };

    events.forEach((event, index) => {
        if (!event?.operation || typeof event.operation !== 'object') {
            return;
        }
        const id = verifiedOperationId(event.operation);
        if (id) {
            indicesById.set(id, [...indicesById.get(id) ?? [], index]);
        }
        const fingerprint = cipher.hashJSON(event.operation);
        indicesByFingerprint.set(fingerprint, [...indicesByFingerprint.get(fingerprint) ?? [], index]);
    });

    const acceptedHashes = new Set<string>();
    const acceptedEvents = new Map<string, GatekeeperEvent>();
    const rejectedOperations = new Map<string, Operation>();
    let busy = false;
    const finish = (indices: number[]) => {
        for (const index of indices) {
            remaining.delete(index);
            capacityIndices.delete(index);
        }
    };

    let retryIndices = Array.from(remaining);
    while (retryIndices.length > 0 && !busy) {
        const remainingBefore = remaining.size;
        for (let offset = 0; offset < retryIndices.length && !busy; offset += 100) {
            let selected = retryIndices.slice(offset, offset + 100);
            let stalled = false;
            while (selected.length > 0 && !busy) {
                const admission = await gatekeeper.importBatch(selected.map(index => events[index]));
                imported.queued += admission.queued;
                imported.processed += admission.processed;
                imported.total = admission.total;
                const validIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < selected.length;
                const refused = new Set((admission.capacityDeferredIndices ?? []).filter(validIndex));
                capacityReported ||= (admission.capacityDeferred ?? 0) > refused.size;
                selected.forEach((index, localIndex) => {
                    if (refused.has(localIndex)) {
                        capacityIndices.add(index);
                    }
                    else {
                        capacityIndices.delete(index);
                    }
                });
                for (const localIndex of admission.rejectedIndices ?? []) {
                    if (validIndex(localIndex)) {
                        const index = selected[localIndex];
                        rejectedIndices.add(index);
                        finish([index]);
                    }
                }
                for (const localIndex of admission.processedIndices ?? []) {
                    if (validIndex(localIndex)) {
                        processedIndices.add(selected[localIndex]);
                    }
                }

                if (admission.queued > 0 || admission.processed > 0 || (admission.capacityDeferred ?? 0) > 0 || refused.size > 0) {
                    let hasMore = true;
                    while (hasMore) {
                        const page = await gatekeeper.processEvents();
                        if (page.busy) {
                            busy = true;
                            break;
                        }
                        // Detailed accepted events identify the signed operation, unlike an unsigned hash.
                        const detailedIds = new Set<string>();
                        for (const event of page.acceptedEvents ?? []) {
                            const id = verifiedOperationId(event.operation);
                            if (!id) {
                                continue;
                            }
                            detailedIds.add(id);
                            const fingerprint = cipher.hashJSON(event.operation);
                            const indices = indicesByFingerprint.get(fingerprint);
                            if (indices) {
                                acceptedHashes.add(id);
                                acceptedEvents.set(fingerprint, event);
                                finish(indices);
                            }
                        }
                        for (const hash of page.acceptedHashes ?? []) {
                            const id = hash.toLowerCase();
                            const indices = indicesById.get(id);
                            if (indices && !detailedIds.has(id)) {
                                acceptedHashes.add(id);
                                finish(indices);
                            }
                        }
                        for (const operation of page.rejectedOperations ?? []) {
                            const fingerprint = cipher.hashJSON(operation);
                            const indices = indicesByFingerprint.get(fingerprint);
                            if (indices) {
                                rejectedOperations.set(fingerprint, operation);
                                finish(indices);
                            }
                        }
                        const pageCapacityHashes = page.capacityDeferredHashes ?? [];
                        for (const hash of pageCapacityHashes) {
                            for (const index of indicesById.get(hash.toLowerCase()) ?? []) {
                                if (remaining.has(index)) {
                                    capacityIndices.add(index);
                                }
                            }
                        }
                        capacityReported ||= (page.capacityDeferred ?? 0) > 0 && pageCapacityHashes.length === 0;
                        hasMore = page.hasMore === true;
                    }
                }

                // Drain between admissions and retry only the refused tail, never the accepted prefix.
                if (refused.size === 0 || (stalled && refused.size === selected.length)) {
                    break;
                }
                stalled = refused.size === selected.length;
                selected = Array.from(refused, index => selected[index]);
            }
        }
        // A later dependency may release processing capacity. Retry it only after conclusive progress.
        if (remaining.size === remainingBefore) {
            break;
        }
        retryIndices = Array.from(capacityIndices).filter(index => remaining.has(index));
    }

    imported.rejectedIndices = Array.from(rejectedIndices);
    imported.rejected = rejectedIndices.size;
    imported.processedIndices = Array.from(processedIndices);
    imported.capacityDeferredIndices = Array.from(capacityIndices);
    imported.capacityDeferred = capacityIndices.size;
    const processed: ProcessEventsResult = {
        ...(busy ? { busy: true } : {}),
        acceptedHashes: Array.from(acceptedHashes),
        acceptedEvents: Array.from(acceptedEvents.values()),
        rejectedOperations: Array.from(rejectedOperations.values()),
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
