import { Buffer } from 'buffer';
import { useSearchParams } from 'react-router-dom';
import * as gatekeeper from '@mdip/gatekeeper/sdk';
import * as cipher from '@mdip/cipher/web';
import * as keymaster from '@mdip/keymaster/lib';
import * as wallet_web from "@mdip/keymaster/db/web";
import * as wallet_enc from "@mdip/keymaster/db/json/enc";
import KeymasterUI from './KeymasterUI.js';
import './App.css';

global.Buffer = Buffer;

function App() {
    const [searchParams] = useSearchParams();
    const challengeDID = searchParams.get('challenge');

    let wallet = wallet_web;
    let walletData = wallet.loadWallet()

    if (walletData && walletData.salt && walletData.iv && walletData.data) {
        const passphrase = prompt("Enter your wallet passphrase:");
        wallet_enc.setPassphrase(passphrase);
        wallet_enc.setWallet(wallet_web);
        wallet = wallet_enc;
    }

    keymaster.start({ gatekeeper, wallet, cipher });

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
