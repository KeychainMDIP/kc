import { Buffer } from 'buffer';
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import GatekeeperClient from '@mdip/gatekeeper/client';
import CipherWeb from '@mdip/cipher/web';
import Keymaster from '@mdip/keymaster';
import SearchClient from '@mdip/keymaster/search';
import WalletWeb from '@mdip/keymaster/wallet/web';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import MnemonicHdWalletProvider from '@mdip/keymaster/wallet/mnemonic-hd';
import {
    isLegacyV0,
    isV1Decrypted,
    isV1WithEnc,
    isV2Wallet,
} from '@mdip/keymaster/wallet/typeGuards';
import { encMnemonic } from '@mdip/keymaster/encryption';
import KeymasterUI from './KeymasterUI';
import PassphraseModal from './PassphraseModal';
import WarningModal from './WarningModal';
import MnemonicModal from './MnemonicModal';
import './App.css';

globalThis.Buffer = Buffer;

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

const KEYMASTER_STORE_NAME = 'mdip-keymaster';
const WALLET_PROVIDER_STORE_NAME = 'mdip-wallet-provider';
const INCORRECT_PASSPHRASE = 'Incorrect passphrase';
const INCOMPLETE_WALLET = 'Wallet data is incomplete. Restore from an mdip-wallet-bundle or reset the wallet.';

function createMetadataStore() {
    return new WalletWeb(KEYMASTER_STORE_NAME);
}

function createProviderStore() {
    return new WalletWeb(WALLET_PROVIDER_STORE_NAME);
}

function createMemoryProviderStore() {
    return new WalletJsonMemory();
}

function createMnemonicWalletProvider(passphrase, store = createProviderStore()) {
    return new MnemonicHdWalletProvider({
        store,
        cipher,
        passphrase,
    });
}

async function createSearchClient() {
    const { protocol, hostname } = window.location;
    return SearchClient.create({ url: `${protocol}//${hostname}:4002` });
}

function isMdipWalletBundle(wallet) {
    if (!wallet || typeof wallet !== 'object') {
        return false;
    }

    return wallet.version === 1
        && wallet.type === 'mdip-wallet-bundle'
        && isV2Wallet(wallet.keymaster)
        && !!wallet.provider
        && wallet.provider.version === 1
        && wallet.provider.type === 'mnemonic-hd'
        && !!wallet.provider.rootPublicJwk;
}

async function verifyMnemonicAgainstProviderState(providerState, mnemonic) {
    const hdKey = cipher.generateHDKey(mnemonic);
    const { publicJwk } = cipher.generateJwk(hdKey.privateKey);

    if (cipher.hashJSON(publicJwk) !== cipher.hashJSON(providerState.rootPublicJwk)) {
        throw new Error('Mnemonic does not match wallet.');
    }
}

