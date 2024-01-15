#!/usr/bin/env node

import { program } from 'commander';
import fs from 'fs';
import * as bip39 from 'bip39';
import HDKey from 'hdkey';
import * as keychain from './keychain.js';
import * as cipher from './cipher.js';

const walletName = 'wallet.json';
const wallet = loadWallet() || initializeWallet();

function loadWallet() {
    if (fs.existsSync(walletName)) {
        const walletJson = fs.readFileSync(walletName);
        return JSON.parse(walletJson);
    }
}

function saveWallet(wallet) {
    fs.writeFileSync(walletName, JSON.stringify(wallet, null, 4));
}

function initializeWallet() {

    if (fs.existsSync(walletName)) {
        return 'Wallet already initialized';
    }

    const mnemonic = bip39.generateMnemonic();
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const hdkey = HDKey.fromMasterSeed(seed);
    const wallet = {
        seed: {
            mnemonic: mnemonic,
            hdkey: hdkey.toJSON(),
        },
        counter: 0,
        ids: {},
    }

    saveWallet(wallet);
    return wallet;
}

async function createId(name) {
    if (wallet.ids && wallet.ids.hasOwnProperty(name)) {
        return `Already have an ID named ${name}`;
    }

    const account = wallet.counter;
    const index = 0;
    const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${account}'/0/${index}`;
    const didkey = hdkey.derive(path);
    const keypair = generateJwk(didkey.privateKey);
    const did = await keychain.generateDid(keypair.publicJwk);
    const doc = await keychain.resolveDid(did);
    const didobj = {
        did: did,
        doc: JSON.parse(doc),
        account: account,
        index: index,
    };

    wallet.ids[name] = didobj;

    wallet.counter += 1;
    wallet.current = name;

    saveWallet(wallet);
    console.log(did);
}

function listIds() {
    for (let id of Object.keys(wallet.ids)) {
        if (id === wallet.current) {
            console.log(id, ' <<< current');
        }
        else {
            console.log(id);
        }
    }
}

function useId(name) {
    if (wallet.ids.hasOwnProperty(name)) {
        wallet.current = name;
        saveWallet(wallet);
        listIds();
    }
    else {
        console.log(`No ID named ${name}`);
    }
}

async function encrypt(msg, did) {
    console.log(`encrypt "${msg}" for ${did}`);

    if (!wallet.current) {
        console.log("No current ID");
        return;
    }

    const id = wallet.ids[wallet.current];
    const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${id.account}'/0/${id.index}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);
    const diddoc = await keychain.resolveDid(did);
    const doc = JSON.parse(diddoc);
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const ciphertext = cipher.encryptMessage(publicJwk, keypair.privateJwk, msg);
    const cipherDid = await keychain.generateDid({
        origin: id.did,
        ciphertext: ciphertext,
    });

    console.log(cipherDid);
}

async function decrypt(did) {
    console.log(`decrypt ${did}`);

    if (!wallet.current) {
        console.log("No current ID");
        return;
    }

    const dataDocJson = await keychain.resolveDid(did);
    const dataDoc = JSON.parse(dataDocJson);
    const origin = dataDoc.didDocumentMetadata.data.origin;
    const msg = dataDoc.didDocumentMetadata.data.ciphertext;
    const id = wallet.ids[wallet.current];
    const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${id.account}'/0/${id.index}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);
    const diddoc = await keychain.resolveDid(origin);
    const doc = JSON.parse(diddoc);
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const plaintext = cipher.decryptMessage(publicJwk, keypair.privateJwk, msg);

    console.log(plaintext);
}

async function resolveDid(did) {
    console.log(await keychain.resolveDid(did));
}

program
    .version('1.0.0')
    .description('Keychain CLI tool');

program
    .command('show')
    .description('Show wallet')
    .action(() => {
        console.log(JSON.stringify(wallet, null, 4));
    });

program
    .command('create-id <name>')
    .description('Create a new decentralized ID')
    .action((name) => { createId(name) });

program
    .command('list')
    .description('List IDs')
    .action(async () => { listIds() });

program
    .command('use <name>')
    .description('Set the current ID')
    .action((name) => { useId(name) });

program
    .command('resolve-did <did>')
    .description('Return document associated with DID')
    .action((did) => { resolveDid(did) });

program
    .command('encrypt <msg> <did>')
    .description('Encrypt a message for a DID')
    .action((msg, did) => { encrypt(msg, did) });

program
    .command('decrypt <did>')
    .description('Decrypt a DID')
    .action((did) => { decrypt(did) });

program.parse(process.argv);
