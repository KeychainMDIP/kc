import fs from 'fs';
import { JSONSchemaFaker } from "json-schema-faker";
import * as cipher from './cipher.js';

let gatekeeper = null;
const dataFolder = 'data';
const walletName = `${dataFolder}/wallet.json`;
const defaultRegistry = 'hyperswarm';

export async function start(gk) {
    gatekeeper = gk;
    await gatekeeper.start();
}

export async function stop() {
    await gatekeeper.stop();
}

function saveWallet(wallet) {
    if (!fs.existsSync(dataFolder)) {
        fs.mkdirSync(dataFolder, { recursive: true });
    }

    fs.writeFileSync(walletName, JSON.stringify(wallet, null, 4));
}

export function newWallet(mnemonic) {
    try {
        if (!mnemonic) {
            mnemonic = cipher.generateMnemonic();
        }
        const hdkey = cipher.generateHDKey(mnemonic);
        const keypair = cipher.generateJwk(hdkey.privateKey);
        const backup = cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, mnemonic);

        const wallet = {
            seed: {
                mnemonic: backup,
                hdkey: hdkey.toJSON(),
            },
            counter: 0,
            ids: {},
        }

        saveWallet(wallet);
        return wallet;
    }
    catch (error) {
        throw "Invalid mnemonic";
    }
}

export function decryptMnemonic() {
    const wallet = loadWallet();
    const keypair = hdKeyPair();
    const mnenomic = cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, wallet.seed.mnemonic);

    return mnenomic;
}

export function loadWallet() {
    if (fs.existsSync(walletName)) {
        const walletJson = fs.readFileSync(walletName);
        return JSON.parse(walletJson);
    }

    return newWallet();
}

export async function backupWallet(registry = 'BTC') {
    const wallet = loadWallet();
    const keypair = hdKeyPair();
    const msg = JSON.stringify(wallet);
    const backup = cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
    const did = await createData({ backup: backup }, registry);

    return did;
}

export async function recoverWallet(did) {
    const keypair = hdKeyPair();
    const data = await resolveAsset(did);
    const backup = cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, data.backup);
    const wallet = JSON.parse(backup);

    return wallet;
}

function getCurrentId() {
    const wallet = loadWallet();
    const id = wallet.ids[wallet.current];

    if (!id) {
        throw "No current ID";
    }

    return id;
}

function hdKeyPair() {
    const wallet = loadWallet();
    const hdkey = cipher.generateHDKeyJSON(wallet.seed.hdkey);
    const keypair = cipher.generateJwk(hdkey.privateKey);

    return keypair;
}

function currentKeyPair() {
    const wallet = loadWallet();
    const id = getCurrentId();
    const hdkey = cipher.generateHDKeyJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${id.account}'/0/${id.index}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);

    return keypair;
}

export async function encrypt(msg, did, registry = defaultRegistry) {
    const id = getCurrentId();
    const keypair = currentKeyPair();
    const doc = await resolveDID(did);
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const cipher_sender = cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
    const cipher_receiver = cipher.encryptMessage(publicJwk, keypair.privateJwk, msg);
    const msgHash = cipher.hashMessage(msg);
    const cipherDid = await createData({
        sender: id.did,
        created: new Date().toISOString(),
        cipher_hash: msgHash,
        cipher_sender: cipher_sender,
        cipher_receiver: cipher_receiver,
    }, registry);

    return cipherDid;
}

export async function decrypt(did) {
    const wallet = loadWallet();
    const id = getCurrentId();
    const crypt = await resolveAsset(did);

    if (!crypt || !crypt.cipher_hash) {
        throw "DID is not encrypted";
    }

    const doc = await resolveDID(crypt.sender, crypt.created);
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const hdkey = cipher.generateHDKeyJSON(wallet.seed.hdkey);
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

    throw 'Cannot decrypt';
}

export async function encryptJSON(json, did, registry = defaultRegistry) {
    const plaintext = JSON.stringify(json);
    return encrypt(plaintext, did, registry);
}

export async function decryptJSON(did) {
    const plaintext = await decrypt(did);
    return JSON.parse(plaintext);
}

export async function addSignature(obj) {
    const id = getCurrentId();
    const keypair = currentKeyPair(id);

    try {
        const msgHash = cipher.hashJSON(obj);
        const signature = await cipher.signHash(msgHash, keypair.privateJwk);

        return {
            ...obj,
            signature: {
                signer: id.did,
                signed: new Date().toISOString(),
                hash: msgHash,
                value: signature,
            }
        };
    }
    catch (error) {
        throw 'Invalid input';
    }
}

