import fs from 'fs';
import { JSONSchemaFaker } from "json-schema-faker";
import * as cipher from './cipher.js';

let gatekeeper = null;
const dataFolder = 'data';
const walletName = `${dataFolder}/wallet.json`;
const defaultRegistry = 'hyperswarm';

export async function start(gk) {
    gatekeeper = gk;
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

export function newWallet(mnemonic, overwrite = false) {
    if (fs.existsSync(walletName) && !overwrite) {
        throw "Wallet already exists";
    }

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

export async function resolveSeedBank() {
    const keypair = hdKeyPair();

    const operation = {
        type: "create",
        created: new Date(0).toISOString(),
        mdip: {
            version: 1,
            type: "agent",
            registry: defaultRegistry,
        },
        publicJwk: keypair.publicJwk,
    };

    const msgHash = cipher.hashJSON(operation);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);
    const signed = {
        ...operation,
        signature: {
            signed: new Date(0).toISOString(),
            hash: msgHash,
            value: signature
        }
    }
    const did = await gatekeeper.createDID(signed);
    const doc = await gatekeeper.resolveDID(did);

    return doc;
}

async function updateSeedBank(doc) {
    const keypair = hdKeyPair();
    const did = doc.didDocument.id;
    const current = await gatekeeper.resolveDID(did);
    const prev = cipher.hashJSON(current);

    const operation = {
        type: "update",
        did: did,
        doc: doc,
        prev: prev,
    };

    const msgHash = cipher.hashJSON(operation);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);
    const signed = {
        ...operation,
        signature: {
            signer: did,
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };

    const ok = await gatekeeper.updateDID(signed);
    return ok;
}

export async function backupWallet(registry = defaultRegistry) {
    const wallet = loadWallet();
    const keypair = hdKeyPair();
    const seedBank = await resolveSeedBank();
    const msg = JSON.stringify(wallet);
    const backup = cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
    const operation = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "asset",
            registry: registry,
        },
        controller: seedBank.didDocument.id,
        data: { backup: backup },
    };
    const msgHash = cipher.hashJSON(operation);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);
    const signed = {
        ...operation,
        signature: {
            signer: seedBank.didDocument.id,
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };
    const backupDID = await gatekeeper.createDID(signed);

    seedBank.didDocumentData.wallet = backupDID;
    await updateSeedBank(seedBank);

    return backupDID;
}

export async function recoverWallet(did) {
    const keypair = hdKeyPair();

    if (!did) {
        const seedBank = await resolveSeedBank();
        did = seedBank.didDocumentData.wallet;
    }

    const data = await resolveAsset(did);
    const backup = cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, data.backup);
    const wallet = JSON.parse(backup);

    return wallet;
}

