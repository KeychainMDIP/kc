import * as bip39 from 'bip39';
import { base64url } from 'multiformats/bases/base64';
import CipherBase from './cipher-base.js';
import { Cipher, HDKeyJSON } from './types.js';
import HDKeyBrowser from '@mdip/browser-hdkey';

export default class CipherWeb extends CipherBase implements Cipher {
    generateHDKey(mnemonic: string): HDKeyBrowser {
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        return HDKeyBrowser.fromMasterSeed(seed);
    }

    generateHDKeyJSON(json: HDKeyJSON): HDKeyBrowser {
        return HDKeyBrowser.fromJSON(json);
    }

    generateRandomSalt(): string {
        const array = new Uint8Array(32);
        if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(array);
        } else if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
            globalThis.crypto.getRandomValues(array);
        } else {
            throw new Error('No secure random number generator available.');
        }
        return base64url.encode(array);
    }
}
