import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { IndexExportRequest, Operation } from '@mdip/gatekeeper/types';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import { createImportPipeline } from '../../services/mediators/hyperswarm/src/import-pipeline.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import { bootstrapSyncStoreFromGatekeeper } from '../../services/mediators/hyperswarm/src/bootstrap.ts';
import TestHelper from '../gatekeeper/helper.ts';

describe('expiration and historical synchronization', () => {
    it('orders accepted replacement history before a retained removed branch', async () => {
        const cipher = new CipherNode();
        const db = new DbJsonMemory('reorganization-sync');
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });
        const helper = new TestHelper(gatekeeper, cipher);
        const key = cipher.generateRandomJwk();
        const store = new InMemoryOperationSyncStore();
        const mirror = () => bootstrapSyncStoreFromGatekeeper(store, {
            exportIndex: async request => request.mode === 'snapshot'
                ? db.exportIndexSnapshot(request)
                : db.exportIndexChanges(request),
        });
        await mirror();
        const create = await helper.createAgentOp(key, { registry: 'hyperswarm' });
        const did = await gatekeeper.generateDID(create);
        const event = (operation: Operation, ordinal: number) => ({
            registry: 'hyperswarm', time: operation.signature!.signed, ordinal: [ordinal], operation,
        });
        await expect(gatekeeper.importEvent(event(create, 1))).resolves.toBe('added');
        const initial = await gatekeeper.resolveDID(did);
        const firstDoc = structuredClone(initial);
        firstDoc.didDocumentData = { branch: 'superseded' };
        const first = await helper.createUpdateOp(key, did, firstDoc);
        await expect(gatekeeper.importEvent(event(first, 100))).resolves.toBe('added');
        await mirror();

        const replacementDoc = structuredClone(initial);
        replacementDoc.didDocumentData = { branch: 'replacement' };
        const replacement = await helper.createUpdateOp(key, did, replacementDoc, {
            mockPrevid: initial.didDocumentMetadata!.versionId,
        });
        await gatekeeper.removeDIDs([did]);
        await expect(gatekeeper.importEvent(event(create, 1))).resolves.toBe('added');
        await expect(gatekeeper.importEvent(event(replacement, 90))).resolves.toBe('added');
        await mirror();
        expect(await store.has(first.signature!.hash)).toBe(true);
        const ordered = await store.iterateOrdered({ limit: 10 });
        const receiver = new Gatekeeper({ db: new DbJsonMemory('reorganization-receiver'), ipfsEnabled: false });
        await receiver.importBatch(ordered.map((row, index) => event(row.operation, 1000 + index)));
        await receiver.processEvents();
        await expect(receiver.resolveDID(did)).resolves.toMatchObject({
            didDocumentData: { branch: 'replacement' },
        });
    });

    it('keeps collected histories known across mediator restart until the Gatekeeper epoch changes', async () => {
        const cipher = new CipherNode();
        const db = new DbJsonMemory('expiration-sync');
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });
        const store = new InMemoryOperationSyncStore();
        const key = cipher.generateRandomJwk();
        const signed = '2026-01-01T00:00:00.000Z';
        const sign = (unsigned: Operation, signer?: string): Operation => {
            const hash = cipher.hashJSON(unsigned);
            return {
                ...unsigned,
                signature: { signed, signer, hash, value: cipher.signHash(hash, key.privateJwk) },
            };
        };
        const importBatch = jest.fn(gatekeeper.importBatch.bind(gatekeeper));
        const processEvents = jest.fn(gatekeeper.processEvents.bind(gatekeeper));
        const exportIndex = async (request: IndexExportRequest) => request.mode === 'snapshot'
            ? db.exportIndexSnapshot(request)
            : db.exportIndexChanges(request);
        const createPipeline = () => createImportPipeline({
            gatekeeper: { importBatch, processEvents, exportIndex, isReady: async () => true },
            syncStore: store,
            cipher,
            syncStats: createMediatorSyncStats(),
            beginStoreMutation: () => () => {},
            onStoreChanged: () => {},
        });
        let pipeline = createPipeline();
        const receive = (data: Operation[]) => pipeline.enqueue({ kind: 'remote', name: 'peer', data });
        try {
            await pipeline.refreshIndex('startup');
            const agent = sign({
                type: 'create', created: signed,
                mdip: { version: 1, type: 'agent', registry: 'hyperswarm', validUntil: '2026-02-01T00:00:00.000Z' },
                publicJwk: key.publicJwk,
            });
            const agentDid = await gatekeeper.generateDID(agent);
            const asset = sign({
                type: 'create', created: signed,
                mdip: { version: 1, type: 'asset', registry: 'hyperswarm' },
                controller: agentDid, data: { original: true },
            }, agentDid);
            const assetDid = await gatekeeper.generateDID(asset);
            await expect(receive([agent, asset])).resolves.toMatchObject({ retryable: false });
            const doc = await gatekeeper.resolveDID(assetDid);
            doc.didDocumentData = { legacy: true };
            const legacyUpdate = sign({ type: 'update', did: assetDid, doc }, agentDid);
            await expect(receive([legacyUpdate])).resolves.toMatchObject({ retryable: false });
            const nextDoc = await gatekeeper.resolveDID(assetDid);
            nextDoc.didDocumentData = { legacy: 'last' };
            const nextUpdate = sign({ type: 'update', did: assetDid, doc: nextDoc }, agentDid);
            await expect(receive([nextUpdate])).resolves.toMatchObject({ retryable: false });
            const history = [agent, asset, legacyUpdate, nextUpdate];
            await pipeline.refreshIndex('initial');
            expect(await store.count()).toBe(4);

            await expect(gatekeeper.collectExpiredDIDs()).resolves.toMatchObject({ expired: 2, hasMore: false });
            await expect(pipeline.refreshIndex('cleanup')).resolves.toMatchObject({ deleted: 0, countAfter: 4 });
            await expect(gatekeeper.exportDID(agentDid)).resolves.toEqual([]);
            await expect(gatekeeper.exportDID(assetDid)).resolves.toEqual([]);
            const orderedBefore = await store.countOrdered();
            expect(orderedBefore).toBe(4);
            const retired = await store.iterateOrdered({ limit: 10 });
            expect(retired.map(row => row.id)).toEqual(history.map(operation => operation.signature!.hash));
            const receiver = new Gatekeeper({ db: new DbJsonMemory('expiration-receiver'), ipfsEnabled: false });
            await receiver.importBatch(retired.map((row, index) => ({
                registry: 'hyperswarm', time: row.operation.signature!.signed,
                ordinal: [index], operation: row.operation,
            })));
            await receiver.processEvents();
            await expect(receiver.resolveDID(assetDid)).resolves.toMatchObject({ didDocumentData: { legacy: 'last' } });
            importBatch.mockClear();
            processEvents.mockClear();

            for (let retry = 0; retry < 3; retry += 1) {
                await expect(receive(history)).resolves.toMatchObject({
                    retryable: false, persistedIds: [],
                    knownIds: history.map(operation => operation.signature!.hash),
                });
            }
            await pipeline.shutdown();
            pipeline = createPipeline();
            await pipeline.refreshIndex('restart');
            await expect(receive(history)).resolves.toMatchObject({
                retryable: false, knownIds: expect.arrayContaining([agent.signature!.hash, asset.signature!.hash]),
            });
            expect(importBatch).not.toHaveBeenCalled();
            expect(processEvents).not.toHaveBeenCalled();
            expect(await store.countOrdered()).toBe(orderedBefore);
            await expect(gatekeeper.exportDID(agentDid)).resolves.toEqual([]);
            await expect(gatekeeper.exportDID(assetDid)).resolves.toEqual([]);

            await gatekeeper.resetDb();
            await expect(pipeline.refreshIndex('reset')).resolves.toMatchObject({
                countAfter: 0, resetReason: 'gatekeeper_index_epoch_changed',
            });
            await expect(receive([agent])).resolves.toMatchObject({ retryable: false, knownIds: [] });
            expect(importBatch).toHaveBeenCalledTimes(1);
            expect(processEvents).toHaveBeenCalledTimes(1);
            expect(await store.count()).toBe(1);
        }
        finally {
            await pipeline.shutdown();
        }
    });
});
