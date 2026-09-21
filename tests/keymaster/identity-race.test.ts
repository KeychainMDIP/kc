import { jest } from '@jest/globals';
import sharp from 'sharp';
import Gatekeeper from '@mdip/gatekeeper';
import Keymaster, { DmailTags } from '@mdip/keymaster';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import HeliaClient from '@mdip/ipfs/helia';
import { mockSchema } from './helper.ts';

let ipfs: HeliaClient;
let gatekeeper: Gatekeeper;
let keymaster: Keymaster;

beforeAll(async () => {
    ipfs = new HeliaClient();
    await ipfs.start();
});

afterAll(async () => {
    await ipfs.stop();
});

beforeEach(() => {
    gatekeeper = new Gatekeeper({
        db: new DbJsonMemory('test'),
        ipfs,
        registries: ['local', 'hyperswarm', 'TFTC'],
    });
    keymaster = new Keymaster({
        gatekeeper,
        wallet: new WalletJsonMemory(),
        cipher: new CipherNode(),
        passphrase: 'passphrase',
    });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function deferred() {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
}

function pauseNextResolution(did: string) {
    const reached = deferred();
    const blocked = deferred();
    const resolveDID = gatekeeper.resolveDID.bind(gatekeeper);
    let paused = false;

    jest.spyOn(gatekeeper, 'resolveDID').mockImplementation(async (candidate, options) => {
        if (!paused && candidate === did) {
            paused = true;
            reached.release();
            await blocked.promise;
        }
        return resolveDID(candidate, options);
    });

    return { reached: reached.promise, release: blocked.release };
}

function pauseNextLookup(did: string) {
    const reached = deferred();
    const blocked = deferred();
    const lookupDID = keymaster.lookupDID.bind(keymaster);
    let paused = false;

    jest.spyOn(keymaster, 'lookupDID').mockImplementation(async candidate => {
        if (!paused && candidate === did) {
            paused = true;
            reached.release();
            await blocked.promise;
        }
        return lookupDID(candidate);
    });

    return { reached: reached.promise, release: blocked.release };
}

function pauseNextDataWrite() {
    const reached = deferred();
    const blocked = deferred();
    const addData = gatekeeper.addData.bind(gatekeeper);

    jest.spyOn(gatekeeper, 'addData').mockImplementationOnce(async data => {
        reached.release();
        await blocked.promise;
        return addData(data);
    });

    return { reached: reached.promise, release: blocked.release };
}

describe('current identity changes during operations', () => {
    it('keeps asset control and bookkeeping with the initiating identity', async () => {
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Alice');
        await keymaster.setCurrentId('Bob');

        const reached = deferred();
        const blocked = deferred();
        const getBlock = gatekeeper.getBlock.bind(gatekeeper);
        jest.spyOn(gatekeeper, 'getBlock').mockImplementationOnce(async registry => {
            reached.release();
            await blocked.promise;
            return getBlock(registry);
        });

        const creating = keymaster.createAsset({ value: 'test' });
        await reached.promise;
        await keymaster.setCurrentId('Alice');
        blocked.release();
        const asset = await creating;

        expect((await keymaster.resolveDID(asset)).didDocument?.controller).toBe(bob);
        expect((await keymaster.fetchIdInfo('Bob')).owned).toContain(asset);
        expect((await keymaster.fetchIdInfo('Alice')).owned ?? []).not.toContain(asset);
    });

    it('treats an empty delegated controller as the initiating identity', async () => {
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Alice');
        await keymaster.setCurrentId('Bob');

        const reached = deferred();
        const blocked = deferred();
        const fetchIdInfo = keymaster.fetchIdInfo.bind(keymaster);
        let first = true;
        jest.spyOn(keymaster, 'fetchIdInfo').mockImplementation(async (id, wallet) => {
            const info = await fetchIdInfo(id, wallet);
            if (first) {
                first = false;
                reached.release();
                await blocked.promise;
            }
            return info;
        });

        const creating = keymaster.createAsset({ value: 'test' }, { controller: '' });
        await reached.promise;
        await keymaster.setCurrentId('Alice');
        blocked.release();
        const asset = await creating;

        expect((await keymaster.resolveDID(asset)).didDocument?.controller).toBe(bob);
        expect((await keymaster.fetchIdInfo('Bob')).owned).toContain(asset);
        expect((await keymaster.fetchIdInfo('Alice')).owned ?? []).not.toContain(asset);
    });

    it('keeps cloned assets with the initiating identity', async () => {
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Alice');
        await keymaster.setCurrentId('Bob');
        const source = await keymaster.createAsset({ value: 'test' });

        const pause = pauseNextResolution(source);
        const cloning = keymaster.cloneAsset(source);
        await pause.reached;
        await keymaster.setCurrentId('Alice');
        pause.release();
        const clone = await cloning;

        expect((await keymaster.resolveDID(clone)).didDocument?.controller).toBe(bob);
        expect((await keymaster.fetchIdInfo('Bob')).owned).toContain(clone);
        expect((await keymaster.fetchIdInfo('Alice')).owned ?? []).not.toContain(clone);
    });

    it('keeps image assets with the initiating identity', async () => {
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Alice');
        await keymaster.setCurrentId('Bob');
        const image = await sharp({
            create: {
                width: 1,
                height: 1,
                channels: 3,
                background: { r: 0, g: 0, b: 0 },
            },
        }).png().toBuffer();

        const pause = pauseNextDataWrite();
        const creating = keymaster.createImage(image);
        await pause.reached;
        await keymaster.setCurrentId('Alice');
        pause.release();
        const asset = await creating;

        expect((await keymaster.resolveDID(asset)).didDocument?.controller).toBe(bob);
        expect((await keymaster.fetchIdInfo('Bob')).owned).toContain(asset);
        expect((await keymaster.fetchIdInfo('Alice')).owned ?? []).not.toContain(asset);
    });

    it('keeps document assets with the initiating identity', async () => {
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Alice');
        await keymaster.setCurrentId('Bob');

        const pause = pauseNextDataWrite();
        const creating = keymaster.createDocument(Buffer.from('test'));
        await pause.reached;
        await keymaster.setCurrentId('Alice');
        pause.release();
        const asset = await creating;

        expect((await keymaster.resolveDID(asset)).didDocument?.controller).toBe(bob);
        expect((await keymaster.fetchIdInfo('Bob')).owned).toContain(asset);
        expect((await keymaster.fetchIdInfo('Alice')).owned ?? []).not.toContain(asset);
    });

    it('keeps poll creation with the initiating identity', async () => {
        const bob = await keymaster.createId('Bob');
        await keymaster.createId('Alice');
        await keymaster.setCurrentId('Bob');
        const roster = await keymaster.createGroup('Roster');
        const poll = { ...await keymaster.pollTemplate(), roster };

        const pause = pauseNextResolution(roster);
        const creating = keymaster.createPoll(poll);
        await pause.reached;
        await keymaster.setCurrentId('Alice');
        pause.release();
        const asset = await creating;

        expect((await keymaster.resolveDID(asset)).didDocument?.controller).toBe(bob);
        expect((await keymaster.fetchIdInfo('Bob')).owned).toContain(asset);
        expect((await keymaster.fetchIdInfo('Alice')).owned ?? []).not.toContain(asset);
    });

    it('stores an accepted credential with the initiating holder', async () => {
        await keymaster.createId('Issuer');
        const holder = await keymaster.createId('Holder');
        await keymaster.createId('Other');
        await keymaster.setCurrentId('Issuer');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.issueCredential(await keymaster.bindCredential(schema, holder));
        await keymaster.setCurrentId('Holder');

        const reached = deferred();
        const blocked = deferred();
        const verifySignature = keymaster.verifySignature.bind(keymaster);
        jest.spyOn(keymaster, 'verifySignature').mockImplementation(async value => {
            reached.release();
            await blocked.promise;
            return verifySignature(value);
        });

        const accepting = keymaster.acceptCredential(credential);
        await reached.promise;
        await keymaster.setCurrentId('Other');
        blocked.release();

        await expect(accepting).resolves.toBe(true);
        expect(await keymaster.listCredentials('Holder')).toContain(credential);
        expect(await keymaster.listCredentials('Other')).not.toContain(credential);
    });

    it('decrypts a credential for the initiating holder', async () => {
        await keymaster.createId('Issuer');
        const holder = await keymaster.createId('Holder');
        await keymaster.createId('Other');
        await keymaster.setCurrentId('Issuer');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.issueCredential(await keymaster.bindCredential(schema, holder));
        await keymaster.setCurrentId('Holder');

        const pause = pauseNextLookup(credential);
        const reading = keymaster.getCredential(credential);
        await pause.reached;
        await keymaster.setCurrentId('Other');
        pause.release();

        await expect(reading).resolves.toMatchObject({ credentialSubject: { id: holder } });
    });

    it('removes a credential from the initiating holder', async () => {
        await keymaster.createId('Issuer');
        const holder = await keymaster.createId('Holder');
        await keymaster.createId('Other');
        await keymaster.setCurrentId('Issuer');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.issueCredential(await keymaster.bindCredential(schema, holder));
        await keymaster.setCurrentId('Holder');
        await keymaster.acceptCredential(credential);

        const pause = pauseNextLookup(credential);
        const removing = keymaster.removeCredential(credential);
        await pause.reached;
        await keymaster.setCurrentId('Other');
        pause.release();

        await expect(removing).resolves.toBe(true);
        expect(await keymaster.listCredentials('Holder')).not.toContain(credential);
        expect(await keymaster.listCredentials('Other')).not.toContain(credential);
    });

    it('keeps challenge verification with the initiating verifier', async () => {
        const verifier = await keymaster.createId('Verifier');
        await keymaster.createId('Responder');
        await keymaster.createId('Other');
        await keymaster.setCurrentId('Verifier');
        const challenge = await keymaster.createChallenge();
        await keymaster.setCurrentId('Responder');
        const response = await keymaster.createResponse(challenge);
        await keymaster.setCurrentId('Verifier');

        const pause = pauseNextResolution(response);
        const verifying = keymaster.verifyResponse(response, { publish: false });
        await pause.reached;
        await keymaster.setCurrentId('Other');
        pause.release();

        await expect(verifying).resolves.toMatchObject({ match: true, challenge, responder: expect.any(String) });
        expect((await keymaster.fetchIdInfo('Verifier')).did).toBe(verifier);
    });

    it('keeps poll ballot processing with the initiating owner', async () => {
        const owner = await keymaster.createId('Owner');
        const voter = await keymaster.createId('Voter');
        await keymaster.setCurrentId('Owner');
        const roster = await keymaster.createGroup('Roster');
        await keymaster.addGroupMember(roster, voter);
        const poll = await keymaster.createPoll({ ...await keymaster.pollTemplate(), roster });
        await keymaster.setCurrentId('Voter');
        const ballot = await keymaster.votePoll(poll, 1);
        await keymaster.setCurrentId('Owner');

        const pause = pauseNextResolution(ballot);
        const updating = keymaster.updatePoll(ballot);
        await pause.reached;
        await keymaster.setCurrentId('Voter');
        pause.release();

        await expect(updating).resolves.toBe(true);
        expect((await keymaster.getPoll(poll))?.ballots?.[voter].ballot).toBe(ballot);
        expect((await keymaster.fetchIdInfo('Owner')).did).toBe(owner);
    });

    it('keeps group vault writes with the initiating owner', async () => {
        await keymaster.createId('Owner');
        await keymaster.createId('Other');
        await keymaster.setCurrentId('Owner');
        const vault = await keymaster.createGroupVault();

        const pause = pauseNextResolution(vault);
        const adding = keymaster.addGroupVaultItem(vault, 'test.txt', Buffer.from('test'));
        await pause.reached;
        await keymaster.setCurrentId('Other');
        pause.release();

        await expect(adding).resolves.toBe(true);
        await keymaster.setCurrentId('Owner');
        await expect(keymaster.getGroupVaultItem(vault, 'test.txt')).resolves.toStrictEqual(Buffer.from('test'));
    });

    it('keeps DMail sending and filing with the initiating sender', async () => {
        const sender = await keymaster.createId('Sender');
        const recipient = await keymaster.createId('Recipient');
        await keymaster.setCurrentId('Sender');
        const dmail = await keymaster.createDmail({
            to: [recipient],
            cc: [],
            subject: 'Subject',
            body: 'Body',
        });

        const pause = pauseNextResolution(dmail);
        const sending = keymaster.sendDmail(dmail);
        await pause.reached;
        await keymaster.setCurrentId('Recipient');
        pause.release();
        const notice = await sending;

        expect(notice).not.toBeNull();
        expect((await keymaster.resolveDID(notice!)).didDocument?.controller).toBe(sender);
        expect((await keymaster.fetchIdInfo('Sender')).dmail?.[dmail].tags).toStrictEqual([DmailTags.SENT]);
        expect((await keymaster.fetchIdInfo('Recipient')).dmail?.[dmail]).toBeUndefined();
    });

    it('keeps notice imports with the initiating recipient', async () => {
        await keymaster.createId('Issuer');
        const recipient = await keymaster.createId('Recipient');
        await keymaster.createId('Other');
        await keymaster.setCurrentId('Issuer');
        const schema = await keymaster.createSchema(mockSchema);
        const credential = await keymaster.issueCredential(await keymaster.bindCredential(schema, recipient));
        const notice = await keymaster.createNotice({ to: [recipient], dids: [credential] });
        await keymaster.setCurrentId('Recipient');

        const pause = pauseNextResolution(notice);
        const importing = keymaster.importNotice(notice);
        await pause.reached;
        await keymaster.setCurrentId('Other');
        pause.release();

        await expect(importing).resolves.toBe(true);
        expect(await keymaster.listCredentials('Recipient')).toContain(credential);
        expect(await keymaster.listCredentials('Other')).not.toContain(credential);
    });

    it('preserves sentinel results when no identity is selected', async () => {
        const did = 'did:test:z3v8AuahfDKeebhCEEgZFcX7YctAeQjFmz9h6q33Ui1sGkqNQZB';

        await expect(keymaster.acceptCredential(did)).resolves.toBe(false);
        await expect(keymaster.getGroupVaultItem(did, 'item')).resolves.toBeNull();
        await expect(keymaster.getDmailMessage(did)).resolves.toBeNull();
        await expect(keymaster.sendDmail(did)).resolves.toBeNull();
        await expect(keymaster.importDmail(did)).resolves.toBe(false);
        await expect(keymaster.searchNotices()).resolves.toBe(false);
    });
});
