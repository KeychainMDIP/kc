import type { GatekeeperEvent, GatekeeperInterface, Operation } from '@mdip/gatekeeper/types';
import {
    collectMissingAcceptedHashes,
    dedupeOperationsByHash,
    filterOperationsByAcceptedHashes,
} from './sync-persistence.js';

type AcceptedEventLookup = Pick<GatekeeperInterface, 'exportEventsByHashes'>;

function toOperations(events: GatekeeperEvent[]): Operation[] {
    return events
        .map(event => event.operation)
        .filter((operation): operation is Operation => !!operation);
}

export async function resolveAcceptedOperationsToPersist(
    acceptedCandidates: Operation[],
    acceptedHashes: string[] = [],
    gatekeeper: AcceptedEventLookup,
): Promise<Operation[]> {
    const acceptedFromCandidates = filterOperationsByAcceptedHashes(acceptedCandidates, acceptedHashes);
    const missingAcceptedHashes = collectMissingAcceptedHashes(acceptedCandidates, acceptedHashes);

    if (missingAcceptedHashes.length === 0) {
        return acceptedFromCandidates;
    }

    const acceptedDeferredEvents = await gatekeeper.exportEventsByHashes(missingAcceptedHashes);
    const acceptedDeferredOperations = toOperations(acceptedDeferredEvents);

    return dedupeOperationsByHash([
        ...acceptedFromCandidates,
        ...acceptedDeferredOperations,
    ]);
}
