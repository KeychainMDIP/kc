import { jest } from '@jest/globals';
import Gatekeeper from '@mdip/gatekeeper';
import CipherNode from '@mdip/cipher/node';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import HeliaClient from '@mdip/ipfs/helia';
import type { LegacyWalletFile, StoredWallet } from '@mdip/keymaster/types';
import { createTestKeymaster } from './testUtils.ts';

let ipfs: HeliaClient;
let gatekeeper: Gatekeeper;
let cipher: CipherNode;

beforeAll(async () => {
    ipfs = new HeliaClient();
    await ipfs.start();
});
afterAll(async () => { await ipfs.stop(); });
beforeEach(() => {
    gatekeeper = new Gatekeeper({ db: new DbJsonMemory('test'), ipfs, registries: ['local', 'hyperswarm'] });
    cipher = new CipherNode();
});
afterEach(() => { jest.restoreAllMocks(); });

it.each(['refusal', 'exception'])('preserves both wallet stores and signing keys after metadata replacement %s', async failure => {
    const { keymaster, store, providerStore, walletProvider } = createTestKeymaster(gatekeeper, cipher);
    await keymaster.createId('Alice');
    const metadata = await store.loadWallet();
    const provider = await providerStore.loadWallet();
    const mnemonic = await walletProvider.decryptMnemonic();
    const save = jest.spyOn(store, 'saveWallet');
    if (failure === 'refusal') save.mockResolvedValueOnce(false);
    else save.mockRejectedValueOnce(new Error('storage failed'));

    await expect(keymaster.newWallet(undefined, true)).rejects.toThrow();
    expect(await store.loadWallet()).toStrictEqual(metadata);
    expect(await providerStore.loadWallet()).toStrictEqual(provider);
    expect(await walletProvider.decryptMnemonic()).toBe(mnemonic);
    expect(await keymaster.verifySignature(await keymaster.addSignature({ message: 'still Alice' }))).toBe(true);
    const restarted = createTestKeymaster(gatekeeper, cipher, { store, providerStore }).keymaster;
    expect(await restarted.verifySignature(await restarted.addSignature({ message: 'after restart' }))).toBe(true);
});

it('keeps the active signing keys available while replacement metadata is being saved', async () => {
    const { keymaster, store } = createTestKeymaster(gatekeeper, cipher);
    await keymaster.createId('Alice');
    jest.spyOn(store, 'saveWallet').mockImplementationOnce(async () => {
        expect(await keymaster.getCurrentId()).toBe('Alice');
        const signed = await keymaster.addSignature({ message: 'during replacement' });
        expect(await keymaster.verifySignature(signed)).toBe(true);
        return false;
    });
    await expect(keymaster.newWallet(undefined, true)).rejects.toThrow('save wallet failed');
});

it('does not advance cached provider accounts when reserving an account fails', async () => {
    const { keymaster, providerStore, walletProvider } = createTestKeymaster(gatekeeper, cipher);
    await keymaster.loadWallet();
    jest.spyOn(providerStore, 'saveWallet').mockResolvedValueOnce(false);
    await expect(walletProvider.createIdKey()).rejects.toThrow('save wallet failed');
    expect((await walletProvider.backupWallet()).nextAccount).toBe(0);
    expect((await walletProvider.createIdKey()).keyRef).toBe('hd:0#0');
});

