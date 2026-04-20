import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import {
    __testHooks,
    runMediator,
} from '../../services/mediators/hyperswarm/src/hyperswarm-mediator.ts';
import {
    buildInitialHistoryWindow,
    buildNextHistoryPage,
    buildRoundCapSplitWindow,
    MDIP_EPOCH_SECONDS,
} from '../../services/mediators/hyperswarm/src/negentropy/windows.ts';
import type { SyncStoreCursor } from '../../services/mediators/hyperswarm/src/db/types.ts';
import type { Operation } from '@mdip/gatekeeper/types';

function makeOp(hashChar: string, signed: string): Operation {
    return {
        type: 'create',
        signature: {
            hash: hashChar.repeat(64),
            signed,
            value: `sig-${hashChar}`,
        },
    };
}

function makeNegClose(
    sessionId: string,
    windowId: string,
    progress: { cappedByRecords: boolean; lastCursor?: { ts: number; id: string } },
) {
    return {
        type: 'neg_close',
        time: new Date().toISOString(),
        node: 'peer',
        relays: [],
        sessionId,
        windowId,
        round: 1,
        reason: 'remote_closed',
        windowProgress: progress,
    };
}

describe('hyperswarm mediator window helpers', () => {
    const after: SyncStoreCursor = {
        ts: 1704067200,
        id: 'a'.repeat(64),
    };

    it('splits a round-capped window by halving maxRecords and preserving coverage', () => {
        const window = buildInitialHistoryWindow(1704067200, 1706659200, 5000, after, 3);

        const split = buildRoundCapSplitWindow(window);

        expect(split).toStrictEqual({
            name: 'history_paged',
            fromTs: 1704067200,
            toTs: 1706659200,
            maxRecords: 2500,
            order: 3,
            after,
        });
    });

    it('does not split a window that cannot be reduced further', () => {
        const window = {
            name: 'history_paged',
            fromTs: 1704067200,
            toTs: 1706659200,
            maxRecords: 1,
            order: 3,
        };

        expect(buildRoundCapSplitWindow(window)).toBeNull();
    });

    it('preserves reduced maxRecords when continuing a split history page', () => {
        const splitHistoryPage = buildInitialHistoryWindow(MDIP_EPOCH_SECONDS, 1706659200, 2500, after, 4);
        const continuation = buildNextHistoryPage(splitHistoryPage, {
            ts: 1705000000,
            id: 'b'.repeat(64),
        }, 5);

        expect(continuation).toStrictEqual({
            name: 'history_paged',
            fromTs: splitHistoryPage.fromTs,
            toTs: splitHistoryPage.toTs,
            maxRecords: 2500,
            order: 5,
            after: {
                ts: 1705000000,
                id: 'b'.repeat(64),
            },
        });
    });
});

