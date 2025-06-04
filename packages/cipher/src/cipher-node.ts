import * as bip39 from 'bip39';
import { base64url } from 'multiformats/bases/base64';
import { randomBytes } from 'crypto';
import HDKeyNode from 'hdkey';
import CipherBase from './cipher-base.js';
import { Cipher, HDKeyJSON } from './types.js';

export default class CipherNode extends CipherBase implements Cipher {
    generateHDKey(mnemonic: string): HDKeyNode {
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        return HDKeyNode.fromMasterSeed(seed);
    }

    generateHDKeyJSON(json: HDKeyJSON): HDKeyNode {
        return HDKeyNode.fromJSON(json);
    }

    generateRandomSalt(): string {
        return base64url.encode(randomBytes(32));
    }
}
