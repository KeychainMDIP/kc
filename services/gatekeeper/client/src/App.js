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
import './App.css';

global.Buffer = Buffer;

function App() {
    const [searchParams] = useSearchParams();
    const challengeDID = searchParams.get('challenge');
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        async function initializeWallet() {
            let wallet = wallet_web;
            const walletData = await wallet.loadWallet();

            if (walletData && walletData.salt && walletData.iv && walletData.data) {
                const passphrase = prompt("Enter your wallet passphrase:");
                wallet_enc.setPassphrase(passphrase);
                wallet_enc.setWallet(wallet_web);
                db_wallet_cache.setWallet(wallet_enc);
                wallet = db_wallet_cache;
            }

            keymaster.start({ gatekeeper, wallet, cipher });
            setIsReady(true);
        }

        initializeWallet();
    }, []);

    if (!isReady) {
        return;
    }

    return (
        <KeymasterUI
            keymaster={keymaster}
            title={'Keymaster Browser Wallet Demo'}
            challengeDID={challengeDID}
            wallet_web={wallet_web}
            wallet_enc={wallet_enc}
            gatekeeper={gatekeeper}
            cipher={cipher}
        />
    );
}

export default App;
