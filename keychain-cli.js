import { program } from 'commander';
import fs from 'fs';
import * as bip39 from 'bip39';
import HDKey from 'hdkey';
import canonicalize from 'canonicalize';
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
    const keypair = cipher.generateJwk(didkey.privateKey);
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

function currentKeyPair(id) {
    const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${id.account}'/0/${id.index}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);

    return keypair;
}

async function encrypt(msg, did) {
    if (!wallet.current) {
        console.log("No current ID");
        return;
    }

    const id = wallet.ids[wallet.current];
    const keypair = currentKeyPair(id);
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

async function encryptFile(file, did) {
    if (fs.existsSync(file)) {
        const contents = fs.readFileSync(file).toString();
        await encrypt(contents, did);
    }
    else {
        console.log(`${file} does not exit`);
    }
}

async function decryptDid(did) {
    const dataDocJson = await keychain.resolveDid(did);
    const dataDoc = JSON.parse(dataDocJson);
    const origin = dataDoc.didDocumentMetadata.data.origin;
    const msg = dataDoc.didDocumentMetadata.data.ciphertext;
    const id = wallet.ids[wallet.current];
    const keypair = currentKeyPair(id);
    const diddoc = await keychain.resolveDid(origin);
    const doc = JSON.parse(diddoc);
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const plaintext = cipher.decryptMessage(publicJwk, keypair.privateJwk, msg);
    return plaintext;
}

async function decrypt(did) {
    if (!wallet.current) {
        console.log("No current ID");
        return;
    }

    try {
        const plaintext = await decryptDid(did);
        console.log(plaintext);
    }
    catch (error) {
        console.error(`cannot decrypt ${did}`);
    }
}

async function resolveDid(did) {
    console.log(await keychain.resolveDid(did));
}

async function sign(file) {
    if (fs.existsSync(file)) {
        const id = wallet.ids[wallet.current];
        const keypair = currentKeyPair(id);
        const contents = fs.readFileSync(file).toString();
        const msg = JSON.stringify(canonicalize(JSON.parse(contents)));
        const msgHash = cipher.hashMessage(msg);
        const sig = await cipher.signHash(msgHash, keypair.privateJwk);
        const jsonFile = JSON.parse(contents);
        jsonFile.signature = {
            signer: id.did,
            created: new Date().toISOString(),
            hash: msgHash,
            value: sig,
        }
        console.log(JSON.stringify(jsonFile, null, 4));
    }
    else {
        console.log(`${file} does not exit`);
    }
}

async function attest(file) {
    if (fs.existsSync(file)) {
        const id = wallet.ids[wallet.current];
        const keypair = currentKeyPair(id);
        const contents = fs.readFileSync(file).toString();
        const msg = JSON.stringify(canonicalize(JSON.parse(contents)));
        const msgHash = cipher.hashMessage(msg);
        const sig = await cipher.signHash(msgHash, keypair.privateJwk);
        const jsonFile = JSON.parse(contents);
        jsonFile.proof = {
            signer: id.did,
            created: new Date().toISOString(),
            hash: msgHash,
            value: sig,
        }
        console.log(JSON.stringify(jsonFile, null, 4));
    }
    else {
        console.log(`${file} does not exit`);
    }
}

async function verifySig(json) {
    const jsonFile = JSON.parse(json);

    if (!jsonFile.signature) {
        console.log("No signature found");
        return;
    }

    const signature = jsonFile.signature;
    delete jsonFile.signature;
    const msg = JSON.stringify(canonicalize(jsonFile));
    const msgHash = cipher.hashMessage(msg);

    if (signature.hash && signature.hash !== msgHash) {
        console.log("Hash does not match");
        return;
    }

    const diddoc = await keychain.resolveDid(signature.signer);
    const doc = JSON.parse(diddoc);
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const isValid = cipher.verifySig(msgHash, signature.value, publicJwk);

    return isValid;
}

async function verify(file) {
    if (!fs.existsSync(file)) {
        console.log(`${file} does not exit`);
        return;
    }

    try {
        const json = fs.readFileSync(file).toString();
        const isValid = verifySig(json);
        console.log(`signature in ${file}`, isValid ? 'is valid' : 'is NOT valid');
    }
    catch (error) {
        console.error('cannot verify signature');
    }
}

async function verifyVP(did) {
    try {
        const plaintext = await decryptDid(did);
        const isValid = await verifySig(plaintext);

        if (isValid) {
            console.log(plaintext);
        }
        else {
            console.error('cannot verify');
        }
    }
    catch (error) {
        console.error('cannot verify');
    }
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
    .command('encrypt-msg <msg> <did>')
    .description('Encrypt a message for a DID')
    .action((msg, did) => { encrypt(msg, did) });

program
    .command('encrypt-file <file> <did>')
    .description('Encrypt a file for a DID')
    .action((file, did) => { encryptFile(file, did) });

program
    .command('decrypt <did>')
    .description('Decrypt a DID')
    .action((did) => { decrypt(did) });

program
    .command('sign <file>')
    .description('Sign a JSON file')
    .action((file) => { sign(file) });

program
    .command('verify <file>')
    .description('Verify the signature in a JSON file')
    .action((file) => { verify(file) });

program
    .command('create-vc <file> <did>')
    .description('Create verifiable credential for a DID')
    .action((file, did) => { createVC(did) });

program
    .command('verify-vp <did>')
    .description('Decrypt and verify the signature in a Verifiable Presentation')
    .action((did) => { verifyVP(did) });

program.parse(process.argv);
