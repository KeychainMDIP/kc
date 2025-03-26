import mockFs from 'mock-fs';
import HeliaClient from '@mdip/ipfs/helia';
import { ExpectedExceptionError } from '@mdip/common/errors';

describe('start', () => {
    it('should ignore a second call to start', async () => {
        const ipfs = await HeliaClient.create();
        await ipfs.start();
        await ipfs.stop();
    });
});

describe('stop', () => {
    it('should ignore a second call to stop', async () => {
        const ipfs = await HeliaClient.create();
        await ipfs.stop();
        await ipfs.stop();
    });
});

describe('addJSON', () => {
    const data = { key: 'mock' };
    const hash = 'z3v8AuaXiw9ZVBhPuQdTJySePBjwpBtvsSCRLXuPLzwqokHV8cS';

    it('should create CID from data', async () => {
        const ipfs = await HeliaClient.create();
        const cid = await ipfs.addJSON(data);
        await ipfs.stop();

        expect(cid).toBe(hash);
    });

    it('should create CID from data without using helia', async () => {
        const ipfs = await HeliaClient.create({ minimal: true });
        const cid = await ipfs.addJSON(data);

        expect(cid).toBe(hash);
    });

    it('should create CID from data with fs blockstore', async () => {
        mockFs({});
        const ipfs = await HeliaClient.create({ datadir: 'ipfs' });
        const cid = await ipfs.addJSON(data);
        await ipfs.stop();
        mockFs.restore();

        expect(cid).toBe(hash);
    });
});

describe('getJSON', () => {
    const mockData = { key: 'mock' };

    it('should return JSON data from CID', async () => {
        const ipfs = await HeliaClient.create();
        const cid = await ipfs.addJSON(mockData);
        const data = await ipfs.getJSON(cid);
        await ipfs.stop();

        expect(data).toStrictEqual(mockData);
    });

    it('should return JSON data from CID with fs blockstore', async () => {
        mockFs({});

        const ipfs = await HeliaClient.create({ datadir: 'ipfs' });
        const cid = await ipfs.addJSON(mockData);
        const data = await ipfs.getJSON(cid);
        await ipfs.stop();
        mockFs.restore();

        expect(data).toStrictEqual(mockData);
    });

    it('should return throw exception if not connected', async () => {
        const ipfs = new HeliaClient();
        const cid = await ipfs.addJSON(mockData);

        try {
            await ipfs.getJSON(cid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error).toBe('Not connected');
        }
    });
});

describe('addText', () => {
    const mockData = 'mock text data';
    const hash = 'zb2rhgNGdyFtViUWRk4oYLGrwdkgbt4GnF2s15k3ZujX6w3QW';

    it('should create CID from text data', async () => {
        const ipfs = await HeliaClient.create();
        const cid = await ipfs.addText(mockData);
        await ipfs.stop();

        expect(cid).toBe(hash);
    });

    it('should create CID from text data without using helia', async () => {
        const ipfs = await HeliaClient.create({ minimal: true });
        const cid = await ipfs.addText(mockData);

        expect(cid).toBe(hash);
    });

    it('should create CID from text data with fs blockstore', async () => {
        mockFs({});
        const ipfs = await HeliaClient.create({ datadir: 'ipfs' });
        const cid = await ipfs.addText(mockData);
        await ipfs.stop();
        mockFs.restore();

        expect(cid).toBe(hash);
    });
});

describe('getText', () => {
    const mockData = 'mock text data';

    it('should return text data from CID', async () => {
        const ipfs = await HeliaClient.create();
        const cid = await ipfs.addText(mockData);
        const data = await ipfs.getText(cid);
        await ipfs.stop();

        expect(data).toBe(mockData);
    });

    it('should return text data from CID with fs blockstore', async () => {
        mockFs({});

        const ipfs = await HeliaClient.create({ datadir: 'ipfs' });
        const cid = await ipfs.addText(mockData);
        const data = await ipfs.getText(cid);
        await ipfs.stop();
        mockFs.restore();

        expect(data).toStrictEqual(mockData);
    });

    it('should return throw exception if not connected', async () => {
        const ipfs = new HeliaClient();
        const cid = await ipfs.addText(mockData);

        try {
            await ipfs.getText(cid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error).toBe('Not connected');
        }
    });
});

describe('addData', () => {
    const mockData = Buffer.from('mock data');
    const hash = 'zb2rhYuMKCR7pY51Tzv52NmTW9zYU2P53XFUJitvDwtSpCDhd';

    it('should create CID from text data', async () => {
        const ipfs = await HeliaClient.create();
        const cid = await ipfs.addData(mockData);
        await ipfs.stop();

        expect(cid).toBe(hash);
    });

    it('should create CID from text data without using helia', async () => {
        const ipfs = await HeliaClient.create({ minimal: true });
        const cid = await ipfs.addData(mockData);

        expect(cid).toBe(hash);
    });

    it('should create CID from text data with fs blockstore', async () => {
        mockFs({});
        const ipfs = await HeliaClient.create({ datadir: 'ipfs' });
        const cid = await ipfs.addData(mockData);
        await ipfs.stop();
        mockFs.restore();

        expect(cid).toBe(hash);
    });
});


describe('getData', () => {
    const mockData = Buffer.from('mock data');

    it('should return text data from CID', async () => {
        const ipfs = await HeliaClient.create();
        const cid = await ipfs.addData(mockData);
        const data = await ipfs.getData(cid);
        await ipfs.stop();

        expect(data).toStrictEqual(mockData);
    });

    it('should return text data from CID with fs blockstore', async () => {
        mockFs({});

        const ipfs = await HeliaClient.create({ datadir: 'ipfs' });
        const cid = await ipfs.addData(mockData);
        const data = await ipfs.getData(cid);
        await ipfs.stop();
        mockFs.restore();

        expect(data).toStrictEqual(mockData);
    });

    it('should return throw exception if not connected', async () => {
        const ipfs = new HeliaClient();
        const cid = await ipfs.addData(mockData);

        try {
            await ipfs.getData(cid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error).toBe('Not connected');
        }
    });
});
