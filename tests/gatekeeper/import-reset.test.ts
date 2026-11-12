import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

function fixture() {
    const db = new DbJsonMemory('import-reset');
    const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });
    const cipher = new CipherNode();
    const key = cipher.generateRandomJwk();
    const unsigned: Operation = {
        type: 'create', created: '2026-01-01T00:00:00.000Z',
        mdip: { version: 1, type: 'agent', registry: 'hyperswarm' }, publicJwk: key.publicJwk,
    };
    const hash = cipher.hashJSON(unsigned);
    const event: GatekeeperEvent = {
        registry: 'hyperswarm', time: unsigned.created!, ordinal: [1],
        operation: { ...unsigned, signature: { signed: unsigned.created!, hash, value: cipher.signHash(hash, key.privateJwk) } },
    };
    return { db, gatekeeper, event };
}

describe('import database reset boundary', () => {
    it('drains an admission before reset and rejects old-epoch work waiting behind reset', async () => {
        const { db, gatekeeper, event } = fixture();
        const epoch = (await db.getLifecycleMetadata()).epoch;
        const entered = deferred();
        const release = deferred();
        const original = gatekeeper.verifyEvent.bind(gatekeeper);
        const verify = jest.spyOn(gatekeeper, 'verifyEvent').mockImplementation(async value => {
            entered.resolve();
            await release.promise;
            return original(value);
        });
        const admission = gatekeeper.importBatch([event], epoch);
        await entered.promise;
        const reset = gatekeeper.resetDb();
        const stale = gatekeeper.importBatch([event], epoch);
        const staleResult = expect(stale).rejects.toMatchObject({ code: 'gatekeeper_index_epoch_changed' });
        release.resolve();
        await expect(admission).resolves.toMatchObject({ queued: 1 });
        await reset;
        await staleResult;
        verify.mockRestore();
        expect(gatekeeper.getQueueStatus().total).toBe(0);
        await expect(db.getAllKeys()).resolves.toEqual([]);
    });

    it('finishes an active processing pass before clearing its events and pending state', async () => {
        const { db, gatekeeper, event } = fixture();
        const epoch = (await db.getLifecycleMetadata()).epoch;
        await gatekeeper.importBatch([event], epoch);
        const entered = deferred();
        const release = deferred();
        const original = gatekeeper.importEvent.bind(gatekeeper);
        const importing = jest.spyOn(gatekeeper, 'importEvent').mockImplementation(async value => {
            entered.resolve();
            await release.promise;
            return original(value);
        });
        const processing = gatekeeper.processEvents(epoch);
        await entered.promise;
        const reset = gatekeeper.resetDb();
        let completed = false;
        const resetCompletion = reset.then(() => { completed = true; });
        await new Promise(resolve => setImmediate(resolve));
        expect(completed).toBe(false);
        release.resolve();
        await expect(processing).resolves.toMatchObject({ added: 1, pending: 0 });
        await resetCompletion;
        importing.mockRestore();
        await expect(db.getAllKeys()).resolves.toEqual([]);
        expect(gatekeeper.getQueueStatus()).toMatchObject({ pending: 0, processing: 0, total: 0, active: false });
        await expect(gatekeeper.processEvents(epoch)).rejects.toMatchObject({ code: 'gatekeeper_index_epoch_changed' });
    });

    it('preserves new publication queues against an old-epoch clear request', async () => {
        const { db, gatekeeper, event } = fixture();
        const oldEpoch = (await db.getLifecycleMetadata()).epoch;
        await gatekeeper.resetDb();
        await gatekeeper.createDID(event.operation);
        const queue = await gatekeeper.getQueue('hyperswarm');
        expect(queue).toHaveLength(1);
        await expect(gatekeeper.clearQueue('hyperswarm', queue, oldEpoch))
            .rejects.toMatchObject({ code: 'gatekeeper_index_epoch_changed' });
        await expect(gatekeeper.getQueue('hyperswarm')).resolves.toEqual(queue);
        await expect(gatekeeper.clearQueue('hyperswarm', queue, (await db.getLifecycleMetadata()).epoch)).resolves.toBe(true);
    });

    it('serializes repeated resets and still accepts clients without an epoch', async () => {
        const { db, gatekeeper, event } = fixture();
        const first = gatekeeper.resetDb();
        const second = gatekeeper.resetDb();
        const admission = gatekeeper.importBatch([event]);
        await Promise.all([first, second]);
        await expect(admission).resolves.toMatchObject({ queued: 1 });
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ added: 1, pending: 0 });
        await expect(db.getAllKeys()).resolves.toHaveLength(1);
    });
});
