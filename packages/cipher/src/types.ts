import type HDKeyNode from 'hdkey';
import type HDKeyBrowser from '@mdip/browser-hdkey';

export interface HDKeyJSON {
    xpriv: string,
    xpub: string,
    chainCode?: string,
    depth?: number,
    index?: number,
    parentFingerprint?: number,
}

export interface EcdsaJwkPublic {
    kty: 'EC',
    crv: 'secp256k1',
    x: string,
    y: string,
}

export interface EcdsaJwkPrivate extends EcdsaJwkPublic {
    d: string,
}

export interface EcdsaJwkPair {
    publicJwk: EcdsaJwkPublic,
    privateJwk: EcdsaJwkPrivate,
}

export interface Cipher {
    generateMnemonic(): string,

    generateHDKey(mnemonic: string): HDKeyNode | HDKeyBrowser,
    generateHDKeyJSON(json: HDKeyJSON): HDKeyNode | HDKeyBrowser,

    generateJwk(privateKeyBytes: Uint8Array): EcdsaJwkPair,
    generateRandomJwk(): EcdsaJwkPair,
    convertJwkToCompressedBytes(jwk: EcdsaJwkPublic): Uint8Array,

    hashMessage(msg: string): string,
    hashJSON(obj: unknown): string,

    signHash(msgHash: string, privateJwk: EcdsaJwkPrivate): string,
    verifySig(msgHash: string, sigHex: string, publicJwk: EcdsaJwkPublic): boolean,

    encryptMessage(
        pubKey: EcdsaJwkPublic,
        privKey: EcdsaJwkPrivate,
        message: string,
    ): string,

    decryptMessage(
        pubKey: EcdsaJwkPublic,
        privKey: EcdsaJwkPrivate,
        ciphertext: string,
    ): string,
}
