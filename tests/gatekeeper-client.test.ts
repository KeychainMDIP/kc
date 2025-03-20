import nock from 'nock';
import GatekeeperClient from '@mdip/gatekeeper/client';
import { ExpectedExceptionError } from '@mdip/common/errors';

const GatekeeperURL = 'http://gatekeeper.org';
const ServerError = { message: 'Server error' };
const MockDID = 'did:mock:1234';

const mockConsole = {
    log: () => { },
    error: () => { },
    time: () => { },
    timeEnd: () => { },
} as unknown as typeof console;

describe('isReady', () => {
    it('should return ready flag', async () => {
        nock(GatekeeperURL)
            // eslint-disable-next-line
            .get('/api/v1/ready')
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const isReady = await gatekeeper.isReady();

        expect(isReady).toBe(true);
    });

    it('should return false on server error', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/ready')
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const isReady = await gatekeeper.isReady();

        expect(isReady).toBe(false);
    });

    it('should wait until ready', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/ready')
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({
            url: GatekeeperURL,
            waitUntilReady: true,
            chatty: true,
            console: mockConsole
        });

        expect(gatekeeper != null).toBe(true);
    });

    it('should timeout if not ready', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/ready')
            .reply(200, 'false');

        const gatekeeper = await GatekeeperClient.create({
            url: GatekeeperURL,
            waitUntilReady: true,
            intervalSeconds: 0.1,
            maxRetries: 2,
            becomeChattyAfter: 1,
            console: mockConsole
        });

        expect(gatekeeper != null).toBe(true);
    });
});

