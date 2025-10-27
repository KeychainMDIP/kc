import { Buffer } from 'buffer';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Alert, Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import GatekeeperClient from '@mdip/gatekeeper/client';
import CipherWeb from '@mdip/cipher/web';
import Keymaster from '@mdip/keymaster';
import SearchClient from '@mdip/keymaster/search';
import WalletWeb from '@mdip/keymaster/wallet/web';
import WalletWebEncrypted from '@mdip/keymaster/wallet/web-enc';
import WalletCache from '@mdip/keymaster/wallet/cache';
import KeymasterUI from './KeymasterUI.js';
import PassphraseModal from './PassphraseModal.js';
import './App.css';

global.Buffer = Buffer;

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

const { protocol, hostname } = window.location;
const search = await SearchClient.create({ url: `${protocol}//${hostname}:4002` });

const isEncryptedBlob = (w) =>
    w && typeof w === 'object' && !!w.salt && !!w.iv && !!w.data;

function App() {
    const [searchParams] = useSearchParams();
    const challengeDID = searchParams.get('challenge');
    const [isReady, setIsReady] = useState(false);
    const [modalAction, setModalAction] = useState(null);
    const [isEncrypted, setIsEncrypted] = useState(false);
    const [passphraseErrorText, setPassphraseErrorText] = useState(null);
    const [isCryptoAvailable, setIsCryptoAvailable] = useState(false);
    const [cryptoError, setCryptoError] = useState('');
    const [keymaster, setKeymaster] = useState(null);
    const [kmEpoch, setKmEpoch] = useState(0);
    const [isFirstRun, setIsFirstRun] = useState(false);
    const backendKindRef = useRef(null);
    const keypassRef = useRef('');
    const initRanRef = useRef(false);

    const buildKeymaster = useCallback(
        async (walletImpl, passphrase, intent, kind, verified = false) => {
            const instance = new Keymaster({
                gatekeeper,
                wallet: walletImpl,
                cipher,
                search,
                passphrase,
            });

            const needVerify =
                !!passphrase &&
                !verified &&
                (kind === 'enc' || intent === 'keypass') &&
                !isFirstRun;

            if (needVerify) {
                try {
                    await instance.decryptMnemonic();
                } catch {
                    setIsReady(false);
                    setPassphraseErrorText('Incorrect passphrase');
                    setModalAction(intent || 'keypass');
                    return;
                }
            }

            if (passphrase) {
                keypassRef.current = passphrase;
            }

            backendKindRef.current = kind || 'plain';
            setKeymaster(instance);
            setIsReady(true);
            setKmEpoch((e) => e + 1);
        },
        [isFirstRun]
    );

    useEffect(() => {
        (async () => {
            if (initRanRef.current) {
                return;
            }
            initRanRef.current = true;

            const cryptoAvailable = !!(window.crypto && window.crypto.subtle);
            setIsCryptoAvailable(cryptoAvailable);

            const walletWeb = new WalletWeb();
            const walletData = await walletWeb.loadWallet();

            if (!walletData) {
                setIsEncrypted(false);
                setIsFirstRun(true);
                setModalAction('keypass');
                return;
            }

            if (isEncryptedBlob(walletData)) {
                if (!cryptoAvailable) {
                    setCryptoError('Wallet is encrypted but this environment is not secure. Use HTTPS or localhost.');
                    return;
                }
                setIsEncrypted(true);
                setModalAction('decrypt');
                setIsReady(false);
            } else {
                setIsEncrypted(false);
                setModalAction('keypass');
            }
        })();
    }, [buildKeymaster]);

    async function handlePassphraseSubmit(passphrase) {
        setPassphraseErrorText(null);

        const walletWeb = new WalletWeb();

        if (modalAction === 'decrypt') {
            const walletEnc = new WalletWebEncrypted(walletWeb, passphrase);
            const walletCached = new WalletCache(walletEnc);

            try {
                await walletEnc.loadWallet();
            } catch {
                setPassphraseErrorText('Incorrect passphrase');
                return;
            }

            setIsEncrypted(true);
            await buildKeymaster(walletCached, passphrase, 'decrypt', 'enc', true);
            setModalAction(null);
            return;
        }

        // keypass
        const data = await walletWeb.loadWallet();
        if (isEncryptedBlob(data)) {
            const walletEnc = new WalletWebEncrypted(walletWeb, passphrase);
            const walletCached = new WalletCache(walletEnc);
            try {
                await walletEnc.loadWallet();
            } catch {
                setPassphraseErrorText('Incorrect passphrase');
                return;
            }
            setIsEncrypted(true);
            await buildKeymaster(walletCached, passphrase, 'keypass', 'enc', true);
        } else {
            setIsEncrypted(false);

            if (isFirstRun) {
                const kmPlainBootstrap = new Keymaster({
                    gatekeeper,
                    wallet: walletWeb,
                    cipher,
                    search,
                    passphrase,
                });
                await kmPlainBootstrap.loadWallet();
                await buildKeymaster(walletWeb, passphrase, 'keypass', 'plain', true);
            } else {
                await buildKeymaster(walletWeb, passphrase, 'keypass', 'plain');
            }
        }

        setIsFirstRun(false);
        setModalAction(null);
    }

    function handleModalClose() {
        setModalAction(null);
    }

    async function encryptWallet() {
        if (isEncrypted) {
            return;
        }

        const pass = keypassRef.current;
        if (!pass) {
            // Should not happen.
            setPassphraseErrorText('Set a passphrase first to encrypt the wallet file.');
            setModalAction('keypass');
            return;
        }

        const walletWeb = new WalletWeb();
        const kmPlain = new Keymaster({ gatekeeper, wallet: walletWeb, cipher, search, passphrase: pass });

        // Generate a wallet if none exists. Should not happen.
        await kmPlain.loadWallet();

        const current = await walletWeb.loadWallet();
        const walletEnc = new WalletWebEncrypted(walletWeb, pass);
        await walletEnc.saveWallet(current, true);

        const walletCached = new WalletCache(walletEnc);

        setIsEncrypted(true);
        backendKindRef.current = 'enc';

        await buildKeymaster(walletCached, pass, 'keypass', 'enc', true);

        setModalAction(null);
    }

    async function decryptWallet() {
        if (!keymaster) {
            return;
        }

        const decrypted = await keymaster.loadWallet();
        const walletWeb = new WalletWeb();
        await walletWeb.saveWallet(decrypted, true);

        setIsEncrypted(false);
        backendKindRef.current = 'plain';
        setIsReady(false);
        setKeymaster(null);

        await buildKeymaster(walletWeb, keypassRef.current, 'keypass', 'plain');
        setModalAction(null);
    }

    function openKeypassModal() {
        setModalAction('keypass');
    }

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== null}
                title={
                    modalAction === 'decrypt'
                        ? 'Enter Your Wallet Passphrase'
                        : isFirstRun
                            ? 'Set a Passphrase'
                            : 'Enter a Passphrase'
                }
                errorText={passphraseErrorText}
                onSubmit={handlePassphraseSubmit}
                onClose={handleModalClose}
                encrypt={isFirstRun}
            />

            {cryptoError && (
                <Box my={2}>
                    <Alert severity="error">{cryptoError}</Alert>
                </Box>
            )}

            {isReady && keymaster && (
                <KeymasterUI
                    key={`km-${kmEpoch}`}
                    keymaster={keymaster}
                    title={'Keymaster Browser Wallet Demo'}
                    challengeDID={challengeDID}
                    encryption={
                        isCryptoAvailable
                            ? {
                                encryptWallet: encryptWallet,
                                decryptWallet: decryptWallet,
                                isWalletEncrypted: isEncrypted,
                                setKeypass: openKeypassModal,
                            }
                            : undefined
                    }
                />
            )}
        </>
    );
}

export default App;
