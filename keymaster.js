import fs from 'fs';
import * as bip39 from 'bip39';
import HDKey from 'hdkey';
import canonicalize from 'canonicalize';
import { JSONSchemaFaker } from "json-schema-faker";
import * as cipher from './cipher.js';
import * as gatekeeper from './gatekeeper.js';

const walletName = 'wallet.json';

export async function start() {
    await gatekeeper.start();
}

export async function stop() {
    await gatekeeper.stop();
}

function saveWallet(wallet) {
    fs.writeFileSync(walletName, JSON.stringify(wallet, null, 4));
}

export function loadWallet() {

    if (fs.existsSync(walletName)) {
        const walletJson = fs.readFileSync(walletName);
        return JSON.parse(walletJson);
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

function getCurrentId() {
    const wallet = loadWallet();
    const id = wallet.ids[wallet.current];

    if (!id) {
        throw "No current ID";
    }

    return id;
}

function currentKeyPair() {
    const wallet = loadWallet();
    const id = getCurrentId();
    const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${id.account}'/0/${id.index}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);

    return keypair;
}

export async function encrypt(msg, did, registry='peerbit') {
    const id = getCurrentId();
    const keypair = currentKeyPair();
    const doc = await resolveDid(did);
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

    const doc = await resolveDid(crypt.sender, crypt.created);
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

    throw 'Cannot decrypt';
}

export async function encryptJSON(json, did, registry='peerbit') {
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
        const msg = canonicalize(obj);
        const msgHash = cipher.hashMessage(msg);
        const signature = await cipher.signHash(msgHash, keypair.privateJwk);

        return {
            ...obj,
            signature: {
                signer: id.did,
                created: new Date().toISOString(),
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
    const msg = canonicalize(jsonCopy);
    const msgHash = cipher.hashMessage(msg);

    if (signature.hash && signature.hash !== msgHash) {
        return false;
    }

    const doc = await resolveDid(signature.signer, signature.created);

    // TBD get the right signature, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;

    try {
        return cipher.verifySig(msgHash, signature.value, publicJwk);
    }
    catch (error) {
        return false;
    }
}

async function updateDid(did, doc) {
    const txn = {
        op: "update",
        did: did,
        doc: doc,
    };

    const signed = await addSignature(txn);
    return gatekeeper.updateDid(signed);
}

async function revokeDid(did) {
    const txn = {
        op: "delete",
        did: did,
    };

    const signed = await addSignature(txn);
    return gatekeeper.deleteDid(signed);
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

export async function resolveDid(did, asof) {
    const doc = JSON.parse(await gatekeeper.resolveDid(did, asof));
    return doc;
}

export async function resolveAsset(did) {
    const doc = await resolveDid(did);

    if (doc?.didDocumentMetadata) {
        if (!doc.didDocumentMetadata.deactivated) {
            return doc.didDocumentMetadata.data;
        }
    }

    return null;
}

export async function createId(name, registry = 'peerbit') {
    const wallet = loadWallet();
    if (wallet.ids && wallet.ids.hasOwnProperty(name)) {
        throw `Already have an ID named ${name}`;
    }

    const account = wallet.counter;
    const index = 0;
    const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${account}'/0/${index}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);

    const txn = {
        op: "create",
        mdip: {
            version: 1,
            type: "agent",
            registry: registry,
        },
        publicJwk: keypair.publicJwk,
    };

    const msg = canonicalize(txn);
    const msgHash = cipher.hashMessage(msg);

    txn.signature = await cipher.signHash(msgHash, keypair.privateJwk);

    const did = await gatekeeper.createDid(txn);

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
    const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${id.account}'/0/${nextIndex}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);
    const doc = await resolveDid(id.did);
    const vmethod = doc.didDocument.verificationMethod[0];

    vmethod.id = `#key-${nextIndex + 1}`;
    vmethod.publicKeyJwk = keypair.publicJwk;
    doc.didDocument.authentication = [vmethod.id];

    const ok = await updateDid(id.did, doc);

    if (ok) {
        id.index = nextIndex;
        saveWallet(wallet);
        return doc;
    }
    else {
        throw 'cannot rotate keys';
    }
}

export async function createData(data, registry = 'peerbit') {

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
        mdip: {
            version: 1,
            type: "asset",
            registry: registry,
        },
        controller: id.did,
        data: data,
    };

    const signed = await addSignature(txn);
    const did = await gatekeeper.createDid(signed);

    addToOwned(did);
    return did;
}

export async function createCredential(schema) {
    // TBD validate schema
    return createData(schema);
}

export async function bindCredential(credentialDid, subjectDid, validUntil = null) {
    const id = getCurrentId();
    const schema = await resolveAsset(credentialDid);
    const credential = JSONSchemaFaker.generate(schema);

    const vc = {
        "@context": [
            "https://www.w3.org/ns/credentials/v2",
            "https://www.w3.org/ns/credentials/examples/v2"
        ],
        type: ["VerifiableCredential", credentialDid],
        issuer: id.did,
        validFrom: new Date().toISOString(),
        validUntil: validUntil,
        credentialSubject: {
            id: subjectDid,
        },
        credential: credential,
    };

    return vc;
}

export async function attestCredential(vc, registry='peerbit') {
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
    return revokeDid(did);
}

export async function acceptCredential(did) {
    try {
        const id = getCurrentId();
        const vc = await decryptJSON(did);

        if (vc.credentialSubject.id !== id.did) {
            throw 'VC not valid or not assigned to this ID';
        }

        return addToHeld(did);
    }
    catch (error) {
        return false;
    }
}

export async function createChallenge(challenge) {
    // TBD validate challenge as list of requirements
    // each requirement is a object containing a list of trusted attestor DIDs and a list of acceptable schema DIDs
    return createData(challenge);
}

export async function issueChallenge(challenge, user, expiresIn = 24) {
    const id = getCurrentId();
    const now = new Date();
    const expires = new Date();
    expires.setHours(now.getHours() + expiresIn);
    const issue = {
        challenge: challenge,
        from: id.did,
        to: user,
        validFrom: now.toISOString(),
        validUntil: expires.toISOString(),
    };
    const signed = await addSignature(issue);
    const cipherDid = await encryptJSON(signed, user);
    return cipherDid;
}

async function findMatchingCredential(credential) {
    const id = getCurrentId();

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
    const id = getCurrentId();
    const boundChallenge = await decryptJSON(did);

    if (!boundChallenge.challenge || boundChallenge.to !== id.did) {
        throw "Invalid challenge";
    }

    const { credentials } = await resolveAsset(boundChallenge.challenge);
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
        const vpDid = await encrypt(plaintext, boundChallenge.from);
        pairs.push({ vc: vcDid, vp: vpDid });
    }

    const responseDid = await createData({
        challenge: did,
        credentials: pairs,
    });

    return responseDid;
}

export async function verifyResponse(did) {
    const { credentials } = await resolveAsset(did);
    const vps = [];

    for (let credential of credentials) {
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
