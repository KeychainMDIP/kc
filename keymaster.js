import fs from 'fs';
import * as bip39 from 'bip39';
import HDKey from 'hdkey';
import canonicalize from 'canonicalize';
import { JSONSchemaFaker } from "json-schema-faker";
import * as cipher from './cipher.js';
import * as gatekeeper from './gatekeeper.js';

const walletName = 'wallet.json';

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

export async function encrypt(msg, did) {
    const id = getCurrentId();
    const keypair = currentKeyPair();
    const diddoc = await gatekeeper.resolveDid(did);
    const doc = JSON.parse(diddoc);
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const cipher_sender = cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
    const cipher_receiver = cipher.encryptMessage(publicJwk, keypair.privateJwk, msg);
    const msgHash = cipher.hashMessage(msg);
    const cipherDid = await gatekeeper.generateDid({
        controller: id.did,
        data: {
            sender: id.did,
            created: new Date().toISOString(),
            cipher_hash: msgHash,
            cipher_sender: cipher_sender,
            cipher_receiver: cipher_receiver,
        }
    });

    return cipherDid;
}

export async function decrypt(did) {
    const wallet = loadWallet();
    const id = getCurrentId();
    const dataDocJson = await gatekeeper.resolveDid(did);
    const dataDoc = JSON.parse(dataDocJson);
    const crypt = dataDoc.didDocumentMetadata?.data;

    if (!crypt || !crypt.cipher_hash) {
        throw "DID is not encrypted";
    }

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

    throw 'Cannot decrypt';
}

export async function encryptJSON(json, did) {
    const plaintext = JSON.stringify(json);
    return encrypt(plaintext, did);
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
        obj.signature = {
            signer: id.did,
            created: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        };
        return obj;
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

    const diddoc = await gatekeeper.resolveDid(signature.signer, signature.created);
    const doc = JSON.parse(diddoc);

    // TBD get the right signature, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;

    try {
        return cipher.verifySig(msgHash, signature.value, publicJwk);
    }
    catch (error) {
        return false;
    }
}

async function updateDoc(did, doc) {
    const txn = {
        op: "update",
        time: new Date().toISOString(),
        did: did,
        doc: doc,
    };

    const signed = await addSignature(txn);
    const ok = gatekeeper.updateDoc(signed);
    return ok;
}

function addToManifest(did) {
    const wallet = loadWallet();
    const id = wallet.ids[wallet.current];
    const manifest = new Set(id.manifest);

    manifest.add(did);
    id.manifest = Array.from(manifest);

    saveWallet(wallet);
    return true;
}

function removeFromManifest(did) {
    const wallet = loadWallet();
    const id = wallet.ids[wallet.current];
    const manifest = new Set(id.manifest);

    manifest.delete(did);
    id.manifest = Array.from(manifest);

    saveWallet(wallet);
    return true;
}

export async function resolveDid(did) {
    const doc = JSON.parse(await gatekeeper.resolveDid(did));
    return doc;
}

export async function createId(name) {
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
    const did = await gatekeeper.generateDid(keypair.publicJwk);

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
    const doc = JSON.parse(await gatekeeper.resolveDid(id.did));
    const vmethod = doc.didDocument.verificationMethod[0];

    vmethod.id = `#key-${nextIndex + 1}`;
    vmethod.publicKeyJwk = keypair.publicJwk;
    doc.didDocument.authentication = [vmethod.id];

    const ok = await updateDoc(id.did, doc);

    if (ok) {
        id.index = nextIndex;
        saveWallet(wallet);
        return doc;
    }
    else {
        throw 'cannot rotate keys';
    }
}

export async function createData(data) {

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
    const did = await gatekeeper.generateDid({
        controller: id.did,
        data: data,
    });

    addToManifest(did);
    return did;
}

export async function createCredential(schema) {
    // TBD validate schema
    return createData(schema);
}

