import fs from 'fs';
import mockFs from 'mock-fs';
import * as secp from '@noble/secp256k1';
import canonicalize from 'canonicalize';
import * as cipher from './cipher.js';
import * as gatekeeper from './gatekeeper.js';

describe('generateDid', () => {

    it('should create DID from txn', async () => {
        const mockTxn = "mockTxn";
        const did = await gatekeeper.generateDid(mockTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });

    it('should create different DIDs from same txn', async () => {
        const mockTxn = "mockTxn";
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
    const anchor = {
        op: "create",
        version: 1,
        type: "agent",
        registry: "peerbit",
        publicJwk: keypair.publicJwk,
    };

    const msg = canonicalize(anchor);
    const msgHash = cipher.hashMessage(msg);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);

    const signed = {
        mdip: anchor,
        signature: signature
    };

    return signed;
}

describe('createAgent', () => {

    it('should create DID from agent txn', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);

        const did = await gatekeeper.createAgent(agentTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });
});

describe('createAsset', () => {

    it('should create DID from asset txn', async () => {
        const keypair = cipher.generateRandomJwk();
        const agentTxn = await createAgentTxn(keypair);
        const agent = await gatekeeper.createAgent(agentTxn);

        const dataAnchor = {
            mdip: {
                op: "create",
                version: 1,
                type: "asset",
                registry: "BTC",
                controller: agent,
                data: "mockData",
            }
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

        const did = await gatekeeper.createAsset(assetTxn);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:'));
    });
});
