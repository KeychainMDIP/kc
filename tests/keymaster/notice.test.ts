import { jest } from '@jest/globals';
import Gatekeeper from '@mdip/gatekeeper';
import Keymaster, { DmailTags, NoticeTags } from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import { ExpectedExceptionError } from '@mdip/common/errors';
import HeliaClient from '@mdip/ipfs/helia';
import { NoticeMessage, SearchEngine } from '@mdip/keymaster/types';

class MockSearch implements SearchEngine {
    private results: string[] = [];
    private throwError: boolean = false;

    async setResults(results: string[]): Promise<void> {
        this.results = results;
    }

    async setThrowError(throwError: boolean): Promise<void> {
        this.throwError = throwError;
    }

    async search(query: object): Promise<string[]> {
        if (this.throwError) {
            throw new Error('Search engine error');
        }

        return this.results;
    }
}

let ipfs: HeliaClient;
let gatekeeper: Gatekeeper;
let wallet: WalletJsonMemory;
let cipher: CipherNode;
let keymaster: Keymaster;
let search: MockSearch;

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
    search = new MockSearch();
    keymaster = new Keymaster({ gatekeeper, wallet, cipher, search, passphrase: 'passphrase' });
});

describe('verifyNotice', () => {
    it('should return same notice if valid', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const asset1 = await keymaster.createAsset({});
        const asset2 = await keymaster.createAsset({});

        const notice: NoticeMessage = {
            to: [alice, bob],
            dids: [asset1, asset2],
        };

        const verified = await keymaster.verifyNotice(notice);

        expect(verified).toStrictEqual(notice);
    });

    it('should throw an exception on invalid notice', async () => {
        const alice = await keymaster.createId('Alice');

        try {
            const notice: NoticeMessage = {
                to: [],
                dids: [],
            };

            await keymaster.verifyNotice(notice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: notice.to');
        }

        try {
            const dmail: NoticeMessage = {
                to: [alice],
                dids: [],
            };

            await keymaster.verifyNotice(dmail);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: notice.dids');
        }
    });
});

describe('createNotice', () => {
    it('should create a valid notice', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const asset1 = await keymaster.createAsset({});
        const asset2 = await keymaster.createAsset({});

        const notice: NoticeMessage = {
            to: [alice, bob],
            dids: [asset1, asset2],
        };

        const did = await keymaster.createNotice(notice);

        expect(did).toBeDefined();
    });
});

describe('updateNotice', () => {
    it('should update a valid notice', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const asset1 = await keymaster.createAsset({});
        const asset2 = await keymaster.createAsset({});

        const notice1: NoticeMessage = {
            to: [alice],
            dids: [asset1],
        };

        const did = await keymaster.createNotice(notice1);

        const notice2: NoticeMessage = {
            to: [alice, bob],
            dids: [asset1, asset2],
        };

        const ok = await keymaster.updateNotice(did, notice2);

        expect(ok).toBe(true);
    });
});

describe('verifyDIDList', () => {
    it('should return same list of valid DIDs', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const charles = await keymaster.createId('Charles');
        const dids = [alice, bob, charles];

        const verified = await keymaster.verifyDIDList(dids);

        expect(verified).toStrictEqual(dids);
    });

    it('should throw an exception on invalid list', async () => {
        await keymaster.createId('Alice');

        try {
            await keymaster.verifyDIDList(123 as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: didList');
        }

        try {
            await keymaster.verifyDIDList([1, 2, 3] as any);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: Invalid DID: 1');
        }

        try {
            await keymaster.verifyDIDList(['did:mdip:123']);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Invalid parameter: Invalid DID: did:mdip:123');
        }
    });
});

