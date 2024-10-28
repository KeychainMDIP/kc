import { JSONSchemaFaker } from "json-schema-faker";
import * as exceptions from '@mdip/exceptions';

let gatekeeper = null;
let db = null;
let cipher = null;

const defaultRegistry = 'TFTC';
const ephemeralRegistry = 'hyperswarm';

export async function start(options = {}) {
    if (options.gatekeeper) {
        gatekeeper = options.gatekeeper;

        if (!gatekeeper.createDID) {
            throw new Error(exceptions.INVALID_PARAMETER);
        }
    }
    else {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (options.wallet) {
        db = options.wallet;

        if (!db.loadWallet) {
            throw new Error(exceptions.INVALID_PARAMETER);
        }
    }
    else {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (options.cipher) {
        cipher = options.cipher;

        if (!cipher.verifySig) {
            throw new Error(exceptions.INVALID_PARAMETER);
        }
    }
    else {
        throw new Error(exceptions.INVALID_PARAMETER);
    }
}

export async function stop() {
    return gatekeeper.stop();
}

export async function listRegistries() {
    return gatekeeper.listRegistries();
}

export async function loadWallet() {
    let wallet = await db.loadWallet();

    if (!wallet) {
        wallet = await newWallet();
    }

    return wallet;
}

export async function saveWallet(wallet, overwrite = true) {
    // TBD validate wallet before saving
    return db.saveWallet(wallet, overwrite);
}

export async function newWallet(mnemonic, overwrite = false) {
    let wallet;

    try {
        if (!mnemonic) {
            mnemonic = cipher.generateMnemonic();
        }
        const hdkey = cipher.generateHDKey(mnemonic);
        const keypair = cipher.generateJwk(hdkey.privateKey);
        const backup = cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, mnemonic);

        wallet = {
            seed: {
                mnemonic: backup,
                hdkey: hdkey.toJSON(),
            },
            counter: 0,
            ids: {},
        }
    }
    catch (error) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const ok = await db.saveWallet(wallet, overwrite)
    if (!ok) {
        throw new Error(exceptions.UPDATE_FAILED);
    }

    return wallet;
}

export async function decryptMnemonic() {
    const wallet = await loadWallet();
    const keypair = await hdKeyPair();

    return cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, wallet.seed.mnemonic);
}

export async function checkWallet() {
    const wallet = await loadWallet();

    let checked = 0;
    let invalid = 0;
    let deleted = 0;

    // Validate keys
    await resolveSeedBank();

    for (const name of Object.keys(wallet.ids)) {
        try {
            const doc = await resolveDID(wallet.ids[name].did);

            if (doc.didDocumentMetadata.deactivated) {
                deleted += 1;
            }
        }
        catch (error) {
            invalid += 1;
        }

        checked += 1;
    }

    for (const id of Object.values(wallet.ids)) {
        if (id.owned) {
            for (const did of id.owned) {
                try {
                    const doc = await resolveDID(did);

                    if (doc.didDocumentMetadata.deactivated) {
                        deleted += 1;
                    }
                }
                catch (error) {
                    invalid += 1;
                }

                checked += 1;
            }
        }

        if (id.held) {
            for (const did of id.held) {
                try {
                    const doc = await resolveDID(did);

                    if (doc.didDocumentMetadata.deactivated) {
                        deleted += 1;
                    }
                }
                catch (error) {
                    invalid += 1;
                }

                checked += 1;
            }
        }
    }

    if (wallet.names) {
        for (const name of Object.keys(wallet.names)) {
            try {
                const doc = await resolveDID(wallet.names[name]);

                if (doc.didDocumentMetadata.deactivated) {
                    deleted += 1;
                }
            }
            catch (error) {
                invalid += 1;
            }

            checked += 1;
        }
    }

    return { checked, invalid, deleted };
}

