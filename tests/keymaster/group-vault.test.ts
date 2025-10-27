import sharp from 'sharp';
import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import {
    GroupVault,
    GroupVaultLogin,
} from '@mdip/keymaster/types';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { ExpectedExceptionError, UnknownIDError, InvalidParameterError } from '@mdip/common/errors';
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
    keymaster = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'passphrase' });
});

describe('createGroupVault', () => {
    it('should return a new groupVault DID', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        const doc = await keymaster.resolveDID(did);
        const data = doc.didDocumentData as { groupVault?: GroupVault };

        expect(data.groupVault).toBeDefined();
        expect(data.groupVault!.version).toBe(1);
        expect(data.groupVault!.publicJwk).toBeDefined();
        expect(data.groupVault!.salt).toBeDefined();
        expect(data.groupVault!.keys).toBeDefined();
        expect(data.groupVault!.items).toBeDefined();
        expect(data.groupVault!.sha256).toStrictEqual(cipher.hashJSON({}));
    });
});

describe('getGroupVault', () => {
    it('should return a groupVault', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        const groupVault = await keymaster.getGroupVault(did);

        expect(groupVault).toBeDefined();
        expect(groupVault!.version).toBe(1);
        expect(groupVault!.publicJwk).toBeDefined();
        expect(groupVault!.salt).toBeDefined();
        expect(groupVault!.keys).toBeDefined();
        expect(groupVault!.items).toBeDefined();
        expect(groupVault!.sha256).toStrictEqual(cipher.hashJSON({}));
    });

    it('should throw an exception on get invalid groupVault', async () => {
        const bob = await keymaster.createId('Bob');

        try {
            await keymaster.getGroupVault('bogus');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }

        try {
            await keymaster.getGroupVault(bob);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(InvalidParameterError.type);
        }
    });
});

describe('testGroupVault', () => {
    it('should return true for a groupVault', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        const isGroupVault = await keymaster.testGroupVault(did);

        expect(isGroupVault).toBe(true);
    });

    it('should return false for an agent', async () => {
        const bob = await keymaster.createId('Bob');
        const isGroupVault = await keymaster.testGroupVault(bob);

        expect(isGroupVault).toBe(false);
    });

    it('should return false for another kind of asset', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createAsset({ name: 'mockAnchor' });
        const isGroupVault = await keymaster.testGroupVault(did);

        expect(isGroupVault).toBe(false);
    });
});

describe('addGroupVaultMember', () => {
    it('should add a new member to the groupVault', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        const ok = await keymaster.addGroupVaultMember(did, alice);
        expect(ok).toBe(true);

        const groupVault = await keymaster.getGroupVault(did);
        expect(Object.keys(groupVault.keys).length).toBe(2);
    });

    it('should not be able add owner as a member', async () => {
        const bob = await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        const ok = await keymaster.addGroupVaultMember(did, bob);
        expect(ok).toBe(false);
    });

    it('should be able to add a new member after key rotation', async () => {
        const alice = await keymaster.createId('Alice');
        const charlie = await keymaster.createId('Charlie');

        await keymaster.createId('Bob', { registry: 'local' });
        const did = await keymaster.createGroupVault({ registry: 'local' });

        await keymaster.addGroupVaultMember(did, alice);
        await keymaster.rotateKeys();

        const ok = await keymaster.addGroupVaultMember(did, charlie);
        expect(ok).toBe(true);

        const groupVault = await keymaster.getGroupVault(did);
        expect(Object.keys(groupVault.keys).length).toBe(3);
    });

    // eslint-disable-next-line
    it('should throw an exception if not owner', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        await keymaster.createId('Alice');

        try {
            await keymaster.addGroupVaultMember(did, 'Bob');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.message).toBe('Keymaster: Only vault owner can modify the vault');
        }
    });

    it('should throw an exception on invalid member', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        try {
            await keymaster.addGroupVaultMember(did, 'bogus');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }

        try {
            const asset = await keymaster.createAsset({ name: 'mockAnchor' });
            await keymaster.addGroupVaultMember(did, asset);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            // eslint-disable-next-line
            expect(error.detail).toBe('Document is not an agent');
        }
    });
});

