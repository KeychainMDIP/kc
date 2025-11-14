import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import HeliaClient from '@mdip/ipfs/helia';
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
        const verify2 = await gatekeeper.verifyDb();

        expect(verify1).toStrictEqual(verify2);
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

    it('should remove invalid DIDs', async () => {
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

        expect(verified).toBe(0);
        expect(expired).toBe(0);
        expect(invalid).toBe(1);
        expect(total).toBe(1);
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
