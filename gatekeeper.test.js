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
        const did = await gatekeeper.generateDid(mockTxn);

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
        const did1 = await gatekeeper.generateDid(mockTxn);
        const did2 = await gatekeeper.generateDid(mockTxn);

        expect(did1.length).toBe(60);
        expect(did1.startsWith('did:mdip:'));

        expect(did2.length).toBe(60);
        expect(did2.startsWith('did:mdip:'));

        expect(did1 !== did2).toBe(true);
    });

});

async function createAgentTxn(keypair) {
    const txn = {
        op: "create",
        mdip: {
            version: 1,
            type: "agent",
            registry: "peerbit",
        },
        publicJwk: keypair.publicJwk,
    };

    const msg = canonicalize(txn);
    const msgHash = cipher.hashMessage(msg);
    txn.signature = await cipher.signHash(msgHash, keypair.privateJwk);
    return txn;
}

describe('createDid', () => {
    afterEach(() => {
        mockFs.restore();
    });

    it('should create DID from agent txn', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);

        const did = await gatekeeper.createDid(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create DID from asset txn', async () => {
        mockFs({});

        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);
        const agent = await gatekeeper.createDid(agentTxn);

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

        const did = await gatekeeper.createDid(assetTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });
});