export async function fixWallet() {
    const wallet = await loadWallet();
    let idsRemoved = 0;
    let ownedRemoved = 0;
    let heldRemoved = 0;
    let namesRemoved = 0;

    for (const name of Object.keys(wallet.ids)) {
        let remove = false;

        try {
            const doc = await resolveDID(wallet.ids[name].did);

            if (doc.didDocumentMetadata.deactivated) {
                remove = true;
            }
        }
        catch (error) {
            remove = true;
        }

        if (remove) {
            delete wallet.ids[name];
            idsRemoved += 1;
        }
    }

    for (const id of Object.values(wallet.ids)) {
        if (id.owned) {
            for (let i = 0; i < id.owned.length; i++) {
                let remove = false;

                try {
                    const doc = await resolveDID(id.owned[i]);

                    if (doc.didDocumentMetadata.deactivated) {
                        remove = true;
                    }
                }
                catch {
                    remove = true;
                }

                if (remove) {
                    id.owned.splice(i, 1);
                    i--; // Decrement index to account for the removed item
                    ownedRemoved += 1;
                }
            }
        }

        if (id.held) {
            for (let i = 0; i < id.held.length; i++) {
                let remove = false;

                try {
                    const doc = await resolveDID(id.held[i]);

                    if (doc.didDocumentMetadata.deactivated) {
                        remove = true;
                    }
                }
                catch {
                    remove = true;
                }

                if (remove) {
                    id.held.splice(i, 1);
                    i--; // Decrement index to account for the removed item
                    heldRemoved += 1;
                }
            }
        }
    }

    if (wallet.names) {
        for (const name of Object.keys(wallet.names)) {
            let remove = false;

            try {
                const doc = await resolveDID(wallet.names[name]);

                if (doc.didDocumentMetadata.deactivated) {
                    remove = true;
                }
            }
            catch (error) {
                remove = true;
            }

            if (remove) {
                delete wallet.names[name];
                namesRemoved += 1;
            }
        }
    }

    await saveWallet(wallet);

    return { idsRemoved, ownedRemoved, heldRemoved, namesRemoved };
}

export async function resolveSeedBank() {
    const keypair = await hdKeyPair();

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
    const signature = cipher.signHash(msgHash, keypair.privateJwk);
    const signed = {
        ...operation,
        signature: {
            signed: new Date(0).toISOString(),
            hash: msgHash,
            value: signature
        }
    }
    const did = await gatekeeper.createDID(signed);
    return gatekeeper.resolveDID(did);
}

async function updateSeedBank(doc) {
    const keypair = await hdKeyPair();
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
    const signature = cipher.signHash(msgHash, keypair.privateJwk);
    const signed = {
        ...operation,
        signature: {
            signer: did,
            signed: new Date().toISOString(),
            hash: msgHash,
            value: signature,
        }
    };

    return await gatekeeper.updateDID(signed);
}

export async function backupWallet(registry = defaultRegistry) {
    const wallet = await loadWallet();
    const keypair = await hdKeyPair();
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
    const signature = cipher.signHash(msgHash, keypair.privateJwk);
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
    try {
        if (!did) {
            const seedBank = await resolveSeedBank();
            did = seedBank.didDocumentData.wallet;
        }

        const keypair = await hdKeyPair();
        const data = await resolveAsset(did);
        const backup = cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, data.backup);
        const wallet = JSON.parse(backup);

        await saveWallet(wallet);
        return wallet;
    }
    catch (error) {
        // If we can't recover the wallet, just return the current one
        return loadWallet();
    }
}

export async function listIds() {
    const wallet = await loadWallet();
    return Object.keys(wallet.ids);
}

export async function getCurrentId() {
    const wallet = await loadWallet();
    return wallet.current;
}

export async function setCurrentId(name) {
    const wallet = await loadWallet();
    if (Object.keys(wallet.ids).includes(name)) {
        wallet.current = name;
        return saveWallet(wallet);
    }
    else {
        throw new Error(exceptions.UNKNOWN_ID);
    }
}

async function fetchIdInfo(id) {
    const wallet = await loadWallet();
    let idInfo = null;

    if (id) {
        if (id.startsWith('did')) {
            for (const name of Object.keys(wallet.ids)) {
                const info = wallet.ids[name];

                if (info.did === id) {
                    idInfo = info;
                    break;
                }
            }
        }
        else {
            idInfo = wallet.ids[id];
        }
    }
    else {
        idInfo = wallet.ids[wallet.current];

        if (!idInfo) {
            throw new Error(exceptions.NO_CURRENT_ID);
        }
    }

    if (!idInfo) {
        throw new Error(exceptions.UNKNOWN_ID);
    }

    return idInfo;
}

async function hdKeyPair() {
    const wallet = await loadWallet();
    const hdkey = cipher.generateHDKeyJSON(wallet.seed.hdkey);

    return cipher.generateJwk(hdkey.privateKey);
}

async function fetchKeyPair(name = null) {
    const wallet = await loadWallet();
    const id = await fetchIdInfo(name);
    const hdkey = cipher.generateHDKeyJSON(wallet.seed.hdkey);
    const doc = await resolveDID(id.did, { confirm: true });
    const confirmedPublicKeyJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;

    for (let i = id.index; i >= 0; i--) {
        const path = `m/44'/0'/${id.account}'/0/${i}`;
        const didkey = hdkey.derive(path);
        const keypair = cipher.generateJwk(didkey.privateKey);

        if (keypair.publicJwk.x === confirmedPublicKeyJwk.x &&
            keypair.publicJwk.y === confirmedPublicKeyJwk.y
        ) {
            return keypair;
        }
    }

    return null;
}

