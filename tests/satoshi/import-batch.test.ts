import { jest } from '@jest/globals';

import CipherNode from '@mdip/cipher/node';
import type { EcdsaJwkPair } from '@mdip/cipher/types';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type { GatekeeperEvent, ImportBatchResult, Operation, ResolveDIDOptions } from '@mdip/gatekeeper/types';
import { importEventBatch as importSatoshiBatch } from '../../services/mediators/satoshi/src/import-batch.ts';
import { importEventBatch as importInscriptionBatch } from '../../services/mediators/satoshi-inscription/src/import-batch.ts';

import { resolveAnchoredBatchAsset } from '../../services/mediators/satoshi/src/batch-import.ts';

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
    async function signedEvents(count: number): Promise<{
        gatekeeper: Gatekeeper;
        db: DbJsonMemory;
        events: GatekeeperEvent[];
        key: EcdsaJwkPair;
    }> {
        const db = new DbJsonMemory('native-import-capacity');
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false, registries: ['TBTC'] });
        const key = cipher.generateRandomJwk();
        const events = Array.from({ length: count }, (_, index) => {
            const created = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
            const unsigned = {
                type: 'create' as const,
                created,
                mdip: { version: 1, type: 'agent' as const, registry: 'TBTC' },
                publicJwk: key.publicJwk,
            };
            const hash = cipher.hashJSON(unsigned);
            return {
                registry: 'TBTC',
                time: created,
                ordinal: [1, index],
                operation: {
                    ...unsigned,
                    signature: { signed: created, hash, value: cipher.signHash(hash, key.privateJwk) },
                },
            };
        });
        return { gatekeeper, db, events, key };
    }

    it('imports an immutable batch larger than Gatekeeper transient admission capacity', async () => {
        const { gatekeeper, db, events } = await signedEvents(301);

        const result = await importBatch(gatekeeper, events);

        expect(result.complete).toBe(true);
        expect(result.capacityDeferred).toBe(false);
        expect(await db.getAllKeys()).toHaveLength(events.length);
        expect(gatekeeper.getQueueStatus().total).toBe(0);
    });

    it('retries only byte-refused entries after draining the admitted prefix', async () => {
        const { gatekeeper, db, events } = await signedEvents(3);
        const normalizedBytes = await Promise.all(events.map(async event => Buffer.byteLength(JSON.stringify({
            ...event,
            did: await gatekeeper.generateDID(event.operation),
            opid: await gatekeeper.generateCID(event.operation),
        }))));
        (gatekeeper as unknown as { maxTransientEventBytes: number }).maxTransientEventBytes = Math.max(...normalizedBytes);
        const submit = jest.spyOn(gatekeeper, 'importBatch');

        const result = await importBatch(gatekeeper, events);

        expect(result.complete).toBe(true);
        expect(result.capacityDeferred).toBe(false);
        expect(submit.mock.calls.map(([submitted]) => submitted)).toEqual([events, events.slice(1), events.slice(2)]);
        expect(await db.getAllKeys()).toHaveLength(events.length);
        expect(result.imported.capacityDeferredIndices).toEqual([]);
    });

    it('drains valid operations alongside structurally invalid entries', async () => {
        const { gatekeeper, db, events: [event] } = await signedEvents(1);
        const events = [
            { ...event, operation: null },
            { ...event, operation: undefined },
            event,
        ] as unknown as GatekeeperEvent[];

        const result = await importBatch(gatekeeper, events);

        expect(result.complete).toBe(true);
        expect(result.imported.rejectedIndices).toEqual([0, 1]);
        expect(result.processed.acceptedHashes).toEqual([event.operation.signature!.hash]);
        expect(await db.getAllKeys()).toHaveLength(1);
        expect(gatekeeper.getQueueStatus().total).toBe(0);
    });

    it('drains a full staging queue before retrying refused native operations', async () => {
        const { gatekeeper, db, events } = await signedEvents(3);
        (gatekeeper as unknown as { maxEventPageCount: number }).maxEventPageCount = 2;
        await gatekeeper.importBatch(events.slice(0, 2));

        const result = await importBatch(gatekeeper, events.slice(2));

        expect(result.complete).toBe(true);
        expect(result.processed.acceptedHashes).toEqual([events[2].operation.signature!.hash]);
        expect(await db.getAllKeys()).toHaveLength(3);
        expect(gatekeeper.getQueueStatus().total).toBe(0);
    });

    it('resumes a staged duplicate after an earlier processing attempt was busy', async () => {
        const { gatekeeper, db, events } = await signedEvents(1);
        const processEvents = jest.fn<GatekeeperClient['processEvents']>()
            .mockResolvedValueOnce({ busy: true })
            .mockImplementation(gatekeeper.processEvents.bind(gatekeeper));
        const client = { importBatch: gatekeeper.importBatch.bind(gatekeeper), processEvents };

        const busy = await importBatch(client, events);
        expect(busy.complete).toBe(false);
        expect(busy.processed.busy).toBe(true);
        expect(gatekeeper.getQueueStatus().staged).toBe(1);

        const resumed = await importBatch(client, events);
        expect(resumed.imported).toMatchObject({ queued: 0, processed: 1 });
        expect(resumed.complete).toBe(true);
        expect(processEvents).toHaveBeenCalledTimes(2);
        expect(await db.getAllKeys()).toHaveLength(1);
        expect(gatekeeper.getQueueStatus().total).toBe(0);
    });

    it('does not confuse an authoritative accepted signature variant with the submitted operation', async () => {
        const operation = makeOperation(1);
        const other = structuredClone(operation);
        other.signature!.value = 'another-signature';
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ queued: 1, total: 1 })),
            processEvents: jest.fn(async () => ({
                acceptedHashes: [operation.signature!.hash],
                acceptedEvents: makeEvents([other]),
                hasMore: false,
            })),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents([operation]));

        expect(result.complete).toBe(false);
        expect(result.processed.acceptedHashes).toEqual([]);
        expect(result.processed.acceptedEvents).toEqual([]);
    });

    it('reaches a later controller and retries processing refusals without replaying accepted operations', async () => {
        const { gatekeeper, db, events: [agent], key } = await signedEvents(1);
        const controller = await gatekeeper.generateDID(agent.operation);
        const asset = (data: string): GatekeeperEvent => {
            const unsigned = {
                type: 'create' as const,
                created: agent.time,
                mdip: { version: 1, type: 'asset' as const, registry: 'TBTC' },
                controller,
                data,
            };
            const hash = cipher.hashJSON(unsigned);
            return {
                ...agent,
                operation: {
                    ...unsigned,
                    signature: { signer: controller, signed: agent.time, hash, value: cipher.signHash(hash, key.privateJwk) },
                },
            };
        };
        const events = [asset('first'), asset('second'), agent];
        const limits = gatekeeper as unknown as { maxEventPageCount: number; maxPendingEventCount: number };
        limits.maxEventPageCount = 2;
        limits.maxPendingEventCount = 1;
        const submit = jest.spyOn(gatekeeper, 'importBatch');

        const result = await importBatch(gatekeeper, events);

        expect(result.complete).toBe(true);
        expect(result.capacityDeferred).toBe(false);
        expect(await db.getAllKeys()).toHaveLength(3);
        expect(gatekeeper.getQueueStatus().total).toBe(0);
        expect(submit.mock.calls.map(([submitted]) => submitted)).toEqual([events, [agent], [events[1]]]);
        expect(result.processed.acceptedHashes).toHaveLength(3);
    });

    it.each(['rejected', 'processed'] as const)('maps %s indices from a refused subset back to the immutable batch', async disposition => {
        const operations = [makeOperation(1), makeOperation(2)];
        const gatekeeper = {
            importBatch: jest.fn<GatekeeperClient['importBatch']>()
                .mockResolvedValueOnce(importResult({ queued: 1, capacityDeferred: 1, capacityDeferredIndices: [1] }))
                .mockResolvedValueOnce(importResult({
                    [disposition]: 1,
                    [`${disposition}Indices`]: [0],
                })),
            processEvents: jest.fn(async () => ({ acceptedHashes: [operations[0].signature!.hash], hasMore: false })),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents(operations));

        expect(result.imported[`${disposition}Indices`]).toEqual([1]);
        expect(result.complete).toBe(disposition === 'rejected');
        expect(result.capacityDeferred).toBe(false);
        expect(gatekeeper.importBatch).toHaveBeenCalledTimes(2);
    });

    it('stops retrying when processing is busy and retains the refused original indices', async () => {
        const operations = [makeOperation(1), makeOperation(2)];
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ queued: 1, capacityDeferred: 1, capacityDeferredIndices: [1] })),
            processEvents: jest.fn(async () => ({ busy: true })),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents(operations));

        expect(result.complete).toBe(false);
        expect(result.processed.busy).toBe(true);
        expect(result.imported.capacityDeferredIndices).toEqual([1]);
        expect(gatekeeper.importBatch).toHaveBeenCalledTimes(1);
    });

    it('deduplicates matching payloads across processing pages', async () => {
        const operations = [makeOperation(1), makeOperation(2)];
        const page = {
            acceptedEvents: makeEvents([operations[0]]),
            acceptedHashes: [operations[0].signature!.hash],
            rejectedOperations: [operations[1]],
        };
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ queued: 2 })),
            processEvents: jest.fn<GatekeeperClient['processEvents']>()
                .mockResolvedValueOnce({ ...page, hasMore: true })
                .mockResolvedValueOnce({ ...page, hasMore: false }),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents(operations));

        expect(result.complete).toBe(true);
        expect(result.processed.acceptedEvents).toEqual(makeEvents([operations[0]]));
        expect(result.processed.rejectedOperations).toEqual([operations[1]]);
    });

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
            importBatch: jest.fn<GatekeeperClient['importBatch']>()
                .mockResolvedValueOnce(importResult({
                    queued: 1,
                    total: 1,
                    capacityDeferred: 1,
                    capacityDeferredIndices: [1],
                }))
                .mockImplementation(async () => importResult({ capacityDeferred: 1, capacityDeferredIndices: [0] })),
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
        const processEvents = jest.fn(async () => ({ hasMore: false }));
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
        expect(processEvents).toHaveBeenCalledTimes(1);
    });

    it('stops after a bounded retry when admission remains full without processing progress', async () => {
        const operation = makeOperation(1);
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ capacityDeferred: 1, capacityDeferredIndices: [0] })),
            processEvents: jest.fn(async () => ({ hasMore: false })),
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents([operation]));

        expect(result.complete).toBe(false);
        expect(result.capacityDeferred).toBe(true);
        expect(result.imported.capacityDeferredIndices).toEqual([0]);
        expect(gatekeeper.importBatch).toHaveBeenCalledTimes(2);
        expect(gatekeeper.processEvents).toHaveBeenCalledTimes(2);
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

    it('does not complete a duplicate that remains pending after a drain', async () => {
        const operation = makeOperation(1);
        const processEvents = jest.fn(async () => ({ hasMore: false, pending: 1 }));
        const gatekeeper = {
            importBatch: jest.fn(async () => importResult({ processed: 1, total: 1, processedIndices: [0] })),
            processEvents,
        } as unknown as Pick<GatekeeperClient, 'importBatch' | 'processEvents'>;

        const result = await importBatch(gatekeeper, makeEvents([operation]));

        expect(result.complete).toBe(false);
        expect(processEvents).toHaveBeenCalledTimes(1);
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

describe('Satoshi batch import', () => {
    it('resolves the batch committed by the asset create operation', async () => {
        const anchoredBatch = { batch: [{ type: 'create' }] };
        const substitutedBatch = { batch: [{ type: 'delete' }] };
        const resolveAsset = jest.fn<(did: string, options?: ResolveDIDOptions) => Promise<unknown>>(
            async (_did, options) => options?.versionSequence === 1 ? anchoredBatch : substitutedBatch
        );

        const result = await resolveAnchoredBatchAsset({ resolveAsset }, 'did:test:batch');

        expect(resolveAsset).toHaveBeenCalledWith('did:test:batch', { versionSequence: 1 });
        expect(result).toBe(anchoredBatch);
    });
});
