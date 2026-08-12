import type { Operation } from '@mdip/gatekeeper/types';
import { extractPublishedCredentialEvidence } from './published-credentials.js';
import type {
    DIDEventHistory,
    NetworkMetricSnapshot,
    PublishedCredentialSchemaCount,
} from './types.js';

export const NETWORK_METRICS_EPOCH = '2024-01-01';

export interface NetworkMetricsBuildResult {
    snapshots: NetworkMetricSnapshot[];
    invalidCreatedTimes: number;
    futureCreatedOperations: number;
    credentialsDatedByOperationCreated: number;
    credentialsDatedByValidFrom: number;
    credentialsWithoutUsableDate: number;
    credentialsWithConflictingSchemas: number;
    futureCredentialValidFrom: number;
}

interface CredentialEvidence {
    credentialDid: string;
    schemas: Set<string>;
    validFrom: Set<string>;
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

function didPrefix(did: string): string {
    return did.split(':', 2).join(':');
}

function didSuffix(did: string): string {
    return did.split(':').pop()!;
}

function incrementPrefix(
    deltas: Map<string, Map<string, number>>,
    day: string,
    did: string
): void {
    const dayDeltas = deltas.get(day) ?? new Map<string, number>();
    increment(dayDeltas, didPrefix(did));
    deltas.set(day, dayDeltas);
}

function sortedPrefixCounts(counts: Map<string, number>): Record<string, number> {
    return Object.fromEntries(Array.from(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function totalPrefixCounts(counts: Map<string, number>): number {
    return Array.from(counts.values()).reduce((total, count) => total + count, 0);
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
    schemaDids: Map<string, string>
): PublishedCredentialSchemaCount[] {
    return Array.from(counts, ([schemaKey, count]) => ({
        schemaDid: schemaDids.get(schemaKey) as string,
        count,
    }))
        .sort((a, b) => b.count - a.count || a.schemaDid.localeCompare(b.schemaDid));
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
    now: Date = new Date()
): Promise<NetworkMetricsBuildResult> {
    const today = utcDay(now);
    const agentPrefixDeltas = new Map<string, Map<string, number>>();
    const credentialPrefixDeltas = new Map<string, Map<string, number>>();
    const schemaDeltas = new Map<string, Map<string, number>>();
    const schemaDids = new Map<string, string>();
    const assetCreationDays = new Map<string, ReturnType<typeof creationDay>>();
    const credentials = new Map<string, CredentialEvidence>();
    let invalidCreatedTimes = 0;
    let futureCreatedOperations = 0;
    let credentialsDatedByOperationCreated = 0;
    let credentialsDatedByValidFrom = 0;
    let credentialsWithoutUsableDate = 0;
    let credentialsWithConflictingSchemas = 0;
    let futureCredentialValidFrom = 0;

    for await (const history of histories) {
        const anchor = history.events[0]?.operation;

        if (anchor?.type === 'create' && anchor.mdip?.type === 'asset') {
            assetCreationDays.set(didSuffix(history.did), creationDay(anchor, today));
        }

        if (anchor?.type !== 'create' || anchor.mdip?.type !== 'agent') {
            continue;
        }

        const created = creationDay(anchor, today);
        if (created.day) {
            incrementPrefix(agentPrefixDeltas, created.day, history.did);
        }
        else if (created.future) {
            futureCreatedOperations += 1;
        }
        else {
            invalidCreatedTimes += 1;
        }

        for (const event of history.events) {
            const doc = event.operation.type === 'update' ? event.operation.doc : undefined;
            if (!doc) {
                continue;
            }

            for (const evidence of extractPublishedCredentialEvidence(history.did, doc)) {
                const { credential, validFrom } = evidence;
                const credentialKey = didSuffix(credential.credentialDid);
                const found = credentials.get(credentialKey) ?? {
                    credentialDid: credential.credentialDid,
                    schemas: new Set<string>(),
                    validFrom: new Set<string>(),
                };
                const schemaKey = didSuffix(credential.schemaDid);
                found.schemas.add(schemaKey);
                if (!schemaDids.has(schemaKey)) {
                    schemaDids.set(schemaKey, credential.schemaDid);
                }
                if (validFrom) {
                    found.validFrom.add(validFrom);
                }
                credentials.set(credentialKey, found);
            }
        }
    }

    for (const [credentialKey, evidence] of credentials) {
        if (evidence.schemas.size !== 1) {
            credentialsWithConflictingSchemas += 1;
            continue;
        }

        const schemaKey = evidence.schemas.values().next().value as string;
        const created = assetCreationDays.get(credentialKey);
        let day: string | undefined;

        if (created) {
            if (created.day) {
                day = created.day;
                credentialsDatedByOperationCreated += 1;
            }
            else if (created.future) {
                futureCreatedOperations += 1;
                continue;
            }
            else if (created.invalid) {
                invalidCreatedTimes += 1;
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

        incrementPrefix(credentialPrefixDeltas, day, evidence.credentialDid);
        incrementSchema(schemaDeltas, day, schemaKey);
    }

    const deltaDays = [...agentPrefixDeltas.keys(), ...credentialPrefixDeltas.keys()];
    const firstDay = deltaDays.sort()[0] ?? today;
    const rebuiltAt = now.toISOString();
    const snapshots: NetworkMetricSnapshot[] = [];
    const agentDidCountsByPrefix = new Map<string, number>();
    const credentialDidCountsByPrefix = new Map<string, number>();
    const schemaCounts = new Map<string, number>();

    for (let day = firstDay; day <= today; day = nextDay(day)) {
        for (const [prefix, count] of agentPrefixDeltas.get(day) ?? []) {
            agentDidCountsByPrefix.set(prefix, (agentDidCountsByPrefix.get(prefix) ?? 0) + count);
        }
        for (const [prefix, count] of credentialPrefixDeltas.get(day) ?? []) {
            credentialDidCountsByPrefix.set(prefix, (credentialDidCountsByPrefix.get(prefix) ?? 0) + count);
        }
        for (const [schemaDid, count] of schemaDeltas.get(day) ?? []) {
            schemaCounts.set(schemaDid, (schemaCounts.get(schemaDid) ?? 0) + count);
        }
        snapshots.push({
            date: day,
            agentDidCount: totalPrefixCounts(agentDidCountsByPrefix),
            agentDidCountsByPrefix: sortedPrefixCounts(agentDidCountsByPrefix),
            credentialCount: totalPrefixCounts(credentialDidCountsByPrefix),
            credentialDidCountsByPrefix: sortedPrefixCounts(credentialDidCountsByPrefix),
            schemas: sortedSchemaCounts(schemaCounts, schemaDids),
            rebuiltAt,
        });
    }

    return {
        snapshots,
        invalidCreatedTimes,
        futureCreatedOperations,
        credentialsDatedByOperationCreated,
        credentialsDatedByValidFrom,
        credentialsWithoutUsableDate,
        credentialsWithConflictingSchemas,
        futureCredentialValidFrom,
    };
}