export async function createAsset(data, options = {}) {
    let { registry, controller, validUntil } = options;

    if (!registry) {
        registry = defaultRegistry;
    }

    if (validUntil) {
        const validate = new Date(validUntil);

        if (isNaN(validate.getTime())) {
            throw new Error(exceptions.INVALID_PARAMETER);
        }
    }

    function isEmpty(data) {
        return (
            !data ||
            (Array.isArray(data) && data.length === 0) ||
            (typeof data === 'object' && Object.keys(data).length === 0)
        );
    }

    if (isEmpty(data)) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const id = await fetchIdInfo(controller);

    const operation = {
        type: "create",
        created: new Date().toISOString(),
        mdip: {
            version: 1,
            type: "asset",
            registry,
            validUntil
        },
        controller: id.did,
        data,
    };

    const signed = await addSignature(operation, controller);
    const did = await gatekeeper.createDID(signed);

    // Keep assets that will be garbage-collected out of the owned list
    if (!validUntil) {
        await addToOwned(did);
    }

    return did;
}

export async function encryptMessage(msg, receiver, options = {}) {
    let { encryptForSender } = options;

    if (typeof encryptForSender === 'undefined') {
        encryptForSender = true;
    }

    const id = await fetchIdInfo();
    const senderKeypair = await fetchKeyPair();
    const doc = await resolveDID(receiver, { confirm: true });
    const receivePublicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const cipher_sender = encryptForSender ? cipher.encryptMessage(senderKeypair.publicJwk, senderKeypair.privateJwk, msg) : null;
    const cipher_receiver = cipher.encryptMessage(receivePublicJwk, senderKeypair.privateJwk, msg);
    const msgHash = cipher.hashMessage(msg);

    return await createAsset({
        encrypted: {
            sender: id.did,
            created: new Date().toISOString(),
            cipher_hash: msgHash,
            cipher_sender: cipher_sender,
            cipher_receiver: cipher_receiver,
        }
    }, options);
}

export async function decryptMessage(did) {
    const wallet = await loadWallet();
    const id = await fetchIdInfo();
    const asset = await resolveAsset(did);

    if (!asset || (!asset.encrypted && !asset.cipher_hash)) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const crypt = asset.encrypted ? asset.encrypted : asset;
    const doc = await resolveDID(crypt.sender, { confirm: true, atTime: crypt.created });
    const senderPublicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
    const hdkey = cipher.generateHDKeyJSON(wallet.seed.hdkey);
    const ciphertext = (crypt.sender === id.did && crypt.cipher_sender) ? crypt.cipher_sender : crypt.cipher_receiver;

    // Try all private keys for this ID, starting with the most recent and working backward
    let index = id.index;
    while (index >= 0) {
        const path = `m/44'/0'/${id.account}'/0/${index}`;
        const didkey = hdkey.derive(path);
        const receiverKeypair = cipher.generateJwk(didkey.privateKey);
        try {
            return cipher.decryptMessage(senderPublicJwk, receiverKeypair.privateJwk, ciphertext);
        }
        catch (error) {
            index -= 1;
        }
    }

    throw new Error('Cannot decrypt');
}

export async function encryptJSON(json, did, options = {}) {
    const plaintext = JSON.stringify(json);
    return encryptMessage(plaintext, did, options);
}

export async function decryptJSON(did) {
    const plaintext = await decryptMessage(did);

    try {
        return JSON.parse(plaintext);
    }
    catch (error) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }
}