export function getCurrentIdName() {
    const wallet = loadWallet();
    return wallet.current;
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

export async function encrypt(msg, did, encryptForSender = true, registry = defaultRegistry) {
    const id = getCurrentId();
    const keypair = currentKeyPair();
    const doc = await resolveDID(did);
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const cipher_sender = encryptForSender ? cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg) : null;
    const cipher_receiver = cipher.encryptMessage(publicJwk, keypair.privateJwk, msg);
    const msgHash = cipher.hashMessage(msg);
    const cipherDid = await createAsset({
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
    const ciphertext = (crypt.sender === id.did && crypt.cipher_sender) ? crypt.cipher_sender : crypt.cipher_receiver;

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

    const operation = {
        type: "update",
        did: did,
        doc: doc,
        prev: prev,
    };

    const signed = await addSignature(operation);
    return gatekeeper.updateDID(signed);
}

async function revokeDID(did) {
    const current = await resolveDID(did);
    const prev = cipher.hashJSON(current);

    const operation = {
        type: "delete",
        did: did,
        prev: prev,
    };

    const signed = await addSignature(operation);
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

export async function resolveDID(did, asof, confirm) {
    const doc = await gatekeeper.resolveDID(lookupDID(did), asof, confirm);
    return doc;
}

export async function resolveAsset(did) {
    const doc = await resolveDID(did);

    if (doc?.didDocumentMetadata) {
        if (!doc.didDocumentMetadata.deactivated) {
            return doc.didDocumentData;
        }
    }

    return null;
}

export async function createId(name, registry = defaultRegistry) {
    const wallet = loadWallet();
    if (wallet.ids && Object.prototype.hasOwnProperty.call(wallet.ids, name)) {
        throw `Already have an ID named ${name}`;
    }

    const account = wallet.counter;
    const index = 0;
    const hdkey = cipher.generateHDKeyJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${account}'/0/${index}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);

    const operation = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "agent",
            registry: registry,
        },
        publicJwk: keypair.publicJwk,
    };

    const msgHash = cipher.hashJSON(operation);
    const signature = await cipher.signHash(msgHash, keypair.privateJwk);
    const signed = {
        ...operation,
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
    let ids = Object.keys(wallet.ids);

    if (ids.includes(name)) {
        delete wallet.ids[name];

        if (wallet.current === name) {
            ids = Object.keys(wallet.ids);
            wallet.current = ids.length > 0 ? ids[0] : '';
        }

        saveWallet(wallet);
        return true;
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
    const registry = doc.mdip.registry;
    const vaultDid = await createAsset({ backup: backup }, registry);

    doc.didDocumentData.vault = vaultDid;
    const ok = await updateDID(id.did, doc);

    return ok;
}

export async function recoverId(did) {
    try {
        const wallet = loadWallet();
        const keypair = hdKeyPair();
        const doc = await resolveDID(did);
        const vault = await resolveAsset(doc.didDocumentData.vault);
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
    if (Object.prototype.hasOwnProperty.call(wallet.ids, name)) {
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

    if (Object.prototype.hasOwnProperty.call(wallet.names, name)) {
        throw `Name already in use`;
    }

    wallet.names[name] = did;
    saveWallet(wallet);

    return true;
}

export function removeName(name) {
    const wallet = loadWallet();

    if (wallet.names) {
        if (Object.prototype.hasOwnProperty.call(wallet.names, name)) {
            delete wallet.names[name];
            saveWallet(wallet);
        }
    }

    return true;
}

export function lookupDID(name) {
    try {
        if (name.startsWith('did:')) {
            return name;
        }
    }
    catch {
        throw "Invalid DID";
    }

    const wallet = loadWallet();

    if (wallet.names) {
        if (Object.prototype.hasOwnProperty.call(wallet.names, name)) {
            return wallet.names[name];
        }
    }

    if (wallet.ids) {
        if (Object.prototype.hasOwnProperty.call(wallet.ids, name)) {
            return wallet.ids[name].did;
        }
    }

    throw "Unknown DID";
}

export async function createAsset(data, registry = defaultRegistry) {

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

    const operation = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "asset",
            registry: registry,
        },
        controller: id.did,
        data: data,
    };

    const signed = await addSignature(operation);
    const did = await gatekeeper.createDID(signed);

    addToOwned(did);
    return did;
}

export async function createCredential(schema) {
    // TBD validate schema
    return createAsset(schema);
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

        if (!doc.didDocumentData.manifest) {
            doc.didDocumentData.manifest = {};
        }

        if (!reveal) {
            // Remove the credential values
            vc.credential = null;
        }
        doc.didDocumentData.manifest[credential] = vc;

        await updateDID(id.did, doc);

        return vc;
    }
    catch (error) {
        return error;
    }
}

export async function unpublishCredential(did) {
    const id = getCurrentId();
    const doc = await resolveDID(id.did);
    const credential = lookupDID(did);
    const manifest = doc.didDocumentData.manifest;

    if (credential && manifest && Object.prototype.hasOwnProperty.call(manifest, credential)) {
        delete manifest[credential];
        await updateDID(id.did, doc);

        return `OK credential ${did} removed from manifest`;
    }

    throw `Error: credential ${did} not found in manifest`;
}

export async function createChallenge(challenge) {

    if (!challenge) {
        challenge = { credentials: [] };
    }

    // TBD: replace with challenge schema validation

    if (!challenge?.credentials) {
        throw "Invalid input";
    }

    if (!Array.isArray(challenge.credentials)) {
        throw "Invalid input";
    }

    return createAsset(challenge);
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

export async function verifyResponse(responseDID, challengeDID) {
    responseDID = lookupDID(responseDID);
    challengeDID = lookupDID(challengeDID);

    if (!responseDID) {
        throw "Invalid response";
    }

    const response = await decryptJSON(responseDID);
    const challenge = await resolveAsset(challengeDID);

    if (response.challenge !== challengeDID) {
        response.match = false;
        return response;
    }

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

        // Check VP against VCs specified in challenge
        if (vp.type.length > 1 && vp.type[1].startsWith('did:')) {
            const schema = vp.type[1];
            const credential = challenge.credentials.find(item => item.schema === schema);

            if (!credential) {
                continue;
            }

            // Check if issuer of VP is in the trusted attestor list
            if (credential.attestors && credential.attestors.length > 0) {
                if (!credential.attestors.includes(vp.issuer)) {
                    continue;
                }
            }
        }

        vps.push(vp);
    }

    response.vps = vps;
    response.match = vps.length === challenge.credentials.length;

    return response;
}

export async function exportDID(did) {
    return gatekeeper.exportDID(lookupDID(did));
}

export async function importDID(ops) {
    return gatekeeper.importDID(ops);
}

export async function createGroup(name) {
    const group = {
        name: name,
        members: []
    };

    return createAsset(group);
}

export async function groupAdd(group, member) {
    const didGroup = lookupDID(group);
    const doc = await resolveDID(didGroup);
    const data = doc.didDocumentData;

    if (!data.members) {
        throw "Invalid group";
    }

    const didMember = lookupDID(member);

    if (didMember === didGroup) {
        throw "Invalid member";
    }

    const isMember = await groupTest(member, group);

    if (isMember) {
        throw "Invalid member";
    }

    // test for valid member DID
    await resolveDID(didMember);

    const members = new Set(data.members);
    members.add(didMember);
    data.members = Array.from(members);

    const ok = await updateDID(didGroup, doc);

    if (!ok) {
        throw `Error: can't update ${group}`
    }

    return data;
}

export async function groupRemove(group, member) {
    const didGroup = lookupDID(group);
    const doc = await resolveDID(didGroup);
    const data = doc.didDocumentData;

    if (!data.members) {
        throw "Invalid group";
    }

    const didMember = lookupDID(member);
    // test for valid member DID
    await resolveDID(didMember);

    const members = new Set(data.members);
    members.delete(didMember);
    data.members = Array.from(members);

    const ok = await updateDID(didGroup, doc);

    if (!ok) {
        throw `Error: can't update ${group}`
    }

    return data;
}

export async function groupTest(group, member) {
    const didGroup = lookupDID(group);

    if (!didGroup) {
        return false;
    }

    const doc = await resolveDID(didGroup);

    if (!doc) {
        return false;
    }

    const data = doc.didDocumentData;

    if (!data) {
        return false;
    }

    if (!Array.isArray(data.members)) {
        return false;
    }

    if (!member) {
        return true;
    }

    const didMember = lookupDID(member);
    let isMember = data.members.includes(didMember);

    if (!isMember) {
        for (const did of data.members) {
            isMember = await groupTest(did, didMember);

            if (isMember) {
                break;
            }
        }
    }

    return isMember;
}

export async function createSchema(schema) {
    try {
        // Validate schema
        JSONSchemaFaker.generate(schema);
    }
    catch {
        throw "Invalid schema";
    }

    return createAsset(schema);
}

export async function createTemplate(did) {
    const didSchema = lookupDID(did);
    const schema = await resolveAsset(didSchema);
    const template = JSONSchemaFaker.generate(schema);

    template['$schema'] = didSchema;

    return template;
}

export async function pollTemplate() {
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);

    return {
        type: 'poll',
        version: 1,
        description: 'What is this poll about?',
        roster: 'DID of the eligible voter group',
        options: ['yes', 'no', 'abstain'],
        deadline: nextWeek.toISOString(),
    };
}

export async function createPoll(poll) {
    if (poll.type !== 'poll') {
        throw "Invalid poll type";
    }

    if (poll.version !== 1) {
        throw "Invalid poll version";
    }

    if (!poll.description) {
        throw "Invalid poll description";
    }

    if (!poll.options || !Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 10) {
        throw "Invalid poll options";
    }

    if (!poll.roster) {
        throw "Invalid poll roster";
    }

    try {
        const isValidGroup = await groupTest(poll.roster);

        if (!isValidGroup) {
            throw "Invalid poll roster";
        }
    }
    catch {
        throw "Invalid poll roster";
    }

    if (!poll.deadline) {
        throw "Invalid poll deadline";
    }

    const deadline = new Date(poll.deadline);

    if (isNaN(deadline.getTime())) {
        throw "Invalid poll deadline";
    }

    if (deadline < new Date()) {
        throw "Invalid poll deadline";
    }

    // TBD validate poll
    return createAsset(poll);
}

export async function viewPoll(poll) {
    const id = getCurrentId();
    const didPoll = lookupDID(poll);
    const doc = await resolveDID(didPoll);
    const data = doc.didDocumentData;

    if (!data || !data.options || !data.deadline) {
        throw "Invalid poll";
    }

    let hasVoted = false;

    if (data.ballots) {
        hasVoted = !!data.ballots[id.did];
    }

    const voteExpired = Date(data.deadline) > new Date();
    const isEligible = await groupTest(data.roster, id.did);

    const view = {
        description: data.description,
        options: data.options,
        deadline: data.deadline,
        isOwner: (doc.didDocument.controller === id.did),
        isEligible: isEligible,
        voteExpired: voteExpired,
        hasVoted: hasVoted,
    };

    if (id.did === doc.didDocument.controller) {
        let voted = 0;

        const results = {
            tally: [],
            ballots: [],
        }

        results.tally.push({
            vote: 0,
            option: 'spoil',
            count: 0,
        });

        for (let i = 0; i < data.options.length; i++) {
            results.tally.push({
                vote: i + 1,
                option: data.options[i],
                count: 0,
            });
        }

        for (let voter in data.ballots) {
            const ballot = data.ballots[voter];
            const decrypted = await decryptJSON(ballot.ballot);
            const vote = decrypted.vote;
            results.ballots.push({
                ...ballot,
                voter: voter,
                vote: vote,
                option: data.options[vote - 1],
            });
            voted += 1;
            results.tally[vote].count += 1;
        }

        const roster = await resolveAsset(data.roster);
        const total = roster.members.length;

        results.votes = {
            eligible: total,
            received: voted,
            pending: total - voted,
        };
        results.final = voteExpired || (voted === total);

        view.results = results;
    }

    return view;
}

export async function votePoll(poll, vote, spoil = false) {
    const id = getCurrentId();
    const didPoll = lookupDID(poll);
    const doc = await resolveDID(didPoll);
    const data = doc.didDocumentData;
    const eligible = await groupTest(data.roster, id.did);
    const expired = (Date(data.deadline) > new Date());
    const owner = doc.didDocument.controller;

    if (!eligible) {
        throw "Not eligible to vote on this poll";
    }

    if (expired) {
        throw "The deadline to vote has passed for this poll";
    }

    let ballot;

    if (spoil) {
        ballot = {
            poll: didPoll,
            vote: 0,
        };
    }
    else {
        const max = data.options.length;
        vote = parseInt(vote);

        if (!Number.isInteger(vote) || vote < 1 || vote > max) {
            throw `Vote must be a number between 1 and ${max}`;
        }

        ballot = {
            poll: didPoll,
            vote: vote,
        };
    }

    // Encrypt for receiver only
    const didBallot = await encryptJSON(ballot, owner, false);

    return didBallot;
}

export async function updatePoll(ballot) {
    const id = getCurrentId();

    const didBallot = lookupDID(ballot);
    const docBallot = await resolveDID(didBallot);
    const didVoter = docBallot.didDocument.controller;
    let dataBallot;

    try {
        dataBallot = await decryptJSON(didBallot);

        if (!dataBallot.poll || !dataBallot.vote) {
            throw "Invalid ballot";
        }
    }
    catch {
        throw "Invalid ballot";
    }

    const didPoll = lookupDID(dataBallot.poll);
    const docPoll = await resolveDID(didPoll);
    const dataPoll = docPoll.didDocumentData;
    const didOwner = docPoll.didDocument.controller;

    if (id.did !== didOwner) {
        throw "Only poll owners can add a ballot";
    }

    const eligible = await groupTest(dataPoll.roster, didVoter);

    if (!eligible) {
        throw "Voter not eligible to vote on this poll";
    }

    const expired = (Date(dataPoll.deadline) > new Date());

    if (expired) {
        throw "The deadline to vote has passed for this poll";
    }

    const max = dataPoll.options.length;
    const vote = parseInt(dataBallot.vote);

    if (!vote || vote < 0 || vote > max) {
        throw "Invalid ballot vote";
    }

    if (!dataPoll.ballots) {
        dataPoll.ballots = {};
    }

    dataPoll.ballots[didVoter] = {
        ballot: didBallot,
        received: new Date().toISOString(),
    };

    const ok = await updateDID(didPoll, docPoll);

    return ok;
}

export async function publishPoll(poll, reveal = false) {
    const id = getCurrentId();
    const didPoll = lookupDID(poll);
    const doc = await resolveDID(didPoll);
    const owner = doc.didDocument.controller;

    if (id.did !== owner) {
        throw "Only poll owners can publish";
    }

    const view = await viewPoll(poll);

    if (!view.results.final) {
        throw "Poll can be published only when results are final";
    }

    if (!reveal) {
        delete view.results.ballots;
    }

    doc.didDocumentData.results = view.results;

    const ok = await updateDID(didPoll, doc);

    return ok;
}

export async function unpublishPoll(poll) {
    const id = getCurrentId();
    const didPoll = lookupDID(poll);
    const doc = await resolveDID(didPoll);
    const owner = doc.didDocument.controller;

    if (id.did !== owner) {
        throw "Only poll owners can unpublish";
    }

    delete doc.didDocumentData.results;

    const ok = await updateDID(didPoll, doc);

    return ok;
}
