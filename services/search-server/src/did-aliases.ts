import type { GatekeeperEvent } from '@mdip/gatekeeper/types';
import { isValidDID } from '@mdip/ipfs/utils';
import type { DIDsDb } from './types.js';

export const AMBIGUOUS_DID_PREFIX = 'did:test';

export interface DIDPrefixClassification {
    prefix: string;
    conflicting: boolean;
    authoritative: boolean;
}

export function getDIDPrefix(did: string): string {
    return did.split(':', 2).join(':');
}

export function getDIDSuffix(did: string): string {
    return did.split(':').pop()!;
}

function isDIDPrefix(value: unknown): value is string {
    return typeof value === 'string' && /^did:[^:]+$/.test(value);
}

export function classifyDIDPrefix(events: GatekeeperEvent[]): DIDPrefixClassification {
    const createPrefix = events.find(event => event.operation.type === 'create')?.operation.mdip?.prefix;
    const referencedPrefixes = new Set<string>();

    for (const event of events) {
        const { operation } = event;
        if ((operation.type === 'update' || operation.type === 'delete') &&
            typeof operation.did === 'string' && operation.did.startsWith('did:')) {
            referencedPrefixes.add(getDIDPrefix(operation.did));
        }
    }

    if (isDIDPrefix(createPrefix)) {
        return {
            prefix: createPrefix,
            conflicting: Array.from(referencedPrefixes).some(prefix => prefix !== createPrefix),
            authoritative: true,
        };
    }

    if (referencedPrefixes.size === 1) {
        return {
            prefix: referencedPrefixes.values().next().value as string,
            conflicting: false,
            authoritative: true,
        };
    }

    return {
        prefix: AMBIGUOUS_DID_PREFIX,
        conflicting: referencedPrefixes.size > 1,
        authoritative: referencedPrefixes.size > 1,
    };
}

export function canonicalDID(did: string, events: GatekeeperEvent[]): string {
    return `${classifyDIDPrefix(events).prefix}:${getDIDSuffix(did)}`;
}

export async function findDIDReadTarget(didDb: DIDsDb, did: string, didPrefix?: string) {
    const requestedDid = didPrefix ? `${didPrefix}:${getDIDSuffix(did)}` : did;
    if (didPrefix && isValidDID(did)) {
        const storedDid = await didDb.findDIDBySuffix(getDIDSuffix(did), didPrefix);
        return storedDid
            ? { storedDid, resolutionDid: requestedDid, events: await didDb.getDIDEvents(storedDid) }
            : { storedDid: requestedDid, resolutionDid: requestedDid, events: [], scopeRejected: true };
    }

    const events = await didDb.getDIDEvents(requestedDid);
    if (events.length > 0 || !isValidDID(did)) {
        return { storedDid: requestedDid, resolutionDid: requestedDid, events };
    }

    const storedDid = await didDb.findDIDBySuffix(getDIDSuffix(did), didPrefix);
    return storedDid
        ? { storedDid, resolutionDid: requestedDid, events: await didDb.getDIDEvents(storedDid) }
        : { storedDid: requestedDid, resolutionDid: requestedDid, events };
}
