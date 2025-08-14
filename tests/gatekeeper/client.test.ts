import nock from 'nock';
import GatekeeperClient from '@mdip/gatekeeper/client';
import { ExpectedExceptionError } from '@mdip/common/errors';

const GatekeeperURL = 'http://gatekeeper.org';
const ServerError = { message: 'Server error' };
const MockDID = 'did:mock:1234';
const Endpoints = {
    ready: '/api/v1/ready',
    version: '/api/v1/version',
    status: '/api/v1/status',
    did: '/api/v1/did',
    db: {
        reset: '/api/v1/db/reset',
        verify: '/api/v1/db/verify',
    },
    dids: {
        list: '/api/v1/dids',
        export: '/api/v1/dids/export',
        import: '/api/v1/dids/import',
        remove: '/api/v1/dids/remove',
    },
    batch: {
        export: '/api/v1/batch/export',
        import: '/api/v1/batch/import',
    },
    registries: '/api/v1/registries',
    queue: '/api/v1/queue',
    events: {
        process: '/api/v1/events/process',
    },
    cas: {
        json: '/api/v1/cas/json',
        text: '/api/v1/cas/text',
        data: '/api/v1/cas/data',
    },
    block: '/api/v1/block',
};

const mockConsole = {
    log: () => { },
    error: () => { },
    time: () => { },
    timeEnd: () => { },
} as unknown as typeof console;

