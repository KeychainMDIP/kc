import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import HeliaClient from '@mdip/ipfs/helia';
import { jest } from '@jest/globals';
import TestHelper from './helper.ts';

const mockConsole = {
    log: (): void => { },
    error: (): void => { },
    time: (): void => { },
    timeEnd: (): void => { },
} as unknown as typeof console;

const cipher = new CipherNode();
const db = new DbJsonMemory('test');
const ipfs = new HeliaClient();
const gatekeeper = new Gatekeeper({ db, ipfs, console: mockConsole, registries: ['local', 'hyperswarm', 'TFTC'] });
const helper = new TestHelper(gatekeeper, cipher);

beforeAll(async () => {
    await db.start();
    await ipfs.start();
});

afterAll(async () => {
    await ipfs.stop();
    await db.stop();
});

beforeEach(async () => {
    await gatekeeper.resetDb();  // Reset database for each test to ensure isolation
});

describe('verifyDb', () => {

    it('should verify all DIDs in db', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const { verified, expired, invalid, total } = await gatekeeper.verifyDb();

        expect(verified).toBe(2);
        expect(expired).toBe(0);
        expect(invalid).toBe(0);
        expect(total).toBe(2);
    });

    it('should get same results with cached verifications', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const verify1 = await gatekeeper.verifyDb();
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID');
        const verify2 = await gatekeeper.verifyDb();

        expect(verify1).toStrictEqual(verify2);
        expect(resolveDID).not.toHaveBeenCalled();
        resolveDID.mockRestore();
    });

    it('should get same results with chatty turned off', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const verify1 = await gatekeeper.verifyDb();
        const verify2 = await gatekeeper.verifyDb({ chatty: false });

        expect(verify1).toStrictEqual(verify2);
    });

    it('should share an in-flight verification run', async () => {
        let signalRun: () => void = () => { };
        let releaseRun: () => void = () => { };
        const runStarted = new Promise<void>(resolve => (signalRun = resolve));
        const runRelease = new Promise<void>(resolve => (releaseRun = resolve));
        const getDIDs = jest.spyOn(gatekeeper, 'getDIDs').mockImplementationOnce(async () => {
            signalRun();
            await runRelease;
            return [];
        });

        const first = gatekeeper.verifyDb({ chatty: false });
        try {
            await runStarted;
            const second = gatekeeper.verifyDb({ chatty: false });
            expect(second).toBe(first);
            expect(getDIDs).toHaveBeenCalledTimes(1);

            releaseRun();
            await expect(Promise.all([first, second])).resolves.toStrictEqual([
                { total: 0, verified: 0, expired: 0, invalid: 0 },
                { total: 0, verified: 0, expired: 0, invalid: 0 },
            ]);

            await gatekeeper.verifyDb({ chatty: false });
            expect(getDIDs).toHaveBeenCalledTimes(2);
        }
        finally {
            releaseRun();
            await first.catch(() => { });
            getDIDs.mockRestore();
        }
    });

    it('should allow verification to retry after failure', async () => {
        const getDIDs = jest.spyOn(gatekeeper, 'getDIDs')
            .mockRejectedValueOnce(new Error('mock failure'));

        try {
            const first = gatekeeper.verifyDb({ chatty: false });
            expect(gatekeeper.verifyDb({ chatty: false })).toBe(first);
            await expect(first).rejects.toThrow('mock failure');
            await expect(gatekeeper.verifyDb({ chatty: false })).resolves.toStrictEqual({
                total: 0,
                verified: 0,
                expired: 0,
                invalid: 0,
            });
            expect(getDIDs).toHaveBeenCalledTimes(2);
        }
        finally {
            getDIDs.mockRestore();
        }
    });

    it('should leave signature auditing to explicit verified resolution', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const doc = await gatekeeper.resolveDID(assetDID);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, assetDID, doc);
        const ok = await gatekeeper.updateDID(updateOp);
        expect(ok).toBe(true);

        // Can't verify a DID that has been updated if the controller is removed
        await gatekeeper.removeDIDs([agentDID]);

        const { verified, expired, invalid, total } = await gatekeeper.verifyDb();

        expect(verified).toBe(1);
        expect(expired).toBe(0);
        expect(invalid).toBe(0);
        expect(total).toBe(1);
        await expect(gatekeeper.resolveDID(assetDID, { verify: true })).rejects.toThrow();
    });

    it('should remove expired DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        // create asset that should expire
        const validUntil = new Date().toISOString();
        const assetOp1 = await helper.createAssetOp(agentDID, keypair, { registry: 'local', validUntil });
        await gatekeeper.createDID(assetOp1);

        // create asset that expires later
        const expires = new Date();
        expires.setHours(expires.getHours() + 1); // Add 1 hour
        const assetOp3 = await helper.createAssetOp(agentDID, keypair, { registry: 'local', validUntil: expires.toISOString() });
        await gatekeeper.createDID(assetOp3);

        const { verified, expired, invalid, total } = await gatekeeper.verifyDb();

        expect(verified).toBe(2);
        expect(expired).toBe(1);
        expect(invalid).toBe(0);
        expect(total).toBe(3);
    });

    it('should count an expired DID removed after the scan as expired', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const assetDID = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair, {
            validUntil: new Date(Date.now() - 1_000).toISOString(),
        }));
        const originalResolveDID = gatekeeper.resolveDID.bind(gatekeeper);
        const staleAssetDoc = await originalResolveDID(assetDID);
        await gatekeeper.removeDIDs([assetDID]);
        const getDIDs = jest.spyOn(gatekeeper, 'getDIDs').mockResolvedValueOnce([agentDID, assetDID]);
        let assetResolutions = 0;
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            if (did === assetDID && ++assetResolutions === 1) {
                return staleAssetDoc;
            }
            return originalResolveDID(did, options);
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 2,
                verified: 1,
                expired: 1,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([agentDID]);
        }
        finally {
            getDIDs.mockRestore();
            resolveDID.mockRestore();
        }
    });

    it('should remove cached assets before an expired agent with a custom prefix', async () => {
        const keypair = cipher.generateRandomJwk();
        const expiresAt = Date.now() + 60_000;
        const agentOp = await helper.createAgentOp(keypair, {
            prefix: 'did:custom',
            validUntil: new Date(expiresAt).toISOString(),
        });
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetDID1 = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair));
        const assetDID2 = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair));

        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
            total: 3,
            verified: 3,
            expired: 0,
            invalid: 0,
        });

        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID');
        const deleteEvents = jest.spyOn(db, 'deleteEvents');
        jest.useFakeTimers();
        jest.setSystemTime(expiresAt + 1);
        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 3,
                verified: 0,
                expired: 3,
                invalid: 0,
            });
            expect(resolveDID).toHaveBeenCalledTimes(6);
            expect(deleteEvents.mock.calls.map(([did]) => did.split(':').pop())).toStrictEqual([
                assetDID1,
                assetDID2,
                agentDID,
            ].map(did => did.split(':').pop()));
            expect(await gatekeeper.getDIDs()).toStrictEqual([]);
        }
        finally {
            jest.useRealTimers();
            resolveDID.mockRestore();
            deleteEvents.mockRestore();
        }
    });

    it('should re-resolve scan failures before classifying DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const expired = new Date(Date.now() - 1_000).toISOString();
        const controllerDID = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const assetDID1 = await gatekeeper.createDID(await helper.createAssetOp(controllerDID, keypair, {
            validUntil: expired,
        }));
        const assetDID2 = await gatekeeper.createDID(await helper.createAssetOp(controllerDID, keypair, {
            validUntil: expired,
        }));
        const expiredAgentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair, {
            validUntil: expired,
        }));
        const failOnce = new Set([controllerDID, assetDID1, assetDID2, expiredAgentDID]);
        const originalGetEvents = db.getEvents.bind(db);
        const getEvents = jest.spyOn(db, 'getEvents').mockImplementation(async did => {
            if (failOnce.delete(did)) {
                throw 'scan read failed';
            }
            return originalGetEvents(did);
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 4,
                verified: 1,
                expired: 3,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([controllerDID]);
        }
        finally {
            getEvents.mockRestore();
        }
    });

    it('should retry when an expired agent cannot be revalidated', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair, {
            validUntil: new Date(Date.now() - 1_000).toISOString(),
        }));
        const assetDID = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair));
        const originalGetEvents = db.getEvents.bind(db);
        let agentReads = 0;
        const getEvents = jest.spyOn(db, 'getEvents').mockImplementation(async did => {
            if (did === agentDID && ++agentReads === 2) {
                throw new Error('transient revalidation failure');
            }
            return originalGetEvents(did);
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 2,
                verified: 2,
                expired: 0,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([agentDID, assetDID]);
        }
        finally {
            getEvents.mockRestore();
        }

        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
            total: 2,
            verified: 0,
            expired: 2,
            invalid: 0,
        });
        expect(await gatekeeper.getDIDs()).toStrictEqual([]);
    });

    it('should retain a pending controller with an invalid resolution', async () => {
        const did = 'did:test:pending-invalid';
        const pending = (gatekeeper as unknown as {
            pendingExpiredControllers: Map<string, string>;
        }).pendingExpiredControllers;
        pending.set('pending-invalid', did);
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID').mockResolvedValue({
            didResolutionMetadata: { error: 'invalidDid' },
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 0,
                verified: 0,
                expired: 0,
                invalid: 0,
            });
            expect(pending.get('pending-invalid')).toBe(did);
        }
        finally {
            resolveDID.mockRestore();
        }
    });

    it('should not remove an agent renewed after the GC scan', async () => {
        const keypair = cipher.generateRandomJwk();
        const expiresAt = Date.now() + 60_000;
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair, {
            validUntil: new Date(expiresAt).toISOString(),
        }));
        const assetDID = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair));
        await gatekeeper.verifyDb({ chatty: false });

        const originalResolveDID = gatekeeper.resolveDID.bind(gatekeeper);
        let pauseAgentResolution = true;
        let signalResolution: () => void = () => { };
        let releaseResolution: () => void = () => { };
        const resolutionStarted = new Promise<void>(resolve => (signalResolution = resolve));
        const resolutionRelease = new Promise<void>(resolve => (releaseResolution = resolve));
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            const doc = await originalResolveDID(did, options);
            if (did === agentDID && pauseAgentResolution) {
                pauseAgentResolution = false;
                signalResolution();
                await resolutionRelease;
            }
            return doc;
        });

        jest.useFakeTimers();
        jest.setSystemTime(expiresAt + 1);
        const gc = gatekeeper.verifyDb({ chatty: false });
        try {
            await resolutionStarted;
            const agentDoc = await originalResolveDID(agentDID);
            agentDoc.mdip!.validUntil = new Date(expiresAt + 60_000).toISOString();
            expect(await gatekeeper.updateDID(
                await helper.createUpdateOp(keypair, agentDID, agentDoc),
            )).toBe(true);

            releaseResolution();
            expect(await gc).toStrictEqual({
                total: 2,
                verified: 2,
                expired: 0,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([agentDID, assetDID]);
        }
        finally {
            releaseResolution();
            await gc.catch(() => { });
            jest.useRealTimers();
            resolveDID.mockRestore();
        }
    });

    it('should retry an expired agent when dependent revalidation fails', async () => {
        const expiredKeys = cipher.generateRandomJwk();
        const liveKeys = cipher.generateRandomJwk();
        const expiredAgent = await gatekeeper.createDID(await helper.createAgentOp(expiredKeys, {
            validUntil: new Date(Date.now() - 1_000).toISOString(),
        }));
        const liveAgent = await gatekeeper.createDID(await helper.createAgentOp(liveKeys));
        const assetDID = await gatekeeper.createDID(await helper.createAssetOp(expiredAgent, expiredKeys));
        const originalResolveDID = gatekeeper.resolveDID.bind(gatekeeper);
        const staleAssetDoc = await originalResolveDID(assetDID);
        const assetDoc = await originalResolveDID(assetDID);
        assetDoc.didDocument!.controller = liveAgent;
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(expiredKeys, assetDID, assetDoc),
        )).toBe(true);

        const originalGetEvents = db.getEvents.bind(db);
        let failAssetRead = true;
        const getEvents = jest.spyOn(db, 'getEvents').mockImplementation(async did => {
            if (did === assetDID && failAssetRead) {
                failAssetRead = false;
                throw new Error('transient read failure');
            }
            return originalGetEvents(did);
        });
        let assetResolutions = 0;
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            if (did === assetDID && ++assetResolutions === 1) {
                return staleAssetDoc;
            }
            return originalResolveDID(did, options);
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 3,
                verified: 3,
                expired: 0,
                invalid: 0,
            });
            expect((await originalResolveDID(assetDID)).didDocument?.controller).toBe(liveAgent);
            expect(await gatekeeper.getDIDs()).toStrictEqual([expiredAgent, liveAgent, assetDID]);
        }
        finally {
            getEvents.mockRestore();
            resolveDID.mockRestore();
        }

        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
            total: 3,
            verified: 2,
            expired: 1,
            invalid: 0,
        });
        expect(await gatekeeper.getDIDs()).toStrictEqual([liveAgent, assetDID]);
    });

    it('should preserve an asset moved to a live controller after the scan', async () => {
        const expiredKeys = cipher.generateRandomJwk();
        const liveKeys = cipher.generateRandomJwk();
        const expiredAgent = await gatekeeper.createDID(await helper.createAgentOp(expiredKeys, {
            validUntil: new Date(Date.now() - 1_000).toISOString(),
        }));
        const liveAgent = await gatekeeper.createDID(await helper.createAgentOp(liveKeys));
        const assetDID = await gatekeeper.createDID(await helper.createAssetOp(expiredAgent, expiredKeys));
        const originalResolveDID = gatekeeper.resolveDID.bind(gatekeeper);
        const staleAssetDoc = await originalResolveDID(assetDID);
        const currentAssetDoc = await originalResolveDID(assetDID);
        currentAssetDoc.didDocument!.controller = liveAgent;
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(expiredKeys, assetDID, currentAssetDoc),
        )).toBe(true);
        let assetResolutions = 0;
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            if (did === assetDID && ++assetResolutions === 1) {
                return staleAssetDoc;
            }
            return originalResolveDID(did, options);
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 3,
                verified: 2,
                expired: 1,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([liveAgent, assetDID]);
        }
        finally {
            resolveDID.mockRestore();
        }
    });

    it('should retry failed dependency discovery before removing an expired agent', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair, {
            validUntil: new Date(Date.now() - 1_000).toISOString(),
        }));
        const assetDID = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair));
        const originalGetEvents = db.getEvents.bind(db);
        let failedAssetReads = 0;
        const getEvents = jest.spyOn(db, 'getEvents').mockImplementation(async did => {
            if (did === assetDID && failedAssetReads < 2) {
                failedAssetReads += 1;
                throw new Error('transient read failure');
            }
            return originalGetEvents(did);
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 2,
                verified: 2,
                expired: 0,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([agentDID, assetDID]);
        }
        finally {
            getEvents.mockRestore();
        }

        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
            total: 2,
            verified: 0,
            expired: 2,
            invalid: 0,
        });
        expect(await gatekeeper.getDIDs()).toStrictEqual([]);
    });

    it('should remove malformed DIDs without blocking expired agents', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair, {
            validUntil: new Date(Date.now() - 1_000).toISOString(),
        }));
        await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair));
        const malformedDID = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const events = await db.getEvents(malformedDID);
        events[0].time = 'not-a-date';
        await db.setEvents(malformedDID, events);

        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
            total: 3,
            verified: 0,
            expired: 2,
            invalid: 1,
        });
        expect(await gatekeeper.getDIDs()).toStrictEqual([]);
    });

    it('should retain a renewed DID when cleanup revalidation fails', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const assetDID = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair, {
            validUntil: new Date(Date.now() - 1_000).toISOString(),
        }));
        const originalResolveDID = gatekeeper.resolveDID.bind(gatekeeper);
        const staleAssetDoc = await originalResolveDID(assetDID);
        const renewedAssetDoc = await originalResolveDID(assetDID);
        renewedAssetDoc.mdip!.validUntil = new Date(Date.now() + 60_000).toISOString();
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(keypair, assetDID, renewedAssetDoc),
        )).toBe(true);

        const originalGetEvents = db.getEvents.bind(db);
        let failAssetRead = true;
        const getEvents = jest.spyOn(db, 'getEvents').mockImplementation(async did => {
            if (did === assetDID && failAssetRead) {
                failAssetRead = false;
                throw new Error('transient read failure');
            }
            return originalGetEvents(did);
        });
        let assetResolutions = 0;
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            if (did === assetDID && ++assetResolutions === 1) {
                return staleAssetDoc;
            }
            return originalResolveDID(did, options);
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 2,
                verified: 2,
                expired: 0,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([agentDID, assetDID]);
        }
        finally {
            getEvents.mockRestore();
            resolveDID.mockRestore();
        }
    });

    it('should remove an expired agent when its dependent is already missing', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair, {
            validUntil: new Date(Date.now() - 1_000).toISOString(),
        }));
        const assetDID = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair));
        const originalResolveDID = gatekeeper.resolveDID.bind(gatekeeper);
        const staleAssetDoc = await originalResolveDID(assetDID);
        await gatekeeper.removeDIDs([assetDID]);
        const getDIDs = jest.spyOn(gatekeeper, 'getDIDs').mockResolvedValueOnce([agentDID, assetDID]);
        let assetResolutions = 0;
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            if (did === assetDID && ++assetResolutions === 1) {
                return staleAssetDoc;
            }
            return originalResolveDID(did, options);
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 2,
                verified: 0,
                expired: 2,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([]);
        }
        finally {
            getDIDs.mockRestore();
            resolveDID.mockRestore();
        }
    });

    it('should retry scanned dependents when their expired agent is already missing', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair, {
            validUntil: new Date(Date.now() - 1_000).toISOString(),
        }));
        const assetDID = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair));
        const originalResolveDID = gatekeeper.resolveDID.bind(gatekeeper);
        const staleAgentDoc = await originalResolveDID(agentDID);
        await gatekeeper.removeDIDs([agentDID]);
        const getDIDs = jest.spyOn(gatekeeper, 'getDIDs').mockResolvedValueOnce([agentDID, assetDID]);
        let agentResolutions = 0;
        const originalGetEvents = db.getEvents.bind(db);
        let assetReads = 0;
        const getEvents = jest.spyOn(db, 'getEvents').mockImplementation(async did => {
            if (did === assetDID && ++assetReads === 2) {
                throw new Error('transient read failure');
            }
            return originalGetEvents(did);
        });
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            if (did === agentDID && ++agentResolutions === 1) {
                return staleAgentDoc;
            }
            return originalResolveDID(did, options);
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 2,
                verified: 1,
                expired: 1,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([assetDID]);
        }
        finally {
            getDIDs.mockRestore();
            getEvents.mockRestore();
            resolveDID.mockRestore();
        }

        const resetDb = jest.spyOn(db, 'resetDb').mockRejectedValueOnce(new Error('reset failed'));
        try {
            await expect(gatekeeper.resetDb()).rejects.toThrow('reset failed');
        }
        finally {
            resetDb.mockRestore();
        }

        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
            total: 1,
            verified: 0,
            expired: 1,
            invalid: 0,
        });
        expect(await gatekeeper.getDIDs()).toStrictEqual([]);
    });

    it('should classify a pending invalid controller only once', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair, {
            validUntil: new Date(Date.now() - 1_000).toISOString(),
        }));
        await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair));
        const pending = (gatekeeper as unknown as {
            pendingExpiredControllers: Map<string, string>;
        }).pendingExpiredControllers;
        pending.set(agentDID.split(':').pop()!, agentDID);
        const originalResolveDID = gatekeeper.resolveDID.bind(gatekeeper);
        let agentResolutions = 0;
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            if (did === agentDID && ++agentResolutions <= 2) {
                return { didResolutionMetadata: { error: 'invalidDid' } };
            }
            return originalResolveDID(did, options);
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 2,
                verified: 0,
                expired: 1,
                invalid: 1,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([]);
        }
        finally {
            resolveDID.mockRestore();
        }
    });

    it('should invalidate cached expiry metadata through a DID alias', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair, {
            prefix: 'did:custom',
        }));
        await gatekeeper.verifyDb({ chatty: false });

        const agentDoc = await gatekeeper.resolveDID(agentDID);
        agentDoc.mdip!.validUntil = new Date(Date.now() - 1_000).toISOString();
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(keypair, agentDID, agentDoc),
        )).toBe(true);

        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
            total: 1,
            verified: 0,
            expired: 1,
            invalid: 0,
        });
        expect(await gatekeeper.getDIDs()).toStrictEqual([]);
    });

    it('should invalidate cached expiry before an ambiguous write failure', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        await gatekeeper.verifyDb({ chatty: false });

        const agentDoc = await gatekeeper.resolveDID(agentDID);
        agentDoc.mdip!.validUntil = new Date(Date.now() - 1_000).toISOString();
        const updateOp = await helper.createUpdateOp(keypair, agentDID, agentDoc);
        const originalAddEvent = db.addEvent.bind(db);
        const addEvent = jest.spyOn(db, 'addEvent').mockImplementationOnce(async (did, event) => {
            await originalAddEvent(did, event);
            throw new Error('connection lost after commit');
        });

        try {
            await expect(gatekeeper.updateDID(updateOp)).rejects.toThrow('connection lost after commit');
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 1,
                verified: 0,
                expired: 1,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([]);
        }
        finally {
            addEvent.mockRestore();
        }
    });

    it('should not cache a DID while its expiry update is pending', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        await gatekeeper.verifyDb({ chatty: false });

        const agentDoc = await gatekeeper.resolveDID(agentDID);
        agentDoc.mdip!.validUntil = new Date(Date.now() - 1_000).toISOString();
        const updateOp = await helper.createUpdateOp(keypair, agentDID, agentDoc);
        const originalAddEvent = db.addEvent.bind(db);
        let signalWrite: () => void = () => { };
        let releaseWrite: () => void = () => { };
        const writeStarted = new Promise<void>(resolve => (signalWrite = resolve));
        const writeRelease = new Promise<void>(resolve => (releaseWrite = resolve));
        const addEvent = jest.spyOn(db, 'addEvent').mockImplementationOnce(async (did, event) => {
            signalWrite();
            await writeRelease;
            return originalAddEvent(did, event);
        });

        const update = gatekeeper.updateDID(updateOp);
        try {
            await writeStarted;
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 1,
                verified: 1,
                expired: 0,
                invalid: 0,
            });

            releaseWrite();
            await update;
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 1,
                verified: 0,
                expired: 1,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([]);
        }
        finally {
            releaseWrite();
            await update.catch(() => { });
            addEvent.mockRestore();
        }
    });

    it('should retain a DID with a malformed expiry', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const agentDoc = await gatekeeper.resolveDID(agentDID);
        agentDoc.mdip!.validUntil = 'not-a-date';
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(keypair, agentDID, agentDoc),
        )).toBe(true);

        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
            total: 1,
            verified: 1,
            expired: 0,
            invalid: 0,
        });
        expect(await gatekeeper.getDIDs()).toStrictEqual([agentDID]);
    });

    it('should reclassify stale expired assets before deletion', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const expired = new Date(Date.now() - 1_000).toISOString();
        const invalidAsset = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair, {
            validUntil: expired,
        }));
        const renewedAsset = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair, {
            validUntil: expired,
        }));
        const originalResolveDID = gatekeeper.resolveDID.bind(gatekeeper);
        const staleDocs = new Map([
            [invalidAsset, await originalResolveDID(invalidAsset)],
            [renewedAsset, await originalResolveDID(renewedAsset)],
        ]);

        const invalidEvents = await db.getEvents(invalidAsset);
        invalidEvents[0].time = 'not-a-date';
        await db.setEvents(invalidAsset, invalidEvents);
        const renewedDoc = await originalResolveDID(renewedAsset);
        renewedDoc.mdip!.validUntil = new Date(Date.now() + 60_000).toISOString();
        expect(await gatekeeper.updateDID(
            await helper.createUpdateOp(keypair, renewedAsset, renewedDoc),
        )).toBe(true);

        const staleReads = new Set(staleDocs.keys());
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            if (did && staleReads.delete(did)) {
                return staleDocs.get(did)!;
            }
            return originalResolveDID(did, options);
        });

        try {
            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 3,
                verified: 2,
                expired: 0,
                invalid: 1,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([agentDID, renewedAsset]);
        }
        finally {
            resolveDID.mockRestore();
        }
    });

    it('should not restore cache invalidated during resolution', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const assetDID = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair));
        const originalResolveDID = gatekeeper.resolveDID.bind(gatekeeper);
        let pauseAssetResolution = true;
        let signalResolution: () => void = () => { };
        let releaseResolution: () => void = () => { };
        const resolutionStarted = new Promise<void>(resolve => (signalResolution = resolve));
        const resolutionRelease = new Promise<void>(resolve => (releaseResolution = resolve));
        const resolveDID = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            const doc = await originalResolveDID(did, options);
            if (did === assetDID && pauseAssetResolution) {
                pauseAssetResolution = false;
                signalResolution();
                await resolutionRelease;
            }
            return doc;
        });

        const firstGc = gatekeeper.verifyDb({ chatty: false });
        try {
            await resolutionStarted;
            const assetDoc = await originalResolveDID(assetDID);
            assetDoc.mdip!.validUntil = new Date(Date.now() - 1_000).toISOString();
            expect(await gatekeeper.updateDID(
                await helper.createUpdateOp(keypair, assetDID, assetDoc),
            )).toBe(true);

            releaseResolution();
            expect(await firstGc).toStrictEqual({
                total: 2,
                verified: 2,
                expired: 0,
                invalid: 0,
            });

            expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
                total: 2,
                verified: 1,
                expired: 1,
                invalid: 0,
            });
            expect(await gatekeeper.getDIDs()).toStrictEqual([agentDID]);
        }
        finally {
            releaseResolution();
            await firstGc.catch(() => { });
            resolveDID.mockRestore();
        }
    });

    it('should not cascade from an agent deactivated by an operation', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentDID = await gatekeeper.createDID(await helper.createAgentOp(keypair));
        const assetDID = await gatekeeper.createDID(await helper.createAssetOp(agentDID, keypair));
        expect(await gatekeeper.deleteDID(await helper.createDeleteOp(keypair, agentDID))).toBe(true);

        expect(await gatekeeper.verifyDb({ chatty: false })).toStrictEqual({
            total: 2,
            verified: 2,
            expired: 0,
            invalid: 0,
        });
        expect(await gatekeeper.getDIDs()).toStrictEqual([agentDID, assetDID]);
    });
});