it('rejects malformed metadata and legacy payloads before changing stored wallets', async () => {
    const { keymaster, store, providerStore, walletProvider } = createTestKeymaster(gatekeeper, cipher);
    const did = await keymaster.createId('Alice');
    const metadata = await store.loadWallet();
    const provider = (await providerStore.loadWallet())!;
    const candidates: unknown[] = [
        { ...metadata, ids: null },
        { ...metadata, ids: [] },
        { ...metadata, ids: { Alice: { did } } },
        { ...metadata, seed: {} },
        { version: 1, seed: { mnemonicEnc: provider.mnemonicEnc }, counter: 1, ids: null },
        { version: 1, seed: { mnemonicEnc: provider.mnemonicEnc }, counter: -1, ids: {} },
    ];
    const mnemonic = await walletProvider.decryptMnemonic();
    const hdKey = cipher.generateHDKey(mnemonic);
    const root = cipher.generateJwk(hdKey.privateKey!);
    for (const payload of [null, [], {}, { counter: 0, ids: {} , seed: {} }]) {
        candidates.push({ version: 1, seed: { mnemonicEnc: provider.mnemonicEnc }, enc: cipher.encryptMessage(root.publicJwk, root.privateJwk, JSON.stringify(payload)) });
    }
    const saveMetadata = jest.spyOn(store, 'saveWallet');
    const saveProvider = jest.spyOn(providerStore, 'saveWallet');
    for (const candidate of candidates) {
        await expect(keymaster.saveWallet(candidate as StoredWallet)).rejects.toThrow();
        expect(await store.loadWallet()).toStrictEqual(metadata);
        expect(await providerStore.loadWallet()).toStrictEqual(provider);
    }
    expect(saveMetadata).not.toHaveBeenCalled();
    expect(saveProvider).not.toHaveBeenCalled();
    expect(await keymaster.verifySignature(await keymaster.addSignature({ message: 'still Alice' }))).toBe(true);
});