describe('removeGroupVaultMember', () => {
    it('should remove a member from the groupVault', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        await keymaster.addGroupVaultMember(did, alice);
        const ok = await keymaster.removeGroupVaultMember(did, alice);
        expect(ok).toBe(true);

        const groupVault = await keymaster.getGroupVault(did);
        expect(Object.keys(groupVault.keys).length).toBe(1);
    });

    it('should remove a member from the groupVault with secret members', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault({ secretMembers: true });

        await keymaster.addGroupVaultMember(did, alice);
        const ok = await keymaster.removeGroupVaultMember(did, alice);
        expect(ok).toBe(true);

        const groupVault = await keymaster.getGroupVault(did);
        expect(Object.keys(groupVault.keys).length).toBe(1);
    });

    it('should not be able to remove owner from the groupVault', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        await keymaster.addGroupVaultMember(did, alice);
        const ok = await keymaster.removeGroupVaultMember(did, bob);
        expect(ok).toBe(false);
    });

    it('should be OK to remove a non-existent member from the groupVault', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        const ok = await keymaster.removeGroupVaultMember(did, alice);
        expect(ok).toBe(true);
    });

    it('should throw an exception if not owner', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        await keymaster.createId('Alice');

        try {
            await keymaster.removeGroupVaultMember(did, 'Bob');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: Only vault owner can modify the vault');
        }
    });

    it('should throw an exception on invalid member', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        try {
            await keymaster.removeGroupVaultMember(did, 'bogus');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.type).toBe(UnknownIDError.type);
        }

        try {
            const asset = await keymaster.createAsset({ name: 'mockAnchor' });
            await keymaster.removeGroupVaultMember(did, asset);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.detail).toBe('Document is not an agent');
        }
    });
});

describe('listGroupVaultMembers', () => {
    it('should return an empty list of members on creation', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        const members = await keymaster.listGroupVaultMembers(did);

        expect(members).toStrictEqual({});
    });

    it('should return member list to owner', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultMember(did, 'Alice');

        const members = await keymaster.listGroupVaultMembers(did);

        expect(alice in members).toBe(true);
    });

    it('should return empty list when all members removed', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultMember(did, alice);
        await keymaster.removeGroupVaultMember(did, alice);

        const members = await keymaster.listGroupVaultMembers(did);

        expect(members).toStrictEqual({});
    });

    it('should return member list to members when not secret', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultMember(did, 'Alice');
        await keymaster.setCurrentId('Alice');

        const members = await keymaster.listGroupVaultMembers(did);

        expect(alice in members).toBe(true);
    });

    it('should not return member list to members when secret', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault({ secretMembers: true });
        await keymaster.addGroupVaultMember(did, 'Alice');
        await keymaster.setCurrentId('Alice');

        const members = await keymaster.listGroupVaultMembers(did);

        expect(members).toStrictEqual({});
    });

    it('should trigger a version upgrade', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault({ version: 0 });

        const ok = await keymaster.addGroupVaultMember(did, alice);
        expect(ok).toBe(true);

        const members = await keymaster.listGroupVaultMembers(did);
        expect(alice in members).toBe(true);

        const groupVault = await keymaster.getGroupVault(did);
        expect(groupVault.version).toBe(1);
    });

    it('should throw an exception if triggered version upgrade encounters unsupported version', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        const ok = await keymaster.addGroupVaultMember(did, alice);
        expect(ok).toBe(true);

        try {
            const groupVault = await keymaster.getGroupVault(did);
            groupVault.version = 999; // Simulate unsupported version
            await keymaster.updateAsset(did, { groupVault });
            await keymaster.listGroupVaultMembers(did);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: Unsupported group vault version');
        }
    });
});

