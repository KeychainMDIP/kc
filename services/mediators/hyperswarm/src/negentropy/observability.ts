import { Operation } from '@mdip/gatekeeper/types';

export interface AggregateMetric {
    count: number;
    total: number;
    max: number;
}

export function createAggregateMetric(): AggregateMetric {
    return {
        count: 0,
        total: 0,
        max: 0,
    };
}

export function addAggregateSample(metric: AggregateMetric, sample: number): void {
    if (!Number.isFinite(sample) || sample < 0) {
        return;
    }

    metric.count += 1;
    metric.total += sample;
    if (sample > metric.max) {
        metric.max = sample;
    }
}

export function averageAggregate(metric: AggregateMetric): number {
    if (metric.count === 0) {
        return 0;
    }

    return metric.total / metric.count;
}

export function messageBytes(payload: string | Buffer | object): number {
    if (typeof payload === 'string') {
        return Buffer.byteLength(payload, 'utf8');
    }

    if (Buffer.isBuffer(payload)) {
        return payload.byteLength;
    }

    return Buffer.byteLength(JSON.stringify(payload), 'utf8');
}

export function collectQueueDelaySamples(operations: Operation[], nowMs: number = Date.now()): number[] {
    if (!Array.isArray(operations) || operations.length === 0) {
        return [];
    }

    const samples: number[] = [];
    for (const operation of operations) {
        const signed = operation.signature?.signed;
        if (typeof signed !== 'string' || signed === '') {
            continue;
        }

        const ts = Date.parse(signed);
        if (!Number.isFinite(ts)) {
            continue;
        }

        samples.push(Math.max(0, nowMs - ts));
    }

    return samples;
}

export function safeRate(numerator: number, denominator: number): number {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
        return 0;
    }

    return numerator / denominator;
}
