import Gatekeeper from '@mdip/gatekeeper';
import Keymaster from '@mdip/keymaster';
import type { SearchEngine, WalletProviderStore } from '@mdip/keymaster/types';
import CipherNode from '@mdip/cipher/node';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';
import MnemonicHdWalletProvider from '../../packages/keymaster/src/provider/mnemonic-hd.ts';

type CryptoLike = typeof globalThis.crypto | undefined;

export const TEST_PASSPHRASE = 'passphrase';

export function createProviderStore(): WalletProviderStore {
    return new WalletJsonMemory() as unknown as WalletProviderStore;
}

export function createMnemonicWalletProvider(
    cipher: CipherNode,
    passphrase: string = TEST_PASSPHRASE,
    store: WalletProviderStore = createProviderStore(),
): MnemonicHdWalletProvider {
    return new MnemonicHdWalletProvider({ store, cipher, passphrase });
}

export function createTestKeymaster(
    gatekeeper: Gatekeeper,
    cipher: CipherNode,
    options: {
        store?: WalletJsonMemory;
        providerStore?: WalletProviderStore;
        passphrase?: string;
        defaultRegistry?: string;
        search?: SearchEngine;
    } = {},
) {
    const store = options.store ?? new WalletJsonMemory();
    const providerStore = options.providerStore ?? createProviderStore();
    const walletProvider = createMnemonicWalletProvider(cipher, options.passphrase, providerStore);
    const keymaster = new Keymaster({
        gatekeeper,
        store,
        walletProvider,
        cipher,
        defaultRegistry: options.defaultRegistry,
        search: options.search,
    });

    return { keymaster, store, providerStore, walletProvider };
}

export function disableSubtle(): () => void {
    const originalDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const originalCrypto: CryptoLike = originalDesc?.value;

    const mockCrypto: any = { ...originalCrypto };

    Object.defineProperty(globalThis, 'crypto', { value: mockCrypto, configurable: true });
    return () => {
        Object.defineProperty(globalThis, 'crypto', originalDesc!);
    };
}
