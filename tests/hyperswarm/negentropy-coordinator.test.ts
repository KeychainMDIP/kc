import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';

import type { ImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import type { ReconciliationWindow } from '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';
import { normalizePeerCapabilities } from '../../services/mediators/hyperswarm/src/negentropy/protocol.ts';
import { makeWindowId } from '../../services/mediators/hyperswarm/src/negentropy/windows.ts';
import { createBulkWorkScheduler } from '../../services/mediators/hyperswarm/src/bulk-work-scheduler.ts';
import { createOperationPageBudget } from '../../services/mediators/hyperswarm/src/operation-page-budget.ts';
import type { HyperMessage, NegOpenMessage } from '../../services/mediators/hyperswarm/src/protocol-messages.ts';

const mockLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

jest.unstable_mockModule('@mdip/common/logger', () => ({
    childLogger: jest.fn(() => mockLogger),
}));

describe('Negentropy coordinator', () => {
    it('contains invalid or failed transfer work and releases the session slot', async () => {
        const [
            { createNegentropyCoordinator }, { default: InMemoryOperationSyncStore },
            { createConnectionInfo }, { createMediatorSyncStats },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/negentropy-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/db/memory.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
        ]);
        const peerKey = '22'.repeat(32);
        const connection = createConnectionInfo({
            connection: { write() {}, destroy() {}, remotePublicKey: Buffer.from(peerKey, 'hex') } as never,
            peerName: 'test-peer',
        });
        connection.capabilities = normalizePeerCapabilities();
        connection.wireVersion = 2;
        const store = new InMemoryOperationSyncStore();
        await store.start();
        const cipher = new CipherNode();
        const unsigned = {
            type: 'create' as const,
            created: '2026-01-01T00:00:00.000Z',
            mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
        };
        const operation = { ...unsigned, signature: {
            hash: cipher.hashJSON(unsigned), signed: unsigned.created, value: 'signature',
        } };
        await store.upsertMany([{
            id: operation.signature.hash, ts: 1_767_225_600, syncOrder: 1, operation,
        }]);
        const outcomes: Array<{ nextMsg: Uint8Array | null; haveIds: string[]; needIds: string[] }> = [];
        const adapter = {
            async buildSnapshotForWindow(window: ReconciliationWindow) {
                return {
                    window, storage: {} as never,
                    stats: {
                        loaded: 1, skipped: 0, durationMs: 0, frameSizeLimit: 0,
                        windowName: window.name, fromTs: window.fromTs, toTs: window.toTs,
                        rounds: 0, completed: false, cappedByRecords: false, cappedByRounds: false,
                    },
                };
            },
            createEngineForSnapshot() {
                return {
                    initiate: async () => new Uint8Array(),
                    reconcile: async () => outcomes.shift()
                        ?? { nextMsg: null, haveIds: [], needIds: [] },
                };
            },
        };
        let pipelineAvailable = true;
        const importPipeline = {
            get available() { return pipelineAvailable; }, recovering: false, queued: 0, running: 0, indexEpoch: 'epoch',
            enqueue: jest.fn(async () => ({
                knownIds: [operation.signature.hash], persistedIds: [], pendingIds: [],
                capacityDeferredIds: [], acceptedOperations: [], portableTerminalOperations: [],
                unaddressableOperations: [], retryable: false,
            })),
            filterRetryDelayedIds: (ids: string[]) => ({
                eligibleIds: ids, pendingIds: [], capacityDeferredIds: [],
            }),
        } as unknown as ImportPipeline;
        const operationPages = createOperationPageBudget(1, 512 * 1024);
        let failedType: string | null = null;
        let failBulk = false;
        let nextSession = 0;
        const sent: HyperMessage[] = [];
        const sendToPeer = jest.fn<Parameters<typeof createNegentropyCoordinator>[0]['sendToPeer']>((_key, message) => {
            sent.push(message);
            return message.type !== failedType;
        });
        const sendBulkToPeer = jest.fn<Parameters<typeof createNegentropyCoordinator>[0]['sendBulkToPeer']>(
            async (_key, message) => {
                sent.push(message);
                return !failBulk;
            },
        );
        const onSessionClosed = jest.fn(async () => undefined);
        const onProtocolViolation = jest.fn();
        const terminatePeerConnection = jest.fn();
        const coordinator = createNegentropyCoordinator({
            wireVersion: 2, frameSizeLimit: 0,
            maxRecordsPerWindow: 16, maxRoundsPerSession: 8, maxIdsPerRequest: 1_000,
            maxIdsPerLookup: 1_000, maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024,
            idleTimeoutMs: 120_000, repairIntervalMs: 60_000,
            syncStore: store, importPipeline, syncStats: createMediatorSyncStats(), cipher,
            bulkReads: createBulkWorkScheduler(2), operationPages,
            getConnection: key => key === peerKey ? connection : undefined,
            createSessionId: () => `local-${nextSession++}`,
            createBaseMessage: type => ({ type }),
            sendToPeer, sendBulkToPeer,
            canStartBackgroundPrebuild: () => false, terminatePeerConnection,
            onProtocolViolation, onSessionClosed, onIndexRefreshed: async () => {},
        });
        coordinator.setAdapter(adapter as never);

        async function startLocal(): Promise<NegOpenMessage> {
            const before = sent.length;
            expect(await coordinator.startSession(peerKey, {
                source: 'connect', initiator: true,
            })).toBe(true);
            return sent.slice(before).find(message => message.type === 'neg_open') as NegOpenMessage;
        }

        async function openRemote(template: NegOpenMessage, sessionId: string) {
            const before = sent.length;
            connection.negentropyRetryAfter = 0;
            outcomes.push({ nextMsg: new Uint8Array([1]), haveIds: [], needIds: [] });
            await coordinator.handleMessage(peerKey, {
                ...template, type: 'neg_open', sessionId, round: 0,
            } as never);
            const messages = sent.slice(before);
            expect(onProtocolViolation).not.toHaveBeenCalled();
            expect(mockLogger.warn.mock.calls).toEqual([]);
            expect(messages).toContainEqual(expect.objectContaining({ type: 'neg_msg' }));
            const response = messages.find(message => message.type === 'neg_msg');
            return response!;
        }

        async function requestOperation(sessionId: string, requestedOperation = operation) {
            const open = await startLocal();
            outcomes.push({
                nextMsg: null,
                haveIds: [],
                needIds: [requestedOperation.signature!.hash],
            });
            const before = sent.length;
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            });
            const request = sent.slice(before).find(message => message.type === 'ops_req');
            expect(request).toBeDefined();
            return { open: { ...open, sessionId }, request: request! };
        }

        try {
            const unknownSession = {
                sessionId: 'unknown', windowId: 'unknown-window', round: 0,
            };
            for (const message of [
                { ...unknownSession, type: 'neg_msg', frame: { encoding: 'base64', data: '' } },
                { ...unknownSession, type: 'ops_offer', offerId: 0, ids: [operation.signature.hash] },
                { ...unknownSession, type: 'ops_req', requestId: 0, ids: [operation.signature.hash] },
                {
                    ...unknownSession, type: 'ops_push', requestId: 0, page: 0,
                    hasMore: false, data: [operation],
                },
                { ...unknownSession, type: 'ops_ack', requestId: 0, page: 0 },
                { ...unknownSession, type: 'neg_close', reason: 'complete' },
            ]) {
                await coordinator.handleMessage(peerKey, message as never);
            }
            expect(coordinator.getActiveSessionCount()).toBe(0);

            const guardOpen = await startLocal();
            coordinator.reset();
            coordinator.setAdapter(null);
            await coordinator.handleMessage(peerKey, {
                ...guardOpen, sessionId: 'remote-no-adapter', round: 0,
            });
            expect(coordinator.hasActiveSession(peerKey)).toBe(false);

            coordinator.setAdapter(adapter as never);
            connection.wireVersion = 1;
            await coordinator.handleMessage(peerKey, {
                ...guardOpen, sessionId: 'remote-incompatible', round: 0,
            });
            expect(coordinator.hasActiveSession(peerKey)).toBe(false);
            connection.wireVersion = 2;

            const authorizationOpen = await startLocal();
            const activeTransfer = {
                sessionId: authorizationOpen.sessionId,
                windowId: authorizationOpen.windowId,
                round: 0,
            };
            for (const message of [
                {
                    ...activeTransfer, type: 'ops_offer', offerId: 0,
                    ids: [operation.signature.hash],
                },
                {
                    ...activeTransfer, type: 'ops_req', requestId: 0,
                    ids: [operation.signature.hash],
                },
                {
                    ...activeTransfer, type: 'ops_push', requestId: 0, page: 0,
                    hasMore: false, data: [operation],
                },
                { ...activeTransfer, type: 'ops_ack', requestId: 0, page: 0 },
                {
                    ...activeTransfer, type: 'ops_offer', round: 1, offerId: 0,
                    ids: [operation.signature.hash],
                },
                {
                    ...activeTransfer, type: 'ops_req', windowId: 'wrong-window', requestId: 0,
                    ids: [operation.signature.hash],
                },
                {
                    ...activeTransfer, type: 'neg_msg', round: 1, windowId: 'wrong-window',
                    frame: { encoding: 'base64', data: '' },
                },
                { ...activeTransfer, type: 'neg_close', windowId: 'wrong-window', reason: 'complete' },
            ]) {
                await coordinator.handleMessage(peerKey, message as never);
            }
            expect(onProtocolViolation).toHaveBeenCalledTimes(8);
            expect(importPipeline.enqueue).not.toHaveBeenCalled();
            coordinator.reset();
            onProtocolViolation.mockClear();
            mockLogger.warn.mockClear();

            let open: NegOpenMessage;
            failedType = 'neg_close';
            const cappedOpen = await startLocal();
            for (let attempt = 0; attempt < 50 && coordinator.hasActiveSession(peerKey); attempt += 1) {
                const currentOpen = [...sent].reverse().find(message =>
                    message.type === 'neg_open' && message.sessionId === cappedOpen.sessionId
                );
                expect(currentOpen?.type).toBe('neg_open');
                outcomes.push({ nextMsg: new Uint8Array([1]), haveIds: [], needIds: [] });
                await coordinator.handleMessage(peerKey, {
                    type: 'neg_msg', sessionId: cappedOpen.sessionId,
                    windowId: currentOpen?.type === 'neg_open' ? currentOpen.windowId : '',
                    round: coordinator.getExpectedInboundRound(peerKey, 'neg_msg'),
                    frame: { encoding: 'base64', data: '' },
                });
            }
            expect(coordinator.hasActiveSession(peerKey)).toBe(false);
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_close_failed');
            outcomes.splice(0);
            failedType = null;

            open = await startLocal();
            outcomes.push({ nextMsg: new Uint8Array([1]), haveIds: [], needIds: [] });
            failedType = 'neg_msg';
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_msg_failed');

            failedType = 'neg_close';
            open = await startLocal();
            outcomes.push({ nextMsg: null, haveIds: [], needIds: [] });
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_close_failed');

            const filterRetryDelayedIds = importPipeline.filterRetryDelayedIds.bind(importPipeline);
            importPipeline.filterRetryDelayedIds = ids => ({
                eligibleIds: [], pendingIds: ids, capacityDeferredIds: [],
            });
            open = await startLocal();
            outcomes.push({ nextMsg: null, haveIds: [], needIds: [operation.signature.hash] });
            onSessionClosed.mockClear();
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_close_failed');
            importPipeline.filterRetryDelayedIds = filterRetryDelayedIds;
            failedType = null;

            await expect(coordinator.startSession('33'.repeat(32), {
                source: 'connect', initiator: true,
            })).resolves.toBe(false);

            open = await startLocal();
            coordinator.reset();
            failedType = 'neg_msg';
            await openRemote(open, 'remote-frame-failure');
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_msg_failed');

            failedType = null;
            open = await startLocal();
            coordinator.reset();
            let remote = await openRemote(open, 'remote-reopen');
            await coordinator.handleMessage(peerKey, {
                ...open, sessionId: 'remote-reopen', round: remote.round!,
            });
            expect(onProtocolViolation).toHaveBeenLastCalledWith(
                peerKey,
                'neg_open reopens the active window',
                connection,
            );
            await coordinator.handleMessage(peerKey, {
                type: 'ops_ack', sessionId: 'remote-reopen', windowId: open.windowId,
                round: 0, requestId: 0, page: 0,
            });
            coordinator.reset();
            await coordinator.handleMessage(peerKey, {
                ...open, sessionId: 'remote-future', round: 1,
            });
            expect(onProtocolViolation).toHaveBeenLastCalledWith(
                peerKey,
                'neg_open is for a future round',
                connection,
            );
            onProtocolViolation.mockClear();

            open = await startLocal();
            coordinator.reset();
            remote = await openRemote(open, 'remote-offer-send-failure');
            failedType = 'ops_req';
            await coordinator.handleMessage(peerKey, {
                type: 'ops_offer', sessionId: 'remote-offer-send-failure', windowId: open.windowId,
                round: remote.round!, offerId: 0, ids: ['e'.repeat(64)],
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_ops_req_failed');
            failedType = null;

            failedType = 'neg_open';
            expect(await coordinator.startSession(peerKey, {
                source: 'connect', initiator: true,
            })).toBe(false);
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_open_failed');

            failedType = null;
            open = await startLocal();
            outcomes.push({ nextMsg: null, haveIds: [], needIds: [operation.signature.hash] });
            failedType = 'ops_req';
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_ops_req_failed');

            failedType = null;
            open = await startLocal();
            outcomes.push({ nextMsg: null, haveIds: [operation.signature.hash], needIds: [] });
            failedType = 'ops_offer';
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_ops_offer_failed');

            failedType = null;
            open = await startLocal();
            outcomes.push({ nextMsg: null, haveIds: [operation.signature.hash], needIds: [] });
            const offerStart = sent.length;
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            });
            const offer = sent.slice(offerStart).find(message => message.type === 'ops_offer');
            expect(offer?.type).toBe('ops_offer');
            await coordinator.handleMessage(peerKey, {
                type: 'ops_req', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                requestId: 0, offerId: 99, ids: [],
            });
            expect(onProtocolViolation).toHaveBeenLastCalledWith(
                peerKey,
                'ops_req does not match the active offer',
                connection,
            );
            await coordinator.handleMessage(peerKey, {
                type: 'ops_req', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                requestId: 0, offerId: offer?.type === 'ops_offer' ? offer.offerId : 0,
                ids: [], deferred: true,
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'incomplete');
            onProtocolViolation.mockClear();

            open = await startLocal();
            coordinator.reset();
            remote = await openRemote(open, 'remote-capacity');
            const held = operationPages.reserve(512 * 1024)!;
            await coordinator.handleMessage(peerKey, {
                type: 'ops_req', sessionId: 'remote-capacity', windowId: open.windowId,
                round: remote.round!, requestId: 0, ids: [operation.signature.hash],
            });
            held.release();
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'ops_push_output_capacity');

            open = await startLocal();
            coordinator.reset();
            remote = await openRemote(open, 'remote-send');
            failBulk = true;
            await coordinator.handleMessage(peerKey, {
                type: 'ops_req', sessionId: 'remote-send', windowId: open.windowId,
                round: remote.round!, requestId: 0, ids: [operation.signature.hash],
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_ops_push_failed');

            failBulk = false;
            failedType = null;
            open = await startLocal();
            coordinator.reset();
            remote = await openRemote(open, 'remote-offer-lookup');
            jest.spyOn(store, 'getByIds').mockRejectedValueOnce(new Error('lookup failed'));
            await coordinator.handleMessage(peerKey, {
                type: 'ops_offer', sessionId: 'remote-offer-lookup', windowId: open.windowId,
                round: remote.round!, offerId: 0, ids: [operation.signature.hash],
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'ops_offer_lookup_failed');
            mockLogger.warn.mockClear();

            open = await startLocal();
            coordinator.reset();
            remote = await openRemote(open, 'remote-corrupt-record');
            const corruptOperation = { ...operation, mdip: { ...operation.mdip, registry: 'local' } };
            jest.spyOn(store, 'getByIds').mockResolvedValueOnce([{
                id: operation.signature.hash, ts: 1_767_225_600, signedTs: 1_767_225_600,
                insertedAt: 1_767_225_600, syncOrder: 1,
                operation: corruptOperation,
            }]);
            await coordinator.handleMessage(peerKey, {
                type: 'ops_req', sessionId: 'remote-corrupt-record', windowId: open.windowId,
                round: remote.round!, requestId: 0, ids: [operation.signature.hash],
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'ops_push_lookup_failed');
            mockLogger.warn.mockClear();

            open = await startLocal();
            coordinator.reset();
            remote = await openRemote(open, 'remote-mismatched-record');
            jest.spyOn(store, 'getByIds').mockResolvedValueOnce([{
                id: 'f'.repeat(64), ts: 1_767_225_600, signedTs: 1_767_225_600,
                insertedAt: 1_767_225_600, syncOrder: 1, operation,
            }]);
            onSessionClosed.mockClear();
            await coordinator.handleMessage(peerKey, {
                type: 'ops_req', sessionId: 'remote-mismatched-record', windowId: open.windowId,
                round: remote.round!, requestId: 0, ids: [operation.signature.hash],
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'ops_push_lookup_failed');
            mockLogger.warn.mockClear();

            open = await startLocal();
            coordinator.reset();
            remote = await openRemote(open, 'remote-cancelled-offer');
            jest.spyOn(store, 'getByIds').mockImplementationOnce(async () => {
                coordinator.reset();
                return [];
            });
            const cancelledOfferStart = sent.length;
            await coordinator.handleMessage(peerKey, {
                type: 'ops_offer', sessionId: 'remote-cancelled-offer', windowId: open.windowId,
                round: remote.round!, offerId: 0, ids: ['d'.repeat(64)],
            });
            expect(coordinator.hasActiveSession(peerKey)).toBe(false);
            expect(sent.slice(cancelledOfferStart)).not.toContainEqual(expect.objectContaining({ type: 'ops_req' }));

            open = await startLocal();
            coordinator.reset();
            remote = await openRemote(open, 'remote-ack');
            const pushStart = sent.length;
            const directRequest = {
                type: 'ops_req' as const,
                sessionId: 'remote-ack', windowId: open.windowId,
                round: remote.round!, requestId: 0, ids: [operation.signature.hash],
            };
            await coordinator.handleMessage(peerKey, directRequest);
            await coordinator.handleMessage(peerKey, directRequest);
            expect(onProtocolViolation).toHaveBeenLastCalledWith(
                peerKey,
                'invalid or overlapping ops_req',
                connection,
            );
            const pushed = sent.slice(pushStart).find(message => message.type === 'ops_push');
            expect(pushed?.type).toBe('ops_push');
            await coordinator.handleMessage(peerKey, {
                type: 'ops_ack', sessionId: 'remote-ack', windowId: open.windowId,
                round: remote.round!, requestId: 1, page: 0,
            });
            expect(onProtocolViolation).toHaveBeenLastCalledWith(
                peerKey,
                'ops_ack does not match the outstanding page',
                connection,
            );
            await coordinator.handleMessage(peerKey, {
                type: 'ops_ack', sessionId: 'remote-ack', windowId: open.windowId,
                round: remote.round!, requestId: pushed?.type === 'ops_push' ? pushed.requestId : 0,
                page: pushed?.type === 'ops_push' ? pushed.page : 0,
            });
            expect(coordinator.hasActiveSession(peerKey)).toBe(true);
            coordinator.reset();
            onProtocolViolation.mockClear();

            const largeOperations = [1, 2].map(index => {
                const largeUnsigned = {
                    ...unsigned,
                    created: `2026-01-0${index + 3}T00:00:00.000Z`,
                };
                return {
                    ...largeUnsigned,
                    signature: {
                        hash: cipher.hashJSON(largeUnsigned),
                        signed: largeUnsigned.created,
                        value: 'x'.repeat(300 * 1024),
                    },
                };
            });
            await store.upsertMany(largeOperations.map((item, index) => ({
                id: item.signature.hash,
                ts: 1_767_225_700 + index,
                syncOrder: 2 + index,
                operation: item,
            })));
            open = await startLocal();
            coordinator.reset();
            remote = await openRemote(open, 'remote-page-lookup');
            const pagedPushStart = sent.length;
            await coordinator.handleMessage(peerKey, {
                type: 'ops_req', sessionId: 'remote-page-lookup', windowId: open.windowId,
                round: remote.round!, requestId: 0,
                ids: largeOperations.map(item => item.signature.hash),
            });
            const firstLargePage = sent.slice(pagedPushStart).find(message => message.type === 'ops_push');
            expect(firstLargePage).toMatchObject({ type: 'ops_push', page: 0, hasMore: true });
            jest.spyOn(store, 'getByIds').mockRejectedValueOnce(new Error('next page failed'));
            await coordinator.handleMessage(peerKey, {
                type: 'ops_ack', sessionId: 'remote-page-lookup', windowId: open.windowId,
                round: remote.round!, requestId: 0, page: 0,
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'ops_push_lookup_failed');
            mockLogger.warn.mockClear();

            let requested = await requestOperation('invalid-push');
            const pushMessage = {
                type: 'ops_push' as const,
                sessionId: requested.request.sessionId!,
                windowId: requested.request.windowId!,
                round: requested.request.round!,
                requestId: requested.request.type === 'ops_req' ? requested.request.requestId : 0,
                page: 0,
                hasMore: false,
            };
            const forged = { ...operation, mdip: { ...operation.mdip, registry: 'local' } };
            await coordinator.handleMessage(peerKey, { ...pushMessage, data: [forged] });
            await coordinator.handleMessage(peerKey, { ...pushMessage, data: [operation, operation] });
            const otherUnsigned = { ...unsigned, created: '2026-01-02T00:00:00.000Z' };
            const unsolicited = { ...otherUnsigned, signature: {
                hash: cipher.hashJSON(otherUnsigned), signed: otherUnsigned.created, value: 'signature',
            } };
            await coordinator.handleMessage(peerKey, { ...pushMessage, data: [unsolicited] });
            await coordinator.handleMessage(peerKey, { ...pushMessage, hasMore: true, data: [operation] });
            await coordinator.handleMessage(peerKey, { ...pushMessage, data: [] });
            expect(onProtocolViolation).toHaveBeenCalledTimes(4);
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'missing_requested_operations');
            onProtocolViolation.mockClear();

            const terminalUnsigned = { ...unsigned, created: '2026-01-03T00:00:00.000Z' };
            const terminalOperation = { ...terminalUnsigned, signature: {
                hash: cipher.hashJSON(terminalUnsigned),
                signed: terminalUnsigned.created,
                value: 'signature',
            } };
            requested = await requestOperation('terminal-retry', terminalOperation);
            const emptyImport = {
                knownIds: [], persistedIds: [], pendingIds: [], capacityDeferredIds: [],
                acceptedOperations: [], portableTerminalOperations: [], unaddressableOperations: [],
                retryable: false,
            };
            (importPipeline.enqueue as jest.MockedFunction<ImportPipeline['enqueue']>)
                .mockResolvedValueOnce(emptyImport)
                .mockResolvedValueOnce({ ...emptyImport, retryable: true });
            failedType = 'neg_close';
            await coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId: requested.request.sessionId!,
                windowId: requested.request.windowId!, round: requested.request.round!,
                requestId: requested.request.type === 'ops_req' ? requested.request.requestId : 0,
                page: 0, hasMore: false, data: [terminalOperation],
            });
            expect(importPipeline.enqueue).toHaveBeenLastCalledWith(expect.objectContaining({
                kind: 'terminal', data: [terminalOperation],
            }));
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_close_failed');
            failedType = null;

            requested = await requestOperation('refresh-failure', terminalOperation);
            (importPipeline.enqueue as jest.MockedFunction<ImportPipeline['enqueue']>)
                .mockResolvedValueOnce(emptyImport);
            jest.spyOn(store, 'getByIds').mockRejectedValueOnce(new Error('refresh failed'));
            mockLogger.warn.mockClear();
            await coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId: requested.request.sessionId!,
                windowId: requested.request.windowId!, round: requested.request.round!,
                requestId: requested.request.type === 'ops_req' ? requested.request.requestId : 0,
                page: 0, hasMore: false, data: [terminalOperation],
            });
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.objectContaining({ error: expect.any(Error), unresolved: 1 }),
                'failed to confirm unresolved negentropy operations',
            );
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'unresolved_operations');
            mockLogger.warn.mockClear();

            requested = await requestOperation('cancelled-terminal', terminalOperation);
            (importPipeline.enqueue as jest.MockedFunction<ImportPipeline['enqueue']>)
                .mockResolvedValueOnce(emptyImport)
                .mockImplementationOnce(async () => {
                    coordinator.reset();
                    return emptyImport;
                });
            await coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId: requested.request.sessionId!,
                windowId: requested.request.windowId!, round: requested.request.round!,
                requestId: requested.request.type === 'ops_req' ? requested.request.requestId : 0,
                page: 0, hasMore: false, data: [terminalOperation],
            });
            expect(coordinator.hasActiveSession(peerKey)).toBe(false);
            expect(importPipeline.enqueue).toHaveBeenLastCalledWith(expect.objectContaining({
                kind: 'terminal', data: [terminalOperation],
            }));

            open = await startLocal();
            coordinator.reset();
            remote = await openRemote(open, 'remote-unresolved-complete');
            const unresolvedOfferStart = sent.length;
            await coordinator.handleMessage(peerKey, {
                type: 'ops_offer', sessionId: 'remote-unresolved-complete', windowId: open.windowId,
                round: remote.round!, offerId: 0, ids: [terminalOperation.signature.hash],
            });
            const unresolvedRequest = sent.slice(unresolvedOfferStart)
                .find(message => message.type === 'ops_req');
            expect(unresolvedRequest?.type).toBe('ops_req');
            (importPipeline.enqueue as jest.MockedFunction<ImportPipeline['enqueue']>)
                .mockResolvedValueOnce(emptyImport)
                .mockResolvedValueOnce(emptyImport);
            await coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId: 'remote-unresolved-complete', windowId: open.windowId,
                round: remote.round!,
                requestId: unresolvedRequest?.type === 'ops_req' ? unresolvedRequest.requestId : 0,
                page: 0, hasMore: false, data: [terminalOperation],
            });
            terminatePeerConnection.mockClear();
            await coordinator.handleMessage(peerKey, {
                type: 'neg_close', sessionId: 'remote-unresolved-complete', windowId: open.windowId,
                round: remote.round!, reason: 'complete',
            });
            expect(terminatePeerConnection).toHaveBeenCalledWith(peerKey, 'unresolved_operations');

            coordinator.reset();
            mockLogger.warn.mockClear();
            open = await startLocal();
            coordinator.reset();
            remote = await openRemote(open, 'remote-incomplete-close');
            const originalFilterRetryDelayedIds = importPipeline.filterRetryDelayedIds.bind(importPipeline);
            importPipeline.filterRetryDelayedIds = ids => ({
                eligibleIds: [], pendingIds: [], capacityDeferredIds: ids,
            });
            await coordinator.handleMessage(peerKey, {
                type: 'ops_offer', sessionId: 'remote-incomplete-close', windowId: open.windowId,
                round: remote.round!, offerId: 0, ids: ['c'.repeat(64)],
            });
            failedType = 'neg_close';
            onSessionClosed.mockClear();
            await coordinator.handleMessage(peerKey, {
                type: 'neg_close', sessionId: 'remote-incomplete-close', windowId: open.windowId,
                round: remote.round!, reason: 'complete',
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_close_failed');
            importPipeline.filterRetryDelayedIds = originalFilterRetryDelayedIds;
            failedType = null;

            await startLocal();
            const callbackError = new Error('synchronous close callback failed');
            onSessionClosed.mockImplementationOnce(() => {
                throw callbackError;
            });
            mockLogger.error.mockClear();
            coordinator.reset('test_reset');
            await Promise.resolve();
            expect(mockLogger.error).toHaveBeenCalledWith(
                { error: callbackError, peer: '2222-2222', reason: 'test_reset' },
                'negentropy session-close callback failed',
            );

            const latestTimestamp = jest.spyOn(store, 'getLatestSignedTimestamp');
            latestTimestamp.mockImplementationOnce(async () => {
                coordinator.reset();
                return null;
            });
            await expect(coordinator.startSession(peerKey, {
                source: 'connect', initiator: true,
            })).resolves.toBe(false);

            latestTimestamp.mockImplementationOnce(async () => {
                pipelineAvailable = false;
                return null;
            });
            onSessionClosed.mockClear();
            await expect(coordinator.startSession(peerKey, {
                source: 'connect', initiator: true,
            })).resolves.toBe(false);
            expect(onSessionClosed).toHaveBeenCalledTimes(1);
            expect(onSessionClosed).toHaveBeenCalledWith(peerKey, 'gatekeeper_processing_unavailable');
            pipelineAvailable = true;

            requested = await requestOperation('capacity-push');
            const inboundHeld = operationPages.reserve(512 * 1024)!;
            await coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId: requested.request.sessionId!,
                windowId: requested.request.windowId!, round: requested.request.round!,
                requestId: requested.request.type === 'ops_req' ? requested.request.requestId : 0,
                page: 0, hasMore: false, data: [operation],
            });
            inboundHeld.release();
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'ops_push_import_capacity');

            requested = await requestOperation('missing-push');
            failedType = 'neg_close';
            await coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId: requested.request.sessionId!,
                windowId: requested.request.windowId!, round: requested.request.round!,
                requestId: requested.request.type === 'ops_req' ? requested.request.requestId : 0,
                page: 0, hasMore: false, data: [],
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_close_failed');

            failedType = null;
            requested = await requestOperation('ack-push');
            failedType = 'ops_ack';
            await coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId: requested.request.sessionId!,
                windowId: requested.request.windowId!, round: requested.request.round!,
                requestId: requested.request.type === 'ops_req' ? requested.request.requestId : 0,
                page: 0, hasMore: false, data: [operation],
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_ops_ack_failed');
            expect(coordinator.getActiveSessionCount()).toBe(0);

            failedType = null;
            open = await startLocal();
            outcomes.push({
                nextMsg: null,
                haveIds: Array.from({ length: 17 }, (_, index) => index.toString(16).padStart(64, '0')),
                needIds: [],
            });
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            });
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'negentropy_outcome_exceeds_window');

            const normalFilterRetryDelayedIds = importPipeline.filterRetryDelayedIds.bind(importPipeline);
            importPipeline.filterRetryDelayedIds = ids => ({
                eligibleIds: [], pendingIds: [], capacityDeferredIds: ids,
            });
            open = await startLocal();
            outcomes.push({
                nextMsg: new Uint8Array([1]), haveIds: [], needIds: ['e'.repeat(64)],
            });
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            });
            failedType = 'neg_close';
            await coordinator.handleMessage(peerKey, {
                type: 'neg_close', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                reason: 'max_rounds_reached',
            });
            expect(sendToPeer).toHaveBeenLastCalledWith(
                peerKey,
                expect.objectContaining({ type: 'neg_close', reason: 'incomplete' }),
            );
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_close_failed');

            failedType = null;
            open = await startLocal();
            for (let round = 1; round <= 8; round += 1) {
                outcomes.push({
                    nextMsg: new Uint8Array([round]),
                    haveIds: [],
                    needIds: round === 1 ? ['a'.repeat(64)] : [],
                });
                await coordinator.handleMessage(peerKey, {
                    type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round,
                    frame: { encoding: 'base64', data: '' },
                });
            }
            failedType = 'neg_close';
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 9,
                frame: { encoding: 'base64', data: '' },
            });
            expect(sendToPeer).toHaveBeenLastCalledWith(
                peerKey,
                expect.objectContaining({ type: 'neg_close', reason: 'incomplete' }),
            );
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_close_failed');
            failedType = null;
            importPipeline.filterRetryDelayedIds = normalFilterRetryDelayedIds;

            const unresolvedOperations = Array.from({ length: 5 }, (_, index) => {
                const unresolvedUnsigned = {
                    ...unsigned,
                    created: `2026-01-${String(index + 10).padStart(2, '0')}T00:00:00.000Z`,
                };
                return {
                    ...unresolvedUnsigned,
                    signature: {
                        hash: cipher.hashJSON(unresolvedUnsigned),
                        signed: unresolvedUnsigned.created,
                        value: 'x'.repeat(430 * 1024),
                    },
                };
            });
            open = await startLocal();
            outcomes.push({
                nextMsg: null,
                haveIds: [],
                needIds: unresolvedOperations.map(item => item.signature.hash),
            });
            const unresolvedRequestStart = sent.length;
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            });
            const unresolvedBudgetRequest = sent.slice(unresolvedRequestStart)
                .find(message => message.type === 'ops_req');
            expect(unresolvedBudgetRequest?.type).toBe('ops_req');
            (importPipeline.enqueue as jest.MockedFunction<ImportPipeline['enqueue']>)
                .mockResolvedValue(emptyImport);
            for (const [page, unresolvedOperation] of unresolvedOperations.entries()) {
                if (page === unresolvedOperations.length - 1) {
                    failedType = 'neg_close';
                }
                await coordinator.handleMessage(peerKey, {
                    type: 'ops_push', sessionId: open.sessionId, windowId: open.windowId,
                    round: 1,
                    requestId: unresolvedBudgetRequest?.type === 'ops_req'
                        ? unresolvedBudgetRequest.requestId
                        : 0,
                    page, hasMore: page < unresolvedOperations.length - 1,
                    data: [unresolvedOperation],
                });
            }
            expect(sendToPeer).toHaveBeenLastCalledWith(
                peerKey,
                expect.objectContaining({ type: 'neg_close', reason: 'unresolved_limit_exceeded' }),
            );
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'send_neg_close_failed');
            expect(coordinator.getActiveSessionCount()).toBe(0);
            failedType = null;

            coordinator.setAdapter(null);
            await expect(coordinator.startSession(peerKey, {
                source: 'connect', initiator: true,
            })).rejects.toThrow('negentropy adapter unavailable');
            coordinator.setAdapter(adapter as never);

            open = await startLocal();
            coordinator.setAdapter(null);
            await expect(coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            })).rejects.toThrow('negentropy adapter unavailable');
            coordinator.reset();
            coordinator.setAdapter(adapter as never);
        }
        finally {
            await coordinator.shutdown();
            await coordinator.shutdown();
            await expect(coordinator.startSession(peerKey, {
                source: 'connect', initiator: true,
            })).resolves.toBe(false);
            await coordinator.handleMessage(peerKey, {
                type: 'neg_close', sessionId: 'closed', windowId: 'closed', round: 0,
                reason: 'complete',
            });
            await coordinator.handleIndexRefreshed('closed', {
                mode: 'changes', inserted: 1, updated: 0, deleted: 0,
            } as never);
            await store.stop();
        }
    });

    it('filters retry-delayed IDs from direct needs and offered requests', async () => {
        const [
            { createNegentropyCoordinator }, { default: InMemoryOperationSyncStore },
            { createConnectionInfo }, { createMediatorSyncStats },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/negentropy-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/db/memory.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
        ]);
        const eligibleId = 'a'.repeat(64);
        const pendingId = 'b'.repeat(64);
        const capacityId = 'c'.repeat(64);
        const delayed = new Map([
            [pendingId, 'pending' as const],
            [capacityId, 'capacity' as const],
        ]);
        const outcomes = [
            { nextMsg: null, haveIds: [], needIds: [eligibleId, pendingId, capacityId] },
            { nextMsg: null, haveIds: [], needIds: [pendingId, capacityId] },
            { nextMsg: null, haveIds: [], needIds: [pendingId] },
            { nextMsg: null, haveIds: [], needIds: [] },
            { nextMsg: null, haveIds: [], needIds: [] },
        ];
        const peerKey = '22'.repeat(32);
        const connection = createConnectionInfo({
            connection: { write() {}, destroy() {}, remotePublicKey: Buffer.from(peerKey, 'hex') } as never,
            peerName: 'test-peer',
        });
        connection.capabilities = normalizePeerCapabilities();
        connection.wireVersion = 2;
        const store = new InMemoryOperationSyncStore();
        await store.start();
        const importPipeline = {
            available: true, recovering: false, queued: 0, running: 0,
            filterRetryDelayedIds(ids: string[]) {
                return {
                    eligibleIds: ids.filter(id => !delayed.has(id)),
                    pendingIds: ids.filter(id => delayed.get(id) === 'pending'),
                    capacityDeferredIds: ids.filter(id => delayed.get(id) === 'capacity'),
                };
            },
        } as unknown as ImportPipeline;
        const adapter = {
            async buildSnapshotForWindow(window: ReconciliationWindow) {
                return {
                    window,
                    storage: {} as never,
                    stats: {
                        loaded: 0, skipped: 0, durationMs: 0, frameSizeLimit: 0,
                        windowName: window.name, fromTs: window.fromTs, toTs: window.toTs,
                        rounds: 0, completed: false, cappedByRecords: false, cappedByRounds: false,
                    },
                };
            },
            createEngineForSnapshot() {
                return {
                    initiate: async () => new Uint8Array(),
                    reconcile: async () => outcomes.shift()!,
                };
            },
        };
        const sendToPeer = jest.fn<Parameters<typeof createNegentropyCoordinator>[0]['sendToPeer']>(() => true);
        const coordinator = createNegentropyCoordinator({
            wireVersion: 2, frameSizeLimit: 0,
            maxRecordsPerWindow: 16, maxRoundsPerSession: 8, maxIdsPerRequest: 1_000,
            maxIdsPerLookup: 1_000, maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024,
            idleTimeoutMs: 120_000, repairIntervalMs: 60_000,
            syncStore: store, importPipeline, syncStats: createMediatorSyncStats(),
            cipher: new CipherNode(), bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getConnection: key => key === peerKey ? connection : undefined,
            createSessionId: () => 'local-session',
            createBaseMessage: type => ({ type }),
            sendToPeer, sendBulkToPeer: async () => true,
            canStartBackgroundPrebuild: () => false, terminatePeerConnection: () => undefined,
            onProtocolViolation: jest.fn(), onSessionClosed: async () => {}, onIndexRefreshed: async () => {},
        });
        coordinator.setAdapter(adapter as never);

        async function runDirectNeed(): Promise<Record<string, unknown> & { sessionId: string; windowId: string }> {
            await coordinator.startSession(peerKey, {
                source: 'connect', initiator: true,
            });
            const open = sendToPeer.mock.calls.at(-1)?.[1] as unknown as Record<string, unknown>
                & { sessionId: string; windowId: string };
            await coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: open.sessionId, windowId: open.windowId, round: 1,
                frame: { encoding: 'base64', data: '' },
            });
            return open;
        }

        try {
            await runDirectNeed();
            expect(sendToPeer.mock.calls.at(-1)?.[1]).toMatchObject({
                type: 'ops_req', ids: [eligibleId],
            });

            coordinator.reset();
            const requestsBefore = sendToPeer.mock.calls.filter(([, message]) => message.type === 'ops_req').length;
            await runDirectNeed();
            expect(sendToPeer.mock.calls.filter(([, message]) => message.type === 'ops_req')).toHaveLength(requestsBefore);
            expect(sendToPeer.mock.calls.at(-1)?.[1]).toMatchObject({ type: 'neg_close', reason: 'incomplete' });

            delayed.delete(pendingId);
            await runDirectNeed();
            expect(sendToPeer.mock.calls.at(-1)?.[1]).toMatchObject({ type: 'ops_req', ids: [pendingId] });

            coordinator.reset();
            const localOpen = sendToPeer.mock.calls.find(([, message]) => message.type === 'neg_open')?.[1];
            await coordinator.handleMessage(peerKey, {
                ...(localOpen as object), type: 'neg_open', sessionId: 'remote-mixed', round: 0,
            } as never);
            await coordinator.handleMessage(peerKey, {
                type: 'ops_offer', sessionId: 'remote-mixed',
                windowId: (localOpen as { windowId: string }).windowId, round: 1, offerId: 0,
                ids: [eligibleId, pendingId, capacityId],
            });
            expect(sendToPeer.mock.calls.at(-1)?.[1]).toMatchObject({
                type: 'ops_req', offerId: 0, ids: [eligibleId, pendingId], deferred: true,
            });

            coordinator.reset();
            await coordinator.handleMessage(peerKey, {
                ...(localOpen as object), type: 'neg_open', sessionId: 'remote-delayed', round: 0,
            } as never);
            await coordinator.handleMessage(peerKey, {
                type: 'ops_offer', sessionId: 'remote-delayed',
                windowId: (localOpen as { windowId: string }).windowId, round: 1, offerId: 0,
                ids: [capacityId],
            });
            expect(sendToPeer.mock.calls.at(-1)?.[1]).toMatchObject({
                type: 'ops_req', offerId: 0, ids: [], deferred: true,
            });
        }
        finally {
            await coordinator.shutdown();
            await store.stop();
        }
    });

    it('repairs skipped gossip through another peer after recovery even when this node normally responds', async () => {
        const [
            { createPeerSyncCoordinator }, { createConnectionInfo },
            { normalizePeerCapabilities }, { createMediatorSyncStats },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/peer-sync-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/negentropy/protocol.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
        ]);
        const peers = ['11'.repeat(32), '22'.repeat(32)];
        const connections = new Map(peers.map(peerKey => {
            const conn = createConnectionInfo({
                connection: { write() {}, destroy() {}, remotePublicKey: Buffer.from(peerKey, 'hex') } as never,
                peerName: peerKey,
            });
            conn.capabilities = normalizePeerCapabilities();
            conn.wireVersion = 2;
            conn.initialPingReceived = true;
            conn.syncStarted = true;
            conn.negentropySynced = true;
            conn.orderedCatchupAttempted = true;
            return [peerKey, conn];
        }));
        let activePeer: string | null = peers[0];
        const startSession = jest.fn(async (peerKey: string) => { activePeer = peerKey; return true; });
        const reset = jest.fn(() => { activePeer = null; });
        const coordinator = createPeerSyncCoordinator({
            wireVersion: 2,
            windowSize: 25_000, repairIntervalMs: 300_000, syncStats: createMediatorSyncStats(),
            getNodeKey: () => 'ff'.repeat(32), getPeerKeys: () => [...connections.keys()],
            getConnection: key => connections.get(key),
            getImportPipeline: () => ({ available: true, queued: 0, running: 0 } as ImportPipeline),
            getSyncStore: () => ({ count: async () => 99 } as never),
            getNegentropyCoordinator: () => ({
                getActiveSessionCount: () => activePeer ? 1 : 0, hasActiveSession: (key: string) => key === activePeer,
                startSession, reset, handleIndexRefreshed: async () => {},
                removePeer: (key: string) => { if (activePeer === key) activePeer = null; },
            } as never),
            getOrderedCatchupCoordinator: () => ({
                hasActiveOutbound: () => false, hasActiveForPeer: () => false,
                expireServerExpectation() {}, removePeer() {}, finishTransition() {},
            } as never),
            waitForInitialPing: async () => true, onPeersAdvertised() {},
        });
        const sync = {
            countBefore: 99, countAfter: 99, mode: 'changes' as const, pages: 1,
            exported: 0, mapped: 0, invalid: 0, inserted: 0, updated: 0, deleted: 0,
            snapshotComplete: true, durationMs: 0,
        };
        try {
            await coordinator.handleIndexRefreshed('recovery', { ...sync, processingRecoveryGeneration: 2 });
            expect(reset).toHaveBeenCalledWith('gatekeeper_processing_unavailable');
            expect(startSession).toHaveBeenCalledWith(peers[0], expect.objectContaining({ initiator: true }));
            expect(connections.get(peers[0])!.negentropySynced).toBe(false);
            await coordinator.handleIndexRefreshed('late-older-refresh', { ...sync, processingRecoveryGeneration: 1 });
            expect(reset).toHaveBeenCalledTimes(1);
            connections.delete(peers[0]);
            coordinator.handleDisconnected(peers[0], 'disconnect');
            await coordinator.schedulePreferredSyncs();
            expect(startSession).toHaveBeenLastCalledWith(peers[1], expect.objectContaining({ initiator: true }));
            expect(startSession).toHaveBeenCalledTimes(2);
            activePeer = null;
            connections.get(peers[1])!.negentropySynced = true;
            await coordinator.handleNegentropySessionClosed(peers[1], 'complete');
            await coordinator.runPeriodicRepairs();
            expect(startSession).toHaveBeenCalledTimes(2);
        } finally { await coordinator.shutdown(); }
    });

    it.each(['unavailable', 'storage', 'accepted'] as const)('handles the %s recovery mirror outcome using accepted inventory', async outcome => {
        const [
            { createNegentropyCoordinator }, { default: InMemoryOperationSyncStore },
            { createConnectionInfo }, { createMediatorSyncStats },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/negentropy-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/db/memory.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
        ]);
        const peerKey = '22'.repeat(32);
        const connection = createConnectionInfo({
            connection: { write() {}, destroy() {}, remotePublicKey: Buffer.from(peerKey, 'hex') } as never,
            peerName: 'test-peer',
        });
        connection.capabilities = normalizePeerCapabilities();
        connection.wireVersion = 2;
        const store = new InMemoryOperationSyncStore();
        const cipher = new CipherNode();
        const unsigned = {
            type: 'create' as const,
            created: '2026-01-01T00:00:00.000Z',
            mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
        };
        const operation = { ...unsigned, signature: {
            hash: cipher.hashJSON(unsigned), signed: unsigned.created, value: 'signature',
        } };
        const lookup = jest.spyOn(store, 'getByIds');
        const failure = outcome === 'unavailable'
            ? Object.assign(new Error('Gatekeeper processing is unavailable'), { code: 'gatekeeper_processing_unavailable' })
            : new Error('sync-store unavailable');
        const importPipeline = {
            available: true, recovering: false, queued: 0, running: 0, indexEpoch: 'epoch',
            enqueue: async () => ({
                knownIds: [], persistedIds: [], pendingIds: [], capacityDeferredIds: [],
                retryable: false, indexRefreshRequired: true,
            }),
            filterRetryDelayedIds: (ids: string[]) => ({ eligibleIds: ids, pendingIds: [], capacityDeferredIds: [] }),
            refreshIndex: async () => {
                if (outcome !== 'accepted') throw failure;
                await store.upsertMany([{ id: operation.signature.hash, ts: 1_767_225_600, syncOrder: 1, operation }]);
                return {
                    mode: 'changes', countBefore: 0, countAfter: 1, pages: 1, exported: 1, mapped: 1,
                    invalid: 0, inserted: 1, updated: 0, deleted: 0, snapshotComplete: true, durationMs: 0,
                };
            },
        } as unknown as ImportPipeline;
        const sendToPeer = jest.fn<Parameters<typeof createNegentropyCoordinator>[0]['sendToPeer']>(() => true);
        const onIndexRefreshed = jest.fn(async () => {});
        const onSessionClosed = jest.fn(async () => {});
        const terminatePeerConnection = jest.fn();
        const coordinator = createNegentropyCoordinator({
            wireVersion: 2, frameSizeLimit: 0, maxRecordsPerWindow: 16,
            maxRoundsPerSession: 8, maxIdsPerRequest: 1_000, maxIdsPerLookup: 1_000,
            maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024, idleTimeoutMs: 120_000,
            repairIntervalMs: 60_000,
            syncStore: store, importPipeline, syncStats: createMediatorSyncStats(), cipher,
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getConnection: () => connection,
            createSessionId: () => 'session', createBaseMessage: type => ({ type }),
            sendToPeer, sendBulkToPeer: async (key, message) => sendToPeer(key, message),
            canStartBackgroundPrebuild: () => false, terminatePeerConnection,
            onProtocolViolation: jest.fn(), onSessionClosed, onIndexRefreshed,
        });
        try {
            await coordinator.initializeAdapter();
            await coordinator.startSession(peerKey, { source: 'connect', initiator: true });
            const open = sendToPeer.mock.calls[0]?.[1] as NegOpenMessage;
            coordinator.reset();
            const sessionId = 'remote-session';
            await coordinator.handleMessage(peerKey, {
                ...(sendToPeer.mock.calls[0]?.[1] as unknown as Record<string, unknown>),
                type: 'neg_open', sessionId,
            } as never);
            onSessionClosed.mockClear();
            const round = (sendToPeer.mock.calls.at(-1)?.[1] as { round: number }).round;
            await coordinator.handleMessage(peerKey, {
                type: 'ops_offer', sessionId, windowId: open.windowId, round, offerId: 0, ids: [operation.signature.hash],
            });
            const request = sendToPeer.mock.calls.at(-1)?.[1] as { requestId: number };
            mockLogger.error.mockClear();
            await coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId, windowId: open.windowId, round,
                requestId: request.requestId, page: 0, hasMore: false, data: [operation],
            });
            if (outcome === 'accepted') {
                expect(onIndexRefreshed).toHaveBeenCalledWith('negentropy_processing_recovery', expect.objectContaining({ inserted: 1 }));
                expect(lookup).toHaveBeenCalledWith([operation.signature.hash]);
                expect(coordinator.hasActiveSession(peerKey)).toBe(true);
                expect(onSessionClosed).not.toHaveBeenCalled();
                expect(mockLogger.error).not.toHaveBeenCalled();
            }
            else {
                expect(onSessionClosed).toHaveBeenCalledWith(peerKey, 'gatekeeper_processing_unavailable');
                expect(onIndexRefreshed).not.toHaveBeenCalled();
                if (outcome === 'unavailable') expect(mockLogger.error).not.toHaveBeenCalled();
                else expect(mockLogger.error).toHaveBeenCalledWith(
                    expect.objectContaining({ err: failure }), 'Failed to mirror Gatekeeper processing recovery',
                );
            }
            expect(terminatePeerConnection).not.toHaveBeenCalled();
        } finally { await coordinator.shutdown(); }
    });

    it('waits for mirror recovery before scheduling peers after a reset cancellation', async () => {
        const { createPeerSyncCoordinator } = await import('../../services/mediators/hyperswarm/src/peer-sync-coordinator.ts');
        const finishTransition = jest.fn();
        const getPeerKeys = jest.fn(() => []);
        const coordinator = createPeerSyncCoordinator({
            getOrderedCatchupCoordinator: () => ({ finishTransition }),
            getNegentropyCoordinator: () => ({ getActiveSessionCount: () => 0 }),
            getPeerKeys,
        } as unknown as Parameters<typeof createPeerSyncCoordinator>[0]);
        await coordinator.handleNegentropySessionClosed('peer', 'gatekeeper_reset');
        expect(finishTransition).toHaveBeenCalledWith('peer');
        expect(getPeerKeys).not.toHaveBeenCalled();
        await coordinator.handleNegentropySessionClosed('peer', 'complete');
        expect(getPeerKeys).toHaveBeenCalledTimes(1);
        await coordinator.shutdown();
    });

    it.each([
        { phase: 'remote', reason: 'gatekeeper_reset', indexEpochChanged: true },
        { phase: 'terminal', reason: 'gatekeeper_reset', indexEpochChanged: true },
        { phase: 'remote', reason: 'gatekeeper_processing_unavailable', indexEpochChanged: false },
        { phase: 'terminal', reason: 'gatekeeper_processing_unavailable', indexEpochChanged: false },
    ])('closes $phase imports interrupted by $reason without blaming the peer', async ({ phase, reason, indexEpochChanged }) => {
        const [
            { createNegentropyCoordinator },
            { default: InMemoryOperationSyncStore },
            { createConnectionInfo },
            { createMediatorSyncStats },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/negentropy-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/db/memory.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
        ]);
        const peerKey = '22'.repeat(32);
        const connection = createConnectionInfo({
            connection: { write() {}, destroy() {}, remotePublicKey: Buffer.from(peerKey, 'hex') } as never,
            peerName: 'test-peer',
        });
        connection.capabilities = normalizePeerCapabilities();
        connection.wireVersion = 2;
        const store = new InMemoryOperationSyncStore();
        let releaseImport!: () => void;
        const held = new Promise<void>(resolve => { releaseImport = resolve; });
        const enqueue = jest.fn<ImportPipeline['enqueue']>(async request => {
            const base = {
                knownIds: [], persistedIds: [], pendingIds: [], capacityDeferredIds: [],
                acceptedOperations: [], portableTerminalOperations: [], unaddressableOperations: [],
            };
            if (request.kind !== phase) return { ...base, retryable: false };
            if (phase === 'remote') await held;
            return { ...base, retryable: true,
                indexEpochChanged, dependencyUnavailable: !indexEpochChanged };
        });
        let recovering = phase === 'remote';
        const importPipeline = {
            available: true, get recovering() { return recovering; }, queued: 0, running: 0, indexEpoch: 'old-epoch', enqueue,
            filterRetryDelayedIds: (ids: string[]) => ({ eligibleIds: ids, pendingIds: [], capacityDeferredIds: [] }),
        } as unknown as ImportPipeline;
        const sendToPeer = jest.fn<Parameters<typeof createNegentropyCoordinator>[0]['sendToPeer']>(() => true);
        const onSessionClosed = jest.fn(async () => undefined);
        const terminatePeerConnection = jest.fn();
        const cipher = new CipherNode();
        const unsigned = {
            type: 'create' as const,
            created: '2026-01-01T00:00:00.000Z',
            mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
        };
        const operation = { ...unsigned, signature: {
            hash: cipher.hashJSON(unsigned), signed: unsigned.created, value: 'signature',
        } };
        const coordinator = createNegentropyCoordinator({
            wireVersion: 2, frameSizeLimit: 0,
            maxRecordsPerWindow: 16, maxRoundsPerSession: 8, maxIdsPerRequest: 1_000,
            maxIdsPerLookup: 1_000, maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024,
            idleTimeoutMs: 120_000, syncStore: store, importPipeline, syncStats: createMediatorSyncStats(), cipher,
            repairIntervalMs: 60_000,
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getConnection: key => key === peerKey ? connection : undefined,
            createSessionId: () => 'reset-session',
            createBaseMessage: type => ({ type }),
            sendToPeer, sendBulkToPeer: async (key, message) => sendToPeer(key, message),
            canStartBackgroundPrebuild: () => false, terminatePeerConnection,
            onProtocolViolation: jest.fn(), onSessionClosed,
            onIndexRefreshed: async () => {},
        });
        try {
            await coordinator.initializeAdapter();
            await coordinator.startSession(peerKey, { source: 'connect', initiator: true });
            const open = sendToPeer.mock.calls[0]?.[1] as { windowId: string };
            coordinator.reset();
            const sessionId = 'remote-reset-session';
            await coordinator.handleMessage(peerKey, {
                ...(sendToPeer.mock.calls[0]?.[1] as unknown as Record<string, unknown>),
                type: 'neg_open', sessionId,
            } as never);
            const round = (sendToPeer.mock.calls.at(-1)?.[1] as { round: number }).round;
            await coordinator.handleMessage(peerKey, {
                type: 'ops_offer', sessionId, windowId: open.windowId, round, offerId: 0, ids: [operation.signature.hash],
            });
            const request = sendToPeer.mock.calls.at(-1)?.[1] as { requestId: number };
            mockLogger.warn.mockClear();
            const push = coordinator.handleMessage(peerKey, {
                type: 'ops_push', sessionId, windowId: open.windowId, round,
                requestId: request.requestId, page: 0, hasMore: false,
                data: [operation],
            });
            if (phase === 'remote') {
                await new Promise<void>(resolve => setImmediate(resolve));
                const resumedAt = Date.now() + 121_000;
                coordinator.expire(resumedAt);
                recovering = false;
                coordinator.expire(resumedAt + 1);
                expect(coordinator.hasActiveSession(peerKey)).toBe(true);
                await coordinator.handleMessage(peerKey, {
                    type: 'neg_close', sessionId, windowId: open.windowId,
                    reason: 'complete', round,
                });
                expect(coordinator.hasActiveSession(peerKey)).toBe(true);
                releaseImport();
            }
            await push;
            if (phase === 'terminal') {
                await coordinator.handleMessage(peerKey, {
                    type: 'neg_close', sessionId, windowId: open.windowId,
                    reason: 'complete', round,
                });
            }
            expect(coordinator.hasActiveSession(peerKey)).toBe(false);
            expect(onSessionClosed).toHaveBeenCalledWith(peerKey, reason);
            expect(terminatePeerConnection).not.toHaveBeenCalled();
            expect(mockLogger.warn).not.toHaveBeenCalled();
        } finally {
            releaseImport();
            await coordinator.shutdown();
            await store.stop();
        }
    });

    it('logs a rejected session-close callback before shutdown completes', async () => {
        const [
            { createNegentropyCoordinator },
            { default: InMemoryOperationSyncStore },
            { createConnectionInfo },
            { createMediatorSyncStats },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/negentropy-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/db/memory.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
        ]);
        const store = new InMemoryOperationSyncStore();
        await store.start();
        const peerKey = '22'.repeat(32);
        const connection = createConnectionInfo({
            connection: {
                write: () => undefined,
                destroy: () => undefined,
                remotePublicKey: Buffer.from(peerKey, 'hex'),
            } as never,
            peerName: 'test-peer',
        });
        const importPipeline: ImportPipeline = {
            available: true, recovering: false,
            getMetrics: () => ({ activeRetryDelayedIds: 0, persistenceRetries: 0 }),
            get queued() {
                return 0;
            },
            get running() {
                return 0;
            },
            async enqueue() {
                return {
                    knownIds: [], persistedIds: [], pendingIds: [], capacityDeferredIds: [],
                    acceptedOperations: [], portableTerminalOperations: [], unaddressableOperations: [],
                    retryable: false,
                };
            },
            async waitForIdle() {},
            filterRetryDelayedIds(ids) {
                return { eligibleIds: ids, pendingIds: [], capacityDeferredIds: [] };
            },
            async refreshIndex() {
                throw new Error('unexpected index refresh');
            },
            async shutdown() {},
        };
        const callbackError = new Error('session-close callback failed');
        const onSessionClosed = jest.fn(async () => {
            throw callbackError;
        });
        const bulkReads = createBulkWorkScheduler(2);
        const cancelBulkReads = jest.spyOn(bulkReads, 'cancel');
        const coordinator = createNegentropyCoordinator({
            wireVersion: 2,
            frameSizeLimit: 0,
            maxRecordsPerWindow: 16,
            maxRoundsPerSession: 8,
            maxIdsPerRequest: 1_000,
            maxIdsPerLookup: 1_000,
            maxOpsPerPush: 300,
            maxBytesPerPush: 512 * 1024,
            idleTimeoutMs: 120_000,
            repairIntervalMs: 60_000,
            syncStore: store,
            importPipeline,
            syncStats: createMediatorSyncStats(),
            cipher: new CipherNode(),
            bulkReads,
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getConnection: key => key === peerKey ? connection : undefined,
            createSessionId: () => 'test-session',
            createBaseMessage: type => ({ type }),
            sendToPeer: () => true,
            sendBulkToPeer: async () => true,
            canStartBackgroundPrebuild: () => true,
            terminatePeerConnection: () => undefined,
            onProtocolViolation: () => undefined,
            onSessionClosed,
            onIndexRefreshed: async () => {},
        });

        await coordinator.initializeAdapter();
        expect(await coordinator.startSession(peerKey, {
            source: 'connect',
            initiator: true,
        })).toBe(true);

        coordinator.removePeer(peerKey, 'test_close');
        expect(await coordinator.startSession(peerKey, {
            source: 'connect',
            initiator: true,
        })).toBe(true);
        coordinator.reset();
        expect(coordinator.getActiveSessionCount()).toBe(0);
        expect(await coordinator.startSession(peerKey, {
            source: 'connect',
            initiator: true,
        })).toBe(true);
        cancelBulkReads.mockClear();
        await coordinator.shutdown();
        expect(cancelBulkReads).toHaveBeenCalledWith(peerKey);

        expect(onSessionClosed).toHaveBeenCalledTimes(1);
        expect(mockLogger.error).toHaveBeenCalledWith(
            { error: callbackError, peer: '2222-2222', reason: 'test_close' },
            'negentropy session-close callback failed',
        );
        expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({
            peer: '2222-2222',
            sessionId: 'test-session',
            durationMs: expect.any(Number),
            reason: 'test_close',
        }), 'peer sync session closed');
        await store.stop();
    });

    it('closes only the session when snapshot contention occurs during a message', async () => {
        const [
            { createNegentropyCoordinator },
            { default: InMemoryOperationSyncStore },
            { createConnectionInfo },
            { createMediatorSyncStats },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/negentropy-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/db/memory.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
        ]);
        const peerKey = '22'.repeat(32);
        const store = new InMemoryOperationSyncStore();
        await store.start();
        let coordinator: ReturnType<typeof createNegentropyCoordinator>;
        const buildSnapshotForWindow = jest.fn(async (window: ReconciliationWindow) => {
            if (buildSnapshotForWindow.mock.calls.length > 1) {
                coordinator.beginStoreMutation()();
            }
            return {
                window,
                storage: {} as never,
                stats: {
                    loaded: 16, skipped: 0, durationMs: 0, frameSizeLimit: 0,
                    windowName: window.name, fromTs: window.fromTs, toTs: window.toTs,
                    rounds: 0, completed: false, cappedByRecords: true, cappedByRounds: false,
                    lastCursor: { ts: 1_750_000_000, id: 'a'.repeat(64) },
                },
            };
        });
        const adapter = {
            buildSnapshotForWindow,
            createEngineForSnapshot: () => ({
                initiate: async () => new Uint8Array(),
                reconcile: async () => ({ nextMsg: null, haveIds: [], needIds: [] }),
            }),
        };
        const connection = createConnectionInfo({
            connection: {
                write: () => undefined,
                destroy: () => undefined,
                remotePublicKey: Buffer.from(peerKey, 'hex'),
            } as never,
            peerName: 'test-peer',
        });
        connection.capabilities = normalizePeerCapabilities();
        connection.wireVersion = 2;
        const importPipeline = {
            available: true, recovering: false, queued: 0, running: 0, indexEpoch: 'epoch',
        } as unknown as ImportPipeline;
        const sendToPeer = jest.fn<Parameters<typeof createNegentropyCoordinator>[0]['sendToPeer']>(() => true);
        const terminatePeerConnection = jest.fn();
        const onSessionClosed = jest.fn(async () => undefined);
        coordinator = createNegentropyCoordinator({
            wireVersion: 2, frameSizeLimit: 0,
            maxRecordsPerWindow: 16, maxRoundsPerSession: 8, maxIdsPerRequest: 1_000,
            maxIdsPerLookup: 1_000, maxOpsPerPush: 300, maxBytesPerPush: 512 * 1024,
            idleTimeoutMs: 120_000, repairIntervalMs: 60_000,
            syncStore: store, importPipeline, syncStats: createMediatorSyncStats(),
            cipher: new CipherNode(), bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getConnection: () => connection,
            createSessionId: () => 'test-session',
            createBaseMessage: type => ({ type }),
            sendToPeer, sendBulkToPeer: async () => true,
            canStartBackgroundPrebuild: () => false, terminatePeerConnection,
            onProtocolViolation: () => undefined, onSessionClosed, onIndexRefreshed: async () => {},
        });

        try {
            coordinator.setAdapter(adapter as never);
            await coordinator.startSession(peerKey, {
                source: 'connect', initiator: true,
            });
            const open = sendToPeer.mock.calls[0]?.[1] as NegOpenMessage;

            await expect(coordinator.handleMessage(peerKey, {
                type: 'neg_msg', sessionId: 'test-session', windowId: open.windowId,
                round: 1, frame: { encoding: 'base64', data: '' },
            })).resolves.toBeUndefined();

            expect(coordinator.hasActiveSession(peerKey)).toBe(false);
            expect(sendToPeer).toHaveBeenLastCalledWith(peerKey, expect.objectContaining({
                type: 'neg_close', sessionId: 'test-session', reason: 'snapshot_busy',
            }));
            expect(onSessionClosed).toHaveBeenCalledWith(peerKey, 'snapshot_busy');
            expect(terminatePeerConnection).not.toHaveBeenCalled();
            expect(buildSnapshotForWindow).toHaveBeenCalledTimes(3);

            sendToPeer.mockClear();
            onSessionClosed.mockClear();
            mockLogger.debug.mockClear();
            await coordinator.handleMessage(peerKey, {
                ...open,
                sessionId: 'remote-contention',
                round: 0,
            });
            expect(sendToPeer).toHaveBeenLastCalledWith(peerKey, expect.objectContaining({
                type: 'neg_close', sessionId: 'remote-contention', reason: 'snapshot_busy',
            }));
            expect(onSessionClosed).toHaveBeenCalledWith(peerKey, 'snapshot_busy');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.objectContaining({ sessionId: 'remote-contention' }),
                'negentropy responder deferred after snapshot contention',
            );
        }
        finally {
            await coordinator.shutdown();
            await store.stop();
        }
    });

    it('rebuilds a snapshot dirtied by a completed store mutation before opening a session', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
        const [
            { createNegentropyCoordinator },
            { default: InMemoryOperationSyncStore },
            { default: NegentropyAdapter },
            { createConnectionInfo },
            { createMediatorSyncStats },
            { normalizePeerCapabilities },
        ] = await Promise.all([
            import('../../services/mediators/hyperswarm/src/negentropy-coordinator.ts'),
            import('../../services/mediators/hyperswarm/src/db/memory.ts'),
            import('../../services/mediators/hyperswarm/src/negentropy/adapter.ts'),
            import('../../services/mediators/hyperswarm/src/mediator-state.ts'),
            import('../../services/mediators/hyperswarm/src/sync-stats.ts'),
            import('../../services/mediators/hyperswarm/src/negentropy/protocol.ts'),
        ]);
        const store = new InMemoryOperationSyncStore();
        await store.start();
        await store.upsertMany(['a', 'b', 'c'].map((char, index) => ({
            id: char.repeat(64),
            signedTs: 1_750_000_000 + index,
            operation: {
                type: 'create',
                signature: {
                    hash: char.repeat(64),
                    signed: new Date((1_750_000_000 + index) * 1000).toISOString(),
                    value: `sig-${char}`,
                },
            },
        })));
        const adapter = await NegentropyAdapter.create({
            syncStore: store,
            maxRecordsPerWindow: 16,
            deferInitialBuild: true,
        });
        const buildSnapshotForWindow = adapter.buildSnapshotForWindow.bind(adapter);
        let markFirstBuildCaptured!: () => void;
        const firstBuildCaptured = new Promise<void>(resolve => {
            markFirstBuildCaptured = resolve;
        });
        let releaseFirstBuild!: () => void;
        const firstBuildBlocked = new Promise<void>(resolve => {
            releaseFirstBuild = resolve;
        });
        const buildSnapshot = jest.spyOn(adapter, 'buildSnapshotForWindow').mockImplementation(async window => {
            const snapshot = await buildSnapshotForWindow(window);
            if (buildSnapshot.mock.calls.length === 1) {
                markFirstBuildCaptured();
                await firstBuildBlocked;
            }
            return snapshot;
        });
        const createEngine = jest.spyOn(adapter, 'createEngineForSnapshot');
        const onSessionClosed = jest.fn(() => undefined);
        const peerKey = '22'.repeat(32);
        const connection = createConnectionInfo({
            connection: {
                write: () => undefined,
                destroy: () => undefined,
                remotePublicKey: Buffer.from(peerKey, 'hex'),
            } as never,
            peerName: 'test-peer',
        });
        connection.capabilities = normalizePeerCapabilities();
        connection.wireVersion = 2;
        const importPipeline: ImportPipeline = {
            available: true, recovering: false,
            getMetrics: () => ({ activeRetryDelayedIds: 0, persistenceRetries: 0 }),
            get queued() { return 0; },
            get running() { return 0; },
            async enqueue() {
                return {
                    knownIds: [], persistedIds: [], pendingIds: [], capacityDeferredIds: [],
                    acceptedOperations: [], portableTerminalOperations: [], unaddressableOperations: [],
                    retryable: false,
                };
            },
            async waitForIdle() {},
            filterRetryDelayedIds(ids) {
                return { eligibleIds: ids, pendingIds: [], capacityDeferredIds: [] };
            },
            async refreshIndex() { throw new Error('unexpected index refresh'); },
            async shutdown() {},
        };
        const sendToPeer = jest.fn(() => true);
        const coordinator = createNegentropyCoordinator({
            wireVersion: 2,
            frameSizeLimit: 0,
            maxRecordsPerWindow: 16,
            maxRoundsPerSession: 8,
            maxIdsPerRequest: 1_000,
            maxIdsPerLookup: 1_000,
            maxOpsPerPush: 300,
            maxBytesPerPush: 512 * 1024,
            idleTimeoutMs: 120_000,
            repairIntervalMs: 60_000,
            syncStore: store,
            importPipeline,
            syncStats: createMediatorSyncStats(),
            cipher: new CipherNode(),
            bulkReads: createBulkWorkScheduler(2),
            operationPages: createOperationPageBudget(5, 5 * 512 * 1024),
            getConnection: key => key === peerKey ? connection : undefined,
            createSessionId: () => 'test-session',
            createBaseMessage: type => ({ type }),
            sendToPeer,
            sendBulkToPeer: async () => true,
            canStartBackgroundPrebuild: () => false,
            terminatePeerConnection: () => undefined,
            onProtocolViolation: () => undefined,
            onSessionClosed,
            onIndexRefreshed: async () => {},
        });
        coordinator.setAdapter(adapter);
        let starting: Promise<boolean> | null = null;
        let finishFirstMutation: () => void = () => undefined;
        let finishSecondMutation: () => void = () => undefined;
        let finishWakeRaceMutation: () => void = () => undefined;
        let finishShutdownMutation: () => void = () => undefined;
        try {
            starting = coordinator.startSession(peerKey, {
                source: 'connect',
                initiator: true,
            });
            await firstBuildCaptured;
            finishFirstMutation = coordinator.beginStoreMutation();
            finishSecondMutation = coordinator.beginStoreMutation();
            await store.upsertMany([{
                id: 'd'.repeat(64),
                signedTs: 1_750_000_003,
                operation: {
                    type: 'create',
                    signature: {
                        hash: 'd'.repeat(64),
                        signed: new Date(1_750_000_003 * 1000).toISOString(),
                        value: 'sig-d',
                    },
                },
            }]);
            releaseFirstBuild();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(buildSnapshot).toHaveBeenCalledTimes(1);
            finishFirstMutation();
            finishFirstMutation();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(buildSnapshot).toHaveBeenCalledTimes(1);
            finishSecondMutation();
            finishWakeRaceMutation = coordinator.beginStoreMutation();
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(buildSnapshot).toHaveBeenCalledTimes(1);
            finishWakeRaceMutation();
            expect(await starting).toBe(true);
            expect(buildSnapshot).toHaveBeenCalledTimes(2);
            expect(createEngine).toHaveBeenCalledTimes(1);
            expect(createEngine.mock.calls[0]?.[0].stats.loaded).toBe(4);

            coordinator.removePeer(peerKey, 'test_close');
            let markThirdBuildStarted!: () => void;
            const thirdBuildStarted = new Promise<void>(resolve => {
                markThirdBuildStarted = resolve;
            });
            let releaseThirdBuild!: () => void;
            const thirdBuildBlocked = new Promise<void>(resolve => {
                releaseThirdBuild = resolve;
            });
            let markFourthBuildStarted!: () => void;
            const fourthBuildStarted = new Promise<void>(resolve => {
                markFourthBuildStarted = resolve;
            });
            let releaseFourthBuild!: () => void;
            const fourthBuildBlocked = new Promise<void>(resolve => {
                releaseFourthBuild = resolve;
            });
            buildSnapshot.mockImplementation(async window => {
                const snapshot = await buildSnapshotForWindow(window);
                if (buildSnapshot.mock.calls.length === 3) {
                    markThirdBuildStarted();
                    await thirdBuildBlocked;
                }
                if (buildSnapshot.mock.calls.length === 4) {
                    markFourthBuildStarted();
                    await fourthBuildBlocked;
                }
                return snapshot;
            });

            const markDirty = coordinator.beginStoreMutation();
            markDirty();
            const contending = coordinator.startSession(peerKey, {
                source: 'periodic',
                initiator: true,
            });
            await thirdBuildStarted;
            const finishThirdBuildMutation = coordinator.beginStoreMutation();
            finishThirdBuildMutation();
            releaseThirdBuild();
            await fourthBuildStarted;
            const finishFourthBuildMutation = coordinator.beginStoreMutation();
            finishFourthBuildMutation();
            releaseFourthBuild();

            expect(await contending).toBe(false);
            expect(buildSnapshot).toHaveBeenCalledTimes(4);
            expect(createEngine).toHaveBeenCalledTimes(1);
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'snapshot_busy');

            expect(await coordinator.startSession(peerKey, {
                source: 'periodic',
                initiator: true,
            })).toBe(true);
            expect(buildSnapshot).toHaveBeenCalledTimes(5);
            expect(createEngine).toHaveBeenCalledTimes(2);

            coordinator.removePeer(peerKey, 'test_close');
            const buildFailure = new Error('snapshot read failed');
            buildSnapshot.mockRejectedValueOnce(buildFailure);
            const dirtyBeforeFailure = coordinator.beginStoreMutation();
            dirtyBeforeFailure();
            const remoteWindow: ReconciliationWindow = {
                name: 'history_paged',
                fromTs: 0,
                toTs: 1_800_000_000,
                maxRecords: 16,
                order: 0,
            };
            await expect(coordinator.handleMessage(peerKey, {
                type: 'neg_open',
                sessionId: 'remote-session',
                windowId: makeWindowId(remoteWindow),
                window: remoteWindow,
                round: 0,
                frame: { encoding: 'base64', data: '' },
            })).rejects.toBe(buildFailure);
            expect(coordinator.hasActiveSession(peerKey)).toBe(false);
            expect(sendToPeer).toHaveBeenLastCalledWith(peerKey, expect.objectContaining({
                type: 'neg_close',
                sessionId: 'remote-session',
                windowId: makeWindowId(remoteWindow),
                reason: 'snapshot_build_failed',
            }));
            expect(onSessionClosed).toHaveBeenLastCalledWith(peerKey, 'snapshot_build_failed');

            finishShutdownMutation = coordinator.beginStoreMutation();
            const waitingForMutation = coordinator.startSession(peerKey, {
                source: 'periodic',
                initiator: true,
            });
            await new Promise<void>(resolve => setImmediate(resolve));
            const shuttingDown = coordinator.shutdown();
            await expect(waitingForMutation).rejects.toThrow('mediator is shutting down');
            await shuttingDown;
        }
        finally {
            finishFirstMutation();
            finishSecondMutation();
            finishWakeRaceMutation();
            finishShutdownMutation();
            releaseFirstBuild();
            await starting?.catch(() => undefined);
            await coordinator.shutdown();
            await store.stop();
            nowSpy.mockRestore();
        }
    });
});
