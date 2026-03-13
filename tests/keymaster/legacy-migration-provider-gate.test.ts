import Keymaster from '@mdip/keymaster';
import type {
    LegacyWalletFile,
    WalletProvider,
    WalletProviderKey,
} from '@mdip/keymaster/types';
import type { EcdsaJwkPublic } from '@mdip/cipher/types';
import WalletJsonMemory from '@mdip/keymaster/wallet/json-memory';

const gatekeeper = {
    createDID: async () => 'did:test:stub',
    listRegistries: async () => [],
} as any;

const cipher = {
    verifySig: () => true,
} as any;

class DummyWalletProvider implements WalletProvider {
    readonly type = 'dummy';
    called = false;

    private fail(): never {
        this.called = true;
        throw new Error('provider should not be called');
    }

    async getFingerprint(): Promise<string> {
        return this.fail();
    }

    async resetWallet(_overwrite: boolean = false): Promise<void> {
        return this.fail();
    }

    async createIdKey(): Promise<WalletProviderKey> {
        return this.fail();
    }

    async getPublicKey(_keyRef: string): Promise<EcdsaJwkPublic> {
        return this.fail();
    }

    async signDigest(_keyRef: string, _digest: string): Promise<string> {
        return this.fail();
    }

    async encrypt(_keyRef: string, _receiver: EcdsaJwkPublic, _plaintext: string): Promise<string> {
        return this.fail();
    }

    async decrypt(_keyRef: string, _sender: EcdsaJwkPublic, _ciphertext: string): Promise<string> {
        return this.fail();
    }

    async rotateKey(_keyRef: string): Promise<{ publicJwk: EcdsaJwkPublic }> {
        return this.fail();
    }

}

const legacyWallet: LegacyWalletFile = {
    version: 1,
    seed: {
        mnemonicEnc: {
            salt: 'salt',
            iv: 'iv',
            data: 'data',
        },
    },
    counter: 1,
    ids: {
        alice: {
            did: 'did:test:alice',
            account: 0,
            index: 0,
        },
    },
    current: 'alice',
};

describe('legacy wallet migration provider gate', () => {
    it('rejects legacy wallets when the active provider is not MnemonicHdWalletProvider', async () => {
        const store = new WalletJsonMemory();
        const provider = new DummyWalletProvider();

        await store.saveWallet(legacyWallet, true);

        const keymaster = new Keymaster({
            gatekeeper,
            store,
            walletProvider: provider,
            cipher,
        });

        await expect(keymaster.loadWallet()).rejects.toThrow(
            'Keymaster: Legacy wallet migration requires MnemonicHdWalletProvider.'
        );
        expect(provider.called).toBe(false);
        expect(await store.loadWallet()).toEqual(legacyWallet);
    });
});
