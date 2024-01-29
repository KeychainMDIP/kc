import fs from 'fs';
import * as bip39 from 'bip39';
import HDKey from 'hdkey';
import canonicalize from 'canonicalize';
import { JSONSchemaFaker } from "json-schema-faker";
import * as cipher from './cipher.js';
import * as gatekeeper from './gatekeeper.js';

const walletName = 'wallet.json';
export const wallet = loadWallet() || initializeWallet();

function loadWallet() {
    if (fs.existsSync(walletName)) {
        const walletJson = fs.readFileSync(walletName);
        return JSON.parse(walletJson);
    }
}

function saveWallet(w = wallet) {
    fs.writeFileSync(walletName, JSON.stringify(w, null, 4));
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

function currentKeyPair(id) {
    if (!id) {
        throw "No current ID selected";
    }

    const hdkey = HDKey.fromJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${id.account}'/0/${id.index}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);

    return keypair;
}

export async function encrypt(msg, did) {
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
    const dataDocJson = await gatekeeper.resolveDid(did);
    const dataDoc = JSON.parse(dataDocJson);
    const crypt = dataDoc.didDocumentMetadata?.data;
    const id = wallet.ids[wallet.current];

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

    throw 'nope!';
}

async function signJson(json) {
    const id = wallet.ids[wallet.current];
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

async function updateDoc(did, doc) {
    const txn = {
        op: "update",
        time: new Date().toISOString(),
        did: did,
        doc: doc,
    };

    const signed = await signJson(txn);
    const ok = gatekeeper.updateDoc(signed);
    return ok;
}

function addToManifest(did) {
    const id = wallet.ids[wallet.current];
    const manifest = new Set(id.manifest);

    manifest.add(did);
    id.manifest = Array.from(manifest);

    saveWallet();
    return true;
}

function removeFromManifest(did) {
    const id = wallet.ids[wallet.current];
    const manifest = new Set(id.manifest);

    manifest.delete(did);
    id.manifest = Array.from(manifest);

    saveWallet();
    return true;
}

export async function resolveDid(did) {
    const doc = JSON.parse(await gatekeeper.resolveDid(did));
    return doc;
}

export async function createId(name) {
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
    saveWallet();

    return (did);
}

export function removeId(name) {
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

export function listIds() {
    return Object.keys(wallet.ids);
}

export function useId(name) {
    if (wallet.ids.hasOwnProperty(name)) {
        wallet.current = name;
        saveWallet();
    }
    else {
        throw `No ID named ${name}`;
    }
}

export async function rotateKeys() {
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
    const id = wallet.ids[wallet.current];
    const did = await gatekeeper.generateDid({
        controller: id.did,
        data: data,
    });

    addToManifest(did);
    return did;
}

export async function createVC(schemaDid, subjectDid, validUntil = null) {
    const id = wallet.ids[wallet.current];
    const schemaDoc = JSON.parse(await gatekeeper.resolveDid(schemaDid));
    const credential = JSONSchemaFaker.generate(schemaDoc.didDocumentMetadata.data);

    const vc = {
        "@context": [
            "https://www.w3.org/ns/credentials/v2",
            "https://www.w3.org/ns/credentials/examples/v2"
        ],
        type: ["VerifiableCredential", schemaDid],
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

export async function attestVC(file) {
    const vc = JSON.parse(fs.readFileSync(file).toString());
    const signed = await signJson(vc);
    const msg = JSON.stringify(signed);
    const cipherDid = await encrypt(msg, vc.credentialSubject.id);
    addToManifest(cipherDid);
    return cipherDid;
}

export async function revokeVC(did) {
    const ok = await updateDoc(did, {});
    return ok;
}

export async function acceptVC(did) {
    const id = wallet.ids[wallet.current];
    const vc = JSON.parse(await decrypt(did));

    if (vc.credentialSubject.id !== id.did) {
        throw 'VC not valid or not assigned to this ID';
    }

    return addToManifest(did);
}

export async function issueChallenge(challenge, user, expiresIn = 24) {
    const id = wallet.ids[wallet.current];
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
    const signed = await signJson(issue);
    const msg = JSON.stringify(signed);
    const cipherDid = await encrypt(msg, user);
    return cipherDid;
}

async function findMatchingCredential(credential) {
    const id = wallet.ids[wallet.current];

    console.log(credential);

    for (let did of id.manifest) {
        console.log('manifest', did);
        try {
            const doc = JSON.parse(await decrypt(did));

            // console.log(doc);

            if (!doc.issuer) {
                // Not a VC
                console.log('not a VC');
                continue;
            }

            if (doc.credentialSubject?.id !== id.did) {
                // This VC is issued by the ID, not held
                console.log('VC not held by me');
                continue;
            }

            if (credential.attestors) {
                if (!credential.attestors.includes(doc.issuer)) {
                    // Attestor not trusted by Verifier
                    console.log('attestor not trusted');
                    continue;
                }
            }

            if (doc.type) {
                if (!doc.type.includes(credential.schema)) {
                    // Wrong type
                    console.log('wrong VC schema');
                    continue;
                }
            }

            // TBD test for VC expiry too

            console.log('types', doc.type);
            console.log('issuer', doc.issuer);

            return did;
        }
        catch (error) {
            // Not encrypted, so can't be a VC
            // console.log(error);
        }
    }
}

export async function createVP(did) {
    const id = wallet.ids[wallet.current];
    const wrapper = JSON.parse(await decrypt(did));

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
        console.log('found', did);
        if (vc) {
            matches.push(vc);
        }
    }

    if (!matches) {
        throw "VCs don't match challenge";
    }

    console.log(wrapper);
    console.log(matches);

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

    console.log(vp);

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

        const vp = JSON.parse(await decrypt(credential.vp));
        const isValid = await verifySig(vp);

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
