import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { ExpectedExceptionError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { DmailMessage } from '@mdip/keymaster/types';

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

describe('verifyDmailTags', () => {
    it('should return same list of valid tags', async () => {
        const tags = ['tag1', 'tag2', 'tag3'];
        const verified = keymaster.verifyDmailTags(tags);

        expect(verified).toStrictEqual(tags);
    });

    it('should remove duplicate tags', async () => {
        const tags = ['tag1', 'tag2', 'tag2', 'tag3', 'tag3', 'tag3'];
        const verified = keymaster.verifyDmailTags(tags);

        expect(verified).toStrictEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should handle empty list', async () => {
        const verified = keymaster.verifyDmailTags([]);

        expect(verified).toStrictEqual([]);
    });

    it('should throw an exception on invalid tags', async () => {
        try {
            await keymaster.verifyDmailTags(123 as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: tags');
        }

        try {
            await keymaster.verifyDmailTags([1, 2, 3] as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe("Invalid parameter: Invalid tag: '1'");
        }

        try {
            await keymaster.verifyDmailTags(['   ']);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe("Invalid parameter: Invalid tag: '   '");
        }
    });
});

describe('verifyDmailList', () => {
    it('should return same list of valid DIDs', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const charles = await keymaster.createId('Charles');
        const to = [alice, bob, charles];

        const verified = await keymaster.verifyDmailList(to);

        expect(verified).toStrictEqual(to);
    });

    it('should convert names to DIDs', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const charles = await keymaster.createId('Charles');
        await keymaster.addName('Chuck', charles);
        const to = ['Alice', 'Bob', 'Chuck'];

        const verified = await keymaster.verifyDmailList(to);

        expect(verified).toStrictEqual([alice, bob, charles]);
    });

    it('should throw an exception on invalid list', async () => {
        await keymaster.createId('Alice');
        await keymaster.createAsset({ mock: 'mock'}, { name: 'Asset' });

        try {
            await keymaster.verifyDmailList(123 as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: list');
        }

        try {
            await keymaster.verifyDmailList([1, 2, 3] as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: Invalid recipient type: number');
        }

        try {
            await keymaster.verifyDmailList(['Bob']);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: Invalid recipient: Bob');
        }

        try {
            await keymaster.verifyDmailList(['Asset']);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: Invalid recipient: Asset');
        }
    });
});

describe('verifyDmail', () => {
    it('should return same dmail if valid', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const charles = await keymaster.createId('Charles');

        const dmail: DmailMessage = {
            to: [alice, bob],
            cc: [charles],
            subject: 'Test Dmail 1',
            body: 'This is a test dmail message 1.',
        };

        const verified = await keymaster.verifyDmail(dmail);

        expect(verified).toStrictEqual(dmail);
    });

    it('should throw an exception on invalid dmail', async () => {
        const alice = await keymaster.createId('Alice');

        try {
            const dmail: DmailMessage = {
                to: [],
                cc: [],
                subject: 'Test Dmail 2',
                body: 'This is a test dmail message 2.',
            };

            await keymaster.verifyDmail(dmail);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: dmail.to');
        }

        try {
            const dmail: DmailMessage = {
                to: [alice],
                cc: [],
                subject: '',
                body: 'This is a test dmail message 3.',
            };

            await keymaster.verifyDmail(dmail);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: dmail.subject');
        }

        try {
            const dmail: DmailMessage = {
                to: [alice],
                cc: [],
                subject: 'Test Dmail 3',
                body: '   ',
            };

            await keymaster.verifyDmail(dmail);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: dmail.body');
        }
    });
});

describe('createDmail', () => {
    it('should create a valid dmail', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');

        const mock: DmailMessage = {
            to: ['Alice'],
            cc: ['Bob'],
            subject: 'Test Dmail 4',
            body: 'This is a test dmail message 4.',
        };

        const did = await keymaster.createDmail(mock);

        expect(did).toBeDefined();
    });
});