export async function verifySignature(obj) {
    if (!obj?.signature) {
        return false;
    }

    const jsonCopy = JSON.parse(JSON.stringify(obj));
    const signature = jsonCopy.signature;
    delete jsonCopy.signature;
    const msgHash = cipher.hashJSON(jsonCopy);

    if (signature.hash && signature.hash !== msgHash) {
        return false;
    }

    const doc = await resolveDID(signature.signer, signature.signed);

    // TBD get the right signature, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;

    try {
        return cipher.verifySig(msgHash, signature.value, publicJwk);
    }
    catch (error) {
        return false;
    }
}

async function updateDID(did, doc) {
    const current = await resolveDID(did);
    const prev = cipher.hashJSON(current);

    const txn = {
        op: "update",
        did: did,
        doc: doc,
        prev: prev,
    };

    const signed = await addSignature(txn);
    return gatekeeper.updateDID(signed);
}

async function revokeDID(did) {
    const current = await resolveDID(did);
    const prev = cipher.hashJSON(current);

    const txn = {
        op: "delete",
        did: did,
        prev: prev,
    };

    const signed = await addSignature(txn);
    return gatekeeper.deleteDID(signed);
}

function addToOwned(did) {
    const wallet = loadWallet();
    const id = wallet.ids[wallet.current];
    const owned = new Set(id.owned);

    owned.add(did);
    id.owned = Array.from(owned);

    saveWallet(wallet);
    return true;
}

function addToHeld(did) {
    const wallet = loadWallet();
    const id = wallet.ids[wallet.current];
    const held = new Set(id.held);

    held.add(did);
    id.held = Array.from(held);

    saveWallet(wallet);
    return true;
}

export async function resolveDID(did, asof) {
    const doc = await gatekeeper.resolveDID(lookupDID(did), asof);
    return doc;
}

export async function resolveAsset(did) {
    const doc = await resolveDID(did);

    if (doc?.didDocumentMetadata) {
        if (!doc.didDocumentMetadata.deactivated) {
            return doc.didDocumentMetadata.data;
        }
    }

    return null;
}

export async function createId(name, registry = defaultRegistry) {
    const wallet = loadWallet();
    if (wallet.ids && wallet.ids.hasOwnProperty(name)) {
        throw `Already have an ID named ${name}`;
    }

    const account = wallet.counter;
    const index = 0;
    const hdkey = cipher.generateHDKeyJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${account}'/0/${index}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);

    const txn = {
        op: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "agent",
            registry: registry,
        },
        publicJwk: keypair.publicJwk,
    };

    const msgHash = cipher.hashJSON(txn);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);
    const signed = {
        ...txn,
        signature: {
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature
        }
    }
    const did = await gatekeeper.createDID(signed);

    const newId = {
        did: did,
        account: account,
        index: index,
    };

    wallet.ids[name] = newId;
    wallet.counter += 1;
    wallet.current = name;
    saveWallet(wallet);

    return did;
}

export function removeId(name) {
    const wallet = loadWallet();
    if (wallet.ids.hasOwnProperty(name)) {
        delete wallet.ids[name];

        if (wallet.current === name) {
            wallet.current = '';
        }

        saveWallet(wallet);
    }
    else {
        throw `No ID named ${name}`;
    }
}

export async function resolveId() {
    const id = getCurrentId();
    return resolveDID(id.did);
}

export async function backupId() {
    const id = getCurrentId();
    const wallet = loadWallet();
    const keypair = hdKeyPair();
    const data = {
        name: wallet.current,
        id: id,
    };
    const msg = JSON.stringify(data);
    const backup = cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
    const doc = await resolveDID(id.did);
    const registry = doc.didDocumentMetadata.mdip.registry;
    const vaultDid = await createData({ backup: backup }, registry);

    doc.didDocumentMetadata.vault = vaultDid;
    const ok = await updateDID(id.did, doc);

    return ok;
}

