import nock from 'nock';
import GatekeeperClient from '@mdip/gatekeeper/client';
import { ExpectedExceptionError } from '@mdip/common/errors';

const GATEKEEPER_URL = 'http://gatekeeper.org';

describe('isReady', () => {
    it('should return ready flag', async () => {
        nock(GATEKEEPER_URL)
            .get('/api/v1/ready')
            .reply(200, true);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const isReady = await gatekeeper.isReady();

        expect(isReady).toBe(true);
    });
});

describe('getVersion', () => {
    it('should return version', async () => {
        nock(GATEKEEPER_URL)
            .get('/api/v1/version')
            .reply(200, 1);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const version = await gatekeeper.getVersion();

        expect(version).toBe(1);
    });
});

describe('resetDb', () => {
    it('should return reset status', async () => {
        nock(GATEKEEPER_URL)
            .get('/api/v1/db/reset')
            .reply(200, true);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const ok = await gatekeeper.resetDb();

        expect(ok).toBe(true);
    });
});

describe('verifyDb', () => {
    it('should return verify status', async () => {
        nock(GATEKEEPER_URL)
            .get('/api/v1/db/verify')
            .reply(200, true);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const ok = await gatekeeper.verifyDb();

        expect(ok).toBe(true);
    });
});

describe('getStatus', () => {
    it('should return server status', async () => {
        nock(GATEKEEPER_URL)
            .get('/api/v1/status')
            .reply(200, { uptimeSeconds: 1234 });

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const status = await gatekeeper.getStatus();

        expect(status.uptimeSeconds).toBe(1234);
    });
});

describe('listRegistries', () => {
    it('should return list of default valid registries', async () => {
        nock(GATEKEEPER_URL)
            .get('/api/v1/registries')
            .reply(200, ['local', 'hyperswarm']);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const registries = await gatekeeper.listRegistries();

        expect(registries.length).toBe(2);
        expect(registries.includes('local')).toBe(true);
        expect(registries.includes('hyperswarm')).toBe(true);
    });
});

describe('createDID', () => {
    it('should return a DID', async () => {
        nock(GATEKEEPER_URL)
            .post('/api/v1/did')
            .reply(200, 'did:mock:1234');

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const did = await gatekeeper.createDID({});

        expect(did).toBe('did:mock:1234');
    });
});

describe('resolveDID', () => {
    const mockDID = 'did:mock:1234';
    const mockDocs = { id: mockDID };

    it('should return DID documents', async () => {
        nock(GATEKEEPER_URL)
            .get(`/api/v1/did/${mockDID}`)
            .reply(200, mockDocs);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const docs = await gatekeeper.resolveDID(mockDID);

        expect(docs).toStrictEqual(mockDocs);
    });

    it('should throw exception when DID not found', async () => {
        nock(GATEKEEPER_URL)
            .get(`/api/v1/did/${mockDID}`)
            .reply(404, { message: 'DID not found' });

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });

        try {
            await gatekeeper.resolveDID(mockDID);
            throw new ExpectedExceptionError();
        }
        catch (error) {
            expect(error.message).toBe('DID not found');
        }
    });
});

describe('updateDID', () => {
    const mockDID = 'did:mock:1234';

    it('should return update status', async () => {
        nock(GATEKEEPER_URL)
            .post(`/api/v1/did/${mockDID}`)
            .reply(200, true);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const ok = await gatekeeper.updateDID({ did: mockDID });

        expect(ok).toBe(true);
    });
});

describe('deleteDID', () => {
    const mockDID = 'did:mock:1234';

    it('should return delete status', async () => {
        nock(GATEKEEPER_URL)
            .delete(`/api/v1/did/${mockDID}`)
            .reply(200, true);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const ok = await gatekeeper.deleteDID({ did: mockDID });

        expect(ok).toBe(true);
    });
});

describe('getDIDs', () => {
    it('should return DID list', async () => {
        nock(GATEKEEPER_URL)
            .post(`/api/v1/dids`)
            .reply(200, []);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const dids = await gatekeeper.getDIDs();

        expect(dids).toStrictEqual([]);
    });
});

describe('removeDIDs', () => {
    it('should return remove status', async () => {
        nock(GATEKEEPER_URL)
            .post(`/api/v1/dids/remove`)
            .reply(200, true);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const ok = await gatekeeper.removeDIDs();

        expect(ok).toStrictEqual(true);
    });
});

describe('exportDIDs', () => {
    it('should return exported DID list', async () => {
        nock(GATEKEEPER_URL)
            .post(`/api/v1/dids/export`)
            .reply(200, []);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const ops = await gatekeeper.exportDIDs();

        expect(ops).toStrictEqual([]);
    });
});

describe('importDIDs', () => {
    it('should return imported DID results', async () => {
        nock(GATEKEEPER_URL)
            .post(`/api/v1/dids/import`)
            .reply(200, { queued: 0, processed: 0 });

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const results = await gatekeeper.importDIDs();

        expect(results).toStrictEqual({ queued: 0, processed: 0 });
    });
});

describe('exportBatch', () => {
    it('should return exported batch', async () => {
        nock(GATEKEEPER_URL)
            .post(`/api/v1/batch/export`)
            .reply(200, []);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const ops = await gatekeeper.exportBatch();

        expect(ops).toStrictEqual([]);
    });
});

describe('importBatch', () => {
    it('should return imported batch results', async () => {
        nock(GATEKEEPER_URL)
            .post(`/api/v1/batch/import`)
            .reply(200, { queued: 0, processed: 0 });

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const results = await gatekeeper.importBatch();

        expect(results).toStrictEqual({ queued: 0, processed: 0 });
    });
});

describe('getQueue', () => {
    const mockRegistry = 'local';

    it('should return queue', async () => {
        nock(GATEKEEPER_URL)
            .get(`/api/v1/queue/${mockRegistry}`)
            .reply(200, []);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const queue = await gatekeeper.getQueue(mockRegistry);

        expect(queue).toStrictEqual([]);
    });
});

describe('clearQueue', () => {
    const mockRegistry = 'local';

    it('should return clear status', async () => {
        nock(GATEKEEPER_URL)
            .post(`/api/v1/queue/${mockRegistry}/clear`)
            .reply(200, true);

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const ok = await gatekeeper.clearQueue(mockRegistry);

        expect(ok).toStrictEqual(true);
    });
});

describe('processEvents', () => {
    it('should return process status', async () => {
        nock(GATEKEEPER_URL)
            .post(`/api/v1/events/process`)
            .reply(200, { added: 0, merged: 0, pending: 0 });

        const gatekeeper = await GatekeeperClient.create({ url: GATEKEEPER_URL });
        const status = await gatekeeper.processEvents();

        expect(status).toStrictEqual({ added: 0, merged: 0, pending: 0 });
    });
});
