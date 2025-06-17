import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
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
    keymaster = new Keymaster({ gatekeeper, wallet, cipher, search });
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

        const did = await keymaster.createNotice(notice1);

        await keymaster.setCurrentId('Alice');
        const ok = await keymaster.importNotice(did);

        expect(ok).toBe(true);
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
        keymaster = new Keymaster({ gatekeeper, wallet, cipher });
        await keymaster.createId('Alice');

        const ok = await keymaster.searchNotices();
        expect(ok).toBe(false);
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

        await keymaster.setCurrentId('Bob');
        await keymaster.revokeDID(did);

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
