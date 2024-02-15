import fs from 'fs';
import mockFs from 'mock-fs';
import canonicalize from 'canonicalize';
import * as cipher from './cipher.js';
import * as gatekeeper from './gatekeeper.js';

beforeEach(async () => {
    await gatekeeper.start();
});

afterEach(async () => {
    await gatekeeper.stop();
});

describe('generateDid', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from txn', async () => {
        mockFs({});

        const mockTxn = {
            op: "create",
            mdip: {
                registry: "mockRegstry"
            }
        };
        const did = await gatekeeper.generateDID(mockTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create different DIDs from same txn', async () => {
        mockFs({});

        const mockTxn = {
            op: "create",
            mdip: {
                registry: "mockRegstry"
            }
        };
        const did1 = await gatekeeper.generateDID(mockTxn);
        const did2 = await gatekeeper.generateDID(mockTxn);

        expect(did1.length).toBe(60);
        expect(did1.startsWith('did:mdip:'));

        expect(did2.length).toBe(60);
        expect(did2.startsWith('did:mdip:'));

        expect(did1 !== did2).toBe(true);
    });

});

async function createAgentTxn(keypair, version = 1, registry = 'peerbit') {
    const txn = {
        op: "create",
        mdip: {
            version: version,
            type: "agent",
            registry: registry,
        },
        publicJwk: keypair.publicJwk,
    };

    const msg = canonicalize(txn);
    const msgHash = cipher.hashMessage(msg);
    txn.signature = await cipher.signHash(msgHash, keypair.privateJwk);
    return txn;
}

async function createAssetTxn(agent, keypair) {
    const dataAnchor = {
        op: "create",
        mdip: {
            version: 1,
            type: "asset",
            registry: "BTC",
        },
        controller: agent,
        data: "mockData",
    };

    const msg = canonicalize(dataAnchor);
    const msgHash = cipher.hashMessage(msg);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);
    const assetTxn = {
        ...dataAnchor,
        signature: {
            signer: agent,
            created: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };

    return assetTxn;
}

describe('createDID', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from agent txn', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);

        const did = await gatekeeper.createDID(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create DID for peerbit registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 1, 'peerbit');

        const did = await gatekeeper.createDID(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });


    it('should create DID for BTC registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 1, 'BTC');

        const did = await gatekeeper.createDID(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create DID for tBTC registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 1, 'tBTC');

        const did = await gatekeeper.createDID(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create DID for local registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 1, 'local');

        const did = await gatekeeper.createDID(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create different DIDs from same agent txn', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);

        const did1 = await gatekeeper.createDID(agentTxn);
        const did2 = await gatekeeper.createDID(agentTxn);

        expect(did1 !== did2).toBe(true);
    });

    it('should throw exception on invalid version', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 2);

        try {
            const did = await gatekeeper.createDID(agentTxn);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error.startsWith('Valid versions include')).toBe(true);
        }
    });

    it('should throw exception on invalid registry', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair, 1, 'mockRegistry');

        try {
            const did = await gatekeeper.createDID(agentTxn);
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error.startsWith('Valid registries include')).toBe(true);
        }
    });

    it('should create DID from asset txn', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);
        const agent = await gatekeeper.createDID(agentTxn);
        const assetTxn = await createAssetTxn(agent, keypair);

        const did = await gatekeeper.createDID(assetTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create different DIDs from same asset txn', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);
        const agent = await gatekeeper.createDID(agentTxn);
        const assetTxn = await createAssetTxn(agent, keypair);

        const did1 = await gatekeeper.createDID(assetTxn);
        const did2 = await gatekeeper.createDID(assetTxn);

        expect(did1 !== did2).toBe(true);
    });
});
