import {
    compareSyncCursor,
    getContinuationCursorDecision,
} from '../../services/mediators/hyperswarm/src/negentropy/cursor.ts';

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

    it('advances to the remote cursor when a capped overlap was already known locally', () => {
        const decision = getContinuationCursorDecision({
            windowName: 'history_paged',
            windowAfter: null,
            windowMaxRecords: 25000,
            localCappedByRecords: true,
            localLastCursor: { ts: 10, id: 'a'.repeat(64) },
            remoteCappedByRecords: true,
            remoteLastCursor: { ts: 11, id: '0'.repeat(64) },
            receivedPushCount: 2,
            receivedKnownPushCount: 2,
            receivedPushMaxCursor: { ts: 11, id: '0'.repeat(64) },
        });

        expect(decision.blockedByAfter).toBe(false);
        expect(decision.chosenCursor).toStrictEqual({ ts: 11, id: '0'.repeat(64) });
    });

    it('keeps the conservative earlier cursor when received pushes were not already known', () => {
        const decision = getContinuationCursorDecision({
            windowName: 'history_paged',
            windowAfter: null,
            windowMaxRecords: 25000,
            localCappedByRecords: true,
            localLastCursor: { ts: 10, id: 'a'.repeat(64) },
            remoteCappedByRecords: true,
            remoteLastCursor: { ts: 11, id: '0'.repeat(64) },
            receivedPushCount: 2,
            receivedKnownPushCount: 0,
            receivedPushMaxCursor: { ts: 11, id: '0'.repeat(64) },
        });

        expect(decision.blockedByAfter).toBe(false);
        expect(decision.chosenCursor).toStrictEqual({ ts: 10, id: 'a'.repeat(64) });
    });

    it('chooses the remote earlier cursor when it precedes the local cursor', () => {
        const decision = getContinuationCursorDecision({
            windowName: 'history_paged',
            windowAfter: null,
            windowMaxRecords: 25000,
            localCappedByRecords: true,
            localLastCursor: { ts: 11, id: 'b'.repeat(64) },
            remoteCappedByRecords: true,
            remoteLastCursor: { ts: 10, id: 'a'.repeat(64) },
            receivedPushCount: 2,
            receivedKnownPushCount: 0,
            receivedPushMaxCursor: { ts: 11, id: 'b'.repeat(64) },
        });

        expect(decision.blockedByAfter).toBe(false);
        expect(decision.chosenCursor).toStrictEqual({ ts: 10, id: 'a'.repeat(64) });
    });

    it('uses the remote cursor when only the remote side capped the page', () => {
        const decision = getContinuationCursorDecision({
            windowName: 'history_paged',
            windowAfter: null,
            windowMaxRecords: 25000,
            localCappedByRecords: false,
            localLastCursor: null,
            remoteCappedByRecords: true,
            remoteLastCursor: { ts: 11, id: '0'.repeat(64) },
            receivedPushCount: 2,
            receivedKnownPushCount: 0,
            receivedPushMaxCursor: { ts: 11, id: '0'.repeat(64) },
        });

        expect(decision.blockedByAfter).toBe(false);
        expect(decision.chosenCursor).toStrictEqual({ ts: 11, id: '0'.repeat(64) });
    });

    it('uses the remote cursor for known-overlap pages when only the remote side capped', () => {
        const decision = getContinuationCursorDecision({
            windowName: 'history_paged',
            windowAfter: null,
            windowMaxRecords: 25000,
            localCappedByRecords: false,
            localLastCursor: null,
            remoteCappedByRecords: true,
            remoteLastCursor: { ts: 12, id: 'f'.repeat(64) },
            receivedPushCount: 2,
            receivedKnownPushCount: 2,
            receivedPushMaxCursor: { ts: 12, id: 'f'.repeat(64) },
        });

        expect(decision.blockedByAfter).toBe(false);
        expect(decision.chosenCursor).toStrictEqual({ ts: 12, id: 'f'.repeat(64) });
    });

    it('keeps the local later cursor for known-overlap pages when it sorts after the remote cursor', () => {
        const decision = getContinuationCursorDecision({
            windowName: 'history_paged',
            windowAfter: null,
            windowMaxRecords: 25000,
            localCappedByRecords: true,
            localLastCursor: { ts: 12, id: 'f'.repeat(64) },
            remoteCappedByRecords: true,
            remoteLastCursor: { ts: 11, id: '0'.repeat(64) },
            receivedPushCount: 2,
            receivedKnownPushCount: 2,
            receivedPushMaxCursor: { ts: 12, id: 'f'.repeat(64) },
        });

        expect(decision.blockedByAfter).toBe(false);
        expect(decision.chosenCursor).toStrictEqual({ ts: 12, id: 'f'.repeat(64) });
    });

    it('falls back to the received push max cursor for full history pages', () => {
        const decision = getContinuationCursorDecision({
            windowName: 'history_paged',
            windowAfter: null,
            windowMaxRecords: 2,
            localCappedByRecords: false,
            localLastCursor: null,
            remoteCappedByRecords: false,
            remoteLastCursor: null,
            receivedPushCount: 2,
            receivedKnownPushCount: 0,
            receivedPushMaxCursor: { ts: 12, id: 'f'.repeat(64) },
        });

        expect(decision.blockedByAfter).toBe(false);
        expect(decision.chosenCursor).toStrictEqual({ ts: 12, id: 'f'.repeat(64) });
    });

    it('returns no continuation cursor when the fallback max cursor is missing', () => {
        const decision = getContinuationCursorDecision({
            windowName: 'history_paged',
            windowAfter: null,
            windowMaxRecords: 2,
            localCappedByRecords: false,
            localLastCursor: null,
            remoteCappedByRecords: false,
            remoteLastCursor: null,
            receivedPushCount: 2,
            receivedKnownPushCount: 0,
            receivedPushMaxCursor: null,
        });

        expect(decision.blockedByAfter).toBe(false);
        expect(decision.chosenCursor).toBeNull();
    });

    it('blocks a cursor that does not advance beyond the prior window boundary', () => {
        const decision = getContinuationCursorDecision({
            windowName: 'history_paged',
            windowAfter: { ts: 10, id: 'a'.repeat(64) },
            windowMaxRecords: 25000,
            localCappedByRecords: true,
            localLastCursor: { ts: 10, id: 'a'.repeat(64) },
            remoteCappedByRecords: false,
            remoteLastCursor: null,
            receivedPushCount: 0,
            receivedKnownPushCount: 0,
            receivedPushMaxCursor: null,
        });

        expect(decision.blockedByAfter).toBe(true);
        expect(decision.chosenCursor).toBeNull();
    });
});
