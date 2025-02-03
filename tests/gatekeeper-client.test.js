import nock from 'nock';
import GatekeeperClient from '@mdip/gatekeeper/client';

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
