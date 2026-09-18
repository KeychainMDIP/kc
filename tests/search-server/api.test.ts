import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { jest } from '@jest/globals';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import { INDEX_SYNC_STATE_KEYS } from '../../services/search-server/src/DidIndexer.ts';
import { extractPublishedCredentials } from '../../services/search-server/src/published-credentials.ts';
import { createSeedEvent, seedDID } from './db-seed.ts';
import type { NetworkMetricSnapshot } from '../../services/search-server/src/types.ts';

/* eslint-disable sonarjs/no-hardcoded-ip */

const require = createRequire(new URL('../../services/search-server/package.json', import.meta.url));
const express = require('express') as typeof import('express');
// Keep this standalone service under its own TypeScript build configuration.
const serverEntry = '../../services/search-server/src/index.ts';
const schemaDid = 'did:mdip:z3v8AuacR4diTuCgtbEfLDo2LzQNEDHgqBSNLMs5Szuq3WHcQdB';
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const connect = jest.fn<() => Promise<void>>();
const startIndexing = jest.fn();
const stopIndexing = jest.fn();
const resolveDID = jest.fn<(...args: any[]) => Promise<any>>();
const sqliteCreate = jest.fn(async () => db);
const postgresCreate = jest.fn(async () => db);
let db: DIDsDbMemory;
let config: Record<string, any>;
let app: ReturnType<typeof express>;
let server: Server | undefined;
let base: string;
let limiter: { skip: (req: any) => boolean };
let signalListeners: Record<string, ReturnType<typeof process.listeners>>;

jest.unstable_mockModule(require.resolve('express'), () => ({ default: Object.assign(() => app, express) }));
jest.unstable_mockModule(require.resolve('express-rate-limit').replace(/\.cjs$/, '.mjs'), () => ({ default: (options: typeof limiter) => {
    limiter = options;
    return (_req: unknown, _res: unknown, next: () => void) => next();
} }));
jest.unstable_mockModule('@mdip/common/logger', () => ({ childLogger: () => logger }));
jest.unstable_mockModule('@mdip/gatekeeper', () => ({ resolveDIDFromEvents: resolveDID }));
jest.unstable_mockModule('@mdip/gatekeeper/client', () => ({ default: class { connect = connect; } }));
jest.unstable_mockModule('./db/sqlite.js', () => ({ default: { create: sqliteCreate } }));
jest.unstable_mockModule('./db/postgres.js', () => ({ default: { create: postgresCreate } }));
jest.unstable_mockModule('../../services/search-server/src/db/json-memory.ts', () => ({
    default: class { constructor() { return db; } },
}));
jest.unstable_mockModule('../../services/search-server/src/config.ts', () => ({ default: config }));
jest.unstable_mockModule('../../services/search-server/src/DidIndexer.ts', () => ({
    INDEX_SYNC_STATE_KEYS,
    default: class {
        startIndexing = startIndexing;
        stopIndexing = stopIndexing;
    },
}));

beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    db = new DIDsDbMemory();
    config = {
        db: 'memory', port: 0, didPrefix: 'did:mdip', postgresURL: 'postgresql://fixture',
        gatekeeperURL: 'http://fixture.invalid', refreshIntervalMs: 5000, metricsRefreshIntervalMs: 60000,
        rateLimitEnabled: false, rateLimitWhitelist: [], rateLimitSkipPaths: ['/api/v1/ready'],
        rateLimitWindowValue: 1, rateLimitWindowUnit: 'minute', rateLimitMaxRequests: 10,
        jsonLimit: '2mb', trustProxy: false,
    };
    app = express();
    server = undefined;
    connect.mockResolvedValue(undefined);
    resolveDID.mockImplementation(async ({ did, getBlock }) => {
        await getBlock('local', 1);
        return { didDocument: { id: did } };
    });
    signalListeners = Object.fromEntries(['SIGTERM', 'SIGINT'].map(signal => [signal, process.listeners(signal)]));
    jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

afterEach(async () => {
    if (server) {
        server.closeAllConnections();
        await new Promise<void>(resolve => server!.close(() => resolve()));
    }
    for (const signal of ['SIGTERM', 'SIGINT']) {
        for (const listener of process.listeners(signal)) {
            if (!signalListeners[signal].includes(listener)) process.removeListener(signal, listener);
        }
    }
    jest.restoreAllMocks();
});