export async function recoverId(did) {
    try {
        const wallet = loadWallet();
        const keypair = hdKeyPair();
        const doc = await resolveDID(did);
        const vault = await resolveAsset(doc.didDocumentMetadata.vault);
        const backup = cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, vault.backup);
        const data = JSON.parse(backup);

        // TBD handle the case where name already exists in wallet
        wallet.ids[data.name] = data.id;
        wallet.current = data.name;
        wallet.counter += 1;

        saveWallet(wallet);

        return `Recovered ${data.name}!`;
    }
    catch {
        throw "Cannot recover ID";
    }
}

export function listIds() {
    const wallet = loadWallet();
    return Object.keys(wallet.ids);
}

export function useId(name) {
    const wallet = loadWallet();
    if (wallet.ids.hasOwnProperty(name)) {
        wallet.current = name;
        saveWallet(wallet);
    }
    else {
        throw `No ID named ${name}`;
    }
}

export async function rotateKeys() {
    const wallet = loadWallet();
    const id = wallet.ids[wallet.current];
    const nextIndex = id.index + 1;
    const hdkey = cipher.generateHDKeyJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${id.account}'/0/${nextIndex}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);
    const doc = await resolveDID(id.did);
    const vmethod = doc.didDocument.verificationMethod[0];

    vmethod.id = `#key-${nextIndex + 1}`;
    vmethod.publicKeyJwk = keypair.publicJwk;
    doc.didDocument.authentication = [vmethod.id];

    const ok = await updateDID(id.did, doc);

    if (ok) {
        id.index = nextIndex;
        saveWallet(wallet);
        return doc;
    }
    else {
        throw 'cannot rotate keys';
    }
}

export function addName(name, did) {
    const wallet = loadWallet();

    if (!wallet.names) {
        wallet.names = {};
    }

    if (wallet.names.hasOwnProperty(name)) {
        throw `Name already in use`;
    }

    wallet.names[name] = did;
    saveWallet(wallet);

    return true;
}

export function removeName(name) {
    const wallet = loadWallet();

    if (wallet.names) {
        if (wallet.names.hasOwnProperty(name)) {
            delete wallet.names[name];
            saveWallet(wallet);
        }
    }

    return true;
}

export function lookupDID(name) {

    if (name.startsWith('did:mdip:')) {
        return name;
    }

    const wallet = loadWallet();

    if (wallet.names) {
        if (wallet.names.hasOwnProperty(name)) {
            return wallet.names[name];
        }
    }

    if (wallet.ids) {
        if (wallet.ids.hasOwnProperty(name)) {
            return wallet.ids[name].did;
        }
    }
}

export async function createData(data, registry = defaultRegistry) {

    function isEmpty(data) {
        if (!data) return true;
        if (Array.isArray(data) && data.length === 0) return true;
        if (typeof data === 'object' && Object.keys(data).length === 0) return true;
        return false;
    }

    if (isEmpty(data)) {
        throw 'Invalid input';
    }

    const id = getCurrentId();

    const txn = {
        op: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "asset",
            registry: registry,
        },
        controller: id.did,
        data: data,
    };

    const signed = await addSignature(txn);
    const did = await gatekeeper.createDID(signed);

    addToOwned(did);
    return did;
}

export async function createCredential(schema) {
    // TBD validate schema
    return createData(schema);
}

export async function bindCredential(credentialDid, subjectDid, validUntil = null) {
    const id = getCurrentId();
    const type = lookupDID(credentialDid);
    const schema = await resolveAsset(type);
    const credential = JSONSchemaFaker.generate(schema);

    const vc = {
        "@context": [
            "https://www.w3.org/ns/credentials/v2",
            "https://www.w3.org/ns/credentials/examples/v2"
        ],
        type: ["VerifiableCredential", type],
        issuer: id.did,
        validFrom: new Date().toISOString(),
        validUntil: validUntil,
        credentialSubject: {
            id: lookupDID(subjectDid),
        },
        credential: credential,
    };

    return vc;
}

export async function attestCredential(vc, registry = defaultRegistry) {
    const id = getCurrentId();

    if (vc.issuer !== id.did) {
        throw 'Invalid VC';
    }

    const signed = await addSignature(vc);
    const cipherDid = await encryptJSON(signed, vc.credentialSubject.id, registry);
    addToOwned(cipherDid);
    return cipherDid;
}

export async function revokeCredential(did) {
    const credential = lookupDID(did);
    return revokeDID(credential);
}

export async function acceptCredential(did) {
    try {
        const id = getCurrentId();
        const credential = lookupDID(did);
        const vc = await decryptJSON(credential);

        if (vc.credentialSubject.id !== id.did) {
            throw 'VC not valid or not assigned to this ID';
        }

        return addToHeld(credential);
    }
    catch (error) {
        return false;
    }
}

