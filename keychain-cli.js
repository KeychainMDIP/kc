import { program } from 'commander';
import fs from 'fs';
import * as bip39 from 'bip39';
import HDKey from 'hdkey';
import canonicalize from 'canonicalize';
import { JSONSchemaFaker } from "json-schema-faker";
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
    const didobj = {
        did: did,
        account: account,
        index: index,
    };

    wallet.ids[name] = didobj;

    wallet.counter += 1;
    wallet.current = name;

    saveWallet(wallet);
    console.log(did);
}

async function removeId(name) {
    if (wallet.ids.hasOwnProperty(name)) {
        delete wallet.ids[name];
        saveWallet(wallet);
        console.log(`ID ${name} removed`);
    }
    else {
        console.log(`No ID named ${name}`);
    }
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
    const cipher_sender = cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
    const cipher_receiver = cipher.encryptMessage(publicJwk, keypair.privateJwk, msg);
    const msgHash = cipher.hashMessage(msg);
    const cipherDid = await keychain.generateDid({
        sender: id.did,
        created: new Date().toISOString(),
        cipher_hash: msgHash,
        cipher_sender: cipher_sender,
        cipher_receiver: cipher_receiver,
    });

    return cipherDid;
}

async function encryptMessage(msg, did) {
    console.log(await encrypt(msg, did));
}

async function encryptFile(file, did) {
    if (fs.existsSync(file)) {
        const contents = fs.readFileSync(file).toString();
        const cipherDid = await encrypt(contents, did);
        console.log(cipherDid);
    }
    else {
        console.log(`${file} does not exit`);
    }
}

async function decrypt(did) {
    const dataDocJson = await keychain.resolveDid(did);
    const dataDoc = JSON.parse(dataDocJson);
    const crypt = dataDoc.didDocumentMetadata.data;
    const id = wallet.ids[wallet.current];

    const diddoc = await keychain.resolveDid(crypt.sender, crypt.created);
    const doc = JSON.parse(diddoc);
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
    const ciphertext = (crypt.sender === id.did) ? crypt.cipher_sender : crypt.cipher_receiver;

    let index = id.index;
    while (index >= 0) {
        const path = `m/44'/0'/${id.account}'/0/${index}`;
        const didkey = hdkey.derive(path);
        const keypair = cipher.generateJwk(didkey.privateKey);
        try {
            return cipher.decryptMessage(publicJwk, keypair.privateJwk, ciphertext);
        }
        catch (error) {
            index -= 1;
        }
    }

    throw 'nope!';
}

async function decryptDid(did) {
    try {
        const plaintext = await decrypt(did);
        console.log(plaintext);
    }
    catch (error) {
        console.error(`cannot decrypt ${did}`);
    }
}

async function resolveDid(did) {
    console.log(await keychain.resolveDid(did));
}

async function signJson(id, json) {
    const keypair = currentKeyPair(id);
    const msg = canonicalize(json);
    const msgHash = cipher.hashMessage(msg);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);
    json.signature = {
        signer: id.did,
        created: new Date().toISOString(),
        hash: msgHash,
        value: signature,
    };
    return json;
}

async function signFile(file) {
    try {
        const id = wallet.ids[wallet.current];
        const contents = fs.readFileSync(file).toString();
        const json = await signJson(id, JSON.parse(contents));
        console.log(JSON.stringify(json, null, 4));
    }
    catch (error) {
        console.log(`cannot sign ${file}`);
    }
}

async function verifyFile(file) {
    try {
        const json = JSON.parse(fs.readFileSync(file).toString());
        const isValid = await keychain.verifySig(json);
        console.log(`signature in ${file}`, isValid ? 'is valid' : 'is NOT valid');
    }
    catch (error) {
        console.error('cannot verify signature');
    }
}

async function createVC(file, did) {
    try {
        const id = wallet.ids[wallet.current];
        const schema = JSON.parse(fs.readFileSync(file).toString());
        const schemaDid = await keychain.generateDid({
            controller: id.did,
            schema: schema,
        });
        const vc = JSON.parse(fs.readFileSync('did-vc.template').toString());
        const atom = JSONSchemaFaker.generate(schema);

        vc.issuer = id.did;
        vc.credentialSubject.id = did;
        vc.validFrom = new Date().toISOString();
        vc.type.push(schemaDid);
        vc.credential = atom;

        console.log(JSON.stringify(vc, null, 4));
    }
    catch (error) {
        console.error('cannot create VC');
    }
}

async function attestVC(file) {
    try {
        const id = wallet.ids[wallet.current];
        const vc = JSON.parse(fs.readFileSync(file).toString());
        const signed = await signJson(id, vc);
        const msg = canonicalize(signed);
        const cipherDid = await encrypt(signed, vc.credentialSubject.id);
        console.log(cipherDid);
    }
    catch (error) {
        console.error(`cannot attest ${file}`)
    }
}

async function revokeVC(did) {
    console.log('TBD');
}

async function updateDoc(id, doc) {
    const txn = {
        op: "replace",
        time: new Date().toISOString(),
        doc: doc,
    };

    const signed = await signJson(id, txn);
    const ok = keychain.updateDid(signed);
}

