import mockFs from 'mock-fs';
import IPFS from '@mdip/ipfs';

describe('start', () => {
    it('should ignore a second call to start', async () => {
        const ipfs = await IPFS.create();
        await ipfs.start();
        await ipfs.stop();
    });
});

describe('stop', () => {
    it('should ignore a second call to stop', async () => {
        const ipfs = await IPFS.create();
        await ipfs.stop();
        await ipfs.stop();
    });
});

describe('add', () => {
    it('should create CID from data', async () => {
        const ipfs = await IPFS.create();
        const cid = await ipfs.add('mock');
        await ipfs.stop();

        expect(cid).toBe('z3v8AuadAh7dTMdMUPJpnRg1duVrHEcwfKvqzr7mdnH6ceyrtoa');
    });

    it('should create CID from data with fs blockstore', async () => {
        mockFs({});
        const ipfs = await IPFS.create({ datadir: 'ipfs' });
        const cid = await ipfs.add('mock');
        await ipfs.stop();
        mockFs.restore();

        expect(cid).toBe('z3v8AuadAh7dTMdMUPJpnRg1duVrHEcwfKvqzr7mdnH6ceyrtoa');
    });
});

describe('get', () => {
    it('should return data from CID', async () => {
        const ipfs = await IPFS.create();
        const cid = await ipfs.add('mock');
        const data = await ipfs.get(cid);
        await ipfs.stop();

        expect(data).toBe('mock');
    });

    it('should return data from CID with fs blockstore', async () => {
        mockFs({});

        const ipfs = await IPFS.create({ datadir: 'ipfs' });
        const cid = await ipfs.add('mock');
        const data = await ipfs.get(cid);
        await ipfs.stop();
        mockFs.restore();

        expect(data).toBe('mock');
    });
});
