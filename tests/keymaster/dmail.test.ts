import Gatekeeper from '@mdip/gatekeeper';
import Keymaster, { DmailTags } from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { ExpectedExceptionError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { DmailMessage, NoticeMessage } from '@mdip/keymaster/types';

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

describe('verifyTagList', () => {
    it('should return same list of valid tags', async () => {
        const tags = ['tag1', 'tag2', 'tag3'];
        const verified = keymaster.verifyTagList(tags);

        expect(verified).toStrictEqual(tags);
    });

    it('should remove duplicate tags', async () => {
        const tags = ['tag1', 'tag2', 'tag2', 'tag3', 'tag3', 'tag3'];
        const verified = keymaster.verifyTagList(tags);

        expect(verified).toStrictEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should remove whitespace from tags', async () => {
        const tags = ['   tag1', 'tag2   ', '   tag3    '];
        const verified = keymaster.verifyTagList(tags);

        expect(verified).toStrictEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should handle empty list', async () => {
        const verified = keymaster.verifyTagList([]);

        expect(verified).toStrictEqual([]);
    });

    it('should throw an exception on invalid tags', async () => {
        try {
            keymaster.verifyTagList(123 as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: tags');
        }

        try {
            keymaster.verifyTagList([1, 2, 3] as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe("Invalid parameter: Invalid tag: '1'");
        }

        try {
            keymaster.verifyTagList(['tag1', 'tag 2', '   ']);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe("Invalid parameter: Invalid tag: '   '");
        }
    });
});

describe('verifyRecipientList', () => {
    it('should return same list of valid DIDs', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const charles = await keymaster.createId('Charles');
        const to = [alice, bob, charles];

        const verified = await keymaster.verifyRecipientList(to);

        expect(verified).toStrictEqual(to);
    });

    it('should convert names to DIDs', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const charles = await keymaster.createId('Charles');
        await keymaster.addName('Chuck', charles);
        const to = ['Alice', 'Bob', 'Chuck'];

        const verified = await keymaster.verifyRecipientList(to);

        expect(verified).toStrictEqual([alice, bob, charles]);
    });

    it('should throw an exception on invalid list', async () => {
        await keymaster.createId('Alice');
        await keymaster.createAsset({ mock: 'mock' }, { name: 'Asset' });

        try {
            await keymaster.verifyRecipientList(123 as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: list');
        }

        try {
            await keymaster.verifyRecipientList([1, 2, 3] as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: Invalid recipient type: number');
        }

        try {
            await keymaster.verifyRecipientList(['Bob']);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: Invalid recipient: Bob');
        }

        try {
            await keymaster.verifyRecipientList(['Asset']);
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

        expect(dmails).toBeDefined();
        expect(dmails[did]).toBeDefined();
        expect(dmails[did].sender).toBe('Bob');
        expect(dmails[did].date).toBeDefined();
        expect(dmails[did].message).toStrictEqual(mock);
        expect(dmails[did].to).toStrictEqual(['Alice']);
        expect(dmails[did].cc).toStrictEqual(['Bob']);
        expect(dmails[did].tags).toStrictEqual(['draft']);
    });

    it('should leave intact unknown DIDs', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const mock: DmailMessage = {
            to: [alice],
            cc: [bob],
            subject: 'Test Dmail 51',
            body: 'This is a test dmail message 51.',
        };

        const did = await keymaster.createDmail(mock);

        await keymaster.setCurrentId('Alice');
        await keymaster.importDmail(did); // import dmail for Alice
        await keymaster.removeId('Bob'); // remove Bob to make it unknown

        const dmails = await keymaster.listDmail();

        expect(dmails).toBeDefined();
        expect(dmails[did]).toBeDefined();
        expect(dmails[did].sender).toBe(bob);
        expect(dmails[did].date).toBeDefined();
        expect(dmails[did].message).toStrictEqual(mock);
        expect(dmails[did].to).toStrictEqual(['Alice']);
        expect(dmails[did].cc).toStrictEqual([bob]);
        expect(dmails[did].tags).toStrictEqual(['inbox']);
    });

    it('should include attachments', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const mock: DmailMessage = {
            to: [alice],
            cc: [bob],
            subject: 'Test Dmail 52',
            body: 'This is a test dmail message 52.',
        };

        const did = await keymaster.createDmail(mock);

        const mockDocument = Buffer.from('This is a mock binary document 52.', 'utf-8');
        const mockName = 'mockDocument1.txt';
        const ok = await keymaster.addDmailAttachment(did, mockName, mockDocument);
        expect(ok).toBe(true);

        const dmails = await keymaster.listDmail();

        expect(dmails).toBeDefined();
        expect(dmails[did]).toBeDefined();
        expect(dmails[did].attachments).toBeDefined();
        expect(dmails[did].attachments[mockName]).toBeDefined();
        expect(dmails[did].attachments[mockName].bytes).toBe(34);
        expect(dmails[did].attachments[mockName].type).toBe('text/plain');
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
            subject: 'Test Dmail 52',
            body: 'This is a test dmail message 52.',
        };

        const did = await keymaster.createDmail(mock);
        await keymaster.removeGroupVaultItem(did, DmailTags.DMAIL); // invalidate the dmail

        const dmails = await keymaster.listDmail();

        expect(dmails).toStrictEqual({});
    });
});

describe('getDmailMessage', () => {
    it('should retrieve message by DID', async () => {
        const alice = await keymaster.createId('Alice');
        const mock: DmailMessage = {
            to: [alice],
            cc: [],
            subject: 'Test Dmail 6',
            body: 'This is a test dmail message 6.',
        };

        const did = await keymaster.createDmail(mock);
        const dmail = await keymaster.getDmailMessage(did);

        expect(dmail).toStrictEqual(mock);
    });

    it('should retrieve null if DID is not a dmail', async () => {
        const alice = await keymaster.createId('Alice');
        const dmail = await keymaster.getDmailMessage(alice);

        expect(dmail).toBeNull();
    });

    it('should retrieve null if DID is a different kind of GroupVault', async () => {
        await keymaster.createId('Alice');
        const vault = await keymaster.createGroupVault();
        const dmail = await keymaster.getDmailMessage(vault);

        expect(dmail).toBeNull();
    });

    it('should retrieve null if DID GroupVault item is the wrong type', async () => {
        await keymaster.createId('Alice');
        const vault = await keymaster.createGroupVault();
        const buffer = Buffer.from('This is not a valid dmail');
        await keymaster.addGroupVaultItem(vault, DmailTags.DMAIL, buffer);
        const dmail = await keymaster.getDmailMessage(vault);

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

        const dmail = await keymaster.getDmailMessage(did);
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

    it('should return true if dmail already removed', async () => {
        await keymaster.createId('Alice');
        const mock1: DmailMessage = {
            to: ['Alice'],
            cc: [],
            subject: 'Test Dmail 81',
            body: 'This is a test dmail message 81.',
        };

        const did = await keymaster.createDmail(mock1);
        await keymaster.removeDmail(did);

        const ok = await keymaster.removeDmail(did);
        expect(ok).toBe(true);
    });
});

describe('sendDmail', () => {
    it('should tag a dmail as sent and return a notice DID', async () => {
        const alice = await keymaster.createId('Alice');
        const mock1: DmailMessage = {
            to: ['Alice'],
            cc: [],
            subject: 'Test Dmail 9',
            body: 'This is a test dmail message 9.',
        };

        const did = await keymaster.createDmail(mock1);

        const notice = await keymaster.sendDmail(did);
        expect(notice).toBeDefined();

        const doc = await keymaster.resolveDID(notice!);
        expect(doc.mdip!.registry).toBe('hyperswarm');
        expect(doc.mdip!.validUntil).toBeDefined();

        const asset = doc.didDocumentData as { notice?: NoticeMessage };

        expect(asset.notice).toBeDefined();
        expect(asset.notice!.to).toStrictEqual([alice]);
        expect(asset.notice!.dids).toStrictEqual([did]);

        const dmails = await keymaster.listDmail();
        expect(dmails[did].tags).toStrictEqual(['sent']);
    });

    it('should return null for invalid dmail', async () => {
        const alice = await keymaster.createId('Alice');

        const notice = await keymaster.sendDmail(alice);
        expect(notice).toBe(null);
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

describe('addDmailAttachment', () => {
    const mockDocument = Buffer.from('This is a mock binary document 11.', 'utf-8');

    it('should add an attachment to the dmail', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const mock1: DmailMessage = {
            to: ['Alice'],
            cc: [],
            subject: 'Test Dmail 11',
            body: 'This is a test dmail message 11.',
        };

        const did = await keymaster.createDmail(mock1);
        const mockName = 'mockDocument11.txt';

        const ok = await keymaster.addDmailAttachment(did, mockName, mockDocument);
        expect(ok).toBe(true);
    });

    it('should throw an exception if invalid attachment name', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const mock1: DmailMessage = {
            to: ['Alice'],
            cc: [],
            subject: 'Test Dmail 111',
            body: 'This is a test dmail message 111.',
        };

        const did = await keymaster.createDmail(mock1);

        try {
            await keymaster.addDmailAttachment(did, 'dmail', mockDocument);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: Cannot add attachment with reserved name "dmail"');
        }
    });
});

describe('removeDmailAttachment', () => {
    const mockDocument = Buffer.from('This is a mock binary document 12.', 'utf-8');

    it('should remove an attachment to the dmail', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const mock1: DmailMessage = {
            to: ['Alice'],
            cc: [],
            subject: 'Test Dmail 12',
            body: 'This is a test dmail message 12.',
        };

        const did = await keymaster.createDmail(mock1);
        const mockName = 'mockDocument1.txt';

        await keymaster.addDmailAttachment(did, mockName, mockDocument);
        const ok = await keymaster.removeDmailAttachment(did, mockName);
        expect(ok).toBe(true);
    });

    it('should throw an exception if invalid attachment name', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const mock1: DmailMessage = {
            to: ['Alice'],
            cc: [],
            subject: 'Test Dmail 13',
            body: 'This is a test dmail message 13.',
        };

        const did = await keymaster.createDmail(mock1);

        try {
            await keymaster.removeDmailAttachment(did, 'dmail');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Invalid parameter: Cannot remove attachment with reserved name "dmail"');
        }
    });
});

describe('getDmailAttachment', () => {
    const mockDocument = Buffer.from('This is a mock binary document 14.', 'utf-8');

    it('should remove an attachment to the dmail', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const mock1: DmailMessage = {
            to: ['Alice'],
            cc: [],
            subject: 'Test Dmail 14',
            body: 'This is a test dmail message 14.',
        };

        const did = await keymaster.createDmail(mock1);
        const mockName = 'mockDocument14.txt';
        await keymaster.addDmailAttachment(did, mockName, mockDocument);

        const attachment = await keymaster.getDmailAttachment(did, mockName);
        expect(attachment).toStrictEqual(mockDocument);
    });
});