export async function addSignature(obj, controller = null) {
    // Fetches current ID if name is missing
    const id = await fetchIdInfo(controller);
    const keypair = await fetchKeyPair(controller);

    try {
        const msgHash = cipher.hashJSON(obj);
        const signature = cipher.signHash(msgHash, keypair.privateJwk);

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
        throw new Error(exceptions.INVALID_PARAMETER);
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

    const doc = await resolveDID(signature.signer, { atTime: signature.signed });

    // TBD get the right signature, not just the first one
    const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;

    try {
        return cipher.verifySig(msgHash, signature.value, publicJwk);
    }
    catch (error) {
        return false;
    }
}

export async function updateDID(did, doc) {
    const current = await resolveDID(did);
    const prev = cipher.hashJSON(current);

    const operation = {
        type: "update",
        did: did,
        doc: doc,
        prev: prev,
    };

    const controller = current.didDocument.controller || current.didDocument.id;
    const signed = await addSignature(operation, controller);
    return gatekeeper.updateDID(signed);
}

export async function revokeDID(did) {
    const current = await resolveDID(did);
    const prev = cipher.hashJSON(current);

    const operation = {
        type: "delete",
        did: did,
        prev: prev,
    };

    const controller = current.didDocument.controller || current.didDocument.id;
    const signed = await addSignature(operation, controller);
    const ok = gatekeeper.deleteDID(signed);

    if (ok && current.didDocument.controller) {
        await removeFromOwned(did, current.didDocument.controller);
    }

    return ok;
}

export async function addToOwned(did) {
    const wallet = await loadWallet();
    const id = wallet.ids[wallet.current];
    const owned = new Set(id.owned);

    owned.add(did);
    id.owned = Array.from(owned);

    return saveWallet(wallet);
}

async function removeFromOwned(did, owner) {
    const wallet = await loadWallet();
    const id = await fetchIdInfo(owner);

    id.owned = id.owned.filter(item => item !== did);

    return saveWallet(wallet);
}

export async function addToHeld(did) {
    const wallet = await loadWallet();
    const id = wallet.ids[wallet.current];
    const held = new Set(id.held);

    held.add(did);
    id.held = Array.from(held);

    return saveWallet(wallet);
}

async function removeFromHeld(did) {
    const wallet = await loadWallet();
    const id = wallet.ids[wallet.current];
    const held = new Set(id.held);

    if (held.delete(did)) {
        id.held = Array.from(held);
        return saveWallet(wallet);
    }

    return false;
}

export async function lookupDID(name) {
    try {
        if (name.startsWith('did:')) {
            return name;
        }
    }
    catch {
        throw new Error(exceptions.INVALID_DID);
    }

    const wallet = await loadWallet();

    if (wallet.names && Object.keys(wallet.names).includes(name)) {
        return wallet.names[name];
    }

    if (wallet.ids && Object.keys(wallet.ids).includes(name)) {
        return wallet.ids[name].did;
    }

    throw new Error(exceptions.UNKNOWN_ID);
}

export async function resolveDID(did, options = {}) {
    did = await lookupDID(did);
    return await gatekeeper.resolveDID(did, options);
}

export async function resolveAsset(did) {
    const doc = await resolveDID(did);

    if (doc?.didDocumentMetadata && !doc.didDocumentMetadata.deactivated) {
        return doc.didDocumentData;
    }

    return null;
}

export async function createId(name, options = {}) {
    let { registry } = options;

    if (!registry) {
        registry = defaultRegistry;
    }

    const wallet = await loadWallet();
    if (wallet.ids && Object.keys(wallet.ids).includes(name)) {
        throw new Error(exceptions.INVALID_PARAMETER);
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
    const signature = cipher.signHash(msgHash, keypair.privateJwk);
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
    await saveWallet(wallet);

    return did;
}

export async function removeId(name) {
    const wallet = await loadWallet();
    let ids = Object.keys(wallet.ids);

    if (ids.includes(name)) {
        delete wallet.ids[name];

        if (wallet.current === name) {
            ids = Object.keys(wallet.ids);
            wallet.current = ids.length > 0 ? ids[0] : '';
        }

        await saveWallet(wallet);
        return true;
    }
    else {
        throw new Error(exceptions.UNKNOWN_ID);
    }
}

export async function resolveId(name) {
    const id = await fetchIdInfo(name);
    return resolveDID(id.did);
}

export async function backupId(controller = null) {
    // Backs up current ID if name is missing
    const id = await fetchIdInfo(controller);
    const wallet = await loadWallet();
    const keypair = await hdKeyPair();
    const data = {
        name: controller || wallet.current,
        id: id,
    };
    const msg = JSON.stringify(data);
    const backup = cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
    const doc = await resolveDID(id.did);
    const registry = doc.mdip.registry;
    const vaultDid = await createAsset({ backup: backup }, { registry, controller });

    doc.didDocumentData.vault = vaultDid;
    return updateDID(id.did, doc);
}

export async function recoverId(did) {
    try {
        const wallet = await loadWallet();
        const keypair = await hdKeyPair();
        const doc = await resolveDID(did);
        const vault = await resolveAsset(doc.didDocumentData.vault);
        const backup = cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, vault.backup);
        const data = JSON.parse(backup);

        // TBD handle the case where name already exists in wallet
        wallet.ids[data.name] = data.id;
        wallet.current = data.name;
        wallet.counter += 1;

        await saveWallet(wallet);

        return wallet.current;
    }
    catch {
        throw new Error(exceptions.INVALID_PARAMETER);
    }
}

export async function rotateKeys() {
    const wallet = await loadWallet();
    const id = wallet.ids[wallet.current];
    const nextIndex = id.index + 1;
    const hdkey = cipher.generateHDKeyJSON(wallet.seed.hdkey);
    const path = `m/44'/0'/${id.account}'/0/${nextIndex}`;
    const didkey = hdkey.derive(path);
    const keypair = cipher.generateJwk(didkey.privateKey);
    const doc = await resolveDID(id.did);

    if (!doc.didDocumentMetadata.confirmed) {
        throw new Error('Cannot rotate keys');
    }

    const vmethod = doc.didDocument.verificationMethod[0];

    vmethod.id = `#key-${nextIndex + 1}`;
    vmethod.publicKeyJwk = keypair.publicJwk;
    doc.didDocument.authentication = [vmethod.id];

    const ok = await updateDID(id.did, doc);

    if (ok) {
        id.index = nextIndex;
        await saveWallet(wallet);
        return doc;
    }
    else {
        throw new Error('Cannot rotate keys');
    }
}

export async function listNames() {
    const wallet = await loadWallet();

    return wallet.names || {};
}

export async function addName(name, did) {
    const wallet = await loadWallet();

    if (!wallet.names) {
        wallet.names = {};
    }

    if (Object.keys(wallet.names).includes(name)) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (Object.keys(wallet.ids).includes(name)) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    wallet.names[name] = did;
    return saveWallet(wallet);
}

export async function removeName(name) {
    const wallet = await loadWallet();

    if (wallet.names && Object.keys(wallet.names).includes(name)) {
        delete wallet.names[name];
        await saveWallet(wallet);
    }

    return true;
}

export async function testAgent(id) {
    const doc = await resolveDID(id);
    return doc?.mdip?.type === 'agent';
}

export async function bindCredential(schemaId, subjectId, options = {}) {
    let { validFrom, validUntil } = options;

    if (!validFrom) {
        validFrom = new Date().toISOString();
    }

    const id = await fetchIdInfo();
    const type = await lookupDID(schemaId);
    const schema = await resolveAsset(type);
    const credential = JSONSchemaFaker.generate(schema);
    const subjectDID = await lookupDID(subjectId);

    return {
        "@context": [
            "https://www.w3.org/ns/credentials/v2",
            "https://www.w3.org/ns/credentials/examples/v2"
        ],
        type: ["VerifiableCredential", type],
        issuer: id.did,
        validFrom,
        validUntil,
        credentialSubject: {
            id: subjectDID,
        },
        credential,
    };
}

export async function issueCredential(credential, options = {}) {
    const id = await fetchIdInfo();

    if (credential.issuer !== id.did) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const signed = await addSignature(credential);
    const cipherDid = await encryptJSON(signed, credential.credentialSubject.id, options);
    await addToOwned(cipherDid);
    return cipherDid;
}

export async function updateCredential(did, credential) {
    did = await lookupDID(did);
    const originalVC = await decryptJSON(did);

    if (!originalVC.credential) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (!credential?.credential || !credential?.credentialSubject?.id) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    delete credential.signature;
    const signed = await addSignature(credential);
    const msg = JSON.stringify(signed);

    const id = await fetchIdInfo();
    const senderKeypair = await fetchKeyPair();
    const holder = credential.credentialSubject.id;
    const holderDoc = await resolveDID(holder, { confirm: true });
    const receivePublicJwk = holderDoc.didDocument.verificationMethod[0].publicKeyJwk;
    const cipher_sender = cipher.encryptMessage(senderKeypair.publicJwk, senderKeypair.privateJwk, msg);
    const cipher_receiver = cipher.encryptMessage(receivePublicJwk, senderKeypair.privateJwk, msg);
    const msgHash = cipher.hashMessage(msg);

    const doc = await resolveDID(did);
    doc.didDocumentData = {
        sender: id.did,
        created: new Date().toISOString(),
        cipher_hash: msgHash,
        cipher_sender: cipher_sender,
        cipher_receiver: cipher_receiver,
    };

    return updateDID(did, doc);
}

export async function revokeCredential(credential) {
    const did = await lookupDID(credential);
    return revokeDID(did);
}

export async function listIssued(issuer) {
    const id = await fetchIdInfo(issuer);
    const issued = [];

    if (id.owned) {
        for (const did of id.owned) {
            try {
                const credential = await decryptJSON(did);

                if (credential.issuer === id.did) {
                    issued.push(did);
                }
            }
            catch (error) {
                continue;
            }
        }
    }

    return issued;
}

export async function acceptCredential(did) {
    try {
        const id = await fetchIdInfo();
        const credential = await lookupDID(did);
        const vc = await decryptJSON(credential);

        if (vc.credentialSubject.id !== id.did) {
            throw new Error(exceptions.INVALID_PARAMETER);
        }

        return addToHeld(credential);
    }
    catch (error) {
        return false;
    }
}

export async function getCredential(id) {
    const did = await lookupDID(id);
    return decryptJSON(did);
}

export async function removeCredential(id) {
    const did = await lookupDID(id);
    return removeFromHeld(did);
}

export async function listCredentials(id) {
    const idInfo = await fetchIdInfo(id);
    return idInfo.held || [];
}

export async function publishCredential(did, options = {}) {
    const { reveal } = options;
    const id = await fetchIdInfo();
    const credential = await lookupDID(did);
    const vc = await decryptJSON(credential);

    if (vc.credentialSubject.id !== id.did) {
        throw new Error(exceptions.INVALID_PARAMETER);
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

    const ok = await updateDID(id.did, doc);

    if (ok) {
        return vc;
    }
    else {
        throw new Error(exceptions.UPDATE_FAILED);
    }
}

export async function unpublishCredential(did) {
    const id = await fetchIdInfo();
    const doc = await resolveDID(id.did);
    const credential = await lookupDID(did);
    const manifest = doc.didDocumentData.manifest;

    if (credential && manifest && Object.keys(manifest).includes(credential)) {
        delete manifest[credential];
        await updateDID(id.did, doc);

        return `OK credential ${did} removed from manifest`;
    }

    throw new Error(exceptions.INVALID_PARAMETER);
}

export async function createChallenge(challenge = {}, options = {}) {

    if (typeof challenge !== 'object' || Array.isArray(challenge)) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (typeof options !== 'object' || Array.isArray(challenge)) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (challenge.credentials && !Array.isArray(challenge.credentials)) {
        throw new Error(exceptions.INVALID_PARAMETER);

        // TBD validate each credential spec
    }

    if (!options.registry) {
        options.registry = ephemeralRegistry;
    }

    if (!options.validUntil) {
        const expires = new Date();
        expires.setHours(expires.getHours() + 1); // Add 1 hour
        options.validUntil = expires.toISOString();
    }

    return createAsset({ challenge }, options);
}

async function findMatchingCredential(credential) {
    const id = await fetchIdInfo();

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

            if (credential.issuers && !credential.issuers.includes(doc.issuer)) {
                // Attestor not trusted by Verifier
                continue;
            }

            if (doc.type && !doc.type.includes(credential.schema)) {
                // Wrong type
                continue;
            }

            // TBD test for VC expiry too
            return did;
        }
        catch (error) {
            // Not encrypted, so can't be a VC
        }
    }
}

