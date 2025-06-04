import CipherNode from '@mdip/cipher/node';
import { Operation, MdipDocument } from '@mdip/gatekeeper/types';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import type { EcdsaJwkPair } from '@mdip/cipher/types';
import HeliaClient from '@mdip/ipfs/helia';

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

beforeAll(async () => {
    await ipfs.start();
});

afterAll(async () => {
    await ipfs.stop();
});

beforeEach(async () => {
    await gatekeeper.resetDb();  // Reset database for each test to ensure isolation
});

async function createAgentOp(
    keypair: EcdsaJwkPair,
    options: {
        version?: number;
        registry?: string;
        prefix?: string;
    } = {}
): Promise<Operation> {
    const { version = 1, registry = 'local', prefix } = options;
    const operation: Operation = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: version,
            type: "agent",
            registry: registry,
        },
        publicJwk: keypair.publicJwk,
    };

    if (prefix) {
        operation.mdip!.prefix = prefix;
    }

    const msgHash = cipher.hashJSON(operation);
    const signature = cipher.signHash(msgHash, keypair.privateJwk);

    return {
        ...operation,
        signature: {
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature
        }
    };
}

async function createUpdateOp(
    keypair: EcdsaJwkPair,
    did: string,
    doc: MdipDocument,
    options: {
        excludePrevid?: boolean;
        mockPrevid?: string;
        mockBlockid?: string;
    } = {}
): Promise<Operation> {
    const { excludePrevid = false, mockPrevid } = options;
    const current = await gatekeeper.resolveDID(did);
    const previd = excludePrevid ? undefined : mockPrevid ? mockPrevid : current.didDocumentMetadata?.versionId;
    const { mockBlockid } = options;

    const operation: Operation = {
        type: "update",
        did,
        previd,
        ...(mockBlockid !== undefined && { blockid: mockBlockid }),
        doc,
    };

    const msgHash = cipher.hashJSON(operation);
    const signature = cipher.signHash(msgHash, keypair.privateJwk);

    return {
        ...operation,
        signature: {
            signer: did,
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };
}

async function createAssetOp(
    agent: string,
    keypair: EcdsaJwkPair,
    options: {
        registry?: string;
        validUntil?: string | null;
    } = {}
): Promise<Operation> {
    const { registry = 'local', validUntil = null } = options;
    const dataAnchor: Operation = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "asset",
            registry,
            validUntil: validUntil || undefined
        },
        controller: agent,
        data: "mockData",
    };

    const msgHash = cipher.hashJSON(dataAnchor);
    const signature = cipher.signHash(msgHash, keypair.privateJwk);

    return {
        ...dataAnchor,
        signature: {
            signer: agent,
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };
}

describe('verifyDb', () => {

    it('should verify all DIDs in db', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const { verified, expired, invalid, total } = await gatekeeper.verifyDb();

        expect(verified).toBe(2);
        expect(expired).toBe(0);
        expect(invalid).toBe(0);
        expect(total).toBe(2);
    });

    it('should get same results with cached verifications', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const verify1 = await gatekeeper.verifyDb();
        const verify2 = await gatekeeper.verifyDb();

        expect(verify1).toStrictEqual(verify2);
    });

    it('should get same results with chatty turned off', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const verify1 = await gatekeeper.verifyDb();
        const verify2 = await gatekeeper.verifyDb({ chatty: false });

        expect(verify1).toStrictEqual(verify2);
    });

    it('should remove invalid DIDs', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        const assetDID = await gatekeeper.createDID(assetOp);
        const doc = await gatekeeper.resolveDID(assetDID);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, assetDID, doc);
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
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);

        // create asset that should expire
        const validUntil = new Date().toISOString();
        const assetOp1 = await createAssetOp(agentDID, keypair, { registry: 'local', validUntil });
        await gatekeeper.createDID(assetOp1);

        // create asset that expires later
        const expires = new Date();
        expires.setHours(expires.getHours() + 1); // Add 1 hour
        const assetOp3 = await createAssetOp(agentDID, keypair, { registry: 'local', validUntil: expires.toISOString() });
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
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair, { registry: 'local', validUntil: new Date().toISOString() });
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
        const agentOp = await createAgentOp(keypair, { version: 1, registry: 'hyperswarm' });
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair, { registry: 'hyperswarm' });
        const assetDID = await gatekeeper.createDID(assetOp);
        const doc = await gatekeeper.resolveDID(assetDID);
        doc.didDocumentData = { mock: 1 };
        const updateOp = await createUpdateOp(keypair, assetDID, doc);
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
        const agentOp = await createAgentOp(keypair);
        const agentDID = await gatekeeper.createDID(agentOp);
        const assetOp = await createAssetOp(agentDID, keypair);
        await gatekeeper.createDID(assetOp);

        const dids = await gatekeeper.getDIDs();
        dids.push('mock');

        // @ts-expect-error Testing invalid usage
        const check = await gatekeeper.checkDIDs({ chatty: true, dids });

        expect(check.total).toBe(3);
        expect(check.byType.invalid).toBe(1);
    });
});