it('honors overwrite=false before migrating provider state', async () => {
    const { keymaster, store, providerStore } = createTestKeymaster(gatekeeper, cipher);
    await keymaster.createId('Alice');
    const metadata = await store.loadWallet();
    const provider = (await providerStore.loadWallet())!;
    const legacy: LegacyWalletFile = { version: 1, seed: { mnemonicEnc: provider.mnemonicEnc }, counter: 0, ids: {} };
    const save = jest.spyOn(providerStore, 'saveWallet');
    expect(await keymaster.saveWallet(legacy, false)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(await store.loadWallet()).toStrictEqual(metadata);
    expect(await providerStore.loadWallet()).toStrictEqual(provider);
});

it('restores the provider if a legacy metadata save fails', async () => {
    const { keymaster, store, providerStore } = createTestKeymaster(gatekeeper, cipher);
    await keymaster.createId('Alice');
    const metadata = await store.loadWallet();
    const provider = (await providerStore.loadWallet())!;
    const legacy: LegacyWalletFile = { version: 1, seed: { mnemonicEnc: provider.mnemonicEnc }, counter: 0, ids: {} };
    jest.spyOn(store, 'saveWallet').mockResolvedValueOnce(false);
    expect(await keymaster.saveWallet(legacy)).toBe(false);
    expect(await store.loadWallet()).toStrictEqual(metadata);
    expect(await providerStore.loadWallet()).toStrictEqual(provider);
    expect(await keymaster.verifySignature(await keymaster.addSignature({ message: 'still Alice' }))).toBe(true);
});

it('serializes wallet bundle imports with metadata mutations', async () => {
    const { keymaster, walletProvider } = createTestKeymaster(gatekeeper, cipher);
    await keymaster.createId('Alice');
    const replacement = createTestKeymaster(gatekeeper, cipher).keymaster;
    await replacement.createId('Bob');
    const bundle = await replacement.exportWalletBundle();
    const save = walletProvider.saveWallet.bind(walletProvider);
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(walletProvider, 'saveWallet').mockImplementationOnce(async (state, overwrite, beforeActivate) => {
        entered();
        await blocked;
        return save(state, overwrite, beforeActivate);
    });
    const importing = keymaster.importWalletBundle(bundle);
    await waiting;
    const aliasing = keymaster.addName('friend', bundle.keymaster.ids.Bob.did);
    release();
    await importing;
    await aliasing;
    expect(await keymaster.listIds()).toStrictEqual(['Bob']);
    expect(await keymaster.getName('friend')).toBe(bundle.keymaster.ids.Bob.did);
    expect(await keymaster.verifySignature(await keymaster.addSignature({ message: 'Bob' }))).toBe(true);
});

it('finds existing seed-bank backups after a DID prefix is configured', async () => {
    const { keymaster, store, providerStore, walletProvider } = createTestKeymaster(gatekeeper, cipher);
    await keymaster.createId('Alice');
    const backupDid = await keymaster.backupWallet();
    const mnemonic = await walletProvider.decryptMnemonic();
    await keymaster.newWallet(mnemonic, true);

    const configured = createTestKeymaster(gatekeeper, cipher, { store, providerStore, didPrefix: 'did:test' }).keymaster;
    const recovered = await configured.recoverWallet();
    expect(recovered.backupDid).toBe(backupDid);
    expect(recovered.current).toBe('Alice');
    expect(await configured.verifySignature(await configured.addSignature({ message: 'recovered' }))).toBe(true);
});

it.each([false, true])('recovers encrypted legacy identities only with their mnemonic (wrong mnemonic=%s)', async wrongMnemonic => {
    const { keymaster, store, providerStore, walletProvider } = createTestKeymaster(gatekeeper, cipher);
    const did = await keymaster.createId('Alice', { registry: 'local' });
    const mnemonic = await walletProvider.decryptMnemonic();
    const root = cipher.generateJwk(cipher.generateHDKey(mnemonic).privateKey!);
    const legacy = { name: 'Alice', id: { did, account: 0, index: 0, icon: 'legacy' } };
    const backup = cipher.encryptMessage(root.publicJwk, root.privateJwk, JSON.stringify(legacy));
    const vault = await keymaster.createAsset({ backup }, { registry: 'local' });
    const document = await keymaster.resolveDID(did);
    document.didDocumentData = { vault };
    expect(await keymaster.updateDID(document)).toBe(true);
    await keymaster.rotateKeys();
    await keymaster.rotateKeys();
    await keymaster.newWallet(wrongMnemonic ? undefined : mnemonic, true);
    if (wrongMnemonic) {
        const metadata = await store.loadWallet();
        const provider = await providerStore.loadWallet();
        await expect(keymaster.recoverId(did)).rejects.toThrow('Invalid DID');
        expect(await store.loadWallet()).toStrictEqual(metadata);
        expect(await providerStore.loadWallet()).toStrictEqual(provider);
        return;
    }

    expect(await keymaster.recoverId(did)).toBe('Alice');
    expect((await keymaster.loadWallet()).ids.Alice).toMatchObject({ did, keyRef: 'hd:0#2', icon: 'legacy' });
    const restarted = createTestKeymaster(gatekeeper, cipher, { store, providerStore }).keymaster;
    expect(await restarted.verifySignature(await restarted.addSignature({ message: 'legacy recovery' }))).toBe(true);
    await restarted.createId('Bob');
    expect((await restarted.loadWallet()).ids.Bob.keyRef).toBe('hd:1#0');
});

it.each([0, 2])('uses the confirmed key after recovering a backup with %i confirmed rotations and a pending rotation', async rotations => {
    const { keymaster, walletProvider } = createTestKeymaster(gatekeeper, cipher, { defaultRegistry: 'local' });
    const did = await keymaster.createId('Alice');
    await keymaster.backupId();
    for (let i = 0; i < rotations; i++) {
        await keymaster.rotateKeys();
    }
    const confirmedDoc = await keymaster.resolveDID(did);
    await keymaster.rotateKeys();
    const pendingDoc = await keymaster.resolveDID(did);
    pendingDoc.didDocumentMetadata!.confirmed = false;
    const mnemonic = await walletProvider.decryptMnemonic();
    await keymaster.newWallet(mnemonic, true);
    const resolveDID = keymaster.resolveDID.bind(keymaster);
    jest.spyOn(keymaster, 'resolveDID').mockImplementation(async (candidate, options) => {
        if (candidate === did) {
            return options?.confirm ? confirmedDoc : pendingDoc;
        }
        return resolveDID(candidate, options);
    });
    await keymaster.recoverId(did);
    const signed = await keymaster.addSignature({ message: 'after recovery' });
    const confirmedKey = confirmedDoc.didDocument!.verificationMethod![0].publicKeyJwk!;
    expect(cipher.verifySig(signed.signature.hash!, signed.signature.value, confirmedKey)).toBe(true);
    const publish = jest.spyOn(gatekeeper, 'createDID').mockResolvedValueOnce('did:test:message');
    await keymaster.encryptMessage('recovered message', did);
    const encrypted = (publish.mock.calls[0][0].data as { encrypted: { cipher_sender: string } }).encrypted;
    expect(await walletProvider.decrypt((await keymaster.fetchIdInfo()).keyRef, confirmedKey, encrypted.cipher_sender)).toBe('recovered message');
    await expect(walletProvider.findKeyRef((await keymaster.fetchIdInfo()).keyRef, cipher.generateRandomJwk().publicJwk)).rejects.toThrow('No matching wallet key');
});

it('finishes a DID backup before replacing the provider and wallet metadata', async () => {
    const { keymaster, walletProvider } = createTestKeymaster(gatekeeper, cipher);
    await keymaster.createId('Alice');
    const readProvider = walletProvider.backupWallet.bind(walletProvider);
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(walletProvider, 'backupWallet').mockImplementationOnce(async () => {
        entered();
        await blocked;
        return readProvider();
    });
    const reset = jest.spyOn(walletProvider, 'newWallet');
    const backingUp = keymaster.backupWallet();
    await reached;
    const replacing = keymaster.newWallet(undefined, true);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    const resetDuringBackup = reset.mock.calls.length > 0;
    release();
    const results = await Promise.allSettled([backingUp, replacing]);
    expect(results.map(result => result.status)).toStrictEqual(['fulfilled', 'fulfilled']);
    expect((await keymaster.loadWallet()).backupDid).toBeUndefined();
    expect(resetDuringBackup).toBe(false);
});

it.each(['missing key', 'unreserved account', 'unregistered rotation', 'non-provider reference'])('rejects wallet bundles whose metadata references a %s', async invalid => {
    const active = createTestKeymaster(gatekeeper, cipher);
    await active.keymaster.createId('Alice');
    const source = createTestKeymaster(gatekeeper, cipher);
    await source.keymaster.createId('Bob');
    const bundle = await source.keymaster.exportWalletBundle();
    if (invalid === 'missing key') bundle.provider.keys = {};
    else if (invalid === 'unreserved account') bundle.keymaster.ids.Bob.keyRef = 'hd:1#0';
    else if (invalid === 'unregistered rotation') bundle.keymaster.ids.Bob.keyRef = 'hd:0#1';
    else bundle.keymaster.ids.Bob.keyRef = 'toString';
    const metadata = await active.store.loadWallet();
    const provider = await active.providerStore.loadWallet();
    await expect(active.keymaster.importWalletBundle(bundle)).rejects.toThrow();
    expect(await active.store.loadWallet()).toStrictEqual(metadata);
    expect(await active.providerStore.loadWallet()).toStrictEqual(provider);
    expect(await active.keymaster.verifySignature(await active.keymaster.addSignature({ message: 'still Alice' }))).toBe(true);
});


it('rejects DID bundle recovery with missing identity keys before changing either store', async () => {
    const { keymaster, store, providerStore } = createTestKeymaster(gatekeeper, cipher);
    await keymaster.createId('Alice');
    const bundle = await keymaster.exportWalletBundle();
    bundle.provider.keys = {};
    const did = await keymaster.createAsset({ backup: bundle });
    const metadata = await store.loadWallet();
    const provider = await providerStore.loadWallet();
    await expect(keymaster.recoverWallet(did)).rejects.toThrow('Unknown keyRef');
    expect(await store.loadWallet()).toStrictEqual(metadata);
    expect(await providerStore.loadWallet()).toStrictEqual(provider);
    expect(await keymaster.verifySignature(await keymaster.addSignature({ message: 'still Alice' }))).toBe(true);
});

it.each(['hd:1#0', 'hd:0#1', 'toString'])('rejects standalone metadata with unavailable provider reference %s before saving', async keyRef => {
    const { keymaster, store, providerStore } = createTestKeymaster(gatekeeper, cipher);
    await keymaster.createId('Alice');
    const metadata = JSON.parse(JSON.stringify(await keymaster.loadWallet()));
    const provider = await providerStore.loadWallet();
    const candidate = structuredClone(metadata);
    candidate.ids.Alice.keyRef = keyRef;
    const save = jest.spyOn(store, 'saveWallet');

    await expect(keymaster.saveWallet(candidate)).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    expect(await store.loadWallet()).toStrictEqual(metadata);
    expect(await providerStore.loadWallet()).toStrictEqual(provider);
    expect(await keymaster.verifySignature(await keymaster.addSignature({ message: 'still Alice' }))).toBe(true);
});