export async function createResponse(challengeDID, options = {}) {
    let { retries, delay } = options;

    if (!retries) {
        retries = 0;
    }

    if (!delay) {
        delay = 1000;
    }

    if (!options.registry) {
        options.registry = ephemeralRegistry;
    }

    if (!options.validUntil) {
        const expires = new Date();
        expires.setHours(expires.getHours() + 1); // Add 1 hour
        options.validUntil = expires.toISOString();
    }

    let doc;

    while (retries >= 0) {
        try {
            doc = await resolveDID(challengeDID);
            break;
        } catch (error) {
            if (retries === 0) throw error; // If no retries left, throw the error
            retries--; // Decrease the retry count
            await new Promise(resolve => setTimeout(resolve, delay)); // Wait for delay milleseconds
        }
    }

    const requestor = doc.didDocument.controller;
    const { challenge } = await resolveAsset(challengeDID);

    if (!challenge) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    // TBD check challenge isValid for expired?

    const matches = [];

    if (challenge.credentials) {
        for (let credential of challenge.credentials) {
            const vc = await findMatchingCredential(credential);

            if (vc) {
                matches.push(vc);
            }
        }
    }

    const pairs = [];

    for (let vcDid of matches) {
        const plaintext = await decryptMessage(vcDid);
        const vpDid = await encryptMessage(plaintext, requestor, options);
        pairs.push({ vc: vcDid, vp: vpDid });
    }

    const requested = challenge.credentials?.length ?? 0;
    const fulfilled = matches.length;
    const match = (requested === fulfilled);

    const response = {
        challenge: challengeDID,
        credentials: pairs,
        requested: requested,
        fulfilled: fulfilled,
        match: match
    };

    return await encryptJSON({ response }, requestor, options);
}

