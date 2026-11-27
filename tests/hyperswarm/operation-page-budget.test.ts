import { createOperationPageBudget } from '../../services/mediators/hyperswarm/src/operation-page-budget.ts';

describe('operation page budget', () => {
    it.each([
        [0, 1],
        [1.5, 1],
        [1, 0],
        [1, Number.MAX_SAFE_INTEGER + 1],
    ])('rejects invalid limits %s pages and %s bytes', (pages, bytes) => {
        expect(() => createOperationPageBudget(pages, bytes)).toThrow();
    });

    it('bounds pages and bytes and releases reservations once', () => {
        const budget = createOperationPageBudget(2, 10);
        const first = budget.reserve(4)!;
        const second = budget.reserve(6)!;

        expect(budget.getMetrics()).toMatchObject({ pages: 2, bytes: 10 });
        expect(budget.reserve(0)).toBeNull();

        first.release();
        first.release();
        expect(budget.getMetrics()).toMatchObject({ pages: 1, bytes: 6 });

        const replacement = budget.reserve(4)!;
        expect(budget.getMetrics()).toMatchObject({ pages: 2, bytes: 10 });

        second.release();
        replacement.release();
        expect(budget.getMetrics()).toMatchObject({ pages: 0, bytes: 0 });
    });

    it('rejects invalid reservations and new work after shutdown', () => {
        const budget = createOperationPageBudget(1, 10);

        expect(() => budget.reserve(-1)).toThrow('non-negative safe integer');
        expect(() => budget.reserve(Number.MAX_SAFE_INTEGER + 1)).toThrow('non-negative safe integer');
        expect(budget.reserve(11)).toBeNull();

        budget.shutdown();
        expect(budget.reserve(1)).toBeNull();
    });
});
