import { Buffer } from 'buffer';
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as gatekeeper from '@mdip/gatekeeper/sdk';
import * as cipher from '@mdip/cipher/web';
import * as keymaster from '@mdip/keymaster/lib';
import * as wallet_web from "@mdip/keymaster/db/web";
import * as wallet_enc from "@mdip/keymaster/db/web/enc";
import * as db_wallet_cache from '@mdip/keymaster/db/cache/async';
import KeymasterUI from './KeymasterUI.js';
import PassphraseModal from './passphraseModal';
import './App.css';

global.Buffer = Buffer;

function App() {
    const [searchParams] = useSearchParams();
    const challengeDID = searchParams.get('challenge');
    const [isReady, setIsReady] = useState(false);
    const [modalAction, setModalAction] = useState(null);
    const [isEncrypted, setIsEncrypted] = useState(false);
    const [errorText, setErrorText] = useState(null);

    useEffect(() => {
        async function initializeWallet() {
            const walletData = await wallet_web.loadWallet();

            if (walletData && walletData.salt && walletData.iv && walletData.data) {
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
                setErrorText('Incorrect passphrase');
                return;
            }
        }

        await keymaster.start({ gatekeeper, wallet: db_wallet_cache, cipher });

        setIsReady(true);
        setModalAction(null);
        setIsEncrypted(true);
        setErrorText(null);
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

    if (!isReady && !modalAction) {
        return;
    }

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== null}
                title={modalAction === 'decrypt' ? "Enter Your Wallet Passphrase" : "Set Your Wallet Passphrase"}
                errorText={errorText}
                onSubmit={handlePassphraseSubmit}
                onClose={handleModalClose}
            />
            {isReady && (
                <KeymasterUI
                    keymaster={keymaster}
                    title={'Keymaster Browser Wallet Demo'}
                    challengeDID={challengeDID}
                    encryptWallet={openEncryptModal}
                    decryptWallet={decryptWallet}
                    isWalletEncrypted={isEncrypted}
                />
            )}
        </>
    );
}

export default App;
