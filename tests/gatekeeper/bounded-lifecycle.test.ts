import { jest } from '@jest/globals';
import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import TestHelper from './helper.ts';

describe('bounded pending events and indexed expiration', () => {
    it('rechecks retained dependencies after cleanup removes their target history', async () => {
        const db = new DbJsonMemory('bounded-expiration-dependencies');
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false });
        const cipher = new CipherNode();
        const helper = new TestHelper(gatekeeper, cipher);
        const keys = cipher.generateRandomJwk();
        const operation = await helper.createAgentOp(keys, {
            validUntil: new Date(Date.now() - 1000).toISOString(),
        });
        const did = await gatekeeper.createDID(operation);
        const doc = await gatekeeper.resolveDID(did);
        doc.didDocumentData = { updated: true };
        const update = await helper.createUpdateOp(keys, did, doc, { mockPrevid: 'missing-predecessor' });
        await gatekeeper.importBatch([{ registry: 'hyperswarm', time: update.signature!.signed, operation: update }]);
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ pending: 1, hasMore: false });
        const importEvent = jest.spyOn(gatekeeper, 'importEvent');

        try {
            await gatekeeper.processEvents();
            expect(importEvent).not.toHaveBeenCalled();
            await expect(gatekeeper.collectExpiredDIDs()).resolves.toMatchObject({ expired: 1, hasMore: false });
            await expect(gatekeeper.processEvents()).resolves.toMatchObject({ added: 0, pending: 1, hasMore: false });
            expect(importEvent).toHaveBeenCalledTimes(1);
            await gatekeeper.processEvents();
            expect(importEvent).toHaveBeenCalledTimes(1);
            await expect(gatekeeper.resolveDID(did)).resolves.toMatchObject({
                didResolutionMetadata: { error: 'notFound' },
            });
        } finally {
            importEvent.mockRestore();
        }
    });
});
