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

const detectWalletType = (w) => {
    if (!w || typeof w !== 'object') {
        return 'unknown';
    }
    if (isEncryptedBlob(w)) {
        return 'blob-enc';
    }
    const v = w.version;
    if (v === 1) {
        const hasTopLevelSeal = typeof w.enc === 'string';
        const hasMnemonicEnc = w.seed && w.seed.mnemonicEnc && typeof w.seed.mnemonicEnc.data === 'string';
        if (hasTopLevelSeal) {
            return 'v1enc';
        }
        if (hasMnemonicEnc) {
            return 'v1plain';
        }
        return 'unknown';
    }
    const hasV0Mnemonic = w.seed && typeof w.seed.mnemonic === 'string';
    if (hasV0Mnemonic) {
        return 'v0plain';
    }
    return 'unknown';
};

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
    const [pendingAction, setPendingAction] = useState(null);
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

    async function rebuildEncWithPass(passphrase) {
        const walletWeb = new WalletWeb();
        const walletEnc = new WalletWebEncrypted(walletWeb, passphrase);
        const walletCached = new WalletCache(walletEnc);
        await buildKeymaster(walletCached, passphrase, 'upload', 'enc', true);
        setIsEncrypted(true);
    }

    async function handlePassphraseSubmit(passphrase) {
        setPassphraseErrorText(null);
        const walletWeb = new WalletWeb();

        if (modalAction === 'decrypt') {
            if (pendingAction === 'upload-plain-v1') {
                try {
                    const km = new Keymaster({ gatekeeper, wallet: walletWeb, cipher, search, passphrase });
                    await km.decryptMnemonic();
                    const cur = await km.loadWallet();
                    await km.saveWallet(cur, true);
                    await rebuildEncWithPass(passphrase);
                    setPendingAction(null);
                    setModalAction(null);
                    return;
                } catch {
                    setPassphraseErrorText('Incorrect passphrase');
                    return;
                }
            }

            const walletEnc = new WalletWebEncrypted(walletWeb, passphrase);
            const walletCached = new WalletCache(walletEnc);
            try {
                const decrypted = await walletEnc.loadWallet();
                if (pendingAction === 'upload-enc') {
                    if (decrypted && decrypted.version === 1) {
                        await walletEnc.saveWallet(decrypted, true);
                        const km = new Keymaster({ gatekeeper, wallet: walletWeb, cipher, search, passphrase });
                        const cur = await km.loadWallet();
                        await km.saveWallet(cur, true);
                        await rebuildEncWithPass(passphrase);
                        setPendingAction(null);
                        setModalAction(null);
                        return;
                    } else {
                        await walletEnc.saveWallet(decrypted, true);
                        setIsEncrypted(false);
                        setPendingAction('upload-plain-upgrade');
                        setModalAction('keypass');
                        return;
                    }
                }
                await buildKeymaster(walletCached, passphrase, 'decrypt', 'enc', true);
                setIsEncrypted(true);
                setModalAction(null);
                return;
            } catch {
                setPassphraseErrorText('Incorrect passphrase');
                return;
            }
        }

        const data = await walletWeb.loadWallet();

        if (pendingAction === 'upload-plain-upgrade') {
            try {
                const km = new Keymaster({ gatekeeper, wallet: walletWeb, cipher, search, passphrase });
                await km.loadWallet();
                const cur = await walletWeb.loadWallet();
                await km.saveWallet(cur, true);
                await rebuildEncWithPass(passphrase);
                setPendingAction(null);
                setModalAction(null);
                return;
            } catch {
                setPassphraseErrorText('Could not set passphrase');
                return;
            }
        }

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

    async function handleWalletUploadFile(uploaded) {
        try {
            const kind = detectWalletType(uploaded);

            const walletWeb = new WalletWeb();
            await walletWeb.saveWallet(uploaded, true);

            const tryDecryptWithKnownPass = async () => {
                if (!keypassRef.current) {
                    setPendingAction('upload-enc');
                    setModalAction('decrypt');
                    return;
                }
                try {
                    const walletEnc = new WalletWebEncrypted(walletWeb, keypassRef.current);
                    const dec = await walletEnc.loadWallet();
                    if (dec && dec.version === 1) {
                        await rebuildEncWithPass(keypassRef.current);
                        setPendingAction(null);
                        setModalAction(null);
                    } else {
                        await walletEnc.saveWallet(dec, true);
                        const km = new Keymaster({ gatekeeper, wallet: walletWeb, cipher, search, passphrase: keypassRef.current });
                        const cur = await km.loadWallet();
                        await km.saveWallet(cur, true);
                        await rebuildEncWithPass(keypassRef.current);
                        setPendingAction(null);
                        setModalAction(null);
                    }
                } catch {
                    setPendingAction('upload-enc');
                    setModalAction('decrypt');
                }
            };

            switch (kind) {
            case 'v0plain': {
                setPendingAction('upload-plain-upgrade');
                setModalAction('set-passphrase');
                break;
            }
            case 'v1plain': {
                let upgraded = false;
                if (keypassRef.current) {
                    try {
                        const km = new Keymaster({ gatekeeper, wallet: walletWeb, cipher, search, passphrase: keypassRef.current });
                        await km.decryptMnemonic();
                        const cur = await km.loadWallet();
                        await km.saveWallet(cur, true);
                        await rebuildEncWithPass(keypassRef.current);
                        setPendingAction(null);
                        setModalAction(null);
                        upgraded = true;
                    } catch {}
                }
                if (!upgraded) {
                    setPendingAction('upload-plain-v1');
                    setModalAction('decrypt');
                }
                break;
            }
            case 'v1enc':
            case 'blob-enc': {
                await tryDecryptWithKnownPass();
                break;
            }
            default: {
                window.alert('Unsupported wallet type');
                break;
            }
            }

            setKmEpoch((e) => e + 1);
        } catch (err) {
            setCryptoError(String(err?.message || err));
        }
    }

    function handleModalClose() {
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
                encrypt={isFirstRun || modalAction === 'set-passphrase'}
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
                    onWalletUpload={handleWalletUploadFile}
                />
            )}
        </>
    );
}

export default App;