describe('importNotice', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    async function createCredentialNotice() {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const schema = await keymaster.createSchema();
        const bound = await keymaster.bindCredential(schema, alice);
        const first = await keymaster.issueCredential(bound);
        const second = await keymaster.issueCredential(bound);
        const notice = await keymaster.createNotice({ to: [alice], dids: [first, second] });
        await keymaster.setCurrentId('Alice');
        return { first, second, notice };
    }

    it('should retry remaining credentials after a resolution failure and restart', async () => {
        const { first, second, notice } = await createCredentialNotice();
        const resolveDID = gatekeeper.resolveDID.bind(gatekeeper);
        const failure = new Error('ECONNREFUSED');
        const resolve = jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (did, options) => {
            if (did === second) {
                throw failure;
            }
            return resolveDID(did, options);
        });

        await expect(keymaster.importNotice(notice)).rejects.toThrow(failure);
        expect(await keymaster.listCredentials()).toStrictEqual([first]);
        expect((await keymaster.fetchIdInfo()).notices?.[notice]).toBeUndefined();

        resolve.mockRestore();
        keymaster = new Keymaster({ gatekeeper, wallet, cipher, search, passphrase: 'passphrase' });
        expect((await keymaster.fetchIdInfo()).notices?.[notice]).toBeUndefined();
        await expect(keymaster.importNotice(notice)).resolves.toBe(true);
        expect(await keymaster.listCredentials()).toStrictEqual([first, second]);
        expect((await keymaster.fetchIdInfo()).notices?.[notice].tags).toStrictEqual([NoticeTags.CREDENTIAL]);

        const accept = jest.spyOn(keymaster, 'acceptCredential');
        await expect(keymaster.importNotice(notice)).resolves.toBe(true);
        expect(accept).not.toHaveBeenCalled();
    });

    it('should retry a notice when a later credential was not accepted', async () => {
        const { first, second, notice } = await createCredentialNotice();
        const acceptCredential = keymaster.acceptCredential.bind(keymaster);
        const accept = jest.spyOn(keymaster, 'acceptCredential').mockImplementation(async did =>
            did === second ? false : acceptCredential(did));

        await expect(keymaster.importNotice(notice)).resolves.toBe(false);
        expect(await keymaster.listCredentials()).toStrictEqual([first]);
        expect((await keymaster.fetchIdInfo()).notices?.[notice]).toBeUndefined();

        accept.mockRestore();
        await expect(keymaster.importNotice(notice)).resolves.toBe(true);
        expect(await keymaster.listCredentials()).toStrictEqual([first, second]);
    });

    it.each([2, 3])('should remain retryable when wallet save %s fails', async failAt => {
        const { first, second, notice } = await createCredentialNotice();
        const saveWallet = wallet.saveWallet.bind(wallet);
        const failure = new Error('Wallet storage unavailable');
        let saves = 0;
        const save = jest.spyOn(wallet, 'saveWallet').mockImplementation(async (candidate, overwrite) => {
            if (++saves === failAt) {
                throw failure;
            }
            return saveWallet(candidate, overwrite);
        });

        await expect(keymaster.importNotice(notice)).rejects.toThrow(failure);
        expect((await keymaster.fetchIdInfo()).notices?.[notice]).toBeUndefined();

        save.mockRestore();
        keymaster = new Keymaster({ gatekeeper, wallet, cipher, search, passphrase: 'passphrase' });
        expect(await keymaster.listCredentials()).toStrictEqual(failAt === 2 ? [first] : [first, second]);
        expect((await keymaster.fetchIdInfo()).notices?.[notice]).toBeUndefined();
        await expect(keymaster.importNotice(notice)).resolves.toBe(true);
        expect(await keymaster.listCredentials()).toStrictEqual([first, second]);
        expect((await keymaster.fetchIdInfo()).notices?.[notice].tags).toStrictEqual([NoticeTags.CREDENTIAL]);
    });

    it('should let search retry a partially imported notice', async () => {
        const { first, second, notice } = await createCredentialNotice();
        await search.setResults([notice]);
        const acceptCredential = keymaster.acceptCredential.bind(keymaster);
        const accept = jest.spyOn(keymaster, 'acceptCredential').mockImplementation(async did =>
            did === second ? false : acceptCredential(did));

        await expect(keymaster.searchNotices()).resolves.toBe(true);
        expect(await keymaster.listCredentials()).toStrictEqual([first]);
        expect((await keymaster.fetchIdInfo()).notices?.[notice]).toBeUndefined();

        accept.mockRestore();
        await expect(keymaster.searchNotices()).resolves.toBe(true);
        expect(await keymaster.listCredentials()).toStrictEqual([first, second]);
        expect((await keymaster.fetchIdInfo()).notices?.[notice].tags).toStrictEqual([NoticeTags.CREDENTIAL]);
    });

    it('should not complete a notice when a DMail import returns false', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const dmail = await keymaster.createDmail({ to: [alice], cc: [], subject: 'Notice', body: 'Message' });
        const notice = await keymaster.createNotice({ to: [alice], dids: [dmail] });
        await keymaster.setCurrentId('Alice');
        jest.spyOn(keymaster, 'importDmail').mockResolvedValueOnce(false);

        await expect(keymaster.importNotice(notice)).resolves.toBe(false);
        expect((await keymaster.fetchIdInfo()).notices?.[notice]).toBeUndefined();
        await expect(keymaster.importNotice(notice)).resolves.toBe(true);
        expect((await keymaster.fetchIdInfo()).dmail?.[dmail]).toBeDefined();
        expect((await keymaster.fetchIdInfo()).notices?.[notice].tags).toStrictEqual([NoticeTags.DMAIL]);
    });

    it.each(['false', 'throw'])('should retry a ballot import that fails with %s', async failure => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const roster = await keymaster.createGroup('PollGroup');
        await keymaster.addGroupMember(roster, alice);
        const poll = await keymaster.createPoll({ ...await keymaster.pollTemplate(), roster });
        await keymaster.setCurrentId('Alice');
        const ballot = await keymaster.votePoll(poll, 1);
        const notice = await keymaster.createNotice({ to: [bob], dids: [ballot] });
        await keymaster.setCurrentId('Bob');
        const update = jest.spyOn(keymaster, 'updatePoll');
        if (failure === 'throw') {
            update.mockRejectedValueOnce(new Error('Temporary update failure'));
        } else {
            update.mockResolvedValueOnce(false);
        }

        await expect(keymaster.importNotice(notice)).resolves.toBe(false);
        expect((await keymaster.fetchIdInfo()).notices?.[notice]).toBeUndefined();
        await expect(keymaster.importNotice(notice)).resolves.toBe(true);
        expect((await keymaster.getPoll(poll))?.ballots?.[alice].ballot).toBe(ballot);
        expect((await keymaster.fetchIdInfo()).notices?.[notice].tags).toStrictEqual([NoticeTags.BALLOT]);
    });

    it('should not complete a poll notice when saving its alias fails', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const roster = await keymaster.createGroup('PollGroup');
        await keymaster.addGroupMember(roster, alice);
        const poll = await keymaster.createPoll({ ...await keymaster.pollTemplate(), roster });
        const notice = await keymaster.createNotice({ to: [alice], dids: [poll] });
        await keymaster.setCurrentId('Alice');
        jest.spyOn(wallet, 'saveWallet').mockRejectedValueOnce(new Error('Wallet storage unavailable'));

        await expect(keymaster.importNotice(notice)).resolves.toBe(false);
        expect((await keymaster.fetchIdInfo()).notices?.[notice]).toBeUndefined();
        await expect(keymaster.importNotice(notice)).resolves.toBe(true);
        expect(Object.values(await keymaster.listNames())).toContain(poll);
        expect((await keymaster.fetchIdInfo()).notices?.[notice].tags).toStrictEqual([NoticeTags.POLL]);
    });

    it('should retain a poll alias while retrying later items in a mixed notice', async () => {
        const { first, second, notice } = await createCredentialNotice();
        const alice = (await keymaster.fetchIdInfo()).did;
        const roster = await keymaster.createGroup('PollGroup');
        await keymaster.addGroupMember(roster, alice);
        const poll = await keymaster.createPoll({ ...await keymaster.pollTemplate(), roster });
        await keymaster.updateNotice(notice, { to: [alice], dids: [poll, first, second] });
        const acceptCredential = keymaster.acceptCredential.bind(keymaster);
        const accept = jest.spyOn(keymaster, 'acceptCredential').mockImplementation(async did =>
            did === second ? false : acceptCredential(did));
        const addName = jest.spyOn(keymaster, 'addName');
        const recordNotice = jest.spyOn(keymaster, 'addToNotices');

        await expect(keymaster.importNotice(notice)).resolves.toBe(false);
        expect(Object.values(await keymaster.listNames())).toContain(poll);
        expect(recordNotice).not.toHaveBeenCalled();

        accept.mockRestore();
        await expect(keymaster.importNotice(notice)).resolves.toBe(true);
        expect(addName).toHaveBeenCalledTimes(1);
        expect(recordNotice).toHaveBeenCalledTimes(1);
        expect(recordNotice).toHaveBeenCalledWith(notice, [NoticeTags.CREDENTIAL]);
        expect(await keymaster.listCredentials()).toStrictEqual([first, second]);
    });

    it('should leave a notice with no items unrecorded', async () => {
        const alice = await keymaster.createId('Alice');
        const notice = await keymaster.createAsset({ notice: { to: [alice], dids: [] } });

        await expect(keymaster.importNotice(notice)).resolves.toBe(true);
        expect((await keymaster.fetchIdInfo()).notices?.[notice]).toBeUndefined();
    });

    it('should import a dmail notice', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Charles');
        const dmail = await keymaster.createDmail({
            to: [alice],
            cc: [bob],
            subject: 'Test Dmail 1',
            body: 'This is a test dmail 1.',
        });

        const notice1: NoticeMessage = {
            to: [alice, bob],
            dids: [dmail],
        };

        const noticeDid = await keymaster.createNotice(notice1);

        await keymaster.setCurrentId('Alice');
        const ok = await keymaster.importNotice(noticeDid);
        expect(ok).toBe(true);

        const wallet = await keymaster.loadWallet();
        const notices = wallet.ids['Alice'].notices;
        expect(notices).toBeDefined();
        expect(notices![noticeDid]).toBeDefined();
        expect(notices![noticeDid].tags).toBeDefined();
        expect(notices![noticeDid].tags.includes(NoticeTags.DMAIL)).toBe(true);

        const dmails = wallet.ids['Alice'].dmail;
        expect(dmails).toBeDefined();
        expect(dmails![dmail]).toBeDefined();
        expect(dmails![dmail].tags).toBeDefined();
        expect(dmails![dmail].tags.includes(DmailTags.INBOX)).toBe(true);
        expect(dmails![dmail].tags.includes(DmailTags.UNREAD)).toBe(true);
    });

    it('should import a poll notice', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        const roster = await keymaster.createGroup('PollGroup');
        await keymaster.addGroupMember(roster, alice);

        const template = await keymaster.pollTemplate();
        const pollDID = await keymaster.createPoll({
            ...template,
            roster
        });

        const notice: NoticeMessage = {
            to: [alice],
            dids: [pollDID],
        };

        const noticeDid = await keymaster.createNotice(notice);

        await keymaster.setCurrentId('Alice');
        const ok = await keymaster.importNotice(noticeDid);
        expect(ok).toBe(true);

        const wallet = await keymaster.loadWallet();
        const notices = wallet.ids['Alice'].notices;
        expect(notices).toBeDefined();
        expect(notices![noticeDid]).toBeDefined();
        expect(notices![noticeDid].tags).toBeDefined();
        expect(notices![noticeDid].tags.includes(NoticeTags.POLL)).toBe(true);
    });

    it('should import a ballot notice', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        const roster = await keymaster.createGroup('PollGroup');
        await keymaster.addGroupMember(roster, alice);

        const template = await keymaster.pollTemplate();
        const pollDID = await keymaster.createPoll({
            ...template,
            roster
        });

        await keymaster.setCurrentId('Alice');
        const ballotDid = await keymaster.votePoll(
            pollDID,
            1,
        );

        const notice: NoticeMessage = {
            to: [bob],
            dids: [ballotDid],
        };

        const noticeDid = await keymaster.createNotice(notice);

        await keymaster.setCurrentId('Bob');
        const ok = await keymaster.importNotice(noticeDid);
        expect(ok).toBe(true);

        const wallet = await keymaster.loadWallet();
        const notices = wallet.ids['Bob'].notices;
        expect(notices).toBeDefined();
        expect(notices![noticeDid]).toBeDefined();
        expect(notices![noticeDid].tags).toBeDefined();
        expect(notices![noticeDid].tags.includes(NoticeTags.BALLOT)).toBe(true);
    });

    it('should import a credential notice', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');

        const mockSchema = {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "properties": {
                "email": {
                    "format": "email",
                    "type": "string"
                }
            },
            "required": [
                "email"
            ],
            "type": "object"
        };

        const schema = await keymaster.createSchema(mockSchema);
        const bc = await keymaster.bindCredential(schema, alice);
        const vc = await keymaster.issueCredential(bc);

        const notice: NoticeMessage = {
            to: [alice],
            dids: [vc],
        };

        const noticeDid = await keymaster.createNotice(notice);

        await keymaster.setCurrentId('Alice');
        const ok = await keymaster.importNotice(noticeDid);
        expect(ok).toBe(true);

        const wallet = await keymaster.loadWallet();
        const notices = wallet.ids['Alice'].notices;
        expect(notices).toBeDefined();
        expect(notices![noticeDid]).toBeDefined();
        expect(notices![noticeDid].tags).toBeDefined();
        expect(notices![noticeDid].tags.includes(NoticeTags.CREDENTIAL)).toBe(true);

        const held = wallet.ids['Alice'].held;
        expect(held).toBeDefined();
        expect(held!.includes(vc)).toBe(true);
    });

    it('should return true if notice already imported', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Charles');
        const dmail = await keymaster.createDmail({
            to: [alice],
            cc: [bob],
            subject: 'Test Dmail',
            body: 'This is a test dmail.',
        });

        const notice1: NoticeMessage = {
            to: [alice, bob],
            dids: [dmail],
        };

        const did = await keymaster.createNotice(notice1);

        await keymaster.setCurrentId('Alice');
        await keymaster.importNotice(did);
        const ok = await keymaster.importNotice(did);

        expect(ok).toBe(true);
    });

    it('should not import notice if current ID is not a recipient', async () => {
        const alice = await keymaster.createId('Alice');
        await keymaster.createId('Bob');
        await keymaster.createId('Charles');
        const dmail = await keymaster.createDmail({
            to: [alice],
            cc: [],
            subject: 'Test Dmail 2',
            body: 'This is a test dmail 2.',
        });

        const notice1: NoticeMessage = {
            to: [alice],
            dids: [dmail],
        };

        const did = await keymaster.createNotice(notice1);

        await keymaster.setCurrentId('Bob');
        const ok = await keymaster.importNotice(did);

        expect(ok).toBe(false);
    });

    it('should not import non-notice', async () => {
        const alice = await keymaster.createId('Alice');
        const ok = await keymaster.importNotice(alice);

        expect(ok).toBe(false);
    });

    it('should not import unknown notice', async () => {
        const alice = await keymaster.createId('Alice');

        const notice: NoticeMessage = {
            to: [alice],
            dids: [alice],
        };

        const did = await keymaster.createNotice(notice);
        const ok = await keymaster.importNotice(did);

        expect(ok).toBe(false);
    });
});

