import { jest } from '@jest/globals';

import CipherNode from '@mdip/cipher/node';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { GatekeeperEvent, ImportBatchResult, Operation } from '@mdip/gatekeeper/types';
import { importEventBatch as importSatoshiBatch } from '../../services/mediators/satoshi/src/import-batch.ts';
import { importEventBatch as importInscriptionBatch } from '../../services/mediators/satoshi-inscription/src/import-batch.ts';

const cipher = new CipherNode();
const implementations = [
    ['Satoshi', importSatoshiBatch],
    ['Satoshi inscription', importInscriptionBatch],
] as const;

function makeOperation(index: number): Operation {
    const unsigned = {
        type: 'create' as const,
        created: `2026-08-01T12:00:0${index}.000Z`,
        mdip: { version: 1, type: 'agent' as const, registry: 'hyperswarm' },
    };
    return {
        ...unsigned,
        signature: {
            signed: unsigned.created,
            hash: cipher.hashJSON(unsigned),
            value: `signature-${index}`,
        },
    };
}

function makeEvents(operations: Operation[]): GatekeeperEvent[] {
    return operations.map((operation, index) => ({
        registry: 'tbtc',
        time: operation.signature!.signed,
        ordinal: [1, index],
        operation,
    }));
}

function importResult(overrides: Partial<ImportBatchResult> = {}): ImportBatchResult {
    return {
        queued: 0,
        processed: 0,
        rejected: 0,
        total: 0,
        rejectedIndices: [],
        capacityDeferred: 0,
        capacityDeferredIndices: [],
        processedIndices: [],
        ...overrides,
    };
}