async function boot() {
    const listening = new Promise<void>(resolve => {
        jest.spyOn(app, 'listen').mockImplementation(((_port: number, callback: () => void) => {
            server = createServer(app).listen(0, '127.0.0.1', () => { callback(); resolve(); });
            return server;
        }) as typeof app.listen);
    });
    await import(serverEntry);
    await listening;
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/v1`;
}

async function request(path: string, body?: unknown) {
    const response = await fetch(`${base}${path}`, body === undefined ? undefined : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

describe('Search Server HTTP routes', () => {
    it('returns identities with defaults and projects repeated field parameters within the configured scope', async () => {
        const event = createSeedEvent(schemaDid);
        event.operation.mdip!.type = 'agent';
        event.operation.mdip!.prefix = 'did:mdip';
        const doc = { didDocumentData: { manifest: {
            'did:mdip:credential': { type: ['VerifiableCredential', schemaDid], issuer: schemaDid,
                credentialSubject: { id: schemaDid }, credential: { label: 'Alice', score: 0, unrequested: 'omit' } },
        } } };
        await seedDID(db, schemaDid, { events: [event], doc, publishedCredentials: extractPublishedCredentials(schemaDid, doc) });
        const list = jest.spyOn(db, 'listIdentities');
        await boot();
        expect(await request('/identities')).toEqual({ status: 200, body: { total: 1, identities: [
            { did: schemaDid, manifestSchemaDids: [schemaDid] },
        ] } });
        expect(list).toHaveBeenLastCalledWith({ didPrefix: 'did:mdip', schemaDid: undefined, fields: [], limit: 50, offset: 0 });
        const query = new URLSearchParams({ schemaDid, limit: '501', offset: '0' });
        query.append('fields', 'label');
        query.append('fields', 'score');
        const result = await request(`/identities?${query}`);
        expect(result.status).toBe(200);
        expect(result.body.identities[0].credentials).toEqual([
            { credentialDid: 'did:mdip:credential', fields: { label: 'Alice', score: 0 } },
        ]);
        expect(list).toHaveBeenLastCalledWith({ didPrefix: 'did:mdip', schemaDid, fields: ['label', 'score'], limit: 500, offset: 0 });
        expect(await request('/identities?offset=1')).toEqual({ status: 200, body: { total: 1, identities: [] } });
    });

    it('filters identities and their total by schema before paginating the HTTP response', async () => {
        for (const name of ['Alice', 'Bob', 'Carol']) {
            const did = `did:mdip:${name}`;
            const event = createSeedEvent(did);
            event.operation.mdip!.type = 'agent';
            event.operation.mdip!.prefix = 'did:mdip';
            const doc = { didDocumentData: { manifest: name === 'Alice' ? {} : {
                [`did:mdip:profile-${name}`]: {
                    type: ['VerifiableCredential', schemaDid], issuer: did,
                    credentialSubject: { id: did }, credential: { publicName: name },
                },
            } } };
            await seedDID(db, did, { events: [event], doc, publishedCredentials: extractPublishedCredentials(did, doc) });
        }
        await boot();
        expect((await request('/identities')).body.total).toBe(3);
        const query = new URLSearchParams({ schemaDid, fields: 'publicName', limit: '1', offset: '0' });
        expect(await request(`/identities?${query}`)).toEqual({ status: 200, body: {
            total: 2, identities: [{ did: 'did:mdip:Bob', manifestSchemaDids: [schemaDid], credentials: [
                { credentialDid: 'did:mdip:profile-Bob', fields: { publicName: 'Bob' } },
            ] }],
        } });
        query.set('offset', '1');
        query.delete('fields');
        expect(await request(`/identities?${query}`)).toEqual({ status: 200, body: {
            total: 2, identities: [{ did: 'did:mdip:Carol', manifestSchemaDids: [schemaDid] }],
        } });
    });

    it('rejects invalid identity queries before consulting storage and reports storage errors as 500', async () => {
        const list = jest.spyOn(db, 'listIdentities');
        await boot();
        for (const query of ['fields=label', 'schemaDid=invalid', 'limit=-1', 'offset=1.5', 'limit=1&limit=2', `schemaDid=${schemaDid}&fields=`]) {
            expect((await request(`/identities?${query}`)).status).toBe(400);
        }
        expect(list).not.toHaveBeenCalled();
        list.mockRejectedValue(new Error('storage unavailable'));
        expect(await request('/identities')).toEqual({ status: 500, body: { error: 'Error: storage unavailable' } });
    });

    it('serves readiness and synchronization status', async () => {
        await boot();
        expect(await request('/ready')).toEqual({ status: 200, body: { ready: true } });
        const status = await request('/status');
        expect(status.status).toBe(200);
        expect(status.body).toMatchObject({ ready: true, db: 'memory', sync: { snapshotComplete: false } });
    });

    it('forwards event, credential and receipt filters and pagination to storage', async () => {
        const events = jest.spyOn(db, 'listEvents');
        const credentials = jest.spyOn(db, 'listPublishedCredentials');
        const receipts = jest.spyOn(db, 'listChallengeReceipts');
        const usage = jest.spyOn(db, 'getChallengeReceiptUsage');
        await boot();
        for (const path of ['/events', '/metrics/credentials/published', '/metrics/challenge-receipts']) {
            expect((await request(path)).status).toBe(200);
        }
        expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
        expect(credentials).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
        expect(receipts).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
        const bounds = { updatedAfter: '2026-01-01', updatedBefore: '2026-02-01' };
        const pagination = { limit: '2', offset: '1' };
        expect((await request(`/events?${new URLSearchParams({ registry: 'local', ...bounds, ...pagination })}`)).status).toBe(200);
        expect(events).toHaveBeenLastCalledWith({ didPrefix: 'did:mdip', registry: 'local', ...bounds, limit: 2, offset: 1 });

        const credentialFilter = { credentialDid: 'credential', schemaDid, issuerDid: 'issuer', subjectDid: 'subject' };
        expect((await request(`/metrics/credentials/published?${new URLSearchParams({ ...credentialFilter, revealed: 'true', limit: '999' })}`)).status).toBe(200);
        expect(credentials).toHaveBeenLastCalledWith({ didPrefix: 'did:mdip', ...credentialFilter, revealed: true, limit: 500, offset: 0 });

        const usageFilter = { attesterDid: 'attester', schemaDid, requesterDid: 'requester', ...bounds };
        const receiptFilter = { receiptDid: 'receipt', responseCommitment: 'commitment', ...usageFilter };
        expect((await request(`/metrics/challenge-receipts?${new URLSearchParams({ ...receiptFilter, ...pagination })}`)).status).toBe(200);
        expect(receipts).toHaveBeenLastCalledWith({ didPrefix: 'did:mdip', ...receiptFilter, limit: 2, offset: 1 });
        expect((await request('/metrics/challenge-receipts/usage')).status).toBe(400);
        expect(usage).not.toHaveBeenCalled();
        expect((await request('/metrics/challenge-receipts/usage?attesterDid=attester')).status).toBe(200);
        expect(usage).toHaveBeenLastCalledWith(expect.objectContaining({ attesterDid: 'attester', limit: 50, offset: 0 }));
        expect((await request(`/metrics/challenge-receipts/usage?${new URLSearchParams({ ...usageFilter, ...pagination })}`)).status).toBe(200);
        expect(usage).toHaveBeenLastCalledWith({ didPrefix: 'did:mdip', ...usageFilter, limit: 2, offset: 1 });
    });

    it('forwards search and document queries and rejects missing query objects', async () => {
        const search = jest.spyOn(db, 'searchDocs').mockResolvedValue([schemaDid]);
        const query = jest.spyOn(db, 'queryDocs').mockResolvedValue([schemaDid]);
        await boot();
        expect(await request('/search')).toEqual({ status: 200, body: [] });
        expect(search).not.toHaveBeenCalled();
        expect(await request('/search?q=Alice')).toEqual({ status: 200, body: [schemaDid] });
        expect(search).toHaveBeenCalledWith('Alice', 'did:mdip');
        for (const body of [{}, { where: 'invalid' }]) {
            expect((await request('/query', body)).status).toBe(400);
        }
        expect(query).not.toHaveBeenCalled();
        const where = { 'mdip.type': 'agent' };
        expect(await request('/query', { where })).toEqual({ status: 200, body: [schemaDid] });
        expect(query).toHaveBeenCalledWith(where, 'did:mdip');
    });

    it('resolves event histories and forwards version options, returning 404 for unresolved documents', async () => {
        const event = createSeedEvent(schemaDid);
        event.operation.mdip!.prefix = 'did:mdip';
        await seedDID(db, schemaDid, { events: [event] });
        const block = jest.spyOn(db, 'getBlock');
        await boot();
        expect(await request(`/did/${schemaDid}/events`)).toEqual({ status: 200, body: [event] });
        expect(await request(`/did/${schemaDid}`)).toEqual({ status: 200, body: { didDocument: { id: schemaDid } } });
        expect(resolveDID).toHaveBeenLastCalledWith(expect.objectContaining({ did: schemaDid, events: [event], options: {} }));
        const versionTime = '2026-01-01T00:00:00Z';
        expect((await request(`/did/${schemaDid}?${new URLSearchParams({ versionSequence: '1', versionTime })}`)).status).toBe(200);
        expect(resolveDID).toHaveBeenLastCalledWith(expect.objectContaining({ options: { versionSequence: 1, versionTime } }));
        expect(block).toHaveBeenCalledWith('local', 1);
        expect((await request(`/did/${schemaDid}?versionSequence=0`)).status).toBe(400);
        resolveDID.mockResolvedValueOnce({ didResolutionMetadata: { error: 'notFound' } });
        expect((await request(`/did/${schemaDid}`)).status).toBe(404);
    });

    it('uses cached documents only for unversioned, in-scope requests', async () => {
        const cached = { didDocument: { id: 'did:mdip:cached' } };
        const getDoc = jest.spyOn(db, 'getDID').mockResolvedValue(cached);
        await boot();
        expect(await request('/did/did:mdip:cached')).toEqual({ status: 200, body: cached });
        getDoc.mockClear();
        expect((await request('/did/did:mdip:cached?versionSequence=1')).status).toBe(404);
        expect((await request(`/did/${schemaDid}`)).status).toBe(404);
        expect(getDoc).not.toHaveBeenCalled();
        getDoc.mockResolvedValue(null);
        expect((await request('/did/did:mdip:missing')).status).toBe(404);
    });

    it('returns current schema counts and directs dated requests to snapshots', async () => {
        const schemas = [{ schemaDid, count: 2 }];
        const counts = jest.spyOn(db, 'getPublishedCredentialCountsBySchema').mockResolvedValue(schemas);
        await boot();
        expect((await request('/metrics/schemas/published?date=2026-01-01')).status).toBe(400);
        expect(counts).not.toHaveBeenCalled();
        expect(await request('/metrics/schemas/published')).toEqual({ status: 200, body: { schemas } });
        expect(counts).toHaveBeenCalledWith('did:mdip');
    });

    it('serves each snapshot projection only when the date and configured scope are valid', async () => {
        const date = '2026-01-01';
        const snapshot: NetworkMetricSnapshot = {
            date, rebuiltAt: '2026-01-02T00:00:00Z', didCount: 4, didCountsByPrefix: { 'did:mdip': 4 },
            agentDidCount: 2, agentDidCountsByPrefix: { 'did:mdip': 2 },
            credentialCount: 1, credentialDidCountsByPrefix: { 'did:mdip': 1 }, schemas: [{ schemaDid, count: 1 }],
        };
        const getSnapshot = jest.spyOn(db, 'getNetworkMetricSnapshot').mockResolvedValue(snapshot);
        await boot();
        expect((await request('/metrics/snapshots/invalid')).status).toBe(400);
        expect((await request(`/metrics/snapshots/${date}`)).status).toBe(503);
        expect(getSnapshot).not.toHaveBeenCalled();
        await db.saveSyncState(INDEX_SYNC_STATE_KEYS.metricsDidPrefix, 'did:mdip');
        const projections = {
            '': snapshot,
            'dids/': { didCount: snapshot.didCount, didCountsByPrefix: snapshot.didCountsByPrefix },
            'schemas/': { schemas: snapshot.schemas },
            'agents/': { agentDidCount: snapshot.agentDidCount, agentDidCountsByPrefix: snapshot.agentDidCountsByPrefix },
            'credentials/': { credentialCount: snapshot.credentialCount, credentialDidCountsByPrefix: snapshot.credentialDidCountsByPrefix },
        };
        for (const [path, body] of Object.entries(projections)) {
            expect(await request(`/metrics/snapshots/${path}${date}`)).toEqual({ status: 200, body });
        }
        expect(getSnapshot).toHaveBeenLastCalledWith(date);
        getSnapshot.mockResolvedValue(null);
        expect((await request(`/metrics/snapshots/${date}`)).status).toBe(404);
    });

    it.each([
        ['/status', 'loadSyncState', undefined],
        ['/did/did:mdip:fixture/events', 'getDIDEvents', undefined],
        ['/did/did:mdip:fixture', 'getDIDEvents', undefined],
        ['/events', 'listEvents', undefined],
        ['/search?q=Alice', 'searchDocs', undefined],
        ['/query', 'queryDocs', { where: {} }],
        ['/metrics/schemas/published', 'getPublishedCredentialCountsBySchema', undefined],
        ['/metrics/snapshots/2026-01-01', 'getNetworkMetricSnapshot', undefined],
        ['/metrics/credentials/published', 'listPublishedCredentials', undefined],
        ['/metrics/challenge-receipts', 'listChallengeReceipts', undefined],
        ['/metrics/challenge-receipts/usage?attesterDid=attester', 'getChallengeReceiptUsage', undefined],
    ] as const)('reports storage errors from %s', async (path, method, body) => {
        await db.saveSyncState(INDEX_SYNC_STATE_KEYS.metricsDidPrefix, 'did:mdip');
        jest.spyOn(db, method).mockRejectedValue(new Error('storage unavailable'));
        await boot();
        expect(await request(path, body)).toEqual({ status: 500, body: { error: 'Error: storage unavailable' } });
    });

    it.each(['sqlite', 'postgres'])('selects the %s adapter and configures rate limiting', async name => {
        config.db = name;
        config.trustProxy = true;
        config.rateLimitEnabled = true;
        config.rateLimitWhitelist = ['127.0.0.1'];
        await boot();
        expect(app.get('trust proxy')).toBe(true);
        if (name === 'sqlite') expect(sqliteCreate).toHaveBeenCalledWith();
        else expect(postgresCreate).toHaveBeenCalledWith(config.postgresURL);
        expect(connect).toHaveBeenCalledWith({ url: config.gatekeeperURL, waitUntilReady: true, intervalSeconds: 5, chatty: true });
        expect(startIndexing).toHaveBeenCalledTimes(1);
        expect(await request('/ready')).toEqual({ status: 200, body: { ready: true } });
        expect(limiter.skip({ method: 'OPTIONS' })).toBe(true);
        expect(limiter.skip({ method: 'GET', originalUrl: '/api/v1/ready' })).toBe(true);
        const req = { method: 'GET', originalUrl: '/api/v1/identities', ip: '127.0.0.1', socket: {} };
        expect(limiter.skip(req)).toBe(true);
        expect(limiter.skip({ ...req, ip: '192.0.2.1' })).toBe(false);
        config.rateLimitWhitelist = [];
        expect(limiter.skip(req)).toBe(false);
    });

    it.each([false, true])('stops indexing and closes storage on shutdown (storage failure: %s)', async fail => {
        const disconnect = jest.spyOn(db, 'disconnect');
        if (fail) disconnect.mockRejectedValue(new Error('disconnect failed'));
        await boot();
        const shutdown = process.listeners('SIGTERM').find(listener => !signalListeners.SIGTERM.includes(listener))!;
        await shutdown('SIGTERM');
        expect(stopIndexing).toHaveBeenCalledTimes(1);
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(0);
        if (fail) expect(logger.error).toHaveBeenCalledWith({ error: expect.any(Error) }, 'Error during shutdown');
    });

    it('exits on startup failure without starting the HTTP listener', async () => {
        connect.mockRejectedValue(new Error('Gatekeeper unavailable'));
        await import(serverEntry);
        await new Promise(resolve => setImmediate(resolve));
        expect(startIndexing).not.toHaveBeenCalled();
        expect(process.exit).toHaveBeenCalledWith(1);
        expect(logger.error).toHaveBeenCalledWith({ error: expect.any(Error) }, '[search-server] Fatal error');
    });
});
