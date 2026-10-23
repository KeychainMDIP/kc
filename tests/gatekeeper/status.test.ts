import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import Memory from '@mdip/gatekeeper/db/json-memory';
import TestHelper from './helper.ts';

describe('lightweight queue status', () => {
    const db = new Memory('status');
    const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });
    const helper = new TestHelper(gatekeeper, new CipherNode());

    beforeEach(async () => { await gatekeeper.resetDb(); });
    afterEach(() => { jest.restoreAllMocks(); });

    async function queueAgent() {
        const cipher = new CipherNode();
        const operation = await helper.createAgentOp(cipher.generateRandomJwk(), { registry: 'hyperswarm' });
        await gatekeeper.importBatch([{ registry: 'hyperswarm', time: operation.created!, operation }]);
    }

    it('reports staging, deferred work and active processing without reading DID histories', async () => {
        await queueAgent();
        const getDIDs = jest.spyOn(gatekeeper, 'getDIDs');
        expect(gatekeeper.getQueueStatus()).toEqual({ staged: 1, pending: 0, processing: 0, total: 1, active: false });
        const importEvent = jest.spyOn(gatekeeper, 'importEvent').mockResolvedValue('deferred' as any);
        await gatekeeper.processEvents();
        expect(gatekeeper.getQueueStatus()).toEqual({ staged: 0, pending: 1, processing: 0, total: 1, active: false });

        let release!: () => void;
        let started!: () => void;
        const working = new Promise<void>(resolve => { started = resolve; });
        const resume = new Promise<void>(resolve => { release = resolve; });
        importEvent.mockImplementationOnce(async () => { started(); await resume; return 'merged' as any; });
        const processing = gatekeeper.processEvents();
        await working;
        expect(gatekeeper.getQueueStatus()).toEqual({ staged: 0, pending: 0, processing: 1, total: 1, active: true });
        release();
        await processing;
        expect(gatekeeper.getQueueStatus()).toEqual({ staged: 0, pending: 0, processing: 0, total: 0, active: false });
        expect(getDIDs).not.toHaveBeenCalled();
    });

    it('restores queue counts after a processing failure and clears them on reset', async () => {
        await queueAgent();
        jest.spyOn(gatekeeper, 'importEvent').mockRejectedValue(new Error('temporary storage failure'));
        await expect(gatekeeper.processEvents()).rejects.toThrow('temporary storage failure');
        expect(gatekeeper.getQueueStatus()).toEqual({ staged: 1, pending: 0, processing: 0, total: 1, active: false });
        await gatekeeper.resetDb();
        expect(gatekeeper.getQueueStatus().total).toBe(0);
    });

    it('stages a previously deferred event object again after reset', async () => {
        await queueAgent();
        const importEvent = jest.spyOn(gatekeeper, 'importEvent').mockResolvedValue('deferred' as any);
        await gatekeeper.processEvents();
        const event = importEvent.mock.calls[0][0];
        expect(gatekeeper.getQueueStatus().pending).toBe(1);

        await gatekeeper.resetDb();
        await gatekeeper.importBatch([event]);

        expect(gatekeeper.getQueueStatus()).toEqual({ staged: 1, pending: 0, processing: 0, total: 1, active: false });
    });
});
