import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import HeliaClient from '@mdip/ipfs/helia';
import type { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import {
    filterIndexRejectedOperations,
    mapAcceptedOperationsToSyncRecords,
} from '../../services/mediators/hyperswarm/src/sync-persistence.ts';
import { resolveAcceptedOperationsToPersist } from '../../services/mediators/hyperswarm/src/sync-store-mirroring.ts';
import TestHelper from '../gatekeeper/helper.ts';

const mockConsole = {
    log: (): void => { },
    error: (): void => { },
    time: (): void => { },
    timeEnd: (): void => { },
} as unknown as typeof console;

const cipher = new CipherNode();
const db = new DbJsonMemory('hyperswarm-sync-store-mirroring');
const ipfs = new HeliaClient();
const gatekeeper = new Gatekeeper({ db, ipfs, console: mockConsole, registries: ['local', 'hyperswarm', 'TFTC'] });
const helper = new TestHelper(gatekeeper, cipher);

function wrapOperation(operation: Operation, ordinalBase: number): GatekeeperEvent {
    return {
        registry: 'hyperswarm',
        time: new Date().toISOString(),
        ordinal: [ordinalBase],
        operation,
    };
}

async function mirrorCurrentMediatorMergeBatch(
    syncStore: InMemoryOperationSyncStore,
    batch: Operation[],
    ordinalBase: number,
): Promise<{ acceptedHashes: string[]; rejectedIndices: number[] }> {
    const events = batch.map((operation, index) => wrapOperation(operation, ordinalBase + index));
    const imported = await gatekeeper.importBatch(events);
    const acceptedCandidates = filterIndexRejectedOperations(batch, imported.rejectedIndices);
    const processed = await gatekeeper.processEvents();
    const acceptedToPersist = resolveAcceptedOperationsToPersist(
        acceptedCandidates,
        processed.acceptedHashes,
        processed.acceptedEvents,
    );
    const { records } = mapAcceptedOperationsToSyncRecords(acceptedToPersist);
    await syncStore.upsertMany(records);

    return {
        acceptedHashes: processed.acceptedHashes ?? [],
        rejectedIndices: imported.rejectedIndices ?? [],
    };
}

describe('hyperswarm sync-store mirroring', () => {
    let syncStore: InMemoryOperationSyncStore;

    beforeAll(async () => {
        await ipfs.start();
    });

    afterAll(async () => {
        await ipfs.stop();
    });

    beforeEach(async () => {
        await gatekeeper.resetDb();
        syncStore = new InMemoryOperationSyncStore();
        await syncStore.start();
    });

    afterEach(async () => {
        await syncStore.stop();
    });

    it('should mirror deferred asset creates once a later batch makes them valid', async () => {
        const controllerKeys = cipher.generateRandomJwk();
        const controllerCreate = await helper.createAgentOp(controllerKeys, { version: 1, registry: 'hyperswarm' });
        const controllerDid = await gatekeeper.createDID(controllerCreate);

        const assetCreate = await helper.createAssetOp(controllerDid, controllerKeys, { registry: 'hyperswarm' });
        await gatekeeper.createDID(assetCreate);

        await gatekeeper.resetDb();

        const firstPass = await mirrorCurrentMediatorMergeBatch(syncStore, [assetCreate], 1);
        expect(firstPass.acceptedHashes).toStrictEqual([]);
        expect(await syncStore.count()).toBe(0);

        const secondPass = await mirrorCurrentMediatorMergeBatch(syncStore, [controllerCreate], 100);

        expect(secondPass.acceptedHashes).toEqual(
            expect.arrayContaining([
                controllerCreate.signature!.hash.toLowerCase(),
                assetCreate.signature!.hash.toLowerCase(),
            ])
        );
        expect(await syncStore.has(controllerCreate.signature!.hash.toLowerCase())).toBe(true);
        expect(await syncStore.has(assetCreate.signature!.hash.toLowerCase())).toBe(true);
    });
});