describe('checkDIDs', () => {

    it('should check all DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair, { registry: 'local', validUntil: new Date().toISOString() });
        await gatekeeper.createDID(assetOp);

        const check = await gatekeeper.checkDIDs({ chatty: true });

        expect(check.total).toBe(2);
        expect(check.byType.agents).toBe(1);
        expect(check.byType.assets).toBe(1);
        expect(check.byType.ephemeral).toBe(1);
        expect(check.byType.invalid).toBe(0);
        expect(check.byRegistry['local']).toBe(2);
        expect(check.byVersion[1]).toBe(2);
    });

    it('should report unconfirmed DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair, { registry: 'hyperswarm' });
        const assetDID = await gatekeeper.createDID(assetOp);
        const doc = await gatekeeper.resolveDID(assetDID);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await helper.createUpdateOp(keypair, assetDID, doc);
        const ok = await gatekeeper.updateDID(updateOp);

        const check = await gatekeeper.checkDIDs({ chatty: true });

        expect(ok).toBe(true);
        expect(check.total).toBe(2);
        expect(check.byType.agents).toBe(1);
        expect(check.byType.assets).toBe(1);
        expect(check.byType.confirmed).toBe(1);
        expect(check.byType.unconfirmed).toBe(1);
        expect(check.byType.ephemeral).toBe(0);
        expect(check.byType.invalid).toBe(0);
        expect(check.byRegistry['hyperswarm']).toBe(2);
        expect(check.byVersion[1]).toBe(1);
        expect(check.byVersion[2]).toBe(1);
    });

    it('should report invalid DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await helper.createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await helper.createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const dids = await gatekeeper.getDIDs();
        dids.push('mock');

        // @ts-expect-error Testing invalid usage
        const check = await gatekeeper.checkDIDs({ chatty: true, dids });

        expect(check.total).toBe(3);
        expect(check.byType.invalid).toBe(1);
    });
});
