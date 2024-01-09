import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { managedNonce } from '@noble/ciphers/webcrypto/utils'
import { hexToBytes, utf8ToBytes } from '@noble/ciphers/utils';

import * as secp from '@noble/secp256k1';

function test1() {
    const key = hexToBytes('fa686bfdffd3758f6377abbc23bf3d9bdc1a0dda4a6e7f8dbdd579fa1ff6d7e1');
    const chacha = managedNonce(xchacha20poly1305)(key); // manages nonces for you
    const data = utf8ToBytes('hello, noble');
    const ciphertext = chacha.encrypt(data);
    const data_ = chacha.decrypt(ciphertext);

    console.log(data);
    console.log(ciphertext);
    console.log(data_);
}

function test2() {

}

test1();
