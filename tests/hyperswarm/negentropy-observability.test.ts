import { Operation } from '@mdip/gatekeeper/types';
import {
    addAggregateSample,
    averageAggregate,
    collectQueueDelaySamples,
    createAggregateMetric,
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
    it('returns zero average for an empty aggregate', () => {
        expect(averageAggregate(createAggregateMetric())).toBe(0);
    });

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

    it('does not reduce the aggregate max when a smaller sample is added', () => {
        const metric = createAggregateMetric();
        addAggregateSample(metric, 20);
        addAggregateSample(metric, 5);

        expect(metric).toStrictEqual({
            count: 2,
            total: 25,
            max: 20,
        });
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

    it('returns empty samples for empty input', () => {
        expect(collectQueueDelaySamples([])).toStrictEqual([]);
    });
});