export async function bindCredential(credentialDid, subjectDid, validUntil = null) {
    const id = getCurrentId();
    const schemaDoc = JSON.parse(await gatekeeper.resolveDid(credentialDid));
    const credential = JSONSchemaFaker.generate(schemaDoc.didDocumentMetadata.data);

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

export async function attestCredential(vc) {
    const id = getCurrentId();

    if (vc.issuer !== id.did) {
        throw 'Invalid VC';
    }

    const signed = await addSignature(vc);
    const cipherDid = await encryptJSON(signed, vc.credentialSubject.id);
    addToManifest(cipherDid);
    return cipherDid;
}

export async function revokeCredential(did) {
    return updateDoc(did, {});
}

export async function acceptCredential(did) {
    try {
        const id = getCurrentId();
        const vc = await decryptJSON(did);

        if (vc.credentialSubject.id !== id.did) {
            throw 'VC not valid or not assigned to this ID';
        }

        return addToManifest(did);
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

    //console.log(credential);

    for (let did of id.manifest) {
        // console.log('manifest', did);
        try {
            const doc = await decryptJSON(did);

            // console.log(doc);

            if (!doc.issuer) {
                // Not a VC
                //console.log('not a VC');
                continue;
            }

            if (doc.credentialSubject?.id !== id.did) {
                // This VC is issued by the ID, not held
                //console.log('VC not held by me');
                continue;
            }

            if (credential.attestors) {
                if (!credential.attestors.includes(doc.issuer)) {
                    // Attestor not trusted by Verifier
                    //console.log('attestor not trusted');
                    continue;
                }
            }

            if (doc.type) {
                if (!doc.type.includes(credential.schema)) {
                    // Wrong type
                    //console.log('wrong VC schema');
                    continue;
                }
            }

            // TBD test for VC expiry too

            //console.log('types', doc.type);
            //console.log('issuer', doc.issuer);

            return did;
        }
        catch (error) {
            // Not encrypted, so can't be a VC
            // console.log(error);
        }
    }
}

export async function createVP(did) {
    const id = getCurrentId();
    const wrapper = await decryptJSON(did);

    //console.log(wrapper);

    if (!wrapper.challenge || wrapper.to !== id.did) {
        throw "Invalid challenge";
    }

    const challengeDoc = JSON.parse(await gatekeeper.resolveDid(wrapper.challenge));

    //console.log(JSON.stringify(challengeDoc, null, 4));

    const credentials = challengeDoc.didDocumentMetadata.data.credentials;

    //console.log(JSON.stringify(credentials, null, 4));

    const matches = [];

    for (let credential of credentials) {
        const vc = await findMatchingCredential(credential);
        //console.log('found', did);
        if (vc) {
            matches.push(vc);
        }
    }

    if (!matches) {
        throw "VCs don't match challenge";
    }

    //console.log(wrapper);
    //console.log(matches);

    const pairs = [];

    for (let vcDid of matches) {
        const plaintext = await decrypt(vcDid);
        const vpDid = await encrypt(plaintext, wrapper.from);
        pairs.push({ vc: vcDid, vp: vpDid });
    }

    const vp = {
        controller: id.did,
        data: {
            challenge: did,
            credentials: pairs,
        }
    };

    //console.log(vp);

    // Do we want to use createData here and add to our manifest or not?
    const wrapperDid = await gatekeeper.generateDid(vp);
    return wrapperDid;
}

export async function verifyVP(did) {
    const vpsdoc = JSON.parse(await gatekeeper.resolveDid(did));
    const credentials = vpsdoc.didDocumentMetadata.data.credentials;
    const vps = [];

    for (let credential of credentials) {
        const vcdoc = JSON.parse(await gatekeeper.resolveDid(credential.vc));
        const vpdoc = JSON.parse(await gatekeeper.resolveDid(credential.vp));
        const vchash = vcdoc.didDocumentMetadata.data.cipher_hash;
        const vphash = vpdoc.didDocumentMetadata.data.cipher_hash;

        if (vchash !== vphash) {
            throw 'cannot verify (VP does not match VC)';
        }

        const vp = await decryptJSON(credential.vp);
        const isValid = await verifySignature(vp);

        if (!isValid) {
            throw 'cannot verify (signature invalid)';
        }

        vps.push(vp);
    }

    const challengeDid = vpsdoc.didDocumentMetadata.data.challenge;
    const challengeDoc = JSON.parse(await gatekeeper.resolveDid(challengeDid));
    // TBD ensure VPs match challenge

    return vps;
}
