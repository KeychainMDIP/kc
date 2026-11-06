import type { Operation } from '@mdip/gatekeeper/types';
import { extractPublishedCredentialHistory } from './published-credentials.js';
import {
    AMBIGUOUS_DID_PREFIX,
    classifyDIDPrefix,
    getDIDPrefix,
    getDIDSuffix,
} from './did-aliases.js';
import type {
    DIDEventHistory,
    NetworkMetricSchemaCount,
    NetworkMetricSnapshot,
    PublishedCredentialSchemaCount,
} from './types.js';

export const NETWORK_METRICS_EPOCH = '2024-01-01';

export function isNetworkMetricsScopeCurrent(storedDidPrefix: string | null, didPrefix?: string): boolean {
    return storedDidPrefix !== null && storedDidPrefix === (didPrefix ?? '');
}

function compareSchemaCounts(a: PublishedCredentialSchemaCount, b: PublishedCredentialSchemaCount): number {
    return b.count - a.count || a.schemaDid.localeCompare(b.schemaDid);
}

// Drops the projection-only split so the stored snapshot serves the same shape as before.
export function withoutSchemaPrefixCounts(snapshot: NetworkMetricSnapshot): NetworkMetricSnapshot {
    return {
        ...snapshot,
        schemas: snapshot.schemas.map(({ schemaDid, count }) => ({ schemaDid, count })),
    };
}

// A scoped build starts at its network's first counted day, or at the rebuild
// day when it has none; cumulative counts never drop, so earlier days are the
// only all-zero ones and a scoped build has no snapshot for them.
export function isScopedSnapshotDay(snapshot: NetworkMetricSnapshot): boolean {
    return snapshot.didCount + snapshot.agentDidCount + snapshot.credentialCount > 0 ||
        snapshot.date === snapshot.rebuiltAt.slice(0, 10);
}

// Returns null when the snapshot predates the per-prefix schema split: it then
// cannot be projected exactly, and the next metrics rebuild will add it.
export function projectSnapshotToPrefix(
    snapshot: NetworkMetricSnapshot,
    didPrefix: string
): NetworkMetricSnapshot | null {
    if (snapshot.schemas.some(schema => !schema.countsByCredentialPrefix)) {
        return null;
    }

    const pick = (counts: Record<string, number>): Record<string, number> =>
        counts[didPrefix] ? { [didPrefix]: counts[didPrefix] } : {};

    const didCountsByPrefix = pick(snapshot.didCountsByPrefix);
    const agentDidCountsByPrefix = pick(snapshot.agentDidCountsByPrefix);
    const credentialDidCountsByPrefix = pick(snapshot.credentialDidCountsByPrefix);

    // Matches a scoped build: a schema counts only credentials of its own network.
    const schemas = snapshot.schemas
        .filter(schema => schema.schemaDid.startsWith(`${didPrefix}:`))
        .map(schema => ({
            schemaDid: schema.schemaDid,
            count: schema.countsByCredentialPrefix?.[didPrefix] ?? 0,
        }))
        .filter(schema => schema.count > 0)
        .sort(compareSchemaCounts);

    return {
        ...snapshot,
        didCount: didCountsByPrefix[didPrefix] ?? 0,
        didCountsByPrefix,
        agentDidCount: agentDidCountsByPrefix[didPrefix] ?? 0,
        agentDidCountsByPrefix,
        credentialCount: credentialDidCountsByPrefix[didPrefix] ?? 0,
        credentialDidCountsByPrefix,
        schemas,
    };
}

export interface NetworkMetricsBuildResult {
    snapshots: NetworkMetricSnapshot[];
    agentsWithConflictingPrefixes: number;
    invalidCreatedTimes: number;
    futureCreatedOperations: number;
    credentialsDatedByOperationCreated: number;
    credentialsDatedByValidFrom: number;
    credentialsWithoutUsableDate: number;
    credentialsWithConflictingSchemas: number;
    futureCredentialValidFrom: number;
}

