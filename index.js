import axios from 'axios';
import { writeFileSync, readFileSync } from 'fs';
import { sign, webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import * as secp from '@noble/secp256k1';
import { base64url } from 'multiformats/bases/base64';
import { DID, generateKeyPair } from '@decentralized-identity/ion-tools';
import { IonRequest, LocalSigner } from '@decentralized-identity/ion-sdk';

async function sendRequest(request) {
    try {
        const getAnchor = await axios.post('http://localhost:3000/operations/', request);
        const anchor = getAnchor.data;

        console.log(`response: ${JSON.stringify(anchor, null, 4)}`);

        const getQueueSize = await axios.get('http://localhost:3000/monitor/operation-queue-size');
        const queueSize = getQueueSize.data;

        console.log(`queue size = ${JSON.stringify(queueSize, null, 4)}`);

    } catch (error) {
        console.log(error);
    }
}

async function createDid() {
    let authnKeys = await generateKeyPair();

    console.log(`keys: ${JSON.stringify(authnKeys, null, 4)}`);

    let did = new DID({
        content: {
            publicKeys: [
                {
                    id: 'key-1',
                    type: 'EcdsaSecp256k1VerificationKey2019',
                    publicKeyJwk: authnKeys.publicJwk,
                    purposes: ['authentication'],
                }
            ],
            services: [
                {
                    id: 'domain-1',
                    type: 'LinkedDomains',
                    serviceEndpoint: 'https://foo-10.com'
                }
            ]
        }
    });

    const shortform = await did.getURI('short');
    const longform = await did.getURI();
    const suffix = await did.getSuffix();

    // console.log(`DID short form: ${shortform}`);
    // console.log(`DID long form: ${longform}`);
    // console.log(`DID: ${JSON.stringify(did)}`);

    // Generate and publish create request to an ION node
    const createRequest = await did.generateRequest(0);
    console.log(`request: ${JSON.stringify(createRequest, null, 4)}`);

    const ionOps = await did.getAllOperations();
    console.log(`all ops: ${JSON.stringify(ionOps, null, 4)}`);

    writeFileSync(`did:mdip:test:${suffix}.json`, JSON.stringify(ionOps, null, 4));

    await sendRequest(createRequest);
}


async function updateDid(suffix) {
    let authnKeys = await generateKeyPair();

    const didJson = readFileSync(`did:mdip:test:${suffix}.json`);
    const ionOps = JSON.parse(didJson);
    // const did = new DID(ionOps);
    // const suffix = await did.getSuffix();

    const jwkEs256k1Public = ionOps[0].update.publicJwk;
    const jwkEs256k1Private = ionOps[0].update.privateJwk;
    const newServices = [
        {
            'id': 'some-service-2',
            'type': 'SomeServiceType',
            'serviceEndpoint': 'http://bar-99.com'
        }
    ];

    const input = {
        didSuffix: suffix,
        updatePublicKey: jwkEs256k1Public,
        nextUpdatePublicKey: authnKeys.publicJwk,
        signer: LocalSigner.create(jwkEs256k1Private),
        servicesToAdd: newServices,
        idsOfServicesToRemove: ['domain-1'],
        publicKeysToAdd: [],
        idsOfPublicKeysToRemove: []
    };

    const updateRequest = await IonRequest.createUpdateRequest(input);
    console.log(`result: ${JSON.stringify(updateRequest, null, 4)}`);

    await sendRequest(updateRequest);
}

// https://www.npmjs.com/package/@noble/secp256k1
async function testNoble() {
    // keys, messages & other inputs can be Uint8Arrays or hex strings
    // Uint8Array.from([0xde, 0xad, 0xbe, 0xef]) === 'deadbeef'
    const privKey = secp.utils.randomPrivateKey(); // Secure random private key
    // sha256 of 'hello world'
    const msgHash = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    const pubKey = secp.getPublicKey(privKey); // Make pubkey from the private key
    const signature = await secp.signAsync(msgHash, privKey); // sign
    const isValid = secp.verify(signature, msgHash, pubKey); // verify

    const alicesPubkey = secp.getPublicKey(secp.utils.randomPrivateKey()); // Key of user 2
    secp.getSharedSecret(privKey, alicesPubkey); // Elliptic curve diffie-hellman
    signature.recoverPublicKey(msgHash); // Public key recovery
}

function convertJwkToCompressedBytes(jwk) {
    const xBytes = base64url.baseDecode(jwk.x);
    const yBytes = base64url.baseDecode(jwk.y);

    // Determine the prefix (02 for even y, 03 for odd y)
    const prefix = yBytes[yBytes.length - 1] % 2 === 0 ? 0x02 : 0x03;

    // Construct compressed key
    return new Uint8Array([prefix, ...xBytes]);
}

async function verifySig(msgHash, sigHex, publicJwk) {
    const compressedPublicKeyBytes = convertJwkToCompressedBytes(publicJwk);
    const signature = secp.Signature.fromCompact(sigHex);
    const isValid = secp.verify(signature, msgHash, compressedPublicKeyBytes);

    console.log(`verifySig: isValid = ${isValid}`);
}

async function testKey() {

    const privateJwk = {
        "kty": "EC",
        "crv": "secp256k1",
        "x": "889-k_5GwpIez8JxY9QISTqYJgrUSdH8Tnraww4cUNU",
        "y": "lR9XH9a_kTp5Teq50yc4lOS3Z7JPzdbkQJXblNeqegM",
        "d": "PDUvET8S_aCq5HinMHBYtWjuarhM6A4qzT9auqwwxEE"
    };

    const privateKeyBytes = base64url.baseDecode(privateJwk.d);

    const compressedPublicKeyBytes = secp.getPublicKey(privateKeyBytes);
    const compressedPublicKeyHex = secp.etc.bytesToHex(compressedPublicKeyBytes);
    const curvePoints = secp.ProjectivePoint.fromHex(compressedPublicKeyHex);
    const uncompressedPublicKeyBytes = curvePoints.toRawBytes(false); // false = uncompressed
    // we need uncompressed public key so that it contains both the x and y values for the JWK format:
    // the first byte is a header that indicates whether the key is uncompressed (0x04 if uncompressed).
    // bytes 1 - 32 represent X
    // bytes 33 - 64 represent Y
    const d = base64url.baseEncode(privateKeyBytes);
    // skip the first byte because it's used as a header to indicate whether the key is uncompressed
    const x = base64url.baseEncode(uncompressedPublicKeyBytes.subarray(1, 33));
    const y = base64url.baseEncode(uncompressedPublicKeyBytes.subarray(33, 65));

    const publicJwk = {
        // alg: 'ES256K',
        kty: 'EC',
        crv: 'secp256k1',
        x,
        y
    };

    console.log(JSON.stringify(publicJwk, null, 4));

    const msgHash = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    const signature = await secp.signAsync(msgHash, privateKeyBytes); // sign
    const sigHex = signature.toCompactHex();
    const isValid = secp.verify(signature, msgHash, compressedPublicKeyBytes); // verify

    console.log(`sig is valid = ${isValid}`);

    verifySig(msgHash, sigHex, publicJwk);
}

//createDid();
updateDid('EiD_u_9devpuQr7fAYHdrb_AGXPAm-r9bPOHfwxXACASWw');
//testNoble();
//testKey();
