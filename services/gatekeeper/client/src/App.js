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
import PassphraseModal from './PassphraseModal.js';
import './App.css';

global.Buffer = Buffer;

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

const { protocol, hostname } = window.location;
const search = await SearchClient.create({ url: `${protocol}//${hostname}:4002` });

function App() {
    const [isReady, setIsReady] = useState(false);
    const [modalAction, setModalAction] = useState(null);
    const [passphraseErrorText, setPassphraseErrorText] = useState(null);
    const [keymaster, setKeymaster] = useState(null);
    const [kmEpoch, setKmEpoch] = useState(0);
    const [isFirstRun, setIsFirstRun] = useState(false);
    const [uploadAction, setUploadAction] = useState(null);
    const [pendingWallet, setPendingWallet] = useState(null);
    const [searchParams] = useSearchParams();
    const challengeDID = searchParams.get('challenge');

    useEffect(() => {
        const init = async () => {
            const walletWeb = new WalletWeb();
            const walletData = await walletWeb.loadWallet();

            if (!walletData) {
                setIsFirstRun(true);
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
        setPassphraseErrorText(null);
        setKeymaster(instance);
        setKmEpoch((e) => e + 1);
        setIsReady(true);
    };

    async function rebuildKeymaster(passphrase) {
        const walletWeb = new WalletWeb();
        const walletCached = new WalletCache(walletWeb);
        await buildKeymaster(walletCached, passphrase, true);
    }

    async function handlePassphraseSubmit(passphrase) {
        setPassphraseErrorText(null);

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
                    } else { // upload-enc-v1 & upload-plain-v1
                        const km = new Keymaster({ gatekeeper, wallet: walletMemory, cipher, search, passphrase });
                        // check pass
                        await km.loadWallet(pendingWallet);
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
        setIsFirstRun(false);
    }

    async function handleWalletUploadFile(uploaded) {
        setPendingWallet(uploaded);

        if (isLegacyV0(uploaded)) {
            setUploadAction('upload-plain-v0');
            setModalAction('set-passphrase');
        } else if (isV1Decrypted(uploaded)) {
            setUploadAction('upload-plain-v1');
            setModalAction('decrypt');
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
        setPassphraseErrorText(null);
    }

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== null}
                title={
                    isFirstRun || modalAction === 'set-passphrase'
                        ? 'Set a Passphrase' : 'Enter Your Wallet Passphrase'
                }
                errorText={passphraseErrorText}
                onSubmit={handlePassphraseSubmit}
                onClose={handleModalClose}
                encrypt={isFirstRun || modalAction === 'set-passphrase'}
                showCancel={pendingWallet !== null}
            />

            {isReady && keymaster && (
                <KeymasterUI
                    key={`km-${kmEpoch}`}
                    keymaster={keymaster}
                    title={'Keymaster Browser Wallet Demo'}
                    challengeDID={challengeDID}
                    onWalletUpload={handleWalletUploadFile}
                />
            )}
        </>
    );
}

export default App;