export async function verifyResponse(responseDID, options = {}) {
    let { retries, delay } = options;

    if (!retries) {
        retries = 0;
    }

    if (!delay) {
        delay = 1000;
    }

    let responseDoc;

    while (retries >= 0) {
        try {
            responseDoc = await resolveDID(responseDID);
            break;
        } catch (error) {
            if (retries === 0) throw error; // If no retries left, throw the error
            retries--; // Decrease the retry count
            await new Promise(resolve => setTimeout(resolve, delay)); // Wait for delay milliseconds
        }
    }

    const { response } = await decryptJSON(responseDID);
    const { challenge } = await resolveAsset(response.challenge);

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

            // Check if issuer of VP is in the trusted issuer list
            if (credential.issuers && credential.issuers.length > 0 && !credential.issuers.includes(vp.issuer)) {
                continue;
            }
        }

        vps.push(vp);
    }

    response.vps = vps;
    response.match = vps.length === (challenge.credentials?.length ?? 0);
    response.responder = responseDoc.didDocument.controller;

    return response;
}

export async function createGroup(name, options = {}) {
    const group = {
        name: name,
        members: []
    };

    return createAsset(group, options);
}

export async function getGroup(id) {
    const isGroup = await testGroup(id);

    if (!isGroup) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    return resolveAsset(id);
}

