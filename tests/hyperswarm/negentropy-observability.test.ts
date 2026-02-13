import { Operation } from '@mdip/gatekeeper/types';
import {
    addAggregateSample,
    averageAggregate,
    collectQueueDelaySamples,
    createAggregateMetric,
    messageBytes,
    safeRate,
} from '../../services/mediators/hyperswarm/src/negentropy/observability.ts';

const h = (c: string) => c.repeat(64);

function makeOp(signed?: string): Operation {
    return {
        type: 'create',
        signature: signed ? {
            hash: h('a'),
            signed,
            value: 'sig',
        } : undefined,
    };
}

describe('negentropy observability helpers', () => {
    it('aggregates samples and computes average', () => {
        const metric = createAggregateMetric();
        addAggregateSample(metric, 10);
        addAggregateSample(metric, 20);
        addAggregateSample(metric, -5);

        expect(metric).toStrictEqual({
            count: 2,
            total: 30,
            max: 20,
        });
        expect(averageAggregate(metric)).toBe(15);
    });

    it('collects queue delay samples from signed operations', () => {
        const now = Date.parse('2026-02-13T10:00:00.000Z');
        const samples = collectQueueDelaySamples([
            makeOp('2026-02-13T09:59:00.000Z'),
            makeOp('invalid-date'),
            makeOp(),
        ], now);

        expect(samples).toStrictEqual([60_000]);
    });

    it('computes message bytes for string, buffer, and object', () => {
        expect(messageBytes('abc')).toBe(3);
        expect(messageBytes(Buffer.from([1, 2, 3]))).toBe(3);
        expect(messageBytes({ hello: 'world' })).toBeGreaterThan(0);
    });

    it('returns safe rate for invalid denominator', () => {
        expect(safeRate(1, 0)).toBe(0);
        expect(safeRate(1, -1)).toBe(0);
        expect(safeRate(2, 4)).toBe(0.5);
    });
});
