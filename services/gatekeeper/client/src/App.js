import { Buffer } from 'buffer';
import React, { useState, useEffect } from 'react';
import { Alert, Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import * as gatekeeper from '@mdip/gatekeeper/sdk';
import * as cipher from '@mdip/cipher/web';
import * as keymaster from '@mdip/keymaster/lib';
import * as wallet_web from "@mdip/keymaster/db/web";
import * as wallet_enc from "@mdip/keymaster/db/web/enc";
import * as db_wallet_cache from '@mdip/keymaster/db/cache/async';
import KeymasterUI from './KeymasterUI.js';
import PassphraseModal from './PassphraseModal.js';
import './App.css';

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

            const walletData = await wallet_web.loadWallet();

            if (walletData && walletData.salt && walletData.iv && walletData.data) {
                if (!cryptoAvailable) {
                    setCryptoError('Wallet is encrypted but environment is not secure. Please connect via a secure connection or localhost.');
                    return;
                }
                setIsEncrypted(true);
                setModalAction('decrypt');
            } else {
                keymaster.start({ gatekeeper, wallet: wallet_web, cipher });
                setIsReady(true);
            }
        }

        initializeWallet();
    }, []);

    async function handlePassphraseSubmit(passphrase) {
        wallet_enc.setPassphrase(passphrase);
        wallet_enc.setWallet(wallet_web);
        db_wallet_cache.setWallet(wallet_enc);

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

        await keymaster.start({ gatekeeper, wallet: db_wallet_cache, cipher });

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
        wallet_web.saveWallet(wallet, true);
        await keymaster.start({ gatekeeper, wallet: wallet_web, cipher });
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
