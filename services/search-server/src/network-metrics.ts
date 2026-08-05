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

function sortedSchemaCounts(counts: Map<string, number>): PublishedCredentialSchemaCount[] {
    return Array.from(counts, ([schemaDid, count]) => ({ schemaDid, count }))
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
    const agentDeltas = new Map<string, number>();
    const credentialDeltas = new Map<string, number>();
    const schemaDeltas = new Map<string, Map<string, number>>();
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
            assetCreationDays.set(history.did, creationDay(anchor, today));
        }

        if (anchor?.type !== 'create' || anchor.mdip?.type !== 'agent') {
            continue;
        }

        const created = creationDay(anchor, today);
        if (created.day) {
            increment(agentDeltas, created.day);
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
                const found = credentials.get(credential.credentialDid) ?? {
                    schemas: new Set<string>(),
                    validFrom: new Set<string>(),
                };
                found.schemas.add(credential.schemaDid);
                if (validFrom) {
                    found.validFrom.add(validFrom);
                }
                credentials.set(credential.credentialDid, found);
            }
        }
    }

    for (const [credentialDid, evidence] of credentials) {
        if (evidence.schemas.size !== 1) {
            credentialsWithConflictingSchemas += 1;
            continue;
        }

        const schemaDid = evidence.schemas.values().next().value as string;
        const created = assetCreationDays.get(credentialDid);
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

        increment(credentialDeltas, day);
        incrementSchema(schemaDeltas, day, schemaDid);
    }

    const deltaDays = [...agentDeltas.keys(), ...credentialDeltas.keys()];
    const firstDay = deltaDays.sort()[0] ?? today;
    const rebuiltAt = now.toISOString();
    const snapshots: NetworkMetricSnapshot[] = [];
    const schemaCounts = new Map<string, number>();
    let agentDidCount = 0;
    let credentialCount = 0;

    for (let day = firstDay; day <= today; day = nextDay(day)) {
        agentDidCount += agentDeltas.get(day) ?? 0;
        credentialCount += credentialDeltas.get(day) ?? 0;
        for (const [schemaDid, count] of schemaDeltas.get(day) ?? []) {
            schemaCounts.set(schemaDid, (schemaCounts.get(schemaDid) ?? 0) + count);
        }
        snapshots.push({
            date: day,
            agentDidCount,
            credentialCount,
            schemas: sortedSchemaCounts(schemaCounts),
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
