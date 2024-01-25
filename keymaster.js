import fs from 'fs';
import * as bip39 from 'bip39';
import HDKey from 'hdkey';
import canonicalize from 'canonicalize';
import { JSONSchemaFaker } from "json-schema-faker";
import * as cipher from './cipher.js';
import * as gatekeeper from './gatekeeper.js';

const walletName = 'wallet.json';
const wallet = loadWallet() || initializeWallet();

function loadWallet() {
    if (fs.existsSync(walletName)) {
        const walletJson = fs.readFileSync(walletName);
        return JSON.parse(walletJson);
    }
}

function saveWallet() {
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

    saveWallet();
    return wallet;
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
    const diddoc = await gatekeeper.resolveDid(did);
    const doc = JSON.parse(diddoc);
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const cipher_sender = cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
    const cipher_receiver = cipher.encryptMessage(publicJwk, keypair.privateJwk, msg);
    const msgHash = cipher.hashMessage(msg);
    const cipherDid = await gatekeeper.generateDid({
        sender: id.did,
        created: new Date().toISOString(),
        cipher_hash: msgHash,
        cipher_sender: cipher_sender,
        cipher_receiver: cipher_receiver,
    });

    return cipherDid;
}

async function decrypt(did) {
    const dataDocJson = await gatekeeper.resolveDid(did);
    const dataDoc = JSON.parse(dataDocJson);
    const crypt = dataDoc.didDocumentMetadata.data;
    const id = wallet.ids[wallet.current];

    const diddoc = await gatekeeper.resolveDid(crypt.sender, crypt.created);
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

async function verifySig(json) {
    if (!json.signature) {
        return false;
    }

    const jsonCopy = JSON.parse(JSON.stringify(json));

    const signature = jsonCopy.signature;
    delete jsonCopy.signature;
    const msg = canonicalize(jsonCopy);
    const msgHash = cipher.hashMessage(msg);

    // console.log(`msgHash        = ${msgHash}`);
    // console.log(`signature.hash = ${signature.hash}`);

    if (signature.hash && signature.hash !== msgHash) {
        return false;
    }

    const diddoc = await gatekeeper.resolveDid(signature.signer, signature.created);
    const doc = JSON.parse(diddoc);

    // TBD get the right signature, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const isValid = cipher.verifySig(msgHash, signature.value, publicJwk);

    return isValid;
}

async function updateDoc(id, did, doc) {
    const txn = {
        op: "replace",
        time: new Date().toISOString(),
        did: did,
        doc: doc,
    };

    const signed = await signJson(id, txn);
    const ok = gatekeeper.saveUpdateTxn(signed);
    return ok;
}

async function resolveDid(did) {
    const doc = JSON.parse(await gatekeeper.resolveDid(did));
    return doc;
}

async function createId(name) {
    if (wallet.ids && wallet.ids.hasOwnProperty(name)) {
        throw `Already have an ID named ${name}`;
    }

    const account = wallet.counter;
    const index = 0;
    const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${account}'/0/${index}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);
    const did = await gatekeeper.generateDid(keypair.publicJwk);
    const didobj = {
        did: did,
        account: account,
        index: index,
    };

    wallet.ids[name] = didobj;
    wallet.counter += 1;
    wallet.current = name;
    saveWallet();

    return (did);
}

function removeId(name) {
    if (wallet.ids.hasOwnProperty(name)) {
        delete wallet.ids[name];

        if (wallet.current === name) {
            wallet.current = '';
        }

        saveWallet();
    }
    else {
        throw `No ID named ${name}`;
    }
}

function listIds() {
    return Object.keys(wallet.ids);
}

function useId(name) {
    if (wallet.ids.hasOwnProperty(name)) {
        wallet.current = name;
        saveWallet();
    }
    else {
        throw `No ID named ${name}`;
    }
}

async function rotateKeys() {
    const id = wallet.ids[wallet.current];
    const nextIndex = id.index + 1;
    const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${id.account}'/0/${nextIndex}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);
    const doc = JSON.parse(await gatekeeper.resolveDid(id.did));
    const vmethod = doc.didDocument.verificationMethod[0];

    vmethod.id = `#key-${nextIndex + 1}`;
    vmethod.publicKeyJwk = keypair.publicJwk;
    doc.didDocument.authentication = [vmethod.id];

    const ok = await updateDoc(id, id.did, doc);

    if (ok) {
        id.index = nextIndex;
        saveWallet(wallet);
        return doc;
    }
    else {
        throw 'cannot rotate keys';
    }
}

async function createVC(file, subjectDid) {
    const id = wallet.ids[wallet.current];
    const schema = JSON.parse(fs.readFileSync(file).toString());
    const schemaDid = await gatekeeper.generateDid({
        controller: id.did,
        schema: schema,
    });
    const vc = JSON.parse(fs.readFileSync('did-vc.template').toString());
    const atom = JSONSchemaFaker.generate(schema);

    vc.issuer = id.did;
    vc.credentialSubject.id = subjectDid;
    vc.validFrom = new Date().toISOString();
    vc.type.push(schemaDid);
    vc.credential = atom;

    return vc;
}

async function attestVC(file) {
    const id = wallet.ids[wallet.current];
    const vc = JSON.parse(fs.readFileSync(file).toString());
    const signed = await signJson(id, vc);
    const msg = JSON.stringify(signed);
    const cipherDid = await encrypt(msg, vc.credentialSubject.id);
    return cipherDid;
}

async function revokeVC(did) {
    const id = wallet.ids[wallet.current];
    const ok = await updateDoc(id, did, {});
    return ok;
}

function loadManifest(id) {
    if (id.manifest) {
        return new Set(id.manifest);
    }
    else {
        return new Set();
    }
}

function saveManifest(id, manifest) {
    id.manifest = Array.from(manifest);
    saveWallet();
}

async function acceptVC(did) {
    const id = wallet.ids[wallet.current];
    const vc = JSON.parse(await decrypt(did));

    if (vc.credentialSubject.id !== id.did) {
        throw 'VC not valid or not assigned to this ID';
    }

    const manifest = loadManifest(id);
    manifest.add(did);
    saveManifest(id, manifest);

    return true;
}

async function saveVC(did) {
    try {
        const id = wallet.ids[wallet.current];
        const doc = JSON.parse(await gatekeeper.resolveDid(id.did));
        const manifestDid = doc.didDocumentMetadata.manifest;
        const manifest = JSON.parse(await gatekeeper.resolveDid(manifestDid));

        const vc = JSON.parse(await decrypt(did));

        if (vc.credentialSubject.id !== id.did) {
            throw 'VC not valid or not assigned to this ID';
        }

        //console.log(JSON.stringify(vc, null, 4));

        let vcSet = new Set();

        if (manifest.didDocumentMetadata.data) {
            vcSet = new Set(JSON.parse(await decrypt(manifest.didDocumentMetadata.data)));
        }

        vcSet.add(did);
        const msg = JSON.stringify(Array.from(vcSet));
        manifest.didDocumentMetadata.data = await encrypt(msg, id.did);
        await updateDoc(id, manifestDid, manifest);

        console.log(vcSet);
    }
    catch (error) {
        console.error('cannot save VC');
    }
}

async function createVP(vcDid, receiverDid) {
    const id = wallet.ids[wallet.current];
    const plaintext = await decrypt(vcDid);
    const cipherDid = await encrypt(plaintext, receiverDid);
    const vp = {
        controller: id.did,
        vc: vcDid,
        vp: cipherDid
    };
    const vpDid = await gatekeeper.generateDid(vp);
    return vpDid;
}

async function verifyVP(did) {
    const vpsdoc = JSON.parse(await gatekeeper.resolveDid(did));
    const vcdid = vpsdoc.didDocumentMetadata.data.vc;
    const vpdid = vpsdoc.didDocumentMetadata.data.vp;
    const vcdoc = JSON.parse(await gatekeeper.resolveDid(vcdid));
    const vpdoc = JSON.parse(await gatekeeper.resolveDid(vpdid));
    const vchash = vcdoc.didDocumentMetadata.data.cipher_hash;
    const vphash = vpdoc.didDocumentMetadata.data.cipher_hash;

    if (vchash !== vphash) {
        throw 'cannot verify (VP does not match VC)';
    }

    const vp = JSON.parse(await decrypt(vpdid));
    const isValid = await keymaster.verifySig(vp);

    if (!isValid) {
        throw 'cannot verify (signature invalid)';
    }

    return vp;
}

export {
    acceptVC,
    attestVC,
    createId,
    createVC,
    createVP,
    currentKeyPair,
    encrypt,
    decrypt,
    listIds,
    resolveDid,
    removeId,
    revokeVC,
    rotateKeys,
    signJson,
    useId,
    verifySig,
    verifyVP,
    wallet,
}
