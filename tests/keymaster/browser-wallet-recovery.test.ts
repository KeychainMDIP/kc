import fs from 'fs';
import ts from 'typescript';
import { jest } from '@jest/globals';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import CipherNode from '@mdip/cipher/node';
import { isV1WithEnc, isV2Wallet } from '@mdip/keymaster/wallet/typeGuards';
import { createTestKeymaster, createProviderStore, createMnemonicWalletProvider } from './testUtils.ts';

function recoveryHandler(file: string, bindings: Record<string, unknown>): (passphrase: string) => Promise<void> {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    const names = new Set(['isMdipWalletBundle', 'persistWalletData', 'importWalletBundle', 'handleRecoverPassphraseSubmit']);
    const declarations: string[] = [];
    function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)) {
            declarations.push(node.getText(source));
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    expect(declarations).toHaveLength(names.size);
    // Run the real browser callbacks with in-memory stores, without rendering React.
    const javascript = ts.transpileModule(declarations.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    // eslint-disable-next-line sonarjs/code-eval -- Executes only checked-in browser callbacks.
    return new Function(...Object.keys(bindings), `${javascript}\nreturn handleRecoverPassphraseSubmit;`)(...Object.values(bindings));
}

it.each([
    'apps/react-wallet/src/contexts/WalletProvider.tsx',
    'apps/chrome-extension/src/contexts/WalletProvider.tsx',
    'services/gatekeeper/client/src/App.tsx',
].flatMap(file => ['valid', 'fingerprint', 'missing-key'].map(invalid => ({ file, invalid }))))('validates uploaded bundle passphrase recovery for $file (invalid bundle=$invalid)', async ({ file, invalid }) => {
    const cipher = new CipherNode();
    const gatekeeper = new Gatekeeper({ db: new DbJsonMemory('test'), ipfsEnabled: false });
    const active = createTestKeymaster(gatekeeper, cipher, { defaultRegistry: 'local' });
    const imported = createTestKeymaster(gatekeeper, cipher, { defaultRegistry: 'local' });
    await active.keymaster.createId('Active');
    await imported.keymaster.createId('Imported');
    const pendingWallet = await imported.keymaster.exportWalletBundle();
    const recoveredMnemonic = await imported.walletProvider.decryptMnemonic();
    if (invalid === 'fingerprint') pendingWallet.keymaster.provider.walletFingerprint = 'wrong-fingerprint';
    if (invalid === 'missing-key') pendingWallet.provider.keys = {};
    const metadata = JSON.stringify(await active.store.loadWallet());
    const provider = JSON.stringify(await active.providerStore.loadWallet());
    const setPassphraseErrorText = jest.fn();
    const buildKeymaster = jest.fn(async () => true);
    const handle = recoveryHandler(file, {
        recoveredMnemonic,
        pendingWallet,
        isV1WithEnc,
        isV2Wallet,
        createMetadataStore: () => active.store,
        createProviderStore: () => active.providerStore,
        createMemoryProviderStore: createProviderStore,
        createMnemonicWalletProvider: (passphrase: string, store: ReturnType<typeof createProviderStore>) => createMnemonicWalletProvider(cipher, passphrase, store),
        createKeymaster: (passphrase: string, store: typeof active.store, providerStore: ReturnType<typeof createProviderStore>) => {
            const fixture = createTestKeymaster(gatekeeper, cipher, { store, providerStore, passphrase });
            return { instance: fixture.keymaster, walletProvider: fixture.walletProvider };
        },
        WalletJsonMemory: active.store.constructor,
        setPassphraseErrorText,
        setRecoveredMnemonic: jest.fn(),
        setShowRecoverSetup: jest.fn(),
        buildKeymaster,
    });

    await handle('new-passphrase');

    if (invalid !== 'valid') {
        expect(setPassphraseErrorText).toHaveBeenCalledWith(expect.stringContaining('Failed'));
        expect(buildKeymaster).not.toHaveBeenCalled();
        expect(JSON.stringify(await active.store.loadWallet())).toBe(metadata);
        expect(JSON.stringify(await active.providerStore.loadWallet())).toBe(provider);
    } else {
        expect(setPassphraseErrorText).not.toHaveBeenCalled();
        expect(buildKeymaster).toHaveBeenCalledWith('new-passphrase');
        expect(JSON.stringify(await active.store.loadWallet())).toBe(JSON.stringify(pendingWallet.keymaster));
        const restored = createMnemonicWalletProvider(cipher, 'new-passphrase', active.providerStore);
        expect(await restored.decryptMnemonic()).toBe(recoveredMnemonic);
    }
});