export async function addGroupMember(groupId, memberId) {
    const groupDID = await lookupDID(groupId);
    const doc = await resolveDID(groupDID);
    const data = doc.didDocumentData;

    if (!data.members || !Array.isArray(data.members)) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const memberDID = await lookupDID(memberId);

    try {
        // test for valid member DID
        await resolveDID(memberDID);
    }
    catch {
        throw new Error(exceptions.INVALID_DID);
    }

    // If already a member, return immediately
    if (data.members.includes(memberDID)) {
        return data;
    }

    // Can't add a group to itself
    if (memberDID === groupDID) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    // Can't add a mutual membership relation
    const isMember = await testGroup(memberId, groupId);

    if (isMember) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const members = new Set(data.members);
    members.add(memberDID);
    data.members = Array.from(members);

    const ok = await updateDID(groupDID, doc);

    if (!ok) {
        throw new Error(exceptions.UPDATE_FAILED);
    }

    return ok;
}

export async function removeGroupMember(groupId, memberId) {
    const groupDID = await lookupDID(groupId);
    const doc = await resolveDID(groupDID);
    const data = doc.didDocumentData;

    if (!data.members) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const memberDID = await lookupDID(memberId);

    try {
        // test for valid member DID
        await resolveDID(memberDID);
    }
    catch {
        throw new Error(exceptions.INVALID_DID);
    }

    // If not already a member, return immediately
    if (!data.members.includes(memberDID)) {
        return data;
    }

    const members = new Set(data.members);
    members.delete(memberDID);
    data.members = Array.from(members);

    const ok = await updateDID(groupDID, doc);

    if (!ok) {
        throw new Error(exceptions.UPDATE_FAILED);
    }

    return data;
}

export async function testGroup(group, member) {
    const didGroup = await lookupDID(group);

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

    const didMember = await lookupDID(member);
    let isMember = data.members.includes(didMember);

    if (!isMember) {
        for (const did of data.members) {
            isMember = await testGroup(did, didMember);

            if (isMember) {
                break;
            }
        }
    }

    return isMember;
}

export const defaultSchema = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
        "propertyName": {
            "type": "string"
        }
    },
    "required": [
        "propertyName"
    ]
};

export async function listGroups(owner) {
    const id = await fetchIdInfo(owner);
    const schemas = [];

    if (id.owned) {
        for (const did of id.owned) {
            try {
                const isGroup = await testGroup(did);

                if (isGroup) {
                    schemas.push(did);
                }
            }
            catch (error) {
                continue;
            }
        }
    }

    return schemas;
}