interface CredentialEvidence {
    schemas: Set<string>;
    validFrom: Set<string>;
}

interface DIDEvidence {
    created: ReturnType<typeof creationDay>;
    prefix: string;
    conflicting: boolean;
    authoritative: boolean;
    isAgent: boolean;
}

function utcDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function metricDay(
    value: unknown,
    today: string
): { day?: string; invalid?: boolean; future?: boolean } {
    if (typeof value !== 'string') {
        return { invalid: true };
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return { invalid: true };
    }

    const day = utcDay(date);
    if (day > today) {
        return { future: true };
    }

    return { day: day < NETWORK_METRICS_EPOCH ? NETWORK_METRICS_EPOCH : day };
}

function canonicalMetricDay(
    value: unknown,
    today: string
): { day?: string; invalid?: boolean; future?: boolean } {
    if (typeof value !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
        return { invalid: true };
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
        return { invalid: true };
    }

    return metricDay(value, today);
}

function creationDay(operation: Operation, today: string) {
    return metricDay(operation.created, today);
}

function increment(counts: Map<string, number>, key: string): void {
    counts.set(key, (counts.get(key) ?? 0) + 1);
}

function incrementPrefix(
    deltas: Map<string, Map<string, number>>,
    day: string,
    prefix: string
): void {
    const dayDeltas = deltas.get(day) ?? new Map<string, number>();
    increment(dayDeltas, prefix);
    deltas.set(day, dayDeltas);
}

