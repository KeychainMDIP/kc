import nock from 'nock';
import KeymasterClient from '@mdip/keymaster/client';
import { ExpectedExceptionError } from '@mdip/common/errors';
import { Seed, WalletFile } from "@mdip/keymaster/types";

const KeymasterURL = 'http://keymaster.org';
const ServerError = { message: 'Server error' };
const Endpoints = {
    ready: '/api/v1/ready',
    wallet: '/api/v1/wallet',
    wallet_new: '/api/v1/wallet/new',
    wallet_backup: '/api/v1/wallet/backup',
    wallet_recover: '/api/v1/wallet/recover',
    wallet_check: '/api/v1/wallet/check',
    wallet_fix: '/api/v1/wallet/fix',
    wallet_mnemonic: '/api/v1/wallet/mnemonic',
    registries: '/api/v1/registries',
    ids: '/api/v1/ids',
    ids_current: '/api/v1/ids/current',
    keys_rotate: '/api/v1/keys/rotate',
    keys_encrypt_message: '/api/v1/keys/encrypt/message',
    keys_decrypt_message: '/api/v1/keys/decrypt/message',
    keys_encrypt_json: '/api/v1/keys/encrypt/json',
    keys_decrypt_json: '/api/v1/keys/decrypt/json',
    names: '/api/v1/names',
    did: '/api/v1/did',
    assets: '/api/v1/assets',
    challenge: '/api/v1/challenge',
    response: '/api/v1/response',
    response_verify: '/api/v1/response/verify',
    groups: '/api/v1/groups',
    schemas: '/api/v1/schemas',
    agents: '/api/v1/agents',
    credentials: '/api/v1/credentials',
    credentials_bind: '/api/v1/credentials/bind',
    credentials_held: '/api/v1/credentials/held',
    credentials_issued: '/api/v1/credentials/issued',
    templates: '/api/v1/templates',
    templates_poll: '/api/v1/templates/poll',
    polls: '/api/v1/polls',
    images: '/api/v1/images',
    documents: '/api/v1/documents',
    groupVaults: `/api/v1/groupVaults`,
    dmail: '/api/v1/dmail',
    notices: '/api/v1/notices',
};

const mockConsole = {
    log: () => { },
    error: () => { },
    time: () => { },
    timeEnd: () => { },
}

const mockCredential = {
    "@context": [
        "https://www.w3.org/ns/credentials/v2",
        "https://www.w3.org/ns/credentials/examples/v2"
    ],
    "type": [
        "VerifiableCredential",
        // eslint-disable-next-line sonarjs/no-duplicate-string
        "did:test:z3v8AuacbUAvrNRex7q3dm2HJU5hQSpSp7YEcaCUcX1vhCfk5EY"
    ],
    // eslint-disable-next-line sonarjs/no-duplicate-string
    "issuer": "did:test:z3v8AuaUaK93ip2KsM5KGsWXWqgXFSNQxRkcMReXe4LheX5CkHe",
    "validFrom": "2025-03-28T10:57:47.055Z",
    "credentialSubject": {
        "id": "did:test:z3v8AuaUaK93ip2KsM5KGsWXWqgXFSNQxRkcMReXe4LheX5CkHe"
    },
    "credential": {
        "email": "TBD"
    }
};

