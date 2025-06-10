import Gatekeeper from '@mdip/gatekeeper';
import Keymaster, { DmailTags } from '@mdip/keymaster';
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

    it('should remove whitespace from tags', async () => {
        const tags = ['   tag1', 'tag2   ', '   tag3    '];
        const verified = keymaster.verifyDmailTags(tags);

        expect(verified).toStrictEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should handle empty list', async () => {
        const verified = keymaster.verifyDmailTags([]);

        expect(verified).toStrictEqual([]);
    });

    it('should throw an exception on invalid tags', async () => {
        try {
            keymaster.verifyDmailTags(123 as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: tags');
        }

        try {
            keymaster.verifyDmailTags([1, 2, 3] as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe("Invalid parameter: Invalid tag: '1'");
        }

        try {
            keymaster.verifyDmailTags(['tag1', 'tag 2', '   ']);
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
        await keymaster.createAsset({ mock: 'mock' }, { name: 'Asset' });

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

describe('listDmail', () => {
    it('should retrieve all dmails when none specified', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const mock: DmailMessage = {
            to: [alice],
            cc: [bob],
            subject: 'Test Dmail 5',
            body: 'This is a test dmail message 5.',
        };

        const did = await keymaster.createDmail(mock);
        const dmails = await keymaster.listDmail();

        const expected = {
            ...mock,
            to: ['Alice'],
            cc: ['Bob'],
        };

        expect(dmails).toBeDefined();
        expect(dmails[did]).toBeDefined();
        expect(dmails[did].sender).toBe('Bob');
        expect(dmails[did].date).toBeDefined();
        expect(dmails[did].dmail).toStrictEqual(expected);
        expect(dmails[did].tags).toStrictEqual(['draft']);
    });

    it('should retrieve an empty set when no dmails', async () => {
        await keymaster.createId('Alice');
        const dmails = await keymaster.listDmail();

        expect(dmails).toStrictEqual({});
    });

    it('should retrieve an empty set when invalid dmails', async () => {
        const alice = await keymaster.createId('Alice');
        const mock: DmailMessage = {
            to: [alice],
            cc: [],
            subject: 'Test Dmail 5',
            body: 'This is a test dmail message 5.',
        };

        const did = await keymaster.createDmail(mock);
        await keymaster.removeGroupVaultItem(did, DmailTags.DMAIL); // invalidate the dmail

        const dmails = await keymaster.listDmail();

        expect(dmails).toStrictEqual({});
    });
});

describe('getDmail', () => {
    it('should retrieve dmail by DID', async () => {
        const alice = await keymaster.createId('Alice');
        const mock: DmailMessage = {
            to: [alice],
            cc: [],
            subject: 'Test Dmail 6',
            body: 'This is a test dmail message 6.',
        };

        const did = await keymaster.createDmail(mock);
        const dmail = await keymaster.getDmail(did);

        expect(dmail).toStrictEqual(mock);
    });

    it('should retrieve null if DID is not a GroupVault', async () => {
        const alice = await keymaster.createId('Alice');
        const dmail = await keymaster.getDmail(alice);

        expect(dmail).toBeNull();
    });

    it('should retrieve null if DID is a different kind of GroupVault', async () => {
        await keymaster.createId('Alice');
        const vault = await keymaster.createGroupVault();
        const dmail = await keymaster.getDmail(vault);

        expect(dmail).toBeNull();
    });

    it('should retrieve null if DID GroupVault item is the wrong type', async () => {
        await keymaster.createId('Alice');
        const vault = await keymaster.createGroupVault();
        const buffer = Buffer.from('This is not a valid dmail');
        await keymaster.addGroupVaultItem(vault, DmailTags.DMAIL, buffer);
        const dmail = await keymaster.getDmail(vault);

        expect(dmail).toBeNull();
    });
});

describe('updateDmail', () => {
    it('should update a valid dmail', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');

        const mock1: DmailMessage = {
            to: ['Alice'],
            cc: [],
            subject: 'Test Dmail 7',
            body: 'This is a test dmail message 7.',
        };

        const did = await keymaster.createDmail(mock1);

        const mock2: DmailMessage = {
            to: [bob],
            cc: [alice],
            subject: 'Test Dmail 7 udpated',
            body: 'This is a test dmail message 7 updated.',
        };

        const ok = await keymaster.updateDmail(did, mock2);
        expect(ok).toBe(true);

        const dmail = await keymaster.getDmail(did);
        expect(dmail).toStrictEqual(mock2);
    });
});

describe('removeDmail', () => {
    it('should remove a valid dmail', async () => {
        await keymaster.createId('Alice');

        const mock1: DmailMessage = {
            to: ['Alice'],
            cc: [],
            subject: 'Test Dmail 8',
            body: 'This is a test dmail message 8.',
        };

        const did = await keymaster.createDmail(mock1);

        const ok = await keymaster.removeDmail(did);
        expect(ok).toBe(true);

        const dmails = await keymaster.listDmail();
        expect(did in dmails).toBe(false);
    });

    it('should return true for non-existent dmail', async () => {
        const alice = await keymaster.createId('Alice');

        const ok = await keymaster.removeDmail(alice);
        expect(ok).toBe(true);
    });
});

describe('sendDmail', () => {
    it('should tag a dmail as sent', async () => {
        await keymaster.createId('Alice');

        const mock1: DmailMessage = {
            to: ['Alice'],
            cc: [],
            subject: 'Test Dmail 9',
            body: 'This is a test dmail message 9.',
        };

        const did = await keymaster.createDmail(mock1);

        const ok = await keymaster.sendDmail(did);
        expect(ok).toBe(true);

        const dmails = await keymaster.listDmail();
        expect(dmails[did].tags).toStrictEqual(['sent']);
    });

    it('should return false for invalid dmail', async () => {
        const alice = await keymaster.createId('Alice');

        const ok = await keymaster.sendDmail(alice);
        expect(ok).toBe(false);
    });
});

describe('importDmail', () => {
    it('should import a valid dmail', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');

        const mock1: DmailMessage = {
            to: ['Alice'],
            cc: [],
            subject: 'Test Dmail 10',
            body: 'This is a test dmail message 10.',
        };

        const did = await keymaster.createDmail(mock1);
        await keymaster.setCurrentId('Alice');

        const ok = await keymaster.importDmail(did);
        expect(ok).toBe(true);

        const dmails = await keymaster.listDmail();
        expect(dmails[did].tags).toStrictEqual(['inbox']);
    });

    it('should return false for invalid dmail', async () => {
        const alice = await keymaster.createId('Alice');

        const ok = await keymaster.importDmail(alice);
        expect(ok).toBe(false);
    });
});