function validateSchema(schema) {
    try {
        if (!Object.keys(schema).includes('$schema')) {
            throw new Error(exceptions.INVALID_PARAMETER);
        }

        // Attempt to instantiate the schema
        JSONSchemaFaker.generate(schema);
    }
    catch {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    return true;
}

export async function createSchema(schema, options = {}) {
    if (!schema) {
        schema = defaultSchema;
    }

    validateSchema(schema);

    return createAsset(schema, options);
}

export async function getSchema(id) {
    return resolveAsset(id);
}

export async function setSchema(id, newSchema) {
    validateSchema(newSchema);

    const doc = await resolveDID(id);
    const did = doc.didDocument.id;
    doc.didDocumentData = newSchema;

    return updateDID(did, doc);
}

// TBD add optional 2nd parameter that will validate JSON against the schema
export async function testSchema(id) {
    const schema = await getSchema(id);

    // TBD Need a better way because any random object with keys can be a valid schema
    if (Object.keys(schema).length === 0) {
        return false;
    }

    return validateSchema(schema);
}

export async function listSchemas(owner) {
    const id = await fetchIdInfo(owner);
    const schemas = [];

    if (id.owned) {
        for (const did of id.owned) {
            try {
                const isSchema = await testSchema(did);

                if (isSchema) {
                    schemas.push(did);
                }
            }
            catch (error) {
                continue;
            }
        }
    }

    return schemas;
}

export async function createTemplate(id) {
    //JSONSchemaFaker.option("alwaysFakeOptionals", true);

    const isSchema = await testSchema(id);

    if (!isSchema) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const schemaDID = await lookupDID(id);
    const schema = await resolveAsset(schemaDID);
    const template = JSONSchemaFaker.generate(schema);

    template['$schema'] = schemaDID;

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

export async function createPoll(poll, options = {}) {
    if (poll.type !== 'poll') {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (poll.version !== 1) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (!poll.description) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (!poll.options || !Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 10) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (!poll.roster) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    try {
        const isValidGroup = await testGroup(poll.roster);

        if (!isValidGroup) {
            throw new Error(exceptions.INVALID_PARAMETER);
        }
    }
    catch {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (!poll.deadline) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const deadline = new Date(poll.deadline);

    if (isNaN(deadline.getTime())) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (deadline < new Date()) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    return createAsset(poll, options);
}

export async function viewPoll(poll) {
    const id = await fetchIdInfo();
    const didPoll = await lookupDID(poll);
    const doc = await resolveDID(didPoll);
    const data = doc.didDocumentData;

    if (!data || !data.options || !data.deadline) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    let hasVoted = false;

    if (data.ballots) {
        hasVoted = !!data.ballots[id.did];
    }

    const voteExpired = Date(data.deadline) > new Date();
    const isEligible = await testGroup(data.roster, id.did);

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

export async function votePoll(poll, vote, options = {}) {
    const { spoil } = options;
    const id = await fetchIdInfo();
    const didPoll = await lookupDID(poll);
    const doc = await resolveDID(didPoll);
    const data = doc.didDocumentData;
    const eligible = await testGroup(data.roster, id.did);
    const expired = (Date(data.deadline) > new Date());
    const owner = doc.didDocument.controller;

    if (!eligible) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (expired) {
        throw new Error(exceptions.INVALID_PARAMETER);
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
            throw new Error(exceptions.INVALID_PARAMETER);
        }

        ballot = {
            poll: didPoll,
            vote: vote,
        };
    }

    // Encrypt for receiver only
    options.encryptForSender = false;
    return await encryptJSON(ballot, owner, options);
}

export async function updatePoll(ballot) {
    const id = await fetchIdInfo();

    const didBallot = await lookupDID(ballot);
    const docBallot = await resolveDID(didBallot);
    const didVoter = docBallot.didDocument.controller;
    let dataBallot;

    try {
        dataBallot = await decryptJSON(didBallot);

        if (!dataBallot.poll || !dataBallot.vote) {
            throw new Error(exceptions.INVALID_PARAMETER);
        }
    }
    catch {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const didPoll = await lookupDID(dataBallot.poll);
    const docPoll = await resolveDID(didPoll);
    const dataPoll = docPoll.didDocumentData;
    const didOwner = docPoll.didDocument.controller;

    if (id.did !== didOwner) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const eligible = await testGroup(dataPoll.roster, didVoter);

    if (!eligible) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const expired = (Date(dataPoll.deadline) > new Date());

    if (expired) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const max = dataPoll.options.length;
    const vote = parseInt(dataBallot.vote);

    if (!vote || vote < 0 || vote > max) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (!dataPoll.ballots) {
        dataPoll.ballots = {};
    }

    dataPoll.ballots[didVoter] = {
        ballot: didBallot,
        received: new Date().toISOString(),
    };

    return updateDID(didPoll, docPoll);
}

export async function publishPoll(poll, options = {}) {
    const { reveal } = options;
    const id = await fetchIdInfo();
    const didPoll = await lookupDID(poll);
    const doc = await resolveDID(didPoll);
    const owner = doc.didDocument.controller;

    if (id.did !== owner) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    const view = await viewPoll(poll);

    if (!view.results.final) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    if (!reveal) {
        delete view.results.ballots;
    }

    doc.didDocumentData.results = view.results;

    return updateDID(didPoll, doc);
}

export async function unpublishPoll(poll) {
    const id = await fetchIdInfo();
    const didPoll = await lookupDID(poll);
    const doc = await resolveDID(didPoll);
    const owner = doc.didDocument.controller;

    if (id.did !== owner) {
        throw new Error(exceptions.INVALID_PARAMETER);
    }

    delete doc.didDocumentData.results;

    return await updateDID(didPoll, doc);
}