describe('searchNotices', () => {
    it('should return true if nothing to do', async () => {
        await keymaster.createId('Alice');

        const ok = await keymaster.searchNotices();
        expect(ok).toBe(true);
    });

    it('should return false if search engine not configured', async () => {
        keymaster = new Keymaster({ gatekeeper, wallet, cipher, passphrase: 'passphrase' });
        await keymaster.createId('Alice');

        const ok = await keymaster.searchNotices();
        expect(ok).toBe(false);
    });

    it('should silently skip expired notices', async () => {
        const alice = await keymaster.createId('Alice');

        const notice: NoticeMessage = {
            to: [alice],
            dids: [alice],
        };

        const did = await keymaster.createNotice(notice);
        search.setResults([did]);
        await gatekeeper.removeDIDs([did]);

        const ok = await keymaster.searchNotices();
        expect(ok).toBe(true);
    });

    it('should throw an exception if search engine throws', async () => {
        await keymaster.createId('Alice');

        search.setThrowError(true);

        try {
            await keymaster.searchNotices();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe('Keymaster: Failed to search for notices');
        }
    });
});

describe('refreshNotices', () => {
    it('should return true if nothing to do', async () => {
        await keymaster.createId('Alice');

        const ok = await keymaster.refreshNotices();
        expect(ok).toBe(true);
    });

    it('should return true if notice already imported', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Charles');
        const dmail = await keymaster.createDmail({
            to: [alice],
            cc: [bob],
            subject: 'Test Dmail 3',
            body: 'This is a test dmail 3.',
        });

        const notice: NoticeMessage = {
            to: [alice, bob],
            dids: [dmail],
        };

        const did = await keymaster.createNotice(notice);

        await keymaster.setCurrentId('Alice');
        await keymaster.importNotice(did);

        const ok = await keymaster.refreshNotices();
        expect(ok).toBe(true);
    });

    it('should remove revoked notices', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Charles');
        const dmail = await keymaster.createDmail({
            to: [alice],
            cc: [bob],
            subject: 'Test Dmail 4',
            body: 'This is a test dmail 4.',
        });

        const notice: NoticeMessage = {
            to: [alice, bob],
            dids: [dmail],
        };

        const did = await keymaster.createNotice(notice);

        await keymaster.setCurrentId('Alice');
        await keymaster.importNotice(did);

        await keymaster.setCurrentId('Bob');
        await keymaster.revokeDID(did);

        await keymaster.setCurrentId('Alice');
        const ok = await keymaster.refreshNotices();

        expect(ok).toBe(true);
    });

    it('should remove expired notices', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Charles');
        const dmail = await keymaster.createDmail({
            to: [alice],
            cc: [bob],
            subject: 'Test Dmail 4',
            body: 'This is a test dmail 4.',
        });

        const notice: NoticeMessage = {
            to: [alice, bob],
            dids: [dmail],
        };

        const did = await keymaster.createNotice(notice);

        await keymaster.setCurrentId('Alice');
        await keymaster.importNotice(did);

        // Simulate expiration by removing the DID
        await gatekeeper.removeDIDs([did]);

        await keymaster.setCurrentId('Alice');
        const ok = await keymaster.refreshNotices();

        expect(ok).toBe(true);
    });

    it('should import notices from search results', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Charles');
        const dmail = await keymaster.createDmail({
            to: [alice],
            cc: [bob],
            subject: 'Test Dmail 5',
            body: 'This is a test dmail 5.',
        });

        const notice = await keymaster.sendDmail(dmail) || '';
        search.setResults([notice]);

        await keymaster.setCurrentId('Alice');
        const ok = await keymaster.refreshNotices();
        expect(ok).toBe(true);

        const id = await keymaster.fetchIdInfo();
        expect(id.notices).toBeDefined();
        expect(notice in id.notices!).toBeTruthy();

        const dmailbox = await keymaster.listDmail();
        expect(dmailbox).toBeDefined();
        expect(dmail in dmailbox).toBeTruthy();
    });

    it('should skip notices that are already imported', async () => {
        const alice = await keymaster.createId('Alice');
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Charles');
        const dmail = await keymaster.createDmail({
            to: [alice],
            cc: [bob],
            subject: 'Test Dmail 6',
            body: 'This is a test dmail 6.',
        });

        const notice = await keymaster.sendDmail(dmail) || '';
        search.setResults([notice]);

        await keymaster.setCurrentId('Alice');
        await keymaster.refreshNotices();
        await keymaster.refreshNotices();

        const id = await keymaster.fetchIdInfo();
        expect(id.notices).toBeDefined();
        expect(notice in id.notices!).toBeTruthy();
    });
});
