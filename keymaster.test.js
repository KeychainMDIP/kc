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

    it('should fail to create a second ID with the same name', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);

        try {
            await keymaster.createId(name);
            fail('Expected createId to throw an exception');
        } catch (error) {
            expect(error).toBe(`Already have an ID named ${name}`);
        }
    });

    it('should create a second ID with a different name', async () => {
        mockFs({});

        const name1 = 'Bob';
        const did1 = await keymaster.createId(name1);

        const name2 = 'Alice';
        const did2 = await keymaster.createId(name2);

        const content = fs.readFileSync('wallet.json', 'utf8');
        const wallet = JSON.parse(content);

        expect(wallet.ids[name1].did).toBe(did1);
        expect(wallet.ids[name2].did).toBe(did2);
        expect(wallet.current).toBe(name2);
    });
});

describe('removeId', () => {

    afterEach(() => {
        mockFs.restore();
    });

    it('should remove an existing ID', async () => {
        mockFs({});

        const name = 'Bob';
        const did = await keymaster.createId(name);

        keymaster.removeId(name);

        const content = fs.readFileSync('wallet.json', 'utf8');
        const wallet = JSON.parse(content);

        expect(wallet.ids).toStrictEqual({});
        expect(wallet.current).toBe('');
    });

    it('should fail to remove an non-existent ID', async () => {
        mockFs({});

        const name1 = 'Bob';
        const name2 = 'Alice';
        const did = await keymaster.createId(name1);

        try {
            keymaster.removeId(name2);
            fail('Expected createId to throw an exception');
        } catch (error) {
            expect(error).toBe(`No ID named ${name2}`);
        }
    });

});
