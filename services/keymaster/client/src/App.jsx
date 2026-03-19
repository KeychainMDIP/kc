import KeymasterClient from '@mdip/keymaster/client';
import KeymasterUI from './KeymasterUI';
import './App.css';

function isMdipWalletBundle(wallet) {
    return !!wallet
        && typeof wallet === 'object'
        && wallet.version === 1
        && wallet.type === 'mdip-wallet-bundle'
        && !!wallet.keymaster
        && !!wallet.provider;
}

function isV2Wallet(wallet) {
    return !!wallet
        && typeof wallet === 'object'
        && wallet.version === 2
        && !!wallet.provider
        && typeof wallet.ids === 'object';
}

function downloadJson(filename, data) {
    const walletJSON = JSON.stringify(data, null, 4);
    const blob = new Blob([walletJSON], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);
}

function App() {
    const keymaster = new KeymasterClient();

    async function handleWalletUpload(wallet) {
        if (isMdipWalletBundle(wallet)) {
            await keymaster.importWalletBundle(wallet);
            return;
        }

        if (isV2Wallet(wallet)) {
            window.alert('Standalone keymaster metadata is not enough. Upload an mdip-wallet-bundle instead.');
            return;
        }

        await keymaster.saveWallet(wallet, true);
        await keymaster.loadWallet();
    }

    async function handleWalletDownload() {
        const bundle = await keymaster.exportWalletBundle();
        downloadJson('mdip-wallet-bundle.json', bundle);
    }

    return (
        <KeymasterUI
            keymaster={keymaster}
            title={'Keymaster Server Wallet Demo'}
            onWalletUpload={handleWalletUpload}
            onWalletDownload={handleWalletDownload}
        />
    );
}

export default App;