export async function publishCredential(did, reveal = false) {
    try {
        const id = getCurrentId();
        const credential = lookupDID(did);
        const vc = await decryptJSON(credential);

        if (vc.credentialSubject.id !== id.did) {
            throw 'VC not valid or not assigned to this ID';
        }

        const doc = await resolveDID(id.did);

        if (!doc.didDocumentMetadata.manifest) {
            doc.didDocumentMetadata.manifest = {};
        }

        if (!reveal) {
            // Remove the credential values
            vc.credential = null;
        }
        doc.didDocumentMetadata.manifest[credential] = vc;

        await updateDID(id.did, doc);

        return vc;
    }
    catch (error) {
        return error;
    }
}

export async function unpublishCredential(did) {
    try {
        const id = getCurrentId();
        const doc = await resolveDID(id.did);
        const credential = lookupDID(did);
        const manifest = doc.didDocumentMetadata.manifest;

        if (manifest && manifest.hasOwnProperty(credential)) {
            delete manifest[credential];
            await updateDID(id.did, doc);
        }

        return true;
    }
    catch (error) {
        return error;
    }
}

export async function createChallenge(challenge) {
    // TBD validate challenge as list of requirements
    // each requirement is a object containing a list of trusted attestor DIDs and a list of acceptable schema DIDs
    return createData(challenge);
}

async function findMatchingCredential(credential) {
    const id = getCurrentId();

    if (!id.held) {
        return;
    }

    for (let did of id.held) {
        try {
            const doc = await decryptJSON(did);

            // console.log(doc);

            if (!doc.issuer) {
                // Not a VC
                continue;
            }

            if (doc.credentialSubject?.id !== id.did) {
                // This VC is issued by the ID, not held
                continue;
            }

            if (credential.attestors) {
                if (!credential.attestors.includes(doc.issuer)) {
                    // Attestor not trusted by Verifier
                    continue;
                }
            }

            if (doc.type) {
                if (!doc.type.includes(credential.schema)) {
                    // Wrong type
                    continue;
                }
            }

            // TBD test for VC expiry too
            return did;
        }
        catch (error) {
            // Not encrypted, so can't be a VC
        }
    }
}

export async function createResponse(did) {
    const challenge = lookupDID(did);

    if (!challenge) {
        throw "Invalid challenge";
    }

    const doc = await resolveDID(challenge);
    const requestor = doc.didDocument.controller;
    const { credentials } = await resolveAsset(challenge);

    if (!credentials) {
        throw "Invalid challenge";
    }

    const matches = [];

    for (let credential of credentials) {
        const vc = await findMatchingCredential(credential);

        if (vc) {
            matches.push(vc);
        }
    }

    if (!matches) {
        throw "VCs don't match challenge";
    }

    const pairs = [];

    for (let vcDid of matches) {
        const plaintext = await decrypt(vcDid);
        const vpDid = await encrypt(plaintext, requestor);
        pairs.push({ vc: vcDid, vp: vpDid });
    }

    const requested = credentials.length;
    const fulfilled = matches.length;
    const match = (requested === fulfilled);
    const response = {
        challenge: challenge,
        credentials: pairs,
        requested: requested,
        fulfilled: fulfilled,
        match: match,
    };

    const responseDid = await encryptJSON(response, requestor);

    return responseDid;
}

export async function verifyResponse(did) {
    const responseDID = lookupDID(did);

    if (!responseDID) {
        throw "Invalid response";
    }

    const response = await decryptJSON(responseDID);
    const vps = [];

    for (let credential of response.credentials) {
        const vcData = await resolveAsset(credential.vc);
        const vpData = await resolveAsset(credential.vp);

        if (!vcData) {
            // revoked
            continue;
        }

        if (vcData.cipher_hash !== vpData.cipher_hash) {
            continue;
        }

        const vp = await decryptJSON(credential.vp);
        const isValid = await verifySignature(vp);

        if (!isValid) {
            continue;
        }

        vps.push(vp);
    }

    // TBD ensure VPs match challenge

    return vps;
}

export async function exportDID(did) {
    return gatekeeper.exportDID(lookupDID(did));
}

export async function importDID(txns) {
    return gatekeeper.importDID(txns);
}
