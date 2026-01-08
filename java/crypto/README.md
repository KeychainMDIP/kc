# Keymaster Crypto (Java)

This module provides crypto primitives compatible with the JS implementation in
`packages/cipher/src/cipher-base.ts` and mnemonic encryption in
`packages/keymaster/src/encryption.ts`.

## Goals
- Byte-for-byte compatibility with JS signing, encryption, and hashing
- Pure-Java dependencies (Android + server JVM)
- Minimal, reusable API surface for Keymaster/Gatekeeper

## Encodings
- Base64url: URL-safe, no padding
- Base64: standard padded (used for mnemonic encryption fields)
- Hashes: lowercase hex
- JWK fields: base64url (no padding)

## Dependencies
- Bouncy Castle (secp256k1 + ECDH)
- Tink (XChaCha20-Poly1305)
- BIP39/BIP32 (mnemonic + derivation)
- RFC8785 canonical JSON
- Jackson (JSON mapping)

## Compatibility Rules
- ECDSA signatures are compact 64-byte (r||s) hex
- Shared secret key for XChaCha20-Poly1305 is derived from the first 32 bytes of
  the compressed ECDH point (prefix byte + 31 bytes of X)
- XChaCha20-Poly1305 ciphertext is nonce-prefixed: nonce || ciphertext
- Mnemonic encryption: PBKDF2-HMAC-SHA512, 100k iterations, AES-256-GCM,
  16-byte salt, 12-byte IV, base64-encoded fields

## Test Vectors
Populate `src/test/resources/vectors/crypto-v1.json` using JS reference output.
The `CryptoVectorsTest` test will fail until vectors are filled.