describe('getVersion', () => {
    it('should return version', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/version')
            .reply(200, '1');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const version = await gatekeeper.getVersion();

        expect(version).toBe(1);
    });

    it('should throw exception on getVersion server error', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/version')
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.getVersion();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('resetDb', () => {
    it('should return reset status', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/db/reset')
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ok = await gatekeeper.resetDb();

        expect(ok).toBe(true);
    });

    it('should throw exception on resetDb server error', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/db/reset')
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.resetDb();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('verifyDb', () => {
    it('should return verify status', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/db/verify')
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ok = await gatekeeper.verifyDb();

        expect(ok).toBe(true);
    });

    it('should throw exception on verifyDb server error', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/db/verify')
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.verifyDb();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getStatus', () => {
    it('should return server status', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/status')
            .reply(200, { uptimeSeconds: 1234 });

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const status = await gatekeeper.getStatus();

        expect(status.uptimeSeconds).toBe(1234);
    });

    it('should throw exception on getStatus server error', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/status')
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.getStatus();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('listRegistries', () => {
    it('should return list of default valid registries', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/registries')
            .reply(200, ['local', 'hyperswarm']);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const registries = await gatekeeper.listRegistries();

        expect(registries).toStrictEqual(['local', 'hyperswarm']);
    });

    it('should throw exception on listRegistries server error', async () => {
        nock(GatekeeperURL)
            .get('/api/v1/registries')
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.listRegistries();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createDID', () => {
    it('should return a DID', async () => {
        nock(GatekeeperURL)
            .post('/api/v1/did')
            .reply(200, 'did:mock:4321');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const did = await gatekeeper.createDID({type: 'create'});

        expect(did).toBe('did:mock:4321');
    });

    it('should throw exception on createDID server error', async () => {
        nock(GatekeeperURL)
            .post('/api/v1/did')
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.createDID({type: 'create'});
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('resolveDID', () => {
    const mockDocs = { id: MockDID };

    it('should return DID documents', async () => {
        nock(GatekeeperURL)
            .get(`/api/v1/did/${MockDID}`)
            .reply(200, mockDocs);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const docs = await gatekeeper.resolveDID(MockDID);

        expect(docs).toStrictEqual(mockDocs);
    });

    it('should return specified DID documents', async () => {
        nock(GatekeeperURL)
            .get(`/api/v1/did/${MockDID}?version=1&confirm=true`)
            .reply(200, mockDocs);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const docs = await gatekeeper.resolveDID(MockDID, { version: 1, confirm: true } as any);

        expect(docs).toStrictEqual(mockDocs);
    });

    it('should throw exception when DID not found', async () => {
        nock(GatekeeperURL)
            .get(`/api/v1/did/${MockDID}`)
            .reply(404, { message: 'DID not found' });

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.resolveDID(MockDID);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('DID not found');
        }
    });
});

describe('updateDID', () => {
    it('should return update status', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/did`)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ok = await gatekeeper.updateDID({ type: 'update', did: MockDID });

        expect(ok).toBe(true);
    });

    it('should throw exception on updateDID server error', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/did`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.updateDID({ type: 'update', did: MockDID });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('deleteDID', () => {
    it('should return delete status', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/did`)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ok = await gatekeeper.deleteDID({ type: 'delete', did: MockDID });

        expect(ok).toBe(true);
    });

    it('should throw exception on getDIDs server error', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/did`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.deleteDID({ type: 'delete', did: MockDID });
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getDIDs', () => {
    it('should return DID list', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/dids`)
            .reply(200, []);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const dids = await gatekeeper.getDIDs();

        expect(dids).toStrictEqual([]);
    });

    it('should throw exception on getDIDs server error', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/dids`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.getDIDs();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('removeDIDs', () => {
    it('should return remove status', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/dids/remove`)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        // @ts-expect-error Testing without arguments
        const ok = await gatekeeper.removeDIDs();

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on removeDIDs server error', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/dids/remove`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            // @ts-expect-error Testing without arguments
            await gatekeeper.removeDIDs();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('exportDIDs', () => {
    it('should return exported DID list', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/dids/export`)
            .reply(200, []);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ops = await gatekeeper.exportDIDs();

        expect(ops).toStrictEqual([]);
    });

    it('should throw exception on exportDIDs server error', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/dids/export`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.exportDIDs();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('importDIDs', () => {
    it('should return imported DID results', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/dids/import`)
            .reply(200, { queued: 0, processed: 0 });

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        // @ts-expect-error Testing without arguments
        const results = await gatekeeper.importDIDs();

        expect(results).toStrictEqual({ queued: 0, processed: 0 });
    });

    it('should throw exception on importDIDs server error', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/dids/import`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            // @ts-expect-error Testing without arguments
            await gatekeeper.importDIDs();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('exportBatch', () => {
    it('should return exported batch', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/batch/export`)
            .reply(200, []);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ops = await gatekeeper.exportBatch();

        expect(ops).toStrictEqual([]);
    });

    it('should throw exception on exportBatch server error', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/batch/export`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.exportBatch();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('importBatch', () => {
    it('should return imported batch results', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/batch/import`)
            .reply(200, { queued: 0, processed: 0 });

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        // @ts-expect-error Testing without arguments
        const results = await gatekeeper.importBatch();

        expect(results).toStrictEqual({ queued: 0, processed: 0 });
    });

    it('should throw exception on importBatch server error', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/batch/import`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            // @ts-expect-error Testing without arguments
            await gatekeeper.importBatch();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getQueue', () => {
    const mockRegistry = 'local';

    it('should return queue', async () => {
        nock(GatekeeperURL)
            .get(`/api/v1/queue/${mockRegistry}`)
            .reply(200, []);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const queue = await gatekeeper.getQueue(mockRegistry);

        expect(queue).toStrictEqual([]);
    });

    it('should throw exception on getQueue server error', async () => {
        const mockRegistry = 'local';

        nock(GatekeeperURL)
            .get(`/api/v1/queue/${mockRegistry}`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.getQueue(mockRegistry);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('clearQueue', () => {
    const mockRegistry = 'local';

    it('should return clear status', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/queue/${mockRegistry}/clear`)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        // @ts-expect-error Testing missing argument
        const ok = await gatekeeper.clearQueue(mockRegistry);

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on clearQueue server error', async () => {
        const mockRegistry = 'local';

        nock(GatekeeperURL)
            .post(`/api/v1/queue/${mockRegistry}/clear`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            // @ts-expect-error Testing missing argument
            await gatekeeper.clearQueue(mockRegistry);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('processEvents', () => {
    it('should return process status', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/events/process`)
            .reply(200, { added: 0, merged: 0, pending: 0 });

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const status = await gatekeeper.processEvents();

        expect(status).toStrictEqual({ added: 0, merged: 0, pending: 0 });
    });

    it('should throw exception on processEvents server error', async () => {
        nock(GatekeeperURL)
            .post(`/api/v1/events/process`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.processEvents();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});
