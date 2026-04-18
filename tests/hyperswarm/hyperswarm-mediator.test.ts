import type { SyncStoreCursor } from '../../services/mediators/hyperswarm/src/db/types.ts';
import {
    buildBootstrapPageWindow,
    buildContinuationWindow,
    buildRoundCapSplitWindow,
} from '../../services/mediators/hyperswarm/src/negentropy/windows.ts';

describe('hyperswarm mediator window helpers', () => {
    const after: SyncStoreCursor = {
        ts: 1704067200123,
        id: 'a'.repeat(64),
    };

    it('splits a round-capped window by halving maxRecords and preserving coverage', () => {
        const window = {
            name: 'older_1',
            fromTs: 1704067200000,
            toTs: 1706659200000,
            maxRecords: 5000,
            order: 3,
            after,
        };

        const split = buildRoundCapSplitWindow(window);

        expect(split).toStrictEqual({
            name: 'older_1',
            fromTs: 1704067200000,
            toTs: 1706659200000,
            maxRecords: 2500,
            order: 3,
            after,
        });
    });

    it('does not split a window that cannot be reduced further', () => {
        const window = {
            name: 'older_1',
            fromTs: 1704067200000,
            toTs: 1706659200000,
            maxRecords: 1,
            order: 3,
        };

        expect(buildRoundCapSplitWindow(window)).toBeNull();
    });

    it('preserves reduced maxRecords when continuing a split bootstrap window', () => {
        const splitBootstrap = buildBootstrapPageWindow(2500, after, 4);
        const continuation = buildContinuationWindow(splitBootstrap, {
            ts: 1705000000000,
            id: 'b'.repeat(64),
        }, 5);

        expect(continuation).toStrictEqual({
            name: 'bootstrap_full_history',
            fromTs: splitBootstrap.fromTs,
            toTs: splitBootstrap.toTs,
            maxRecords: 2500,
            order: 5,
            after: {
                ts: 1705000000000,
                id: 'b'.repeat(64),
            },
        });
    });
});
