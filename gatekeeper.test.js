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
