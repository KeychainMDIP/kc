import { Buffer } from 'buffer';
import React, { useState, useEffect } from 'react';
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

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

const { protocol, hostname } = window.location;
const search = await SearchClient.create({ url: `${protocol}//${hostname}:4002` });

let keymaster;

global.Buffer = Buffer;

function App() {
    const [searchParams] = useSearchParams();
    const challengeDID = searchParams.get('challenge');
    const [isReady, setIsReady] = useState(false);
    const [modalAction, setModalAction] = useState(null);
    const [isEncrypted, setIsEncrypted] = useState(false);
    const [passphraseErrorText, setPassphraseErrorText] = useState(null);
    const [isCryptoAvailable, setIsCryptoAvailable] = useState(false);
    const [cryptoError, setCryptoError] = useState('');

    useEffect(() => {
        async function initializeWallet() {

            const cryptoAvailable = window.crypto && window.crypto.subtle;
            setIsCryptoAvailable(!!cryptoAvailable);

            const wallet_web = new WalletWeb();
            const walletData = await wallet_web.loadWallet();

            if (walletData && walletData.salt && walletData.iv && walletData.data) {
                if (!cryptoAvailable) {
                    setCryptoError('Wallet is encrypted but environment is not secure. Please connect via a secure connection or localhost.');
                    return;
                }
                setIsEncrypted(true);
                setModalAction('decrypt');
            } else {
                keymaster = new Keymaster({ gatekeeper, wallet: wallet_web, cipher, search });
                setIsReady(true);
            }
        }

        initializeWallet();
    }, []);

    async function handlePassphraseSubmit(passphrase) {
        const wallet_web = new WalletWeb();
        const wallet_enc = new WalletWebEncrypted(wallet_web, passphrase);
        const wallet_cache = new WalletCache(wallet_enc);

        if (modalAction === 'encrypt') {
            const walletData = await wallet_web.loadWallet();
            await wallet_enc.saveWallet(walletData, true);
        } else {
            try {
                await wallet_enc.loadWallet();
            } catch (e) {
                setPassphraseErrorText('Incorrect passphrase');
                return;
            }
        }

        keymaster = new Keymaster({ gatekeeper, wallet: wallet_cache, cipher, search });

        setIsReady(true);
        setModalAction(null);
        setIsEncrypted(true);
        setPassphraseErrorText(null);
    }

    function handleModalClose() {
        setModalAction(null);
    }

    function openEncryptModal() {
        setModalAction('encrypt');
    }

    async function decryptWallet() {
        const wallet = await keymaster.loadWallet();
        const wallet_web = new WalletWeb();

        wallet_web.saveWallet(wallet, true);
        keymaster = new Keymaster({ gatekeeper, wallet: wallet_web, cipher, search });
        setIsEncrypted(false);
    }

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== null}
                title={modalAction === 'decrypt' ? "Enter Your Wallet Passphrase" : "Set Your Wallet Passphrase"}
                errorText={passphraseErrorText}
                onSubmit={handlePassphraseSubmit}
                onClose={handleModalClose}
            />

            {cryptoError && (
                <Box my={2}>
                    <Alert severity="error">
                        {cryptoError}
                    </Alert>
                </Box>
            )}

            {isReady && (
                <KeymasterUI
                    keymaster={keymaster}
                    title={'Keymaster Browser Wallet Demo'}
                    challengeDID={challengeDID}
                    encryption={
                        isCryptoAvailable
                            ? {
                                encryptWallet: openEncryptModal,
                                decryptWallet: decryptWallet,
                                isWalletEncrypted: isEncrypted,
                            }
                            : undefined
                    }
                />
            )}

        </>
    );
}

export default App;