describe('addGroupVaultItem', () => {
    const mockDocument = Buffer.from('This is a mock binary document 1.', 'utf-8');

    it('should add a document to the groupVault', async () => {
        const mockName = 'mockDocument1.txt';
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        const ok = await keymaster.addGroupVaultItem(did, mockName, mockDocument);
        expect(ok).toBe(true);
    });

    it('should add a document to the groupVault with a unicode name', async () => {
        const mockName = 'm̾o̾c̾k̾N̾a̾m̾e̾.txt';
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        const ok = await keymaster.addGroupVaultItem(did, mockName, mockDocument);
        expect(ok).toBe(true);
    });

    it('should add an image to the groupVault', async () => {
        const mockImage = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).png().toBuffer();
        const mockName = 'vaultImage.png';
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        const ok = await keymaster.addGroupVaultItem(did, mockName, mockImage);
        expect(ok).toBe(true);

        const items = await keymaster.listGroupVaultItems(did);
        expect(items![mockName]).toBeDefined();
        expect(items![mockName].type).toBe('image/png');
    });

    it('should add JSON to the groupVault', async () => {
        const login: GroupVaultLogin = {
            service: 'https://example.com',
            username: 'bob',
            password: 'secret',
        };
        const buffer = Buffer.from(JSON.stringify({ login }), 'utf-8');
        const mockName = `login: ${login.service}`;
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        const ok = await keymaster.addGroupVaultItem(did, mockName, buffer);
        expect(ok).toBe(true);

        const items = await keymaster.listGroupVaultItems(did);
        expect(items![mockName]).toBeDefined();
        expect(items![mockName].type).toBe('application/json');
    });

    it('should be able to add a new item after key rotation', async () => {
        await keymaster.createId('Bob', { registry: 'local' });
        const did = await keymaster.createGroupVault({ registry: 'local' });

        await keymaster.addGroupVaultItem(did, 'item1', mockDocument);
        await keymaster.rotateKeys();
        await keymaster.addGroupVaultItem(did, 'item2', mockDocument);

        const items = await keymaster.listGroupVaultItems(did);

        expect(items!['item1'].bytes).toBe(mockDocument.length);
        expect(items!['item1'].sha256).toBe(items!['item2'].sha256);
    });

    it('should throw an exception if not owner', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        await keymaster.createId('Alice');

        try {
            await keymaster.addGroupVaultItem(did, 'item1', mockDocument);
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: Only vault owner can modify the vault');
        }
    });

    it('should not add an item with an empty name', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        const expectedError = 'Invalid parameter: name must be a non-empty string';

        try {
            await keymaster.addGroupVaultItem(did, '', mockDocument);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            await keymaster.addGroupVaultItem(did, '    ', mockDocument);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }

        try {
            await keymaster.addGroupVaultItem(did, "\t\r\n", mockDocument);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(expectedError);
        }
    });
});

describe('removeGroupVaultItem', () => {
    it('should remove a document from the groupVault', async () => {
        const mockName = 'mockDocument9.txt';
        const mockDocument = Buffer.from('This is a mock binary document 9.', 'utf-8');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultItem(did, mockName, mockDocument);

        const ok = await keymaster.removeGroupVaultItem(did, mockName);
        const items = await keymaster.listGroupVaultItems(did);
        expect(ok).toBe(true);
        expect(items).toStrictEqual({});
    });

    it('should be OK to remove a non-existent item from the groupVault', async () => {
        const mockName = 'mockDocument9.txt';
        const mockDocument = Buffer.from('This is a mock binary document 9.', 'utf-8');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultItem(did, mockName, mockDocument);

        const ok = await keymaster.removeGroupVaultItem(did, 'bogus');
        expect(ok).toBe(true);
    });

    it('should throw an exception if not owner', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();

        await keymaster.createId('Alice');

        try {
            await keymaster.removeGroupVaultItem(did, 'item1');
            throw new ExpectedExceptionError();
        } catch (error: any) {
            expect(error.message).toBe('Keymaster: Only vault owner can modify the vault');
        }
    });
});

