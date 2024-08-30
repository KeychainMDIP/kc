import * as ipfs from './helia-lib.js';
import { base58btc } from 'multiformats/bases/base58';

beforeEach(async () => {
    await ipfs.start();
});

afterEach(async () => {
    await ipfs.stop();
});

describe('add', () => {
    it('should create CID from data', async () => {

        const cid = await ipfs.add('mock');
        const cidStr = cid.toString(base58btc);

        expect(cidStr.startsWith('z3v8Aua')).toBe(true);
    });
});

describe('get', () => {
    it('should return data from CID', async () => {

        const cid = await ipfs.add('mock');
        const data = await ipfs.get(cid);

        expect(data).toBe('mock');
    });
});
