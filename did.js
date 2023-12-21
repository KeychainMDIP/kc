// node.js 18 and earlier, needs globalThis.crypto polyfill
import { webcrypto } from 'node:crypto';
// @ts-ignore
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { anchor, DID, generateKeyPair, resolve } from '@decentralized-identity/ion-tools';
import { writeFile } from 'fs/promises';

async function createDid() {

    // Generate keys and ION DID
    let authnKeys = await generateKeyPair();
    let did = new DID({
        content: {
            publicKeys: [
                {
                    id: 'key-1',
                    type: 'EcdsaSecp256k1VerificationKey2019',
                    publicKeyJwk: authnKeys.publicJwk,
                    purposes: ['authentication']
                }
            ],
            services: [
                {
                    id: 'domain-1',
                    type: 'LinkedDomains',
                    serviceEndpoint: 'https://foo.example.com'
                }
            ]
        }
    });

    return did;
}

async function testResolve() {

    let response = await resolve('did:ion:test:EiClWZ1MnE8PHjH6y4e4nCKgtKnI1DK1foZiP61I86b6pw', {
        nodeEndpoint: 'http://localhost:3000/identifiers/',
    });

    console.log(response);
}

export {
    createDid,
    testResolve,
};
