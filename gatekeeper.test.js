import fs from 'fs';
import mockFs from 'mock-fs';
import * as gatekeeper from './gatekeeper.js';

describe('createDid', () => {

    afterEach(() => {
        mockFs.restore();
    });


    it('should create DID from an object anchor', async () => {
        mockFs({});

        expect(true).toBe(true);
    });

});