describe.each(implementations)('%s blockchain event import', (_name, importBatch) => {
    it('drains pages and records only the submitted operations', async () => {
        const operations = [makeOperation(1), makeOperation(2)];
        const unrelated = makeOperation(3);
        const processEvents = jest.fn<GatekeeperClient['processEvents']>()
            .mockResolvedValueOnce({
                added: 2,
                merged: 0,
                rejected: 0,
                pending: 1,
                acceptedHashes: [operations[0].signature!.hash, unrelated.signature!.hash],
                acceptedEvents: makeEvents([operations[0], unrelated]),
                rejectedOperations: [unrelated],
                hasMore: true,
            })
            .mockResolvedValueOnce({
                added: 1,
                merged: 0,
                rejected: 0,
                pending: 0,
                acceptedHashes: [operations[1].signature!.hash],
                acceptedEvents: makeEvents([operations[1]]),
                hasMore: false,
            });
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ queued: 2, total: 2 })),
            processEvents,
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents(operations));

        expect(result.complete).toBe(true);
        expect(result.capacityDeferred).toBe(false);
        expect(processEvents).toHaveBeenCalledTimes(2);
        expect(result.processed.acceptedHashes).toEqual(operations.map(op => op.signature!.hash));
        expect(result.processed.acceptedEvents).toHaveLength(2);
        expect(result.processed.hasMore).toBe(false);
        expect(result.processed.rejectedOperations).toEqual([]);
        expect(result.processed.added).toBeUndefined();
        expect(result.processed.merged).toBeUndefined();
        expect(result.processed.pending).toBeUndefined();
    });

    it('leaves a capacity-deferred item incomplete after processing admitted work', async () => {
        const operations = [makeOperation(1), makeOperation(2)];
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({
                queued: 1,
                total: 1,
                capacityDeferred: 1,
                capacityDeferredIndices: [1],
            })),
            processEvents: jest.fn(async () => ({
                added: 1,
                merged: 0,
                rejected: 0,
                pending: 0,
                acceptedHashes: [operations[0].signature!.hash],
                hasMore: false,
            })),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents(operations));

        expect(result.complete).toBe(false);
        expect(result.capacityDeferred).toBe(true);
        expect(result.processed.capacityDeferredHashes).toEqual([operations[1].signature!.hash]);
    });

    it('treats capacity as backpressure even when optional indexes are unusable', async () => {
        const operation = makeOperation(1);
        const processEvents = jest.fn();
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({
                capacityDeferred: 1,
                capacityDeferredIndices: [-1, 10],
            })),
            processEvents,
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, [{
            registry: 'tbtc',
            time: '2026-08-01T12:00:01.000Z',
            operation,
        }]);

        expect(result.complete).toBe(false);
        expect(result.capacityDeferred).toBe(true);
        expect(processEvents).not.toHaveBeenCalled();
    });

    it('uses accepted event details when an accepted hash list is absent', async () => {
        const operation = makeOperation(1);
        const event = makeEvents([operation])[0];
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ queued: 1, total: 1 })),
            processEvents: jest.fn(async () => ({
                added: 1,
                merged: 0,
                rejected: 0,
                pending: 0,
                acceptedEvents: [event],
                hasMore: false,
            })),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, [event]);

        expect(result.complete).toBe(true);
        expect(result.processed.acceptedHashes).toEqual([operation.signature!.hash]);
        expect(result.processed.acceptedEvents).toEqual([event]);
    });

    it('reports processing-page capacity for a submitted operation', async () => {
        const operation = makeOperation(1);
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ queued: 1, total: 1 })),
            processEvents: jest.fn(async () => ({
                added: 0,
                merged: 0,
                rejected: 0,
                pending: 0,
                capacityDeferred: 1,
                capacityDeferredHashes: [operation.signature!.hash],
                hasMore: false,
            })),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents([operation]));

        expect(result.complete).toBe(false);
        expect(result.capacityDeferred).toBe(true);
        expect(result.processed.capacityDeferredHashes).toEqual([operation.signature!.hash]);
    });

    it('reports processing-page capacity when exact hashes are unavailable', async () => {
        const operation = makeOperation(1);
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ queued: 1, total: 1 })),
            processEvents: jest.fn(async () => ({
                added: 0,
                merged: 0,
                rejected: 0,
                pending: 0,
                capacityDeferred: 1,
                hasMore: false,
            })),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents([operation]));

        expect(result.complete).toBe(false);
        expect(result.capacityDeferred).toBe(true);
        expect(result.processed.capacityDeferredHashes).toEqual([]);
    });

    it('ignores processing-page capacity for unrelated operations', async () => {
        const operation = makeOperation(1);
        const unrelated = makeOperation(2);
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ queued: 1, total: 1 })),
            processEvents: jest.fn(async () => ({
                added: 1,
                merged: 0,
                rejected: 0,
                pending: 0,
                acceptedHashes: [operation.signature!.hash],
                capacityDeferred: 1,
                capacityDeferredHashes: [unrelated.signature!.hash],
                hasMore: false,
            })),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents([operation]));

        expect(result.complete).toBe(true);
        expect(result.capacityDeferred).toBe(false);
        expect(result.processed.capacityDeferredHashes).toEqual([]);
    });

    it('leaves an item retryable while Gatekeeper processing is busy', async () => {
        const operation = makeOperation(1);
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ queued: 1, total: 1 })),
            processEvents: jest.fn(async () => ({ busy: true })),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents([operation]));

        expect(result.complete).toBe(false);
        expect(result.processed.busy).toBe(true);
        expect(result.processed.hasMore).toBeUndefined();
    });

    it('conclusively handles structural rejection without an operation hash', async () => {
        const operation = makeOperation(1);
        delete operation.signature;
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({
                rejected: 1,
                rejectedIndices: [0],
            })),
            processEvents: jest.fn(),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, [{
            registry: 'tbtc',
            time: '2026-08-01T12:00:01.000Z',
            operation,
        }]);

        expect(result.complete).toBe(true);
        expect(gatekeeper.processEvents).not.toHaveBeenCalled();
    });

    it('does not process or complete a duplicate that is still pending', async () => {
        const operation = makeOperation(1);
        const processEvents = jest.fn();
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ processed: 1, total: 1, processedIndices: [0] })),
            processEvents,
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents([operation]));

        expect(result.complete).toBe(false);
        expect(processEvents).not.toHaveBeenCalled();
    });

    it('conclusively handles a rejected operation whose claimed hash is unusable', async () => {
        const operation = makeOperation(1);
        operation.signature!.hash = 'f'.repeat(64);
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ queued: 1, total: 1 })),
            processEvents: jest.fn(async () => ({
                added: 0,
                merged: 0,
                rejected: 1,
                pending: 0,
                rejectedOperations: [operation],
                hasMore: false,
            })),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents([operation]));

        expect(result.complete).toBe(true);
        expect(result.processed.rejectedOperations).toEqual([operation]);
    });
});