describe('isReady', () => {
    it('should return ready flag', async () => {
        nock(KeymasterURL)
            .get(Endpoints.ready)
            .reply(200, { ready: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const isReady = await keymaster.isReady();

        expect(isReady).toBe(true);
    });

    it('should return false on server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.ready)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const isReady = await keymaster.isReady();

        expect(isReady).toBe(false);
    });

    it('should wait until ready', async () => {
        nock(KeymasterURL)
            .get(Endpoints.ready)
            .reply(200, { ready: true });

        const keymaster = await KeymasterClient.create({
            url: KeymasterURL,
            waitUntilReady: true,
            chatty: true,
            console: mockConsole
        });

        expect(keymaster != null).toBe(true);
    });

    it('should timeout if not ready', async () => {
        nock(KeymasterURL)
            .get(Endpoints.ready)
            .reply(200, { ready: false });

        const keymaster = await KeymasterClient.create({
            url: KeymasterURL,
            waitUntilReady: true,
            intervalSeconds: 0.1,
            maxRetries: 2,
            chatty: false,
            becomeChattyAfter: 1,
            console: mockConsole
        });

        expect(keymaster != null).toBe(true);
    });
});

describe('loadWallet', () => {
    it('should return wallet', async () => {
        const mockWallet = { seed: 1 };

        nock(KeymasterURL)
            .get(Endpoints.wallet)
            .reply(200, { wallet: mockWallet });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const wallet = await keymaster.loadWallet();

        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should throw exception on loadWallet server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.wallet)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.loadWallet();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('saveWallet', () => {
    const mockWallet: WalletFile = { seed: {} as Seed, counter: 0, ids: {} };

    it('should save wallet', async () => {
        nock(KeymasterURL)
            .put(Endpoints.wallet)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.saveWallet(mockWallet);

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on saveWallet server error', async () => {
        nock(KeymasterURL)
            .put(Endpoints.wallet)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.saveWallet(mockWallet);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('newWallet', () => {
    const mockWallet = { seed: 1 };

    it('should create a new wallet', async () => {
        nock(KeymasterURL)
            .post(Endpoints.wallet_new)
            .reply(200, { wallet: mockWallet });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const wallet = await keymaster.newWallet();

        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should throw exception on newWallet server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.wallet_new)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.newWallet();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('backupWallet', () => {
    it('should backup wallet', async () => {
        nock(KeymasterURL)
            .post(Endpoints.wallet_backup)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.backupWallet();

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on backupWallet server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.wallet_backup)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.backupWallet();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('recoverWallet', () => {
    const mockWallet = { seed: 1 };

    it('should recover wallet', async () => {
        nock(KeymasterURL)
            .post(Endpoints.wallet_recover)
            .reply(200, { wallet: mockWallet });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const wallet = await keymaster.recoverWallet();

        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should throw exception on recoverWallet server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.wallet_recover)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.recoverWallet();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('checkWallet', () => {
    it('should check wallet', async () => {
        nock(KeymasterURL)
            .post(Endpoints.wallet_check)
            .reply(200, { check: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const check = await keymaster.checkWallet();

        expect(check).toStrictEqual(true);
    });

    it('should throw exception on checkWallet server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.wallet_check)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.checkWallet();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('fixWallet', () => {
    it('should fix wallet', async () => {
        nock(KeymasterURL)
            .post(Endpoints.wallet_fix)
            .reply(200, { fix: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const fix = await keymaster.fixWallet();

        expect(fix).toStrictEqual(true);
    });

    it('should throw exception on fixWallet server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.wallet_fix)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.fixWallet();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('decryptMnemonic', () => {
    const mockMnemonic = 'mock mnemonic phrase';

    it('should decrypt mnemonic', async () => {
        nock(KeymasterURL)
            .get(Endpoints.wallet_mnemonic)
            .reply(200, { mnemonic: mockMnemonic });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const mnemonic = await keymaster.decryptMnemonic();

        expect(mnemonic).toStrictEqual(mockMnemonic);
    });

    it('should throw exception on decryptMnemonic server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.wallet_mnemonic)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.decryptMnemonic();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('listRegistries', () => {
    const mockRegistries = ['local', 'hyperswarm'];

    it('should list registries', async () => {
        nock(KeymasterURL)
            .get(Endpoints.registries)
            .reply(200, { registries: mockRegistries });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const registries = await keymaster.listRegistries();

        expect(registries).toStrictEqual(mockRegistries);
    });

    it('should throw exception on listRegistries server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.registries)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.listRegistries();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getCurrentId', () => {
    const mockCurrentId = 'mockCurrentId';

    it('should get current ID', async () => {
        nock(KeymasterURL)
            .get(Endpoints.ids_current)
            .reply(200, { current: mockCurrentId });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const currentId = await keymaster.getCurrentId();

        expect(currentId).toStrictEqual(mockCurrentId);
    });

    it('should throw exception on getCurrentId server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.ids_current)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.getCurrentId();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('setCurrentId', () => {
    const mockName = 'mockName';

    it('should set current ID', async () => {
        nock(KeymasterURL)
            .put(Endpoints.ids_current)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.setCurrentId(mockName);

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on setCurrentId server error', async () => {
        nock(KeymasterURL)
            .put(Endpoints.ids_current)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.setCurrentId(mockName);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('listIds', () => {
    const mockIds = ['id1', 'id2'];

    it('should list IDs', async () => {
        nock(KeymasterURL)
            .get(Endpoints.ids)
            .reply(200, { ids: mockIds });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ids = await keymaster.listIds();

        expect(ids).toStrictEqual(mockIds);
    });

    it('should throw exception on listIds server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.ids)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.listIds();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('rotateKeys', () => {
    it('should rotate keys', async () => {
        nock(KeymasterURL)
            .post(Endpoints.keys_rotate)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.rotateKeys();

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on rotateKeys server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.keys_rotate)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.rotateKeys();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('encryptMessage', () => {
    const mockMessage = 'mockMessage';
    const mockReceiver = 'mockReceiver';
    const mockOptions = {};
    const mockDid = 'mockDid';

    it('should encrypt message', async () => {
        nock(KeymasterURL)
            .post(Endpoints.keys_encrypt_message)
            .reply(200, { did: mockDid });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.encryptMessage(mockMessage, mockReceiver, mockOptions);

        expect(did).toStrictEqual(mockDid);
    });

    it('should throw exception on encryptMessage server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.keys_encrypt_message)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.encryptMessage(mockMessage, mockReceiver, mockOptions);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('decryptMessage', () => {
    const mockDid = 'mockDid';
    const mockMessage = 'mockMessage';

    it('should decrypt message', async () => {
        nock(KeymasterURL)
            .post(Endpoints.keys_decrypt_message)
            .reply(200, { message: mockMessage });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const message = await keymaster.decryptMessage(mockDid);

        expect(message).toStrictEqual(mockMessage);
    });

    it('should throw exception on decryptMessage server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.keys_decrypt_message)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.decryptMessage(mockDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('encryptJSON', () => {
    const mockJSON = { key: 'value' };
    const mockReceiver = 'mockReceiver';
    const mockOptions = {};
    const mockDid = 'mockDid';

    it('should encrypt JSON', async () => {
        nock(KeymasterURL)
            .post(Endpoints.keys_encrypt_json)
            .reply(200, { did: mockDid });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.encryptJSON(mockJSON, mockReceiver, mockOptions);

        expect(did).toStrictEqual(mockDid);
    });

    it('should throw exception on encryptJSON server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.keys_encrypt_json)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.encryptJSON(mockJSON, mockReceiver, mockOptions);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('decryptJSON', () => {
    const mockDid = 'mockDid';
    const mockJSON = { key: 'value' };

    it('should decrypt JSON', async () => {
        nock(KeymasterURL)
            .post(Endpoints.keys_decrypt_json)
            .reply(200, { json: mockJSON });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const json = await keymaster.decryptJSON(mockDid);

        expect(json).toStrictEqual(mockJSON);
    });

    it('should throw exception on decryptJSON server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.keys_decrypt_json)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.decryptJSON(mockDid);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createId', () => {
    const mockName = 'mockName';
    const mockOptions = {};
    const mockDid = 'mockDid';

    it('should create ID', async () => {
        nock(KeymasterURL)
            .post(Endpoints.ids)
            .reply(200, { did: mockDid });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createId(mockName, mockOptions);

        expect(did).toStrictEqual(mockDid);
    });

    it('should throw exception on createId server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.ids)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createId(mockName, mockOptions);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('removeId', () => {
    const mockName = 'mockName';

    it('should remove ID', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.ids}/${mockName}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.removeId(mockName);

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on removeId server error', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.ids}/${mockName}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.removeId(mockName);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('renameId', () => {
    const mockOldName = 'mockOldName';
    const mockNewName = 'mockNewName';

    it('should rename ID', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.ids}/${mockOldName}/rename`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.renameId(mockOldName, mockNewName);

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on renameId server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.ids}/${mockOldName}/rename`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.renameId(mockOldName, mockNewName);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('backupId', () => {
    const mockName = 'mockName';

    it('should backup ID', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.ids}/${mockName}/backup`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.backupId(mockName);

        expect(ok).toStrictEqual(true);
    });

    it('should backup current ID', async () => {

        nock(KeymasterURL)
            .get(Endpoints.ids_current)
            .reply(200, { current: mockName });

        nock(KeymasterURL)
            .post(`${Endpoints.ids}/${mockName}/backup`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.backupId();

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on backupId server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.ids}/${mockName}/backup`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.backupId(mockName);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('recoverId', () => {
    const mockName = 'mockName';

    it('should recover ID', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.ids}/${mockName}/recover`)
            .reply(200, { recovered: mockName });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.recoverId(mockName);

        expect(did).toStrictEqual(mockName);
    });

    it('should throw exception on recoverId server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.ids}/${mockName}/recover`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.recoverId(mockName);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('listNames', () => {
    const mockNames = ['name1', 'name2'];

    it('should list names', async () => {
        nock(KeymasterURL)
            .get(Endpoints.names)
            .reply(200, { names: mockNames });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const names = await keymaster.listNames();

        expect(names).toStrictEqual(mockNames);
    });

    it('should throw exception on listNames server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.names)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.listNames();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('addName', () => {
    const mockName = 'mockName';
    const mockDID = 'mockDID';

    it('should add name', async () => {
        nock(KeymasterURL)
            .post(Endpoints.names)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.addName(mockName, mockDID);

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on addName server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.names)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            // @ts-expect-error Testing invalid usage, missing arg
            await keymaster.addName(mockName);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getName', () => {
    const mockName = 'mockName';
    const mockDID = 'mockDID';

    it('should get name', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.names}/${mockName}`)
            .reply(200, { did: mockDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.getName(mockName);

        expect(did).toStrictEqual(mockDID);
    });

    it('should throw exception on getName server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.names}/${mockName}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.getName(mockName);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('removeName', () => {
    const mockName = 'mockName';

    it('should remove name', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.names}/${mockName}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.removeName(mockName);

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on removeName server error', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.names}/${mockName}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.removeName(mockName);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('resolveDID', () => {
    const mockDID = 'did:example:123456789abcdefghi';
    const mockDocument = { id: mockDID, publicKey: [] };

    it('should resolve DID', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.did}/${mockDID}`)
            .reply(200, { docs: mockDocument });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const document = await keymaster.resolveDID(mockDID);

        expect(document).toStrictEqual(mockDocument);
    });

    it('should resolve specified DID', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.did}/${mockDID}?confirm=true`)
            .reply(200, { docs: mockDocument });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const document = await keymaster.resolveDID(mockDID, { confirm: true });

        expect(document).toStrictEqual(mockDocument);
    });

    it('should throw exception on resolveDID server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.did}/${mockDID}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.resolveDID(mockDID);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('revokeDID', () => {
    const mockDID = 'did:example:1234567890abcdefghi';

    it('should revoke DID', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.did}/${mockDID}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.revokeDID(mockDID);

        expect(ok).toBe(true);
    });

    it('should throw exception on revokeDID server error', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.did}/${mockDID}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.revokeDID(mockDID);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createAsset', () => {
    const mockAsset = { id: 'asset1', data: 'some data' };
    const mockDID = 'did:example:1234567890abcd';

    it('should create asset', async () => {
        nock(KeymasterURL)
            .post(Endpoints.assets)
            .reply(200, { did: mockDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createAsset(mockAsset);

        expect(did).toBe(mockDID);
    });

    it('should throw exception on createAsset server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.assets)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createAsset(mockAsset);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('listAssets', () => {
    const mockAssets = ['did1', 'did2', 'did3'];

    it('should list assets', async () => {
        nock(KeymasterURL)
            .get(Endpoints.assets)
            .reply(200, { assets: mockAssets });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const assets = await keymaster.listAssets();

        expect(assets).toStrictEqual(mockAssets);
    });

    it('should throw exception on listAssets server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.assets)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.listAssets();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('resolveAsset', () => {
    const mockAssetId = 'asset1';
    const mockAsset = { id: mockAssetId, data: 'some data' };

    it('should resolve asset', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.assets}/${mockAssetId}`)
            .reply(200, { asset: mockAsset });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const asset = await keymaster.resolveAsset(mockAssetId);

        expect(asset).toStrictEqual(mockAsset);
    });

    it('should throw exception on resolveAsset server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.assets}/${mockAssetId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.resolveAsset(mockAssetId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('updateAsset', () => {
    const mockAssetId = 'asset1';
    const mockAsset = { id: mockAssetId, data: 'some data' };

    it('should resolve asset', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.assets}/${mockAssetId}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.updateAsset(mockAssetId, mockAsset);

        expect(ok).toBe(true);
    });

    it('should throw exception on resolveAsset server error', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.assets}/${mockAssetId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.updateAsset(mockAssetId, mockAsset);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('cloneAsset', () => {
    const mockDID = 'did:example:123456789abcdef';
    const cloneDID = 'did:example:123456789clone';

    it('should clone asset', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.assets}/${mockDID}/clone`)
            .reply(200, { did: cloneDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.cloneAsset(mockDID);

        expect(did).toBe(cloneDID);
    });

    it('should throw exception on cloneAsset server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.assets}/${mockDID}/clone`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.cloneAsset(mockDID);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('transferAsset', () => {
    const mockDID = 'did:example:124356789abcd';
    const controller = 'did:example:controller';

    it('should transfer asset', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.assets}/${mockDID}/transfer`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.transferAsset(mockDID, controller);

        expect(ok).toBe(true);
    });

    it('should throw exception on transferAsset server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.assets}/${mockDID}/transfer`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.transferAsset(mockDID, controller);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createChallenge', () => {
    const mockDID = 'did:mock:challenge';

    it('should create challenge', async () => {
        nock(KeymasterURL)
            .post(Endpoints.challenge)
            .reply(200, { did: mockDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createChallenge();

        expect(did).toStrictEqual(mockDID);
    });

    it('should throw exception on createChallenge server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.challenge)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createChallenge();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createResponse', () => {
    const mockChallenge = 'did:mock:challenge';
    const mockResponse = 'did:mock:response';

    it('should create response', async () => {
        nock(KeymasterURL)
            .post(Endpoints.response)
            .reply(200, { did: mockResponse });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createResponse(mockChallenge);

        expect(did).toStrictEqual(mockResponse);
    });

    it('should throw exception on createResponse server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.response)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createResponse(mockChallenge);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('verifyResponse', () => {
    const mockResponse = 'mockResponse';
    const mockVerification = { verified: true };

    it('should verify response', async () => {
        nock(KeymasterURL)
            .post(Endpoints.response_verify)
            .reply(200, { verify: mockVerification });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const verification = await keymaster.verifyResponse(mockResponse);

        expect(verification).toStrictEqual(mockVerification);
    });

    it('should throw exception on verifyResponse server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.response_verify)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.verifyResponse(mockResponse);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createGroup', () => {
    const mockGroup = 'mockGroup';
    const mockDID = 'did:mock:group';

    it('should create group', async () => {
        nock(KeymasterURL)
            .post(Endpoints.groups)
            .reply(200, { did: mockDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createGroup(mockGroup);

        expect(did).toStrictEqual(mockDID);
    });

    it('should throw exception on createGroup server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.groups)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createGroup(mockGroup);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getGroup', () => {
    const mockGroupId = 'group1';
    const mockGroup = { id: mockGroupId, name: 'Test Group' };

    it('should get group', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groups}/${mockGroupId}`)
            .reply(200, { group: mockGroup });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const group = await keymaster.getGroup(mockGroupId);

        expect(group).toStrictEqual(mockGroup);
    });

    it('should throw exception on getGroup server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groups}/${mockGroupId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.getGroup(mockGroupId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('addGroupMember', () => {
    const mockGroupId = 'group1';
    const mockMember = 'member1';

    it('should add group member', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groups}/${mockGroupId}/add`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.addGroupMember(mockGroupId, mockMember);

        expect(ok).toBe(true);
    });

    it('should throw exception on addGroupMember server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groups}/${mockGroupId}/add`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.addGroupMember(mockGroupId, mockMember);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('removeGroupMember', () => {
    const mockGroupId = 'group1';
    const mockMemberId = 'member1';

    it('should remove group member', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groups}/${mockGroupId}/remove`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.removeGroupMember(mockGroupId, mockMemberId);

        expect(ok).toStrictEqual(true);
    });

    it('should throw exception on removeGroupMember server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groups}/${mockGroupId}/remove`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.removeGroupMember(mockGroupId, mockMemberId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('testGroup', () => {
    const mockGroupId = 'group1';
    const mockTestResult = { test: true };

    it('should test group', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groups}/${mockGroupId}/test`)
            .reply(200, mockTestResult);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const result = await keymaster.testGroup(mockGroupId);

        expect(result).toBe(true);
    });

    it('should throw exception on testGroup server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groups}/${mockGroupId}/test`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.testGroup(mockGroupId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('listGroups', () => {
    const mockGroups = ['group1', 'group2', 'group3'];

    it('should list groups', async () => {
        nock(KeymasterURL)
            .get(Endpoints.groups)
            .reply(200, { groups: mockGroups });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const groups = await keymaster.listGroups();

        expect(groups).toStrictEqual(mockGroups);
    });

    it('should list groups by owner', async () => {
        const mockOwner = 'owner1';
        nock(KeymasterURL)
            .get(`${Endpoints.groups}?owner=${mockOwner}`)
            .reply(200, { groups: mockGroups });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const groups = await keymaster.listGroups(mockOwner);

        expect(groups).toStrictEqual(mockGroups);
    });

    it('should throw exception on listGroups server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.groups)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.listGroups();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createSchema', () => {
    const mockSchema = { id: 'schema1' };
    const mockDID = 'did:mock:schema';

    it('should create schema', async () => {
        nock(KeymasterURL)
            .post(Endpoints.schemas)
            .reply(200, { did: mockDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createSchema(mockSchema);

        expect(did).toStrictEqual(mockDID);
    });

    it('should throw exception on createSchema server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.schemas)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createSchema(mockSchema);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getSchema', () => {
    const mockSchemaId = 'schema1';
    const mockSchema = { id: mockSchemaId, name: 'Test Schema' };

    it('should get schema', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.schemas}/${mockSchemaId}`)
            .reply(200, { schema: mockSchema });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const schema = await keymaster.getSchema(mockSchemaId);

        expect(schema).toStrictEqual(mockSchema);
    });

    it('should throw exception on getSchema server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.schemas}/${mockSchemaId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.getSchema(mockSchemaId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('setSchema', () => {
    const mockSchemaId = 'schema1';
    const mockSchema = { id: mockSchemaId, name: 'Test Schema' };

    it('should set schema', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.schemas}/${mockSchemaId}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.setSchema(mockSchemaId, mockSchema);

        expect(ok).toBe(true);
    });

    it('should throw exception on setSchema server error', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.schemas}/${mockSchemaId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.setSchema(mockSchemaId, mockSchema);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('testSchema', () => {
    const mockSchemaId = 'schema1';

    it('should test schema', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.schemas}/${mockSchemaId}/test`)
            .reply(200, { test: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const result = await keymaster.testSchema(mockSchemaId);

        expect(result).toBe(true);
    });

    it('should throw exception on testSchema server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.schemas}/${mockSchemaId}/test`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.testSchema(mockSchemaId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('listSchemas', () => {
    const mockSchemas = ['schema1', 'schema2', 'schema3'];

    it('should list schemas', async () => {
        nock(KeymasterURL)
            .get(Endpoints.schemas)
            .reply(200, { schemas: mockSchemas });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const schemas = await keymaster.listSchemas();

        expect(schemas).toStrictEqual(mockSchemas);
    });

    it('should list schemas by owner', async () => {
        const mockOwner = 'owner1';
        nock(KeymasterURL)
            .get(`${Endpoints.schemas}?owner=${mockOwner}`)
            .reply(200, { schemas: mockSchemas });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const schemas = await keymaster.listSchemas(mockOwner);

        expect(schemas).toStrictEqual(mockSchemas);
    });

    it('should throw exception on listSchemas server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.schemas)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.listSchemas();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createTemplate', () => {
    const mockTemplate = { id: 'schema1' };
    const mockDID = 'did:mock:schema';

    it('should create a template from the schema', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.schemas}/${mockDID}/template`)
            .reply(200, { template: mockTemplate });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const template = await keymaster.createTemplate(mockDID);

        expect(template).toStrictEqual(mockTemplate);
    });

    it('should throw exception on createTemplate server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.schemas}/${mockDID}/template`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createTemplate(mockDID);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('testAgent', () => {
    const mockAgentId = 'agent1';

    it('should test agent', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.agents}/${mockAgentId}/test`)
            .reply(200, { test: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const result = await keymaster.testAgent(mockAgentId);

        expect(result).toBe(true);
    });

    it('should throw exception on testAgent server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.agents}/${mockAgentId}/test`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.testAgent(mockAgentId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('bindCredential', () => {
    const credentialDID = 'did:test:z3v8AuacbUAvrNRex7q3dm2HJU5hQSpSp7YEcaCUcX1vhCfk5EY';
    const userDID = 'did:test:z3v8AuaUaK93ip2KsM5KGsWXWqgXFSNQxRkcMReXe4LheX5CkHe';

    it('should bind credential', async () => {
        nock(KeymasterURL)
            .post(Endpoints.credentials_bind)
            .reply(200, { credential: mockCredential });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const credential = await keymaster.bindCredential(credentialDID, userDID);

        expect(credential).toStrictEqual(mockCredential);
    });

    it('should throw exception on bindCredential server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.credentials_bind)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            // @ts-expect-error Testing invalid usage, missing args
            await keymaster.bindCredential();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('issueCredential', () => {
    const mockCredential = {
        "@context": [
            "https://www.w3.org/ns/credentials/v2",
            "https://www.w3.org/ns/credentials/examples/v2"
        ],
        "type": [
            "VerifiableCredential",
            "did:test:z3v8AuacbUAvrNRex7q3dm2HJU5hQSpSp7YEcaCUcX1vhCfk5EY"
        ],
        "issuer": "did:test:z3v8AuaUaK93ip2KsM5KGsWXWqgXFSNQxRkcMReXe4LheX5CkHe",
        "validFrom": "2025-03-28T10:57:47.055Z",
        "credentialSubject": {
            "id": "did:test:z3v8AuaUaK93ip2KsM5KGsWXWqgXFSNQxRkcMReXe4LheX5CkHe"
        },
        "credential": {
            "email": "TBD"
        }
    };
    const mockDID = 'did:mock:credential';

    it('should issue credential', async () => {
        nock(KeymasterURL)
            .post(Endpoints.credentials_issued)
            .reply(200, { did: mockDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.issueCredential(mockCredential);

        expect(did).toBe(mockDID);
    });

    it('should throw exception on issueCredential server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.credentials_issued)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.issueCredential(mockCredential);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('updateCredential', () => {
    const mockCredentialId = 'cred1';

    it('should update credential', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.credentials_issued}/${mockCredentialId}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.updateCredential(mockCredentialId, mockCredential);

        expect(ok).toBe(true);
    });

    it('should throw exception on updateCredential server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.credentials_issued}/${mockCredentialId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.updateCredential(mockCredentialId, mockCredential);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('listCredentials', () => {
    const mockCredentials = ['cred1', 'cred2', 'cred3'];

    it('should list credentials', async () => {
        nock(KeymasterURL)
            .get(Endpoints.credentials_held)
            .reply(200, { held: mockCredentials });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const credentials = await keymaster.listCredentials();

        expect(credentials).toStrictEqual(mockCredentials);
    });

    it('should throw exception on listCredentials server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.credentials_held)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.listCredentials();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('acceptCredential', () => {
    const mockDID = 'did:mock:credential';

    it('should accept credential', async () => {
        nock(KeymasterURL)
            .post(Endpoints.credentials_held)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.acceptCredential(mockDID);

        expect(ok).toBe(true);
    });

    it('should throw exception on acceptCredential server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.credentials_held)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.acceptCredential(mockDID);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getCredential', () => {
    const mockCredentialId = 'cred1';
    const mockCredential = { id: mockCredentialId, data: 'some data' };

    it('should get credential', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.credentials_held}/${mockCredentialId}`)
            .reply(200, { credential: mockCredential });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const credential = await keymaster.getCredential(mockCredentialId);

        expect(credential).toStrictEqual(mockCredential);
    });

    it('should throw exception on getCredential server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.credentials_held}/${mockCredentialId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.getCredential(mockCredentialId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('removeCredential', () => {
    const mockCredentialId = 'cred1';

    it('should remove credential', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.credentials_held}/${mockCredentialId}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.removeCredential(mockCredentialId);

        expect(ok).toBe(true);
    });

    it('should throw exception on removeCredential server error', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.credentials_held}/${mockCredentialId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.removeCredential(mockCredentialId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('publishCredential', () => {
    const mockCredentialId = 'cred1';

    it('should publish credential', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.credentials_held}/${mockCredentialId}/publish`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.publishCredential(mockCredentialId);

        expect(ok).toBe(true);
    });

    it('should throw exception on publishCredential server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.credentials_held}/${mockCredentialId}/publish`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.publishCredential(mockCredentialId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('unpublishCredential', () => {
    const mockCredentialId = 'cred1';

    it('should unpublish credential', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.credentials_held}/${mockCredentialId}/unpublish`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.unpublishCredential(mockCredentialId);

        expect(ok).toBe(true);
    });

    it('should throw exception on unpublishCredential server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.credentials_held}/${mockCredentialId}/unpublish`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.unpublishCredential(mockCredentialId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('listIssued', () => {
    const mockCredentials = ['cred1', 'cred2', 'cred3'];

    it('should list issued credentials', async () => {
        nock(KeymasterURL)
            .get(Endpoints.credentials_issued)
            .reply(200, { issued: mockCredentials });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const issued = await keymaster.listIssued();

        expect(issued).toStrictEqual(mockCredentials);
    });

    it('should throw exception on listIssued server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.credentials_issued)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.listIssued();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('revokeCredential', () => {
    const mockCredentialId = 'cred1';

    it('should revoke credential', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.credentials_issued}/${mockCredentialId}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.revokeCredential(mockCredentialId);

        expect(ok).toBe(true);
    });

    it('should throw exception on revokeCredential server error', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.credentials_issued}/${mockCredentialId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.revokeCredential(mockCredentialId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('pollTemplate', () => {
    const mockTemplate = { id: 'template1', name: 'Test Template' };

    it('should get poll template', async () => {
        nock(KeymasterURL)
            .get(Endpoints.templates_poll)
            .reply(200, { template: mockTemplate });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const template = await keymaster.pollTemplate();

        expect(template).toStrictEqual(mockTemplate);
    });

    it('should throw exception on pollTemplate server error', async () => {
        nock(KeymasterURL)
            .get(Endpoints.templates_poll)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.pollTemplate();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createPoll', () => {
    const mockPoll = {
        "type": "poll",
        "version": 1,
        "description": "What is this poll about?",
        "roster": "DID of the eligible voter group",
        "options": [
            "yes",
            "no",
            "abstain"
        ],
        "deadline": "2025-04-04T10:06:49.417Z"
    };
    const mockDID = 'did:mock:poll';

    it('should create poll', async () => {
        nock(KeymasterURL)
            .post(Endpoints.polls)
            .reply(200, { did: mockDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createPoll(mockPoll);

        expect(did).toStrictEqual(mockDID);
    });

    it('should throw exception on createPoll server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.polls)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createPoll(mockPoll);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getPoll', () => {
    const mockPollId = 'poll1';
    const mockPoll = { id: mockPollId, question: 'Test Poll' };

    it('should get poll', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.polls}/${mockPollId}`)
            .reply(200, { poll: mockPoll });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const poll = await keymaster.getPoll(mockPollId);

        expect(poll).toStrictEqual(mockPoll);
    });

    it('should throw exception on getPoll server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.polls}/${mockPollId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.getPoll(mockPollId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('viewPoll', () => {
    const mockPollId = 'poll1';
    const mockPoll = { id: mockPollId, question: 'Test Poll' };

    it('should view poll', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.polls}/${mockPollId}/view`)
            .reply(200, { poll: mockPoll });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const poll = await keymaster.viewPoll(mockPollId);

        expect(poll).toStrictEqual(mockPoll);
    });

    it('should throw exception on viewPoll server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.polls}/${mockPollId}/view`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.viewPoll(mockPollId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('votePoll', () => {
    const mockPollId = 'poll1';
    const mockVote = 1;
    const mockDID = 'did:mock:vote';

    it('should vote on poll', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.polls}/${mockPollId}/vote`)
            .reply(200, { did: mockDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.votePoll(mockPollId, mockVote);

        expect(did).toStrictEqual(mockDID);
    });

    it('should throw exception on votePoll server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.polls}/${mockPollId}/vote`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.votePoll(mockPollId, mockVote);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('updatePoll', () => {
    const mockBallot = "did:test:z3v8AuaZUTzAPHj4oUwYqjHuhBr9HczoLsfT4hZtx4iBkpsFKbL";

    it('should update poll', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.polls}/update`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.updatePoll(mockBallot);

        expect(ok).toBe(true);
    });

    it('should throw exception on updatePoll server error', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.polls}/update`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.updatePoll(mockBallot);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('publishPoll', () => {
    const mockPollId = 'poll1';

    it('should publish poll', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.polls}/${mockPollId}/publish`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.publishPoll(mockPollId);

        expect(ok).toBe(true);
    });

    it('should throw exception on publishPoll server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.polls}/${mockPollId}/publish`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.publishPoll(mockPollId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('unpublishPoll', () => {
    const mockPollId = 'poll1';

    it('should unpublish poll', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.polls}/${mockPollId}/unpublish`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.unpublishPoll(mockPollId);

        expect(ok).toBe(true);
    });

    it('should throw exception on unpublishPoll server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.polls}/${mockPollId}/unpublish`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.unpublishPoll(mockPollId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createImage', () => {
    const mockImage = Buffer.from('image data');
    const mockDID = 'did:example:123456789abcd';

    it('should create an image asset', async () => {
        nock(KeymasterURL)
            .post(Endpoints.images)
            .reply(200, { did: mockDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createImage(mockImage);

        expect(did).toBe(mockDID);
    });

    it('should throw exception on createImage server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.images)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createImage(mockImage);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('updateImage', () => {
    const mockImage = Buffer.from('image data');
    const mockDID = 'did:example:923456789abcd';

    it('should create an image asset', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.images}/${mockDID}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.updateImage(mockDID, mockImage);

        expect(ok).toBe(true);
    });

    it('should throw exception on updateImage server error', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.images}/${mockDID}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.updateImage(mockDID, mockImage);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getImage', () => {
    const mockImageId = 'image1';
    const mockImage = { cid: 'mockCID', height: 100, width: 100, type: 'png' };

    it('should get image', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.images}/${mockImageId}`)
            .reply(200, { image: mockImage });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const schema = await keymaster.getImage(mockImageId);

        expect(schema).toStrictEqual(mockImage);
    });

    it('should throw exception on getImage server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.images}/${mockImageId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.getImage(mockImageId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('testImage', () => {
    const mockImageId = 'image1';

    it('should test image', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.images}/${mockImageId}/test`)
            .reply(200, { test: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const result = await keymaster.testImage(mockImageId);

        expect(result).toBe(true);
    });

    it('should throw exception on testImage server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.images}/${mockImageId}/test`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.testImage(mockImageId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createDocument', () => {
    const mockDocument = Buffer.from('document data');
    const mockDID = 'did:example:123456789abcd';

    it('should create an document asset', async () => {
        nock(KeymasterURL)
            .post(Endpoints.documents)
            .reply(200, { did: mockDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createDocument(mockDocument);

        expect(did).toBe(mockDID);
    });

    it('should throw exception on createDocument server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.documents)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createDocument(mockDocument);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('updateDocument', () => {
    const mockDocument = Buffer.from('document data');
    const mockDID = 'did:example:923456789abcd';

    it('should update a document asset', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.documents}/${mockDID}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.updateDocument(mockDID, mockDocument);

        expect(ok).toBe(true);
    });

    it('should throw exception on updateDocument server error', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.documents}/${mockDID}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.updateDocument(mockDID, mockDocument);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getDocument', () => {
    const mockDocumentId = 'document1';
    const mockDocument = { cid: 'mockCID', bytes: 12345, type: 'pdf' };

    it('should get document', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.documents}/${mockDocumentId}`)
            .reply(200, { document: mockDocument });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const schema = await keymaster.getDocument(mockDocumentId);

        expect(schema).toStrictEqual(mockDocument);
    });

    it('should throw exception on getDocument server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.documents}/${mockDocumentId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.getDocument(mockDocumentId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('testDocument', () => {
    const mockDocumentId = 'document1';

    it('should test document', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.documents}/${mockDocumentId}/test`)
            .reply(200, { test: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const result = await keymaster.testDocument(mockDocumentId);

        expect(result).toBe(true);
    });

    it('should throw exception on testDocument server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.documents}/${mockDocumentId}/test`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.testDocument(mockDocumentId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('createGroupVault', () => {
    const mockDID = 'did:example:123456789gvault';

    it('should create a group vault', async () => {
        nock(KeymasterURL)
            .post(Endpoints.groupVaults)
            .reply(200, { did: mockDID });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createGroupVault();

        expect(did).toBe(mockDID);
    });

    it('should throw exception on createGroupVault server error', async () => {
        nock(KeymasterURL)
            .post(Endpoints.groupVaults)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createGroupVault();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getGroupVault', () => {
    const mockVaultId = 'vault1';
    const mockVault = { salt: 'mockSalt', keys: {}, items: 'mockItems' };

    it('should get document', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groupVaults}/${mockVaultId}`)
            .reply(200, { groupVault: mockVault });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const vault = await keymaster.getGroupVault(mockVaultId);

        expect(vault).toStrictEqual(mockVault);
    });

    it('should throw exception on getDocument server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groupVaults}/${mockVaultId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.getGroupVault(mockVaultId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('testGroupVault', () => {
    const mockVaultId = 'vault2';

    it('should test group vault', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groupVaults}/${mockVaultId}/test`)
            .reply(200, { test: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const result = await keymaster.testGroupVault(mockVaultId);

        expect(result).toBe(true);
    });

    it('should throw exception on testGroupVault server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groupVaults}/${mockVaultId}/test`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.testGroupVault(mockVaultId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('addGroupVaultMember', () => {
    const mockVaultId = 'vault3';
    const mockMember = 'did:example:123456789member';

    it('should add vault member', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groupVaults}/${mockVaultId}/members`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const result = await keymaster.addGroupVaultMember(mockVaultId, mockMember);

        expect(result).toBe(true);
    });

    it('should throw exception on addGroupVaultMember server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groupVaults}/${mockVaultId}/members`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.addGroupVaultMember(mockVaultId, mockMember);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('removeGroupVaultMember', () => {
    const mockVaultId = 'vault4';
    const mockMember = 'did:example:123456789member2';

    it('should remove vault member', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.groupVaults}/${mockVaultId}/members/${mockMember}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const result = await keymaster.removeGroupVaultMember(mockVaultId, mockMember);

        expect(result).toBe(true);
    });

    it('should throw exception on removeGroupVaultMember server error', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.groupVaults}/${mockVaultId}/members/${mockMember}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.removeGroupVaultMember(mockVaultId, mockMember);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});


describe('listGroupVaultMembers', () => {
    const mockVaultId = 'vault8';
    const mockMembers = { member1: 'member1', member2: 'member2' };

    it('should list vault members', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groupVaults}/${mockVaultId}/members`)
            .reply(200, { members: mockMembers });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const members = await keymaster.listGroupVaultMembers(mockVaultId);

        expect(members).toStrictEqual(mockMembers);
    });

    it('should throw exception on listGroupVaultMember server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groupVaults}/${mockVaultId}/members`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.listGroupVaultMembers(mockVaultId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('addGroupVaultItem', () => {
    const mockVaultId = 'vault4';
    const mockName = 'mockName';
    const mockBuffer = Buffer.from('mockBuffer');

    it('should add vault item', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groupVaults}/${mockVaultId}/items`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const result = await keymaster.addGroupVaultItem(mockVaultId, mockName, mockBuffer);

        expect(result).toBe(true);
    });

    it('should throw exception on addGroupVaultItem server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.groupVaults}/${mockVaultId}/items`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.addGroupVaultItem(mockVaultId, mockName, mockBuffer);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('removeGroupVaultItem', () => {
    const mockVaultId = 'vault5';
    const mockName = 'mockName';

    it('should remove vault item', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.groupVaults}/${mockVaultId}/items/${mockName}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const result = await keymaster.removeGroupVaultItem(mockVaultId, mockName);

        expect(result).toBe(true);
    });

    it('should throw exception on removeGroupVaultItem server error', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.groupVaults}/${mockVaultId}/items/${mockName}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.removeGroupVaultItem(mockVaultId, mockName);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('listGroupVaultItems', () => {
    const mockVaultId = 'vault6';
    const mockItems = { item1: 'item1', item2: 'item2' };

    it('should list vault items', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groupVaults}/${mockVaultId}/items`)
            .reply(200, { items: mockItems });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const items = await keymaster.listGroupVaultItems(mockVaultId);

        expect(items).toStrictEqual(mockItems);
    });

    it('should throw exception on listGroupVaultItems server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groupVaults}/${mockVaultId}/items`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.listGroupVaultItems(mockVaultId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getGroupVaultItem', () => {
    const mockVaultId = 'vault7';
    const mockName = 'mockName';
    const mockData = Buffer.from('mockData');

    it('should return group vault item data', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groupVaults}/${mockVaultId}/items/${mockName}`)
            .reply(200, mockData);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const data = await keymaster.getGroupVaultItem(mockVaultId, mockName);

        expect(data).toStrictEqual(mockData);
    });

    it('should return null when missing data', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groupVaults}/${mockVaultId}/items/${mockName}`)
            .reply(200);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const data = await keymaster.getGroupVaultItem(mockVaultId, mockName);

        expect(data).toStrictEqual(null);
    });

    it('should return null on 404 not found', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groupVaults}/${mockVaultId}/items/${mockName}`)
            .reply(404);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const data = await keymaster.getGroupVaultItem(mockVaultId, mockName);

        expect(data).toStrictEqual(null);
    });

    it('should throw exception on getGroupVaultItem server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.groupVaults}/${mockVaultId}/items/${mockName}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.getGroupVaultItem(mockVaultId, mockName);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

const mockDmailId = 'did:mdip:dmail';
const mockDmail = { to: ['mockTo'], cc: ['mockCC'], subject: 'Test subject', body: 'Test body' };

describe('createDmail', () => {
    it('should return dmail DID', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.dmail}`)
            .reply(200, { did: mockDmailId });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createDmail(mockDmail);

        expect(did).toStrictEqual(mockDmailId);
    });

    it('should throw exception on createDmail server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.dmail}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createDmail(mockDmail);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('updateDmail', () => {
    it('should update dmail DID', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.dmail}/${mockDmailId}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.updateDmail(mockDmailId, mockDmail);

        expect(ok).toBe(true);
    });

    it('should throw exception on updateDmail server error', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.dmail}/${mockDmailId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.updateDmail(mockDmailId, mockDmail);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('sendDmail', () => {
    const mockNotice = 'mockNotice';

    it('should send dmail DID', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.dmail}/${mockDmailId}/send`)
            .reply(200, { did: mockNotice });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.sendDmail(mockDmailId);

        expect(did).toBe(mockNotice);
    });

    it('should throw exception on sendDmail server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.dmail}/${mockDmailId}/send`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.sendDmail(mockDmailId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('fileDmail', () => {
    it('should file dmail DID', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.dmail}/${mockDmailId}/file`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.fileDmail(mockDmailId, ['sent']);

        expect(ok).toBe(true);
    });

    it('should throw exception on fileDmail server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.dmail}/${mockDmailId}/file`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.fileDmail(mockDmailId, ['sent']);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('removeDmail', () => {
    it('should remove dmail DID', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.dmail}/${mockDmailId}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.removeDmail(mockDmailId);

        expect(ok).toBe(true);
    });

    it('should throw exception on removeDmail server error', async () => {
        nock(KeymasterURL)
            .delete(`${Endpoints.dmail}/${mockDmailId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.removeDmail(mockDmailId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('importDmail', () => {
    it('should import dmail DID', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.dmail}/import`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.importDmail(mockDmailId);

        expect(ok).toBe(true);
    });

    it('should throw exception on importDmail server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.dmail}/import`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.importDmail(mockDmailId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('getDmailMessage', () => {
    it('should get message', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.dmail}/${mockDmailId}`)
            .reply(200, { message: mockDmail });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const message = await keymaster.getDmailMessage(mockDmailId);

        expect(message).toStrictEqual(mockDmail);
    });

    it('should throw exception on getDmailMessage server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.dmail}/${mockDmailId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.getDmailMessage(mockDmailId);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('listDmail', () => {
    const mockDmailList = { dmail1: 'mock1', dmail2: 'mock2' };

    it('should get message', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.dmail}`)
            .reply(200, { dmail: mockDmailList });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const dmail = await keymaster.listDmail();

        expect(dmail).toStrictEqual(mockDmailList);
    });

    it('should throw exception on getDmailMessage server error', async () => {
        nock(KeymasterURL)
            .get(`${Endpoints.dmail}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.listDmail();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

const mockNoticeId = 'did:mdip:notice';
const mockNotice = { to: ['mockTo'], dids: ['mockDID'] };

describe('createNotice', () => {
    it('should return dmail DID', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.notices}`)
            .reply(200, { did: mockNoticeId });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const did = await keymaster.createNotice(mockNotice);

        expect(did).toStrictEqual(mockNoticeId);
    });

    it('should throw exception on createNotice server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.notices}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.createNotice(mockNotice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('updateNotice', () => {
    it('should update notice DID', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.notices}/${mockNoticeId}`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.updateNotice(mockNoticeId, mockNotice);

        expect(ok).toBe(true);
    });

    it('should throw exception on updateNotice server error', async () => {
        nock(KeymasterURL)
            .put(`${Endpoints.notices}/${mockNoticeId}`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.updateNotice(mockNoticeId, mockNotice);
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});

describe('refreshNotices', () => {
    it('should refresh notices', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.notices}/refresh`)
            .reply(200, { ok: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const ok = await keymaster.refreshNotices();

        expect(ok).toBe(true);
    });

    it('should throw exception on refreshNotices server error', async () => {
        nock(KeymasterURL)
            .post(`${Endpoints.notices}/refresh`)
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.refreshNotices();
            throw new ExpectedExceptionError();
        }
        catch (error: any) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});