describe('isReady', () => {
    it('should return ready flag', async () => {
        nock(GatekeeperURL)
            .get(Endpoints.ready)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const isReady = await gatekeeper.isReady();

        expect(isReady).toBe(true);
    });

    it('should return false on server error', async () => {
        nock(GatekeeperURL)
            .get(Endpoints.ready)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const isReady = await gatekeeper.isReady();

        expect(isReady).toBe(false);
    });

    it('should wait until ready', async () => {
        nock(GatekeeperURL)
            .get(Endpoints.ready)
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
            .get(Endpoints.ready)
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
            .get(Endpoints.version)
            .reply(200, '1');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const version = await gatekeeper.getVersion();

        expect(version).toBe(1);
    });

    it('should throw exception on getVersion server error', async () => {
        nock(GatekeeperURL)
            .get(Endpoints.version)
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
            .get(Endpoints.db.reset)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ok = await gatekeeper.resetDb();

        expect(ok).toBe(true);
    });

    it('should throw exception on resetDb server error', async () => {
        nock(GatekeeperURL)
            .get(Endpoints.db.reset)
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
            .get(Endpoints.db.verify)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ok = await gatekeeper.verifyDb();

        expect(ok).toBe(true);
    });

    it('should throw exception on verifyDb server error', async () => {
        nock(GatekeeperURL)
            .get(Endpoints.db.verify)
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
            .get(Endpoints.status)
            .reply(200, { uptimeSeconds: 1234 });

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const status = await gatekeeper.getStatus();

        expect(status.uptimeSeconds).toBe(1234);
    });

    it('should throw exception on getStatus server error', async () => {
        nock(GatekeeperURL)
            .get(Endpoints.status)
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
            .get(Endpoints.registries)
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
            .post(Endpoints.did)
            .reply(200, 'did:mock:4321');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const did = await gatekeeper.createDID({ type: 'create' });

        expect(did).toBe('did:mock:4321');
    });

    it('should throw exception on createDID server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.did)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.createDID({ type: 'create' });
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
            .get(`${Endpoints.did}/${MockDID}`)
            .reply(200, mockDocs);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const docs = await gatekeeper.resolveDID(MockDID);

        expect(docs).toStrictEqual(mockDocs);
    });

    it('should return specified DID documents', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.did}/${MockDID}?version=1&confirm=true`)
            .reply(200, mockDocs);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const docs = await gatekeeper.resolveDID(MockDID, { version: 1, confirm: true } as any);

        expect(docs).toStrictEqual(mockDocs);
    });

    it('should throw exception when DID not found', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.did}/${MockDID}`)
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
            .post(Endpoints.did)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ok = await gatekeeper.updateDID({ type: 'update', did: MockDID });

        expect(ok).toBe(true);
    });

    it('should throw exception on updateDID server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.did)
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
            .post(Endpoints.did)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ok = await gatekeeper.deleteDID({ type: 'delete', did: MockDID });

        expect(ok).toBe(true);
    });

    it('should throw exception on getDIDs server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.did)
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
            .post(Endpoints.dids.list)
            .reply(200, []);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const dids = await gatekeeper.getDIDs();

        expect(dids).toStrictEqual([]);
    });

    it('should throw exception on getDIDs server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.dids.list)
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
            .post(Endpoints.dids.remove)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        // @ts-expect-error Testing without arguments
        const ok = await gatekeeper.removeDIDs();

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on removeDIDs server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.dids.remove)
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
            .post(Endpoints.dids.export)
            .reply(200, []);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ops = await gatekeeper.exportDIDs();

        expect(ops).toStrictEqual([]);
    });

    it('should throw exception on exportDIDs server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.dids.export)
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
            .post(Endpoints.dids.import)
            .reply(200, { queued: 0, processed: 0 });

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        // @ts-expect-error Testing without arguments
        const results = await gatekeeper.importDIDs();

        expect(results).toStrictEqual({ queued: 0, processed: 0 });
    });

    it('should throw exception on importDIDs server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.dids.import)
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
            .post(Endpoints.batch.export)
            .reply(200, []);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ops = await gatekeeper.exportBatch();

        expect(ops).toStrictEqual([]);
    });

    it('should throw exception on exportBatch server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.batch.export)
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
            .post(Endpoints.batch.import)
            .reply(200, { queued: 0, processed: 0 });

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        // @ts-expect-error Testing without arguments
        const results = await gatekeeper.importBatch();

        expect(results).toStrictEqual({ queued: 0, processed: 0 });
    });

    it('should throw exception on importBatch server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.batch.import)
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
            .get(`${Endpoints.queue}/${mockRegistry}`)
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
            .post(`${Endpoints.queue}/${mockRegistry}/clear`)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        // @ts-expect-error Testing missing argument
        const ok = await gatekeeper.clearQueue(mockRegistry);

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on clearQueue server error', async () => {
        const mockRegistry = 'local';

        nock(GatekeeperURL)
            .post(`${Endpoints.queue}/${mockRegistry}/clear`)
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
            .post(Endpoints.events.process)
            .reply(200, { added: 0, merged: 0, pending: 0 });

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const status = await gatekeeper.processEvents();

        expect(status).toStrictEqual({ added: 0, merged: 0, pending: 0 });
    });

    it('should throw exception on processEvents server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.events.process)
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

describe('addJSON', () => {
    const mockJSON = { mockData: 'mockData' };
    const mockCID = 'mockCID';

    it('should return a CID for JSON', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.cas.json)
            .reply(200, mockCID);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const cid = await gatekeeper.addJSON(mockJSON);

        expect(cid).toStrictEqual(mockCID);
    });

    it('should throw exception on addJSON server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.cas.json)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.addJSON(mockJSON);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getJSON', () => {
    const mockJSON = { mockData: 'mockData' };
    const mockCID = 'mockCID';

    it('should return JSON', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.cas.json}/${mockCID}`)
            .reply(200, mockJSON);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const json = await gatekeeper.getJSON(mockCID);

        expect(json).toStrictEqual(mockJSON);
    });

    it('should throw exception on getJSON server error', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.cas.json}/${mockCID}`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.getJSON(mockCID);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('addText', () => {
    const mockText = 'mockText';
    const mockCID = 'mockCID';

    it('should return a CID for text', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.cas.text)
            .reply(200, mockCID);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const cid = await gatekeeper.addText(mockText);

        expect(cid).toStrictEqual(mockCID);
    });

    it('should throw exception on addText server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.cas.text)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.addText(mockText);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getText', () => {
    const mockText = 'mockText';
    const mockCID = 'mockCID';

    it('should return text', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.cas.text}/${mockCID}`)
            .reply(200, mockText);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const json = await gatekeeper.getText(mockCID);

        expect(json).toStrictEqual(mockText);
    });

    it('should throw exception on getText server error', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.cas.text}/${mockCID}`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.getText(mockCID);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('addData', () => {
    const mockData = Buffer.from('mockData');
    const mockCID = 'mockCID';

    it('should return a CID for data', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.cas.data)
            .reply(200, mockCID);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const cid = await gatekeeper.addData(mockData);

        expect(cid).toStrictEqual(mockCID);
    });

    it('should throw exception on addData server error', async () => {
        nock(GatekeeperURL)
            .post(Endpoints.cas.data)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.addData(mockData);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getData', () => {
    const mockData = Buffer.from('mockData');
    const mockCID = 'mockCID';

    it('should return text', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.cas.data}/${mockCID}`)
            .reply(200, mockData);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const json = await gatekeeper.getData(mockCID);

        expect(json).toStrictEqual(mockData);
    });

    it('should throw exception on getData server error', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.cas.data}/${mockCID}`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.getData(mockCID);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('addBlock', () => {
    const mockBlock = { hash: 'mockHash', height: 1, time: 1234 };
    const mockRegistry = 'local';

    it('should add a block', async () => {
        nock(GatekeeperURL)
            .post(`${Endpoints.block}/${mockRegistry}`)
            .reply(200, 'true');

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const ok = await gatekeeper.addBlock(mockRegistry, mockBlock);

        expect(ok).toBe(true);
    });

    it('should throw exception on addBlock server error', async () => {
        nock(GatekeeperURL)
            .post(`${Endpoints.block}/${mockRegistry}`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.addBlock(mockRegistry, mockBlock);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getBlock', () => {
    const mockBlock = { hash: 'mockHash', height: 1, time: 1234 };
    const mockRegistry = 'local';

    it('should return the latest block', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.block}/${mockRegistry}/latest`)
            .reply(200, mockBlock);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const block = await gatekeeper.getBlock(mockRegistry);

        expect(block).toStrictEqual(mockBlock);
    });

    it('should return the block by hash', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.block}/${mockRegistry}/${mockBlock.hash}`)
            .reply(200, mockBlock);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const block = await gatekeeper.getBlock(mockRegistry, mockBlock.hash);

        expect(block).toStrictEqual(mockBlock);
    });

    it('should return the block by height', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.block}/${mockRegistry}/${mockBlock.height}`)
            .reply(200, mockBlock);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        const block = await gatekeeper.getBlock(mockRegistry, mockBlock.height);

        expect(block).toStrictEqual(mockBlock);
    });

    it('should throw exception on getBlock server error', async () => {
        nock(GatekeeperURL)
            .get(`${Endpoints.block}/${mockRegistry}/latest`)
            .reply(500, ServerError);

        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });

        try {
            await gatekeeper.getBlock(mockRegistry);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

const CustomHeader = 'X-Custom-Header';
const CustomHeaderValue = 'CustomHeaderValue';

describe('addCustomHeader', () => {
    it('should add a custom header', async () => {
        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        gatekeeper.addCustomHeader(CustomHeader, CustomHeaderValue);

        // Use nock to intercept and inspect the header
        const scope = nock(GatekeeperURL)
            .get(Endpoints.registries)
            .matchHeader(CustomHeader, CustomHeaderValue)
            .reply(200, ['local', 'hyperswarm']);

        await gatekeeper.listRegistries();
        expect(scope.isDone()).toBe(true);
    });
});

describe('removeCustomHeader', () => {
    it('should remove a custom header', async () => {
        const gatekeeper = await GatekeeperClient.create({ url: GatekeeperURL });
        gatekeeper.addCustomHeader(CustomHeader, CustomHeaderValue);
        gatekeeper.removeCustomHeader(CustomHeader);

        // Use nock to intercept and ensure the header is not present
        const scope = nock(GatekeeperURL)
            .get(Endpoints.registries)
            .matchHeader(CustomHeader, (val) => val === undefined)
            .reply(200, ['local', 'hyperswarm']);

        await gatekeeper.listRegistries();
        expect(scope.isDone()).toBe(true);
    });
});