function sortedPrefixCounts(counts: Map<string, number>): Record<string, number> {
    return Object.fromEntries(Array.from(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function totalPrefixCounts(counts: Map<string, number>): number {
    return Array.from(counts.values()).reduce((total, count) => total + count, 0);
}

function metricPrefix(did: DIDEvidence | undefined, publishedPrefixes: Set<string> | undefined): string {
    if (did?.authoritative || did?.isAgent) {
        return did.prefix;
    }
    if (did?.conflicting || publishedPrefixes?.size !== 1) {
        return AMBIGUOUS_DID_PREFIX;
    }
    return publishedPrefixes.values().next().value as string;
}

function incrementSchema(
    deltas: Map<string, Map<string, number>>,
    day: string,
    schemaDid: string
): void {
    const dayDeltas = deltas.get(day) ?? new Map<string, number>();
    increment(dayDeltas, schemaDid);
    deltas.set(day, dayDeltas);
}

function nextDay(day: string): string {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return utcDay(date);
}

function sortedSchemaCounts(
    counts: Map<string, number>,
    schemaDids: Map<string, string>,
    prefixCounts?: Map<string, Map<string, number>>
): NetworkMetricSchemaCount[] {
    return Array.from(counts, ([schemaKey, count]) => ({
        schemaDid: schemaDids.get(schemaKey) as string,
        count,
        ...(prefixCounts
            ? { countsByCredentialPrefix: sortedPrefixCounts(prefixCounts.get(schemaKey) ?? new Map()) }
            : {}),
    }))
        .sort(compareSchemaCounts);
}

export function parseSnapshotDate(value: unknown, now: Date = new Date()): string | null {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || utcDay(date) !== value || value > utcDay(now)) {
        return null;
    }

    return value;
}

export async function buildNetworkMetricSnapshots(
    histories: Iterable<DIDEventHistory> | AsyncIterable<DIDEventHistory>,
    now: Date = new Date(),
    didPrefix?: string
): Promise<NetworkMetricsBuildResult> {
    const today = utcDay(now);
    const didPrefixDeltas = new Map<string, Map<string, number>>();
    const agentPrefixDeltas = new Map<string, Map<string, number>>();
    const credentialPrefixDeltas = new Map<string, Map<string, number>>();
    const schemaDeltas = new Map<string, Map<string, number>>();
    // day -> schema -> credential prefix -> count; unscoped builds only.
    const schemaPrefixDeltas = new Map<string, Map<string, Map<string, number>>>();
    const schemaDids = new Map<string, string>();
    const dids = new Map<string, DIDEvidence>();
    const credentials = new Map<string, CredentialEvidence>();
    const publishedPrefixes = new Map<string, Set<string>>();
    let agentsWithConflictingPrefixes = 0;
    let invalidCreatedTimes = 0;
    let futureCreatedOperations = 0;
    let credentialsDatedByOperationCreated = 0;
    let credentialsDatedByValidFrom = 0;
    let credentialsWithoutUsableDate = 0;
    let credentialsWithConflictingSchemas = 0;
    let futureCredentialValidFrom = 0;

    for await (const history of histories) {
        const anchor = history.events[0]?.operation;
        const classification = classifyDIDPrefix(history.events);

        if (anchor?.type === 'create') {
            dids.set(getDIDSuffix(history.did), {
                created: creationDay(anchor, today),
                prefix: classification.prefix,
                conflicting: classification.conflicting,
                authoritative: classification.authoritative,
                isAgent: anchor.mdip?.type === 'agent',
            });
        }

        if (anchor?.type !== 'create' || anchor.mdip?.type !== 'agent') {
            continue;
        }

        for (const evidence of extractPublishedCredentialHistory(history.did, history.events)) {
            const { credential, validFrom } = evidence;
            const credentialKey = getDIDSuffix(credential.credentialDid);
            const credentialPrefixes = publishedPrefixes.get(credentialKey) ?? new Set<string>();
            credentialPrefixes.add(getDIDPrefix(credential.credentialDid));
            publishedPrefixes.set(credentialKey, credentialPrefixes);
            const found = credentials.get(credentialKey) ?? {
                schemas: new Set<string>(),
                validFrom: new Set<string>(),
            };
            const schemaKey = getDIDSuffix(credential.schemaDid);
            const schemaPrefixes = publishedPrefixes.get(schemaKey) ?? new Set<string>();
            schemaPrefixes.add(getDIDPrefix(credential.schemaDid));
            publishedPrefixes.set(schemaKey, schemaPrefixes);
            found.schemas.add(schemaKey);
            if (validFrom) {
                found.validFrom.add(validFrom);
            }
            credentials.set(credentialKey, found);
        }
    }

    for (const [didKey, evidence] of dids) {
        const { created } = evidence;
        if (evidence.isAgent && evidence.conflicting) {
            agentsWithConflictingPrefixes += 1;
        }
        const prefix = metricPrefix(
            evidence,
            evidence.isAgent ? undefined : publishedPrefixes.get(didKey)
        );
        if (didPrefix && prefix !== didPrefix) {
            continue;
        }
        if (created.future) {
            futureCreatedOperations += 1;
            continue;
        }
        if (!created.day) {
            invalidCreatedTimes += 1;
            continue;
        }

        incrementPrefix(didPrefixDeltas, created.day, prefix);
        if (evidence.isAgent) {
            incrementPrefix(agentPrefixDeltas, created.day, prefix);
        }
    }

    for (const [credentialKey, evidence] of credentials) {
        if (evidence.schemas.size !== 1) {
            credentialsWithConflictingSchemas += 1;
            continue;
        }

        const schemaKey = evidence.schemas.values().next().value as string;
        const asset = dids.get(credentialKey);
        const credentialPrefix = metricPrefix(asset, publishedPrefixes.get(credentialKey));
        if (didPrefix && credentialPrefix !== didPrefix) {
            continue;
        }
        const created = asset?.created;
        let day: string | undefined;

        if (created) {
            if (created.day) {
                day = created.day;
                credentialsDatedByOperationCreated += 1;
            }
            else if (created.future) {
                continue;
            }
        }

        if (!day) {
            const validFromDays = Array.from(evidence.validFrom)
                .map(value => canonicalMetricDay(value, today))
                .filter(result => result.day)
                .map(result => result.day as string)
                .sort();
            day = validFromDays[0];

            if (day) {
                credentialsDatedByValidFrom += 1;
            }
            else if (Array.from(evidence.validFrom).some(value => canonicalMetricDay(value, today).future)) {
                futureCredentialValidFrom += 1;
                continue;
            }
            else {
                credentialsWithoutUsableDate += 1;
                continue;
            }
        }

        incrementPrefix(credentialPrefixDeltas, day, credentialPrefix);

        const schemaPrefix = metricPrefix(dids.get(schemaKey), publishedPrefixes.get(schemaKey));
        if (!didPrefix || schemaPrefix === didPrefix) {
            schemaDids.set(schemaKey, `${schemaPrefix}:${schemaKey}`);
            incrementSchema(schemaDeltas, day, schemaKey);
        }
        if (!didPrefix) {
            const daySchemas = schemaPrefixDeltas.get(day) ?? new Map<string, Map<string, number>>();
            const schemaPrefixes = daySchemas.get(schemaKey) ?? new Map<string, number>();
            increment(schemaPrefixes, credentialPrefix);
            daySchemas.set(schemaKey, schemaPrefixes);
            schemaPrefixDeltas.set(day, daySchemas);
        }
    }

    const deltaDays = [...didPrefixDeltas.keys(), ...agentPrefixDeltas.keys(), ...credentialPrefixDeltas.keys()];
    const firstDay = deltaDays.sort()[0] ?? today;
    const rebuiltAt = now.toISOString();
    const snapshots: NetworkMetricSnapshot[] = [];
    const didCountsByPrefix = new Map<string, number>();
    const agentDidCountsByPrefix = new Map<string, number>();
    const credentialDidCountsByPrefix = new Map<string, number>();
    const schemaCounts = new Map<string, number>();
    const schemaPrefixCounts = new Map<string, Map<string, number>>();

    for (let day = firstDay; day <= today; day = nextDay(day)) {
        for (const [prefix, count] of didPrefixDeltas.get(day) ?? []) {
            didCountsByPrefix.set(prefix, (didCountsByPrefix.get(prefix) ?? 0) + count);
        }
        for (const [prefix, count] of agentPrefixDeltas.get(day) ?? []) {
            agentDidCountsByPrefix.set(prefix, (agentDidCountsByPrefix.get(prefix) ?? 0) + count);
        }
        for (const [prefix, count] of credentialPrefixDeltas.get(day) ?? []) {
            credentialDidCountsByPrefix.set(prefix, (credentialDidCountsByPrefix.get(prefix) ?? 0) + count);
        }
        for (const [schemaDid, count] of schemaDeltas.get(day) ?? []) {
            schemaCounts.set(schemaDid, (schemaCounts.get(schemaDid) ?? 0) + count);
        }
        for (const [schemaKey, prefixDeltas] of schemaPrefixDeltas.get(day) ?? []) {
            const prefixCounts = schemaPrefixCounts.get(schemaKey) ?? new Map<string, number>();
            for (const [prefix, count] of prefixDeltas) {
                prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + count);
            }
            schemaPrefixCounts.set(schemaKey, prefixCounts);
        }
        snapshots.push({
            date: day,
            didCount: totalPrefixCounts(didCountsByPrefix),
            didCountsByPrefix: sortedPrefixCounts(didCountsByPrefix),
            agentDidCount: totalPrefixCounts(agentDidCountsByPrefix),
            agentDidCountsByPrefix: sortedPrefixCounts(agentDidCountsByPrefix),
            credentialCount: totalPrefixCounts(credentialDidCountsByPrefix),
            credentialDidCountsByPrefix: sortedPrefixCounts(credentialDidCountsByPrefix),
            schemas: sortedSchemaCounts(schemaCounts, schemaDids, didPrefix ? undefined : schemaPrefixCounts),
            rebuiltAt,
        });
    }

    return {
        snapshots,
        agentsWithConflictingPrefixes,
        invalidCreatedTimes,
        futureCreatedOperations,
        credentialsDatedByOperationCreated,
        credentialsDatedByValidFrom,
        credentialsWithoutUsableDate,
        credentialsWithConflictingSchemas,
        futureCredentialValidFrom,
    };
}
