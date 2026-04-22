import { compareSyncCursor } from '../../services/mediators/hyperswarm/src/negentropy/cursor.ts';

describe('compareSyncCursor', () => {
    it('orders by timestamp before id', () => {
        expect(compareSyncCursor(
            { ts: 10, id: 'f'.repeat(64) },
            { ts: 11, id: '0'.repeat(64) },
        )).toBeLessThan(0);
    });

    it('orders equal timestamps by lowercase hex id lexicographically', () => {
        expect(compareSyncCursor(
            { ts: 10, id: '0'.repeat(63) + 'a' },
            { ts: 10, id: '0'.repeat(63) + 'b' },
        )).toBeLessThan(0);

        expect(compareSyncCursor(
            { ts: 10, id: 'f'.repeat(64) },
            { ts: 10, id: 'f'.repeat(63) + 'e' },
        )).toBeGreaterThan(0);
    });

    it('treats identical cursors as equal', () => {
        const cursor = { ts: 10, id: 'a'.repeat(64) };
        expect(compareSyncCursor(cursor, cursor)).toBe(0);
    });
});
