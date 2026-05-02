import {
    buildInitialHistoryWindow,
    buildNextHistoryPage,
    buildRoundCapSplitWindow,
} from '../../services/mediators/hyperswarm/src/negentropy/windows.ts';

describe('negentropy windows', () => {
    it('builds an initial history window without a cursor and uses the default order', () => {
        expect(buildInitialHistoryWindow(1704067200, 1706659200, 25000)).toStrictEqual({
            name: 'history_paged',
            fromTs: 1704067200,
            toTs: 1706659200,
            maxRecords: 25000,
            order: 0,
            after: undefined,
        });
    });

    it('builds the next history page with a cloned cursor', () => {
        const cursor = {
            ts: 1705000000,
            id: 'a'.repeat(64),
        };
        const window = buildInitialHistoryWindow(1704067200, 1706659200, 25000);

        const next = buildNextHistoryPage(window, cursor, 3);

        expect(next).toStrictEqual({
            name: 'history_paged',
            fromTs: 1704067200,
            toTs: 1706659200,
            maxRecords: 25000,
            order: 3,
            after: cursor,
        });
        expect(next.after).not.toBe(cursor);
    });

    it('omits the cursor when the next history page is built with a null cursor', () => {
        const window = buildInitialHistoryWindow(1704067200, 1706659200, 25000);

        expect(buildNextHistoryPage(window, null as never, 4)).toStrictEqual({
            name: 'history_paged',
            fromTs: 1704067200,
            toTs: 1706659200,
            maxRecords: 25000,
            order: 4,
            after: undefined,
        });
    });

    it('returns null when a round-capped window cannot be split further', () => {
        expect(buildRoundCapSplitWindow({
            name: 'history_paged',
            fromTs: 1704067200,
            toTs: 1706659200,
            maxRecords: 1,
            order: 0,
        })).toBeNull();
    });

    it('splits a window without an existing cursor', () => {
        expect(buildRoundCapSplitWindow({
            name: 'history_paged',
            fromTs: 1704067200,
            toTs: 1706659200,
            maxRecords: 5,
            order: 2,
        })).toStrictEqual({
            name: 'history_paged',
            fromTs: 1704067200,
            toTs: 1706659200,
            maxRecords: 3,
            order: 2,
            after: undefined,
        });
    });
});
