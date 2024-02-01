import fs from 'fs';
import mockFs from 'mock-fs';
import * as gatekeeper from './gatekeeper.js';

describe('generateDid', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a DID in standard format', async () => {
        mockFs({});

        const mockAnchor = { data: "mockAnchor" };
        const did = await gatekeeper.generateDid(mockAnchor);

        expect(did.length).toBe(60);
        expect(did.startsWith('did:mdip:')).toBe(true);
    });

    it('should throw an exception if no anchor provided', async () => {
        mockFs({});

        try {
            const did = await gatekeeper.generateDid();
            throw 'Expected to throw an exception';
        } catch (error) {
            expect(error).toBe('Invalid anchor');
        }
    });
});

describe('resolveDid', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should resolve a valid DID with a valid data anchor', async () => {
        mockFs({});

        const mockAnchor = { controller: "mockController", data: "mockAnchor" };
        const did = await gatekeeper.generateDid(mockAnchor);
        const doc = JSON.parse(await gatekeeper.resolveDid(did));

        expect(doc.didDocument.id).toBe(did);
        expect(doc.didDocument.controller).toBe(mockAnchor.controller);
        expect(doc.didDocumentMetadata.mdip.version).toBe(1);
        expect(doc.didDocumentMetadata.data).toBe(mockAnchor.data);
    });

    it('should resolve a valid DID with a valid agent anchor (pubkey)', async () => {
        mockFs({});

        const mockAnchor = {
            crv: "secp256k1",
            kty: "EC",
            x: "ZGMyLSKEqUBFZvRb7cv_3Kyw6TSCaHMe2z8A5aDot8M",
            y: "CePPcnEVNq7WvwbxnaXI2ekGZJHSFoqFnrXryzxqMMI"
        };

        const did = await gatekeeper.generateDid(mockAnchor);
        const doc = JSON.parse(await gatekeeper.resolveDid(did));

        expect(doc.didDocument.id).toBe(did);
        expect(doc.didDocument.verificationMethod.length).toBe(1);
        expect(doc.didDocument.verificationMethod[0].publicKeyJwk).toStrictEqual(mockAnchor);
        expect(doc.didDocumentMetadata.mdip.version).toBe(1);
    });
});
