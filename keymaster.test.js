import fs from 'fs';
import mockFs from 'mock-fs';
import * as keymaster from './keymaster.js';

describe('createId', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should create a new ID', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);

        const content = fs.readFileSync('wallet.json', 'utf8');
        const wallet = JSON.parse(content);

        expect(wallet.ids[name].did).toBe(did);
        expect(wallet.current).toBe(name);
    });
});
