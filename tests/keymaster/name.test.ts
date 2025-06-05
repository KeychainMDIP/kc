import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { ExpectedExceptionError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';

let ipfs: HeliaClient;
let gatekeeper: Gatekeeper;
let wallet: WalletJsonMemory;
let cipher: CipherNode;
let keymaster: Keymaster;

beforeAll(async () => {
    ipfs = new HeliaClient();
    await ipfs.start();
});

afterAll(async () => {
    if (ipfs) {
        await ipfs.stop();
    }
});

beforeEach(() => {
    const db = new DbJsonMemory('test');
    gatekeeper = new Gatekeeper({ db, ipfs, registries: ['local', 'hyperswarm', 'TFTC'] });
    wallet = new WalletJsonMemory();
    cipher = new CipherNode();
    keymaster = new Keymaster({ gatekeeper, wallet, cipher });
});

describe('addName', () => {
    it('should create a new name', async () => {
        const bob = await keymaster.createId('Bob');
        const ok = await keymaster.addName('Jack', bob);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet.names!['Jack'] === bob).toBe(true);
    });

    it('should create a Unicode name', async () => {
        const name = 'ҽ× ʍɑϲհíղɑ';

        const bob = await keymaster.createId('Bob');
        const ok = await keymaster.addName(name, bob);
        const wallet = await keymaster.loadWallet();

        expect(ok).toBe(true);
        expect(wallet.names![name] === bob).toBe(true);
    });

    it('should not add duplicate name', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        try {
            await keymaster.addName('Jack', alice);
            await keymaster.addName('Jack', bob);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name already used');
        }
    });

    it('should not add a name that is same as an ID', async () => {
        const alice = await keymaster.createId('Alice');

        try {
            await keymaster.addName('Alice', alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name already used');
        }
    });

    it('should not add an empty name', async () => {
        const alice = await keymaster.createId('Alice');
        const expectedError = 'Invalid parameter: name must be a non-empty string';

        try {
            await keymaster.addName('', alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            await keymaster.addName('    ', alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid name arg
            await keymaster.addName(undefined, alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid name arg
            await keymaster.addName(0, alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            // @ts-expect-error Testing invalid usage, invalid name arg
            await keymaster.addName({}, alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }
    });

    it('should not add a name that is too long', async () => {
        const alice = await keymaster.createId('Alice');

        try {
            await keymaster.addName('1234567890123456789012345678901234567890', alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name too long');
        }
    });

    it('should not add a name that contains unprintable characters', async () => {
        const alice = await keymaster.createId('Alice');

        try {
            await keymaster.addName('hello\nworld!', alice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: name contains unprintable characters');
        }
    });
});

describe('getName', () => {
    it('should return DID for a new name', async () => {
        const bob = await keymaster.createId('Bob');
        const ok = await keymaster.addName('Jack', bob);
        const did = await keymaster.getName('Jack');

        expect(ok).toBe(true);
        expect(did).toBe(bob);
    });

    it('should return null for unknown name', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.getName('Jack');

        expect(did).toBe(null);
    });

    it('should return null for non-string names', async () => {
        await keymaster.createId('Bob');

        // @ts-expect-error Testing invalid usage, missing arg
        let did = await keymaster.getName();
        expect(did).toBe(null);

        // @ts-expect-error Testing invalid usage, invalid name arg
        did = await keymaster.getName(333);
        expect(did).toBe(null);

        // @ts-expect-error Testing invalid usage, invalid name arg
        did = await keymaster.getName([1, 2, 3]);
        expect(did).toBe(null);

        // @ts-expect-error Testing invalid usage, invalid name arg
        did = await keymaster.getName({ id: 'mock' });
        expect(did).toBe(null);
    });
});

describe('removeName', () => {
    it('should remove a valid name', async () => {
        const bob = await keymaster.createId('Bob');

        await keymaster.addName('Jack', bob);
        await keymaster.removeName('Jack');

        const wallet = await keymaster.loadWallet();

        expect(wallet.names!['Jack'] === bob).toBe(false);
    });

    it('should return true if name is missing', async () => {
        const ok = await keymaster.removeName('Jack');

        expect(ok).toBe(true);
    });
});

describe('listNames', () => {
    it('should return current list of wallet names', async () => {
        const bob = await keymaster.createId('Bob');

        for (let i = 0; i < 10; i++) {
            await keymaster.addName(`name-${i}`, bob);
        }

        const names = await keymaster.listNames();

        expect(Object.keys(names).length).toBe(10);

        for (const name of Object.keys(names)) {
            expect(names[name]).toBe(bob);
        }
    });

    it('should return empty list if no names added', async () => {
        const names = await keymaster.listNames();

        expect(Object.keys(names).length).toBe(0);
    });
});