function App() {
    const [isReady, setIsReady] = useState(false);
    const [modalAction, setModalAction] = useState(null);
    const [passphraseErrorText, setPassphraseErrorText] = useState('');
    const [keymaster, setKeymaster] = useState(null);
    const [walletProvider, setWalletProvider] = useState(null);
    const [kmEpoch, setKmEpoch] = useState(0);
    const [uploadAction, setUploadAction] = useState(null);
    const [pendingWallet, setPendingWallet] = useState(null);
    const [pendingMnemonic, setPendingMnemonic] = useState('');
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showResetSetup, setShowResetSetup] = useState(false);
    const [showRecoverMnemonic, setShowRecoverMnemonic] = useState(false);
    const [mnemonicErrorText, setMnemonicErrorText] = useState('');
    const [recoveredMnemonic, setRecoveredMnemonic] = useState('');
    const [showRecoverSetup, setShowRecoverSetup] = useState(false);
    const [searchClient, setSearchClient] = useState(null);
    const [searchParams] = useSearchParams();
    const challengeDID = searchParams.get('challenge');

    useEffect(() => {
        const init = async () => {
            try {
                const search = await createSearchClient();
                setSearchClient(search);
                await initialiseWallet();
            }
            catch {
                setPassphraseErrorText('Failed to initialize wallet services.');
            }
        };

        void init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const getSearchClient = async () => {
        if (searchClient) {
            return searchClient;
        }

        const created = await createSearchClient();
        setSearchClient(created);
        return created;
    };

    async function initialiseWallet() {
        const walletStore = createMetadataStore();
        const providerStore = createProviderStore();
        const walletData = await walletStore.loadWallet();
        const providerData = await providerStore.loadWallet();
        const hasIncompleteState =
            (!!providerData && !walletData)
            || (!!walletData && isV2Wallet(walletData) && !providerData);

        setIsReady(false);

        if (hasIncompleteState) {
            setPassphraseErrorText(INCOMPLETE_WALLET);
            setModalAction('decrypt');
            return;
        }

        if (!walletData || pendingMnemonic || isLegacyV0(walletData) || isV1Decrypted(walletData)) {
            setPassphraseErrorText('');
            setModalAction('set-passphrase');
        }
        else {
            setPassphraseErrorText('');
            setModalAction('decrypt');
        }
    }

    async function createKeymaster(
        passphrase,
        store = createMetadataStore(),
        providerStore = createProviderStore(),
    ) {
        const search = await getSearchClient();
        const nextWalletProvider = createMnemonicWalletProvider(passphrase, providerStore);
        const instance = new Keymaster({
            gatekeeper,
            store,
            walletProvider: nextWalletProvider,
            cipher,
            search,
        });

        return { instance, walletProvider: nextWalletProvider };
    }

    async function activateWallet(instance, nextWalletProvider) {
        setModalAction(null);
        setPendingWallet(null);
        setPendingMnemonic('');
        setRecoveredMnemonic('');
        setUploadAction(null);
        setPassphraseErrorText('');
        setKeymaster(instance);
        setWalletProvider(nextWalletProvider);
        setKmEpoch((epoch) => epoch + 1);
        setIsReady(true);
    }

    async function buildKeymaster(passphrase) {
        const { instance, walletProvider: nextWalletProvider } = await createKeymaster(passphrase);

        try {
            if (pendingMnemonic) {
                await instance.newWallet(pendingMnemonic, true);
                await instance.recoverWallet();
            }
            else {
                await instance.loadWallet();
            }
        }
        catch {
            setPassphraseErrorText(INCORRECT_PASSPHRASE);
            return false;
        }

        await activateWallet(instance, nextWalletProvider);
        return true;
    }

    async function persistWalletData(wallet, providerState) {
        const providerStore = createProviderStore();
        const walletStore = createMetadataStore();

        const providerOk = await providerStore.saveWallet(providerState, true);
        if (!providerOk) {
            throw new Error('save provider wallet failed');
        }

        const walletOk = await walletStore.saveWallet(wallet, true);
        if (!walletOk) {
            throw new Error('save wallet failed');
        }
    }

    async function importLegacyWallet(wallet, passphrase) {
        const memoryStore = new WalletJsonMemory();
        const memoryProviderStore = createMemoryProviderStore();
        const { instance, walletProvider: memoryWalletProvider } = await createKeymaster(
            passphrase,
            memoryStore,
            memoryProviderStore,
        );

        await memoryStore.saveWallet(wallet, true);
        const normalized = await instance.loadWallet();
        const providerState = await memoryWalletProvider.backupWallet();
        await persistWalletData(normalized, providerState);
    }

    async function importWalletBundle(bundle, passphrase) {
        const memoryStore = new WalletJsonMemory();
        const memoryProviderStore = createMemoryProviderStore();
        const { instance, walletProvider: memoryWalletProvider } = await createKeymaster(
            passphrase,
            memoryStore,
            memoryProviderStore,
        );

        await memoryStore.saveWallet(bundle.keymaster, true);
        await memoryWalletProvider.saveWallet(bundle.provider, true);
        const normalized = await instance.loadWallet();
        const providerState = await memoryWalletProvider.backupWallet();
        await persistWalletData(normalized, providerState);
    }

    async function handlePassphraseSubmit(passphrase) {
        setPassphraseErrorText('');

        if (uploadAction && pendingWallet) {
            try {
                if (uploadAction === 'upload-bundle' && isMdipWalletBundle(pendingWallet)) {
                    await importWalletBundle(pendingWallet, passphrase);
                }
                else {
                    await importLegacyWallet(pendingWallet, passphrase);
                }
            }
            catch {
                setPassphraseErrorText(
                    modalAction === 'decrypt' ? INCORRECT_PASSPHRASE : 'Failed to import wallet.',
                );
                return;
            }
        }

        await buildKeymaster(passphrase);
    }

    async function handleModalClose() {
        setPendingWallet(null);
        setPendingMnemonic('');
        setRecoveredMnemonic('');
        setPassphraseErrorText('');

        const walletData = await createMetadataStore().loadWallet();
        const providerData = await createProviderStore().loadWallet();
        if (walletData || providerData) {
            setModalAction(null);
        }
    }

    async function handleWalletUploadFile(uploaded) {
        setPendingWallet(uploaded);

        if (isMdipWalletBundle(uploaded)) {
            setUploadAction('upload-bundle');
            setModalAction('decrypt');
            return;
        }

        if (isLegacyV0(uploaded) || isV1Decrypted(uploaded)) {
            setUploadAction('upload-legacy-plain');
            setModalAction('set-passphrase');
            return;
        }

        if (isV1WithEnc(uploaded)) {
            setUploadAction('upload-legacy-encrypted');
            setModalAction('decrypt');
            return;
        }

        if (isV2Wallet(uploaded)) {
            window.alert('Standalone keymaster metadata is not enough. Upload an mdip-wallet-bundle instead.');
            return;
        }

        window.alert('Unsupported wallet type');
    }

    function handleStartReset() {
        setPassphraseErrorText('');
        setShowResetConfirm(true);
    }

    function handleStartRecover() {
        setMnemonicErrorText('');
        setRecoveredMnemonic('');
        setShowRecoverMnemonic(true);
        setPassphraseErrorText('');

        if (uploadAction !== null) {
            setModalAction(null);
        }
    }

    function handleConfirmReset() {
        setShowResetConfirm(false);
        setShowResetSetup(true);
    }

    function handleCancelReset() {
        setShowResetConfirm(false);
    }

    async function handleResetPassphraseSubmit(newPassphrase) {
        try {
            const { instance } = await createKeymaster(newPassphrase);
            await instance.newWallet(undefined, true);
            setShowResetSetup(false);
            await buildKeymaster(newPassphrase);
        }
        catch {
            setPassphraseErrorText('Failed to reset wallet. Try again.');
        }
    }

    async function handleRecoverMnemonicSubmit(mnemonic) {
        setMnemonicErrorText('');

        try {
            const walletStore = createMetadataStore();
            const providerStore = createProviderStore();
            const storedWallet = pendingWallet && isV1WithEnc(pendingWallet)
                ? pendingWallet
                : await walletStore.loadWallet();

            if (isV1WithEnc(storedWallet)) {
                const hdKey = cipher.generateHDKey(mnemonic);
                const { publicJwk, privateJwk } = cipher.generateJwk(hdKey.privateKey);
                cipher.decryptMessage(publicJwk, privateJwk, storedWallet.enc);
            }
            else {
                const providerState = isMdipWalletBundle(pendingWallet)
                    ? pendingWallet.provider
                    : await providerStore.loadWallet();

                if (!providerState) {
                    setMnemonicErrorText('Recovery not available for this wallet type.');
                    return;
                }

                await verifyMnemonicAgainstProviderState(providerState, mnemonic);
            }

            setRecoveredMnemonic(mnemonic);
            setShowRecoverMnemonic(false);
            setShowRecoverSetup(true);
        }
        catch {
            setMnemonicErrorText('Mnemonic is incorrect. Try again.');
        }
    }

    async function handleRecoverPassphraseSubmit(newPassphrase) {
        if (!recoveredMnemonic) {
            return;
        }

        try {
            const walletStore = createMetadataStore();
            const providerStore = createProviderStore();
            const storedWallet = pendingWallet && isV1WithEnc(pendingWallet)
                ? pendingWallet
                : await walletStore.loadWallet();

            if (isV1WithEnc(storedWallet)) {
                const mnemonicEnc = await encMnemonic(recoveredMnemonic, newPassphrase);
                const updatedWallet = {
                    version: storedWallet.version,
                    seed: { mnemonicEnc },
                    enc: storedWallet.enc,
                };

                await importLegacyWallet(updatedWallet, newPassphrase);
            }
            else {
                const providerState = isMdipWalletBundle(pendingWallet)
                    ? pendingWallet.provider
                    : await providerStore.loadWallet();

                if (!providerState) {
                    setPassphraseErrorText('Recovery not available for this wallet type.');
                    return;
                }

                const recoveryProvider = createMnemonicWalletProvider(newPassphrase, createMemoryProviderStore());
                await recoveryProvider.saveWallet(providerState, true);
                await recoveryProvider.changePassphrase(recoveredMnemonic, newPassphrase);
                const updatedProviderState = await recoveryProvider.backupWallet();

                if (isMdipWalletBundle(pendingWallet)) {
                    await persistWalletData(pendingWallet.keymaster, updatedProviderState);
                }
                else {
                    const wallet = await walletStore.loadWallet();
                    if (!wallet || !isV2Wallet(wallet)) {
                        setPassphraseErrorText('Recovery not available for this wallet type.');
                        return;
                    }

                    await persistWalletData(wallet, updatedProviderState);
                }
            }

            setRecoveredMnemonic('');
            setShowRecoverSetup(false);
            await buildKeymaster(newPassphrase);
        }
        catch {
            setPassphraseErrorText('Failed to update passphrase. Try again.');
        }
    }

    async function handleShowMnemonic() {
        if (!walletProvider) {
            throw new Error('Wallet provider not available.');
        }

        return walletProvider.decryptMnemonic();
    }

    async function handleCreateWallet() {
        setPendingWallet(null);
        setPendingMnemonic('');
        setRecoveredMnemonic('');
        setUploadAction(null);
        setPassphraseErrorText('');
        setShowResetSetup(true);
    }

    async function handleImportMnemonic(mnemonic) {
        setPendingMnemonic(mnemonic);
        setPendingWallet(null);
        setRecoveredMnemonic('');
        setUploadAction(null);
        setPassphraseErrorText('');
        setModalAction('set-passphrase');
    }

    async function handleDownloadWallet() {
        if (!keymaster || !walletProvider) {
            return;
        }

        const wallet = await keymaster.loadWallet();
        const provider = await walletProvider.backupWallet();
        const bundle = {
            version: 1,
            type: 'mdip-wallet-bundle',
            keymaster: wallet,
            provider,
        };
        const walletJSON = JSON.stringify(bundle, null, 4);
        const blob = new Blob([walletJSON], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = 'mdip-wallet-bundle.json';
        link.click();

        URL.revokeObjectURL(url);
    }

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== null && !showResetSetup && !showRecoverSetup}
                title={modalAction === 'set-passphrase'
                    ? 'Set a Passphrase' : 'Enter Your Wallet Passphrase'}
                errorText={passphraseErrorText}
                onSubmit={handlePassphraseSubmit}
                onClose={handleModalClose}
                encrypt={modalAction === 'set-passphrase'}
                showCancel={pendingWallet !== null}
                upload={uploadAction !== null}
                onStartReset={handleStartReset}
                onStartRecover={
                    modalAction === 'decrypt'
                    && (uploadAction === null
                        || uploadAction === 'upload-legacy-encrypted'
                        || uploadAction === 'upload-bundle')
                        ? handleStartRecover
                        : undefined
                }
            />

            <MnemonicModal
                isOpen={showRecoverMnemonic}
                errorText={mnemonicErrorText}
                onSubmit={handleRecoverMnemonicSubmit}
                onClose={() => setShowRecoverMnemonic(false)}
            />

            <WarningModal
                isOpen={showResetConfirm}
                title="Overwrite wallet with a new one?"
                warningText="This will delete your current wallet data in this browser and create a brand new one."
                onSubmit={handleConfirmReset}
                onClose={handleCancelReset}
            />

            <PassphraseModal
                isOpen={showResetSetup}
                title="Set a Passphrase"
                errorText={passphraseErrorText}
                onSubmit={handleResetPassphraseSubmit}
                onClose={() => setShowResetSetup(false)}
                encrypt={true}
                showCancel={true}
            />

            <PassphraseModal
                isOpen={showRecoverSetup}
                title="Set a New Passphrase"
                errorText={passphraseErrorText}
                onSubmit={handleRecoverPassphraseSubmit}
                onClose={() => setShowRecoverSetup(false)}
                encrypt={true}
                showCancel={true}
            />

            {isReady && keymaster && (
                <KeymasterUI
                    key={`km-${kmEpoch}`}
                    keymaster={keymaster}
                    title={'Keymaster Browser Wallet Demo'}
                    challengeDID={challengeDID}
                    onWalletUpload={handleWalletUploadFile}
                    onShowMnemonic={handleShowMnemonic}
                    onCreateWallet={handleCreateWallet}
                    onImportMnemonic={handleImportMnemonic}
                    onWalletDownload={handleDownloadWallet}
                />
            )}
        </>
    );
}

export default App;
