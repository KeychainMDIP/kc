import { Buffer } from 'buffer';
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import GatekeeperClient from '@mdip/gatekeeper/client';
import CipherWeb from '@mdip/cipher/web';
import Keymaster from '@mdip/keymaster';
import SearchClient from '@mdip/keymaster/search';
import WalletWeb from '@mdip/keymaster/wallet/web';
import WalletWebEncrypted from '@mdip/keymaster/wallet/web-enc';
import WalletCache from '@mdip/keymaster/wallet/cache';
import WalletJsonMemory from "@mdip/keymaster/wallet/json-memory";
import { isEncryptedWallet, isV1WithEnc, isV1Decrypted, isLegacyV0 } from '@mdip/keymaster/wallet/typeGuards';
import KeymasterUI from './KeymasterUI.js';
import PassphraseModal from './PassphraseModal';
import WarningModal from './WarningModal';
import MnemonicModal from './MnemonicModal';
import { encMnemonic } from '@mdip/keymaster/encryption';
import './App.css';

global.Buffer = Buffer;

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

const { protocol, hostname } = window.location;
const search = await SearchClient.create({ url: `${protocol}//${hostname}:4002` });

function App() {
    const [isReady, setIsReady] = useState(false);
    const [modalAction, setModalAction] = useState(null);
    const [passphraseErrorText, setPassphraseErrorText] = useState("");
    const [keymaster, setKeymaster] = useState(null);
    const [kmEpoch, setKmEpoch] = useState(0);
    const [uploadAction, setUploadAction] = useState(null);
    const [pendingWallet, setPendingWallet] = useState(null);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showResetSetup, setShowResetSetup] = useState(false);
    const [showRecoverMnemonic, setShowRecoverMnemonic] = useState(false);
    const [mnemonicErrorText, setMnemonicErrorText] = useState("");
    const [recoveredMnemonic, setRecoveredMnemonic] = useState("");
    const [showRecoverSetup, setShowRecoverSetup] = useState(false);
    const [searchParams] = useSearchParams();
    const challengeDID = searchParams.get('challenge');

    useEffect(() => {
        const init = async () => {
            const walletWeb = new WalletWeb();
            const walletData = await walletWeb.loadWallet();

            if (!walletData || isLegacyV0(walletData)) {
                setModalAction('set-passphrase');
            } else {
                setModalAction('decrypt');
            }
        };
        init();
    }, []);

    const buildKeymaster = async (wallet, passphrase) => {
        const instance = new Keymaster({gatekeeper, wallet, cipher, search, passphrase});

        try {
            // check pass & convert to v1 if needed
            await instance.loadWallet();
        } catch {
            setPassphraseErrorText('Incorrect passphrase');
            return;
        }

        setModalAction(null);
        setPendingWallet(null);
        setUploadAction(null);
        setPassphraseErrorText("");
        setKeymaster(instance);
        setKmEpoch((e) => e + 1);
        setIsReady(true);
    };

    async function rebuildKeymaster(passphrase) {
        const walletWeb = new WalletWeb();
        const walletCached = new WalletCache(walletWeb);
        await buildKeymaster(walletCached, passphrase);
    }

    async function handlePassphraseSubmit(passphrase) {
        setPassphraseErrorText("");

        const walletWeb = new WalletWeb();
        const walletMemory = new WalletJsonMemory();

        if (uploadAction && pendingWallet) {
            if (modalAction === 'decrypt') {
                await walletMemory.saveWallet(pendingWallet, true);

                try {
                    if (uploadAction === 'upload-enc-v0') {
                        const walletEnc = new WalletWebEncrypted(walletMemory, passphrase);
                        // check pass & remove encyption wrapper
                        const decrypted = await walletEnc.loadWallet();
                        await walletWeb.saveWallet(decrypted, true);
                    } else { // upload-enc-v1
                        const km = new Keymaster({ gatekeeper, wallet: walletMemory, cipher, search, passphrase });
                        // check pass
                        await km.loadWallet();
                        await walletWeb.saveWallet(pendingWallet, true);
                    }
                } catch {
                    setPassphraseErrorText('Incorrect passphrase');
                    return;
                }
            } else { // upload-plain-v0
                await walletWeb.saveWallet(pendingWallet, true);
            }
        } else {
            const wallet = await walletWeb.loadWallet();
            if (isEncryptedWallet(wallet)) {
                try {
                    const walletEnc = new WalletWebEncrypted(walletWeb, passphrase);
                    // check pass & remove encyption wrapper
                    const decrypted = await walletEnc.loadWallet();
                    await walletWeb.saveWallet(decrypted, true);
                } catch {
                    setPassphraseErrorText('Incorrect passphrase');
                    return;
                }
            }
        }

        await rebuildKeymaster(passphrase);
    }
    
    function handleStartReset() {
        setPassphraseErrorText("");
        setShowResetConfirm(true);
    }

    function handleStartRecover() {
        setMnemonicErrorText("");
        setShowRecoverMnemonic(true);
        setPassphraseErrorText("");

        // only nullify modalAction if we are uploading a wallet, otherwise
        // leave passphrase modal open in case the user cancels
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
            const walletWeb = new WalletWeb();
            const km = new Keymaster({ gatekeeper, wallet: walletWeb, cipher, search, passphrase: newPassphrase });
            await km.newWallet(undefined, true);
            setShowResetSetup(false);
            await rebuildKeymaster(newPassphrase);
        } catch {
            setPassphraseErrorText('Failed to reset wallet. Try again.');
        }
    }

    async function handleImportUploadFile() {
        const mnemonic = window.prompt("Enter 12-word mnemonic");
        if (!mnemonic) {
            return;
        }

        const passphrase = window.prompt("Enter your wallet passphrase");
        if (!passphrase) {
            return;
        }

        const walletMemory = new WalletJsonMemory();
        const km = new Keymaster({ gatekeeper, wallet: walletMemory, cipher, search, passphrase });

        try {
            await km.newWallet(mnemonic, true);
        } catch {
            window.alert('Invalid mnemonic');
            return;
        }

        const seedBank = await km.resolveSeedBank();
        let backupEnc = null;

        if (seedBank.didDocumentData?.wallet) {
            const did = seedBank.didDocumentData?.wallet;
            const asset = await keymaster.resolveAsset(did);
            backupEnc = asset.backup ? asset.backup : null;
        }

        if (backupEnc) {
            const hdkey = cipher.generateHDKey(mnemonic);
            const { publicJwk, privateJwk } = cipher.generateJwk(hdkey.privateKey);
            const backupJson = cipher.decryptMessage(publicJwk, privateJwk, backupEnc);
            let recovered = JSON.parse(backupJson);

            if (isV1Decrypted(recovered)) {
                recovered.seed.mnemonicEnc = await encMnemonic(mnemonic, passphrase);
            }

            await km.saveWallet(recovered, true);
        }

        const finalStored = await walletMemory.loadWallet();
        const walletWeb = new WalletWeb();
        await walletWeb.saveWallet(finalStored, true);
        await rebuildKeymaster(passphrase);
    }

    async function handleWalletUploadFile(uploaded) {
        setPendingWallet(uploaded);

        if (isLegacyV0(uploaded)) {
            setUploadAction('upload-plain-v0');
            setModalAction('set-passphrase');
        } else if (isV1WithEnc(uploaded)) {
            setUploadAction('upload-enc-v1');
            setModalAction('decrypt');
        } else if (isEncryptedWallet(uploaded)) {
            setUploadAction('upload-enc-v0');
            setModalAction('decrypt');
        } else {
            window.alert('Unsupported wallet type');
        }
    }

    function handleModalClose() {
        setModalAction(null);
        setPendingWallet(null);
        setPassphraseErrorText("");
    }

    async function handleRecoverMnemonicSubmit(mnemonic) {
        setMnemonicErrorText("");
        try {
            const walletWeb = new WalletWeb();
            let stored = pendingWallet && isV1WithEnc(pendingWallet)
                ? pendingWallet
                : await walletWeb.loadWallet();

            if (!isV1WithEnc(stored)) {
                setMnemonicErrorText('Recovery not available for this wallet type.');
                return;
            }

            const hdkey = cipher.generateHDKey(mnemonic);
            const { publicJwk, privateJwk } = cipher.generateJwk(hdkey.privateKey);
            cipher.decryptMessage(publicJwk, privateJwk, stored.enc);

            setRecoveredMnemonic(mnemonic);
            setShowRecoverMnemonic(false);
            setShowRecoverSetup(true);
        } catch {
            setMnemonicErrorText('Mnemonic is incorrect. Try again.');
        }
    }

    async function handleRecoverPassphraseSubmit(newPassphrase) {
        if (!recoveredMnemonic) {
            return;
        }
        try {
            const walletWeb = new WalletWeb();
            const base = pendingWallet && isV1WithEnc(pendingWallet)
                ? pendingWallet
                : await walletWeb.loadWallet();

            if (!isV1WithEnc(base)) {
                setPassphraseErrorText('Recovery not available for this wallet type.');
                return;
            }

            const mnemonicEnc = await encMnemonic(recoveredMnemonic, newPassphrase);
            const updated = {
                version: base.version,
                seed: { mnemonicEnc },
                enc: base.enc
            };

            await walletWeb.saveWallet(updated, true);
            setRecoveredMnemonic("");
            setShowRecoverSetup(false);
            await rebuildKeymaster(newPassphrase);
        } catch {
            setPassphraseErrorText('Failed to update passphrase. Try again.');
        }
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
                    modalAction === 'decrypt' &&
                    (uploadAction === null || uploadAction === 'upload-enc-v1')
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
                    onImportWallet={handleImportUploadFile}
                />
            )}
        </>
    );
}

export default App;
