import fs from 'fs';
import mockFs from 'mock-fs';
import * as gatekeeper from './gatekeeper.js';

describe('generateDid', () => {

    afterEach(() => {
        mockFs.restore();
    });

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