describe('hyperswarm mediator negentropy session flow', () => {
    const peerKeyA = 'a'.repeat(64);
    const peerKeyB = 'b'.repeat(64);

    beforeEach(async () => {
        await __testHooks.resetMediatorState();
    });

    afterEach(async () => {
        await __testHooks.resetMediatorState();
    });

    it('ignores neg_open from a peer advertising an incompatible negentropy version', async () => {
        const store = new InMemoryOperationSyncStore();
        await runMediator({ syncStore: store, startLoops: false });
        await __testHooks.initNegentropyAdapter();

        const writes: string[] = [];
        const connInfo = __testHooks.addConnection(peerKeyA, chunk => writes.push(chunk)) as any;
        connInfo.capabilities.version = 1;

        await __testHooks.receiveMsg(peerKeyA, {
            type: 'neg_open',
            time: new Date().toISOString(),
            node: 'peer',
            relays: [],
            sessionId: 'mismatch-session',
            windowId: 'history_paged:0:100:4:none',
            window: {
                name: 'history_paged',
                fromTs: MDIP_EPOCH_SECONDS,
                toTs: 1706659200,
                maxRecords: 4,
                order: 0,
            },
            round: 1,
            frame: {
                encoding: 'utf8',
                data: '',
            },
        });

        expect(__testHooks.getPeerSession(peerKeyA)).toBeNull();
        expect(writes).toStrictEqual([]);
    });

    it('ignores stale neg_close progress from an older session or window', async () => {
        const store = new InMemoryOperationSyncStore();
        await runMediator({ syncStore: store, startLoops: false });
        await __testHooks.initNegentropyAdapter();
        __testHooks.addConnection(peerKeyA);

        const session = __testHooks.createPeerSession(peerKeyA, 'negentropy', true, 'current-session') as any;
        session.windows = [buildInitialHistoryWindow(MDIP_EPOCH_SECONDS, Number.MAX_SAFE_INTEGER, 4)];
        session.windowIndex = 0;

        await __testHooks.startNextNegentropyWindow(peerKeyA, session);

        expect(session.windowId).toBeTruthy();
        expect(session.remoteWindowCappedByRecords).toBe(false);
        expect(session.remoteWindowLastCursor).toBeNull();

        await __testHooks.receiveMsg(peerKeyA, makeNegClose(
            'stale-session',
            session.windowId,
            {
                cappedByRecords: true,
                lastCursor: {
                    ts: 1704067201,
                    id: 'c'.repeat(64),
                },
            },
        ));

        expect(session.remoteWindowCappedByRecords).toBe(false);
        expect(session.remoteWindowLastCursor).toBeNull();

        await __testHooks.receiveMsg(peerKeyA, makeNegClose(
            'current-session',
            'stale-window',
            {
                cappedByRecords: true,
                lastCursor: {
                    ts: 1704067202,
                    id: 'd'.repeat(64),
                },
            },
        ));

        expect(session.remoteWindowCappedByRecords).toBe(false);
        expect(session.remoteWindowLastCursor).toBeNull();
        expect(__testHooks.getPeerSession(peerKeyA)).toBe(session);
    });

    it('splits round-capped windows, continues paged coverage, and then completes the session', async () => {
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.upsertMany([
            { id: '1'.repeat(64), ts: 1704067200, operation: makeOp('1', '2024-01-01T00:00:00.000Z') },
            { id: '2'.repeat(64), ts: 1704067201, operation: makeOp('2', '2024-01-01T00:00:01.000Z') },
            { id: '3'.repeat(64), ts: 1704067202, operation: makeOp('3', '2024-01-01T00:00:02.000Z') },
            { id: '4'.repeat(64), ts: 1704067203, operation: makeOp('4', '2024-01-01T00:00:03.000Z') },
        ]);

        await runMediator({ syncStore: store, startLoops: false });
        await __testHooks.initNegentropyAdapter();

        const writes: string[] = [];
        const connInfo = __testHooks.addConnection(peerKeyB, chunk => writes.push(chunk));
        const session = __testHooks.createPeerSession(peerKeyB, 'negentropy', true, 'split-session') as any;
        session.windows = [buildInitialHistoryWindow(1704067200, Number.MAX_SAFE_INTEGER, 4)];
        session.windowIndex = 0;

        await __testHooks.startNextNegentropyWindow(peerKeyB, session);

        const initialOpen = JSON.parse(writes[writes.length - 1]);
        expect(initialOpen.type).toBe('neg_open');
        expect(initialOpen.window.maxRecords).toBe(4);

        await __testHooks.receiveMsg(peerKeyB, {
            type: 'neg_close',
            time: new Date().toISOString(),
            node: 'peer',
            relays: [],
            sessionId: 'split-session',
            windowId: session.windowId,
            round: 1,
            reason: 'max_rounds_reached',
        });

        const splitSession = __testHooks.getPeerSession(peerKeyB) as any;
        expect(splitSession).toBeTruthy();
        expect(splitSession.windows[0].maxRecords).toBe(2);

        const splitOpen = JSON.parse(writes[writes.length - 1]);
        expect(splitOpen.type).toBe('neg_open');
        expect(splitOpen.window.maxRecords).toBe(2);

        const splitCursor = splitSession.currentWindowStats.lastCursor;
        expect(splitSession.currentWindowStats.cappedByRecords).toBe(true);
        expect(splitCursor).toStrictEqual({
            ts: 1704067201,
            id: '2'.repeat(64),
        });

        splitSession.reconciliationComplete = true;
        splitSession.pendingNeedIds.clear();
        await __testHooks.maybeFinalizeInitiatorSession(peerKeyB, splitSession);

        const continuationSession = __testHooks.getPeerSession(peerKeyB) as any;
        expect(continuationSession.windowIndex).toBe(1);
        expect(continuationSession.windows[1]).toStrictEqual({
            name: 'history_paged',
            fromTs: 1704067200,
            toTs: Number.MAX_SAFE_INTEGER,
            maxRecords: 2,
            order: 1,
            after: splitCursor,
        });

        const continuationOpen = JSON.parse(writes[writes.length - 1]);
        expect(continuationOpen.type).toBe('neg_open');
        expect(continuationOpen.window.maxRecords).toBe(2);
        expect(continuationOpen.window.after).toStrictEqual(splitCursor);
        expect(continuationSession.currentWindowStats.cappedByRecords).toBe(false);

        continuationSession.reconciliationComplete = true;
        continuationSession.pendingNeedIds.clear();
        await __testHooks.maybeFinalizeInitiatorSession(peerKeyB, continuationSession);

        expect(__testHooks.getPeerSession(peerKeyB)).toBeNull();
        expect(connInfo.negentropySynced).toBe(true);

        const closeMsg = JSON.parse(writes[writes.length - 1]);
        expect(closeMsg.type).toBe('neg_close');
        expect(closeMsg.reason).toBe('complete');
    });
});