describe('listGroupVaultItems', () => {
    it('should return an index of the items in the groupVault', async () => {
        const mockName = 'mockDocument2.txt';
        const mockDocument = Buffer.from('This is a mock binary document 2.', 'utf-8');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        const ok = await keymaster.addGroupVaultItem(did, mockName, mockDocument);
        const items = await keymaster.listGroupVaultItems(did);

        expect(ok).toBe(true);
        expect(items).toBeDefined();
        expect(items![mockName]).toBeDefined();
        expect(items![mockName].cid).toBeDefined();
        expect(items![mockName].bytes).toBe(mockDocument.length);
        expect(items![mockName].sha256).toBe(cipher.hashMessage(mockDocument));
    });
});

describe('getGroupVaultItem', () => {
    const mockDocumentName = 'mockVaultItem.txt';
    const mockDocument = Buffer.from('This is a mock vault document.', 'utf-8');

    it('should return a document from the groupVault', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultItem(did, mockDocumentName, mockDocument);

        const item = await keymaster.getGroupVaultItem(did, mockDocumentName);

        expect(item).toStrictEqual(mockDocument);
    });

    it('should return a large BLOB', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        const largeDocument = Buffer.alloc(1024 * 1024, 'A'); // 1 MB of 'A's
        await keymaster.addGroupVaultItem(did, mockDocumentName, largeDocument);

        const item = await keymaster.getGroupVaultItem(did, mockDocumentName);

        expect(item).toStrictEqual(largeDocument);
    });

    it('should return null for unknown item', async () => {
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultItem(did, mockDocumentName, mockDocument);

        const item = await keymaster.getGroupVaultItem(did, 'bogus');

        expect(item).toBe(null);
    });

    it('should return an image from the groupVault', async () => {
        const mockImageName = 'vaultImage33.png';
        const mockImage = await sharp({
            create: {
                width: 100,
                height: 100,
                channels: 3,
                background: { r: 255, g: 0, b: 0 }
            }
        }).png().toBuffer();
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultItem(did, mockImageName, mockImage);

        const item = await keymaster.getGroupVaultItem(did, mockImageName);

        expect(item).toStrictEqual(mockImage);
    });

    it('should return a document from the groupVault to a different member', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultMember(did, alice);
        await keymaster.addGroupVaultItem(did, mockDocumentName, mockDocument);

        await keymaster.setCurrentId('Alice');
        const item = await keymaster.getGroupVaultItem(did, mockDocumentName);

        expect(item).toStrictEqual(mockDocument);
    });

    it('should return a document from the groupVault after key rotation', async () => {
        // Need to register on local so key rotation is automatically confirmed
        const alice = await keymaster.createId('Alice', { registry: 'local' });
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultMember(did, alice);
        await keymaster.addGroupVaultItem(did, mockDocumentName, mockDocument);

        await keymaster.setCurrentId('Alice');
        await keymaster.rotateKeys();

        const item = await keymaster.getGroupVaultItem(did, mockDocumentName);

        expect(item).toStrictEqual(mockDocument);
    });

    it('should return null if caller is not a member', async () => {
        await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultItem(did, mockDocumentName, mockDocument);

        await keymaster.setCurrentId('Alice');
        const item = await keymaster.getGroupVaultItem(did, mockDocumentName);

        expect(item).toBe(null);
    });

    it('should retrieve JSON', async () => {
        const login: GroupVaultLogin = {
            service: 'https://example2.com',
            username: 'alice',
            password: '*******',
        };
        const buffer = Buffer.from(JSON.stringify({ login }), 'utf-8');
        const mockName = `login: ${login.service}`;
        await keymaster.createId('Bob');
        const did = await keymaster.createGroupVault();
        await keymaster.addGroupVaultItem(did, mockName, buffer);

        const itemBuffer = await keymaster.getGroupVaultItem(did, mockName);
        const itemLogin = JSON.parse(itemBuffer!.toString('utf-8'));

        expect(itemLogin).toStrictEqual({ login });
    });
});
