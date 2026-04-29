import type { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import {
    dedupeOperationsByHash,
    filterOperationsByAcceptedHashes,
} from './sync-persistence.js';

function toOperations(events: GatekeeperEvent[]): Operation[] {
    return events
        .map(event => event.operation)
        .filter((operation): operation is Operation => !!operation);
}

export function resolveAcceptedOperationsToPersist(
    acceptedCandidates: Operation[],
    acceptedHashes: string[] = [],
    acceptedEvents: GatekeeperEvent[] = [],
): Operation[] {
    const acceptedFromCandidates = filterOperationsByAcceptedHashes(acceptedCandidates, acceptedHashes);
    const acceptedFromProcessEvents = dedupeOperationsByHash(toOperations(acceptedEvents));

    if (acceptedFromProcessEvents.length === 0) {
        return acceptedFromCandidates;
    }

    return dedupeOperationsByHash([
        ...acceptedFromCandidates,
        ...acceptedFromProcessEvents,
    ]);
}
