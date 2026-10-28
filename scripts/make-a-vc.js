import GatekeeperClient from '@mdip/gatekeeper/client';
import WalletJson from '@mdip/keymaster/wallet/json';
import CipherNode from '@mdip/cipher/node';
import Keymaster from '@mdip/keymaster';
import { loadEnv } from '@mdip/common/env';

loadEnv();

const gatekeeper = new GatekeeperClient();
await gatekeeper.connect({
    url: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    waitUntilReady: true,
    intervalSeconds: 5,
    chatty: true,
});
const wallet = new WalletJson();
const cipher = new CipherNode();
const passphrase = 'SuperSecurePassphrase';
const keymaster = new Keymaster({
    gatekeeper,
    wallet,
    cipher,
    passphrase,
    didPrefix: 'did:test'
});

const names = await keymaster.listNames({includeIDs:true});
console.log(`names: ${JSON.stringify(names, null, 2)}`)
const issuer =  names.hasOwnProperty('bob') ? names['bob'] : await keymaster.createId('bob');
console.log(`issuer: ${issuer}`);

const subject = names.hasOwnProperty('alice') ? names['alice'] : await keymaster.createId('alice');
console.log(`issuer: ${subject}`);

await keymaster.setCurrentId('bob');

const mockSchema = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "properties": {
        "aNumber": {
            "type": "number"
        },
        "aString": {
            "type": "string"
        }
    },
    "required": [
        "aNumber",
        "aString"
    ],
    "type": "object"
};

const schema = await keymaster.createSchema(mockSchema)
console.log(`Schema: ${schema}`)
const schemaDoc = await keymaster.getSchema(schema)
console.log(`${JSON.stringify(schemaDoc, null, 2)}`)

const bound = await keymaster.bindCredential(schema, subject);
bound.credential.aNumber = 4
bound.credential.aString = 'foobar'
bound.validUntil = "2099-01-01T00:00:00.000Z"
bound['@context'].push(schema)
console.log(`bound: ${JSON.stringify(bound, null, 2)}`)

const vcdid = await keymaster.issueCredential(bound);
console.log(`vcdid: ${vcdid}`);


keymaster.setCurrentId('alice')
const vc = await keymaster.getCredential(vcdid);
console.log(`vc: ${JSON.stringify(vc, null, 2)}`)

keymaster.setCurrentId('bob')
const evmCredential = await keymaster.createEvmCredential(vc, {});
console.log(`evmCredential: ${JSON.stringify(evmCredential, null, 2)}`)

