import KeymasterClient from '@mdip/keymaster/client';
import type { MdipWalletBundle, StoredWallet } from '@mdip/keymaster/types';
import KeymasterUI from './KeymasterUI';
import './App.css';

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

function isMdipWalletBundle(wallet: unknown): wallet is MdipWalletBundle {
    return isRecord(wallet)
        && wallet.version === 1
        && wallet.type === 'mdip-wallet-bundle'
        && !!wallet.keymaster
        && !!wallet.provider;
}

function isV2Wallet(wallet: unknown): boolean {
    return isRecord(wallet)
        && wallet.version === 2
        && !!wallet.provider
        && typeof wallet.ids === 'object';
}

function downloadJson(filename: string, data: unknown) {
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

    async function handleWalletUpload(wallet: unknown) {
        if (isMdipWalletBundle(wallet)) {
            await keymaster.importWalletBundle(wallet);
            return;
        }

        if (isV2Wallet(wallet)) {
            window.alert('Standalone keymaster metadata is not enough. Upload an mdip-wallet-bundle instead.');
            return;
        }

        await keymaster.saveWallet(wallet as StoredWallet);
        await keymaster.loadWallet();
    }

    async function handleShowMnemonic() {
        return keymaster.decryptMnemonic();
    }

    async function handleCreateWallet() {
        await keymaster.newWallet(undefined, true);
    }

    async function handleImportMnemonic(mnemonic: string) {
        await keymaster.newWallet(mnemonic, true);
        await keymaster.recoverWallet();
    }

    async function handleWalletDownload() {
        const bundle = await keymaster.exportWalletBundle();
        downloadJson('mdip-wallet-bundle.json', bundle);
    }

    return (
        <KeymasterUI
            keymaster={keymaster}
            title={'Keymaster Server Wallet Demo'}
            challengeDID={null}
            onWalletUpload={handleWalletUpload}
            onShowMnemonic={handleShowMnemonic}
            onCreateWallet={handleCreateWallet}
            onImportMnemonic={handleImportMnemonic}
            onWalletDownload={handleWalletDownload}
        />
    );
}

export default App;