async function saveVC(did) {
    try {
        const vc = JSON.parse(await decrypt(did));
        const id = wallet.ids[wallet.current];
        const doc = JSON.parse(await keychain.resolveDid(id.did));
        const manifest = JSON.parse(await keychain.resolveDid(doc.didDocumentMetadata.manifest));

        let vclist = {};

        if (manifest.didDocumentMetadata.data) {
            vclist = JSON.parse(await decrypt(manifest.didDocumentMetadata.data));
        }

        vclist[did] = vc;
        const msg = JSON.stringify(vclist);
        manifest.didDocumentMetadata.data = await encrypt(msg, id.did);
        await updateDoc(id, manifest);

        console.log(manifest);
    }
    catch (error) {
        console.error('cannot save VC');
    }
}

async function createVP(vcDid, receiverDid) {
    try {
        const id = wallet.ids[wallet.current];
        const plaintext = await decrypt(vcDid);
        const cipherDid = await encrypt(plaintext, receiverDid);
        const vp = {
            controller: id.did,
            vc: vcDid,
            vp: cipherDid
        };
        const vpDid = await keychain.generateDid(vp);
        console.log(vpDid);
    }
    catch (error) {
        console.error('cannot create verifiable presentation');
    }
}

async function verifyVP(did) {
    try {
        const vpsdoc = JSON.parse(await keychain.resolveDid(did));
        const vcdid = vpsdoc.didDocumentMetadata.data.vc;
        const vpdid = vpsdoc.didDocumentMetadata.data.vp;
        const vcdoc = JSON.parse(await keychain.resolveDid(vcdid));
        const vpdoc = JSON.parse(await keychain.resolveDid(vpdid));
        const vchash = vcdoc.didDocumentMetadata.data.cipher_hash;
        const vphash = vpdoc.didDocumentMetadata.data.cipher_hash;

        if (vchash !== vphash) {
            console.log('cannot verify (VP does not match VC)');
            return;
        }

        const vp = JSON.parse(await decrypt(vpdid));
        const isValid = await keychain.verifySig(vp);

        if (!isValid) {
            console.log('cannot verify (signature invalid)');
        }

        console.log(vp);
    }
    catch (error) {
        console.error('cannot verify VP');
    }
}

async function rotateKeys() {
    try {
        const id = wallet.ids[wallet.current];
        const nextIndex = id.index + 1;
        const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
        const path = `m/44'/0'/${id.account}'/0/${nextIndex}`;
        const didkey = hdkey.derive(path);
        const keypair = cipher.generateJwk(didkey.privateKey);
        const doc = JSON.parse(await keychain.resolveDid(id.did));
        const vmethod = doc.didDocument.verificationMethod[0];

        vmethod.id = `#key-${nextIndex + 1}`;
        vmethod.publicKeyJwk = keypair.publicJwk;
        doc.didDocument.authentication = [vmethod.id];

        await updateDoc(id, doc);

        id.index = nextIndex;
        saveWallet(wallet);

        console.log(JSON.stringify(doc, null, 2));
    }
    catch (error) {
        console.error('cannot rotate keys');
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
    .command('remove-id <name>')
    .description('Deletes named ID')
    .action((name) => { removeId(name) });

program
    .command('list-id')
    .description('List IDs and show current ID')
    .action(async () => { listIds() });

program
    .command('use-id <name>')
    .description('Set the current ID')
    .action((name) => { useId(name) });

program
    .command('resolve-did <did>')
    .description('Return document associated with DID')
    .action((did) => { resolveDid(did) });

program
    .command('encrypt-msg <msg> <did>')
    .description('Encrypt a message for a DID')
    .action((msg, did) => { encryptMessage(msg, did) });

program
    .command('encrypt-file <file> <did>')
    .description('Encrypt a file for a DID')
    .action((file, did) => { encryptFile(file, did) });

program
    .command('decrypt-did <did>')
    .description('Decrypt an encrypted data DID')
    .action((did) => { decryptDid(did) });

program
    .command('sign-file <file>')
    .description('Sign a JSON file')
    .action((file) => { signFile(file) });

program
    .command('verify-file <file>')
    .description('Verify the signature in a JSON file')
    .action((file) => { verifyFile(file) });

program
    .command('create-vc <file> <did>')
    .description('Create verifiable credential for a DID')
    .action((file, did) => { createVC(file, did) });

program
    .command('attest-vc <file>')
    .description('Sign and encrypt VC')
    .action((file) => { attestVC(file) });

program
    .command('revoke-vc <did>')
    .description('Revokes a verifiable credential')
    .action((did) => { revokeVC(did) });

program
    .command('save-vc <file>')
    .description('Save verifiable credential for current ID')
    .action((did) => { saveVC(did) });

program
    .command('create-vp <vc-did> <receiver-did>')
    .description('Decrypt and verify the signature in a Verifiable Presentation')
    .action((vc, receiver) => { createVP(vc, receiver) });

program
    .command('verify-vp <did>')
    .description('Decrypt and verify the signature in a Verifiable Presentation')
    .action((did) => { verifyVP(did) });

program
    .command('rotate-keys')
    .description('Rotates keys for current user')
    .action(() => { rotateKeys() });

program.parse(process.argv);
