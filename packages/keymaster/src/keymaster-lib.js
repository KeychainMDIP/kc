import { InvalidDIDError, InvalidParameterError, KeymasterError, UnknownIDError } from '@mdip/common/errors';

const DefaultSchema = {
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

export default class Keymaster {

    constructor(options = {}) {
        if (options.gatekeeper) {
            this.gatekeeper = options.gatekeeper;

            if (!this.gatekeeper.createDID) {
                throw new InvalidParameterError('options.gatekeeper');
            }
        }
        else {
            throw new InvalidParameterError('options.gatekeeper');
        }

        if (options.wallet) {
            this.db = options.wallet;

            if (!this.db.loadWallet || !this.db.saveWallet) {
                throw new InvalidParameterError('options.wallet');
            }
        } else {
            throw new InvalidParameterError('options.wallet');
        }

        if (options.cipher) {
            this.cipher = options.cipher;

            if (!this.cipher.verifySig) {
                throw new InvalidParameterError('options.cipher');
            }
        }
        else {
            throw new InvalidParameterError('options.cipher');
        }

        this.defaultRegistry = process.env.KC_DEFAULT_REGISTRY || 'hyperswarm';
        this.ephemeralRegistry = 'hyperswarm';
    }

    async listRegistries() {
        return this.gatekeeper.listRegistries();
    }

    async loadWallet() {
        let wallet = await this.db.loadWallet();

        if (!wallet) {
            wallet = await this.newWallet();
        }

        return wallet;
    }

    async saveWallet(wallet, overwrite = true) {
        // TBD validate wallet before saving
        return this.db.saveWallet(wallet, overwrite);
    }

    async newWallet(mnemonic, overwrite = false) {
        let wallet;

        try {
            if (!mnemonic) {
                mnemonic = this.cipher.generateMnemonic();
            }
            const hdkey = this.cipher.generateHDKey(mnemonic);
            const keypair = this.cipher.generateJwk(hdkey.privateKey);
            const backup = this.cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, mnemonic);

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
            throw new InvalidParameterError('mnemonic');
        }

        const ok = await this.db.saveWallet(wallet, overwrite)
        if (!ok) {
            throw new KeymasterError('save wallet failed');
        }

        return wallet;
    }

    async decryptMnemonic() {
        const wallet = await this.loadWallet();
        const keypair = await this.hdKeyPair();

        return this.cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, wallet.seed.mnemonic);
    }

    async checkWallet() {
        const wallet = await this.loadWallet();

        let checked = 0;
        let invalid = 0;
        let deleted = 0;

        // Validate keys
        await this.resolveSeedBank();

        for (const name of Object.keys(wallet.ids)) {
            try {
                const doc = await this.resolveDID(wallet.ids[name].did);

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
                        const doc = await this.resolveDID(did);

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
                        const doc = await this.resolveDID(did);

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
                    const doc = await this.resolveDID(wallet.names[name]);

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

    async fixWallet() {
        const wallet = await this.loadWallet();
        let idsRemoved = 0;
        let ownedRemoved = 0;
        let heldRemoved = 0;
        let namesRemoved = 0;

        for (const name of Object.keys(wallet.ids)) {
            let remove = false;

            try {
                const doc = await this.resolveDID(wallet.ids[name].did);

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
                        const doc = await this.resolveDID(id.owned[i]);

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
                        const doc = await this.resolveDID(id.held[i]);

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
                    const doc = await this.resolveDID(wallet.names[name]);

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

        await this.saveWallet(wallet);

        return { idsRemoved, ownedRemoved, heldRemoved, namesRemoved };
    }

    async resolveSeedBank() {
        const keypair = await this.hdKeyPair();

        const operation = {
            type: "create",
            created: new Date(0).toISOString(),
            mdip: {
                version: 1,
                type: "agent",
                registry: this.defaultRegistry,
            },
            publicJwk: keypair.publicJwk,
        };

        const msgHash = this.cipher.hashJSON(operation);
        const signature = this.cipher.signHash(msgHash, keypair.privateJwk);
        const signed = {
            ...operation,
            signature: {
                signed: new Date(0).toISOString(),
                hash: msgHash,
                value: signature
            }
        }
        const did = await this.gatekeeper.createDID(signed);
        return this.gatekeeper.resolveDID(did);
    }

    async updateSeedBank(doc) {
        const keypair = await this.hdKeyPair();
        const did = doc.didDocument.id;
        const current = await this.gatekeeper.resolveDID(did);
        const previd = current.didDocumentMetadata.versionId;

        const operation = {
            type: "update",
            did,
            previd,
            doc,
        };

        const msgHash = this.cipher.hashJSON(operation);
        const signature = this.cipher.signHash(msgHash, keypair.privateJwk);
        const signed = {
            ...operation,
            signature: {
                signer: did,
                signed: new Date().toISOString(),
                hash: msgHash,
                value: signature,
            }
        };

        return await this.gatekeeper.updateDID(signed);
    }

    async backupWallet(registry = this.defaultRegistry) {
        const wallet = await this.loadWallet();
        const keypair = await this.hdKeyPair();
        const seedBank = await this.resolveSeedBank();
        const msg = JSON.stringify(wallet);
        const backup = this.cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
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
        const msgHash = this.cipher.hashJSON(operation);
        const signature = this.cipher.signHash(msgHash, keypair.privateJwk);
        const signed = {
            ...operation,
            signature: {
                signer: seedBank.didDocument.id,
                signed: new Date().toISOString(),
                hash: msgHash,
                value: signature,
            }
        };
        const backupDID = await this.gatekeeper.createDID(signed);

        seedBank.didDocumentData.wallet = backupDID;
        await this.updateSeedBank(seedBank);

        return backupDID;
    }

    async recoverWallet(did) {
        try {
            if (!did) {
                const seedBank = await this.resolveSeedBank();
                did = seedBank.didDocumentData.wallet;
            }

            const keypair = await this.hdKeyPair();
            const data = await this.resolveAsset(did);
            const backup = this.cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, data.backup);
            const wallet = JSON.parse(backup);

            await this.saveWallet(wallet);
            return wallet;
        }
        catch (error) {
            // If we can't recover the wallet, just return the current one
            return this.loadWallet();
        }
    }

    async listIds() {
        const wallet = await this.loadWallet();
        return Object.keys(wallet.ids);
    }

    async getCurrentId() {
        const wallet = await this.loadWallet();
        return wallet.current;
    }

    async setCurrentId(name) {
        const wallet = await this.loadWallet();
        if (Object.keys(wallet.ids).includes(name)) {
            wallet.current = name;
            return this.saveWallet(wallet);
        }
        else {
            throw new UnknownIDError();
        }
    }

    async fetchIdInfo(id) {
        const wallet = await this.loadWallet();
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
                throw new KeymasterError('No current ID');
            }
        }

        if (!idInfo) {
            throw new UnknownIDError();
        }

        return idInfo;
    }

    async hdKeyPair() {
        const wallet = await this.loadWallet();
        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed.hdkey);

        return this.cipher.generateJwk(hdkey.privateKey);
    }

    async fetchKeyPair(name = null) {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(name);
        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed.hdkey);
        const doc = await this.resolveDID(id.did, { confirm: true });
        const confirmedPublicKeyJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;

        for (let i = id.index; i >= 0; i--) {
            const path = `m/44'/0'/${id.account}'/0/${i}`;
            const didkey = hdkey.derive(path);
            const keypair = this.cipher.generateJwk(didkey.privateKey);

            if (keypair.publicJwk.x === confirmedPublicKeyJwk.x &&
                keypair.publicJwk.y === confirmedPublicKeyJwk.y
            ) {
                return keypair;
            }
        }

        return null;
    }

    async createAsset(data, options = {}) {
        let { registry = this.defaultRegistry, controller, validUntil } = options;

        if (validUntil) {
            const validate = new Date(validUntil);

            if (isNaN(validate.getTime())) {
                throw new InvalidParameterError('options.validUntil');
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
            throw new InvalidParameterError('data');
        }

        const id = await this.fetchIdInfo(controller);

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

        const signed = await this.addSignature(operation, controller);
        const did = await this.gatekeeper.createDID(signed);

        // Keep assets that will be garbage-collected out of the owned list
        if (!validUntil) {
            await this.addToOwned(did);
        }

        return did;
    }

    async encryptMessage(msg, receiver, options = {}) {
        const { encryptForSender = true, includeHash = false } = options;

        const id = await this.fetchIdInfo();
        const senderKeypair = await this.fetchKeyPair();
        const doc = await this.resolveDID(receiver, { confirm: true });
        const receivePublicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
        const cipher_sender = encryptForSender ? this.cipher.encryptMessage(senderKeypair.publicJwk, senderKeypair.privateJwk, msg) : null;
        const cipher_receiver = this.cipher.encryptMessage(receivePublicJwk, senderKeypair.privateJwk, msg);
        const cipher_hash = includeHash ? this.cipher.hashMessage(msg) : null;

        return await this.createAsset({
            encrypted: {
                sender: id.did,
                created: new Date().toISOString(),
                cipher_hash,
                cipher_sender,
                cipher_receiver,
            }
        }, options);
    }

    async decryptMessage(did) {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo();
        const asset = await this.resolveAsset(did);

        if (!asset || (!asset.encrypted && !asset.cipher_hash)) {
            throw new InvalidParameterError('did not encrypted');
        }

        const crypt = asset.encrypted ? asset.encrypted : asset;
        const doc = await this.resolveDID(crypt.sender, { confirm: true, atTime: crypt.created });
        const senderPublicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed.hdkey);
        const ciphertext = (crypt.sender === id.did && crypt.cipher_sender) ? crypt.cipher_sender : crypt.cipher_receiver;

        // Try all private keys for this ID, starting with the most recent and working backward
        let index = id.index;
        while (index >= 0) {
            const path = `m/44'/0'/${id.account}'/0/${index}`;
            const didkey = hdkey.derive(path);
            const receiverKeypair = this.cipher.generateJwk(didkey.privateKey);
            try {
                return this.cipher.decryptMessage(senderPublicJwk, receiverKeypair.privateJwk, ciphertext);
            }
            catch (error) {
                index -= 1;
            }
        }

        throw new KeymasterError('cannot decrypt');
    }

    async encryptJSON(json, did, options = {}) {
        const plaintext = JSON.stringify(json);
        return this.encryptMessage(plaintext, did, options);
    }

    async decryptJSON(did) {
        const plaintext = await this.decryptMessage(did);

        try {
            return JSON.parse(plaintext);
        }
        catch (error) {
            throw new InvalidParameterError('did not encrypted JSON');
        }
    }

    async addSignature(obj, controller = null) {
        // Fetches current ID if name is missing
        const id = await this.fetchIdInfo(controller);
        const keypair = await this.fetchKeyPair(controller);

        try {
            const msgHash = this.cipher.hashJSON(obj);
            const signature = this.cipher.signHash(msgHash, keypair.privateJwk);

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
            throw new InvalidParameterError('obj');
        }
    }

    async verifySignature(obj) {
        if (!obj?.signature) {
            return false;
        }

        const jsonCopy = JSON.parse(JSON.stringify(obj));
        const signature = jsonCopy.signature;
        delete jsonCopy.signature;
        const msgHash = this.cipher.hashJSON(jsonCopy);

        if (signature.hash && signature.hash !== msgHash) {
            return false;
        }

        const doc = await this.resolveDID(signature.signer, { atTime: signature.signed });

        // TBD get the right signature, not just the first one
        const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;

        try {
            return this.cipher.verifySig(msgHash, signature.value, publicJwk);
        }
        catch (error) {
            return false;
        }
    }

    async updateDID(doc) {
        const did = doc.didDocument.id;
        const current = await this.resolveDID(did);
        const previd = current.didDocumentMetadata.versionId;

        const operation = {
            type: "update",
            did,
            previd,
            doc,
        };

        const controller = current.didDocument.controller || current.didDocument.id;
        const signed = await this.addSignature(operation, controller);
        return this.gatekeeper.updateDID(signed);
    }

    async revokeDID(did) {
        const current = await this.resolveDID(did);
        const previd = current.didDocumentMetadata.versionId;

        const operation = {
            type: "delete",
            did,
            previd,
        };

        const controller = current.didDocument.controller || current.didDocument.id;
        const signed = await this.addSignature(operation, controller);

        const ok = this.gatekeeper.deleteDID(signed);

        if (ok && current.didDocument.controller) {
            await this.removeFromOwned(did, current.didDocument.controller);
        }

        return ok;
    }

    async addToOwned(did) {
        const wallet = await this.loadWallet();
        const id = wallet.ids[wallet.current];
        const owned = new Set(id.owned);

        owned.add(did);
        id.owned = Array.from(owned);

        return this.saveWallet(wallet);
    }

    async removeFromOwned(did, owner) {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(owner);

        id.owned = id.owned.filter(item => item !== did);

        return this.saveWallet(wallet);
    }

    async addToHeld(did) {
        const wallet = await this.loadWallet();
        const id = wallet.ids[wallet.current];
        const held = new Set(id.held);

        held.add(did);
        id.held = Array.from(held);

        return this.saveWallet(wallet);
    }

    async removeFromHeld(did) {
        const wallet = await this.loadWallet();
        const id = wallet.ids[wallet.current];
        const held = new Set(id.held);

        if (held.delete(did)) {
            id.held = Array.from(held);
            return this.saveWallet(wallet);
        }

        return false;
    }

    async lookupDID(name) {
        try {
            if (name.startsWith('did:')) {
                return name;
            }
        }
        catch {
            throw new InvalidDIDError();
        }

        const wallet = await this.loadWallet();

        if (wallet.names && Object.keys(wallet.names).includes(name)) {
            return wallet.names[name];
        }

        if (wallet.ids && Object.keys(wallet.ids).includes(name)) {
            return wallet.ids[name].did;
        }

        throw new UnknownIDError();
    }

    async resolveDID(did, options = {}) {
        did = await this.lookupDID(did);
        return await this.gatekeeper.resolveDID(did, options);
    }

    async resolveAsset(did) {
        const doc = await this.resolveDID(did);

        if (doc?.didDocumentMetadata && !doc.didDocumentMetadata.deactivated) {
            return doc.didDocumentData;
        }

        return null;
    }

    async updateAsset(did, data) {
        const doc = await this.resolveDID(did);

        doc.didDocumentData = data;

        return this.updateDID(doc);
    }

    async listAssets(owner) {
        const id = await this.fetchIdInfo(owner);
        return id.owned || [];
    }

    async createId(name, options = {}) {
        const { registry = this.defaultRegistry } = options;

        const wallet = await this.loadWallet();
        if (wallet.ids && Object.keys(wallet.ids).includes(name)) {
            // eslint-disable-next-line
            throw new InvalidParameterError('name already used');
        }

        const account = wallet.counter;
        const index = 0;
        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed.hdkey);
        const path = `m/44'/0'/${account}'/0/${index}`;
        const didkey = hdkey.derive(path);
        const keypair = this.cipher.generateJwk(didkey.privateKey);

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

        const msgHash = this.cipher.hashJSON(operation);
        const signature = this.cipher.signHash(msgHash, keypair.privateJwk);
        const signed = {
            ...operation,
            signature: {
                signed: new Date().toISOString(),
                hash: msgHash,
                value: signature
            }
        }
        const did = await this.gatekeeper.createDID(signed);

        const newId = {
            did: did,
            account: account,
            index: index,
        };

        wallet.ids[name] = newId;
        wallet.counter += 1;
        wallet.current = name;
        await this.saveWallet(wallet);

        return did;
    }

    async removeId(name) {
        const wallet = await this.loadWallet();
        let ids = Object.keys(wallet.ids);

        if (ids.includes(name)) {
            delete wallet.ids[name];

            if (wallet.current === name) {
                ids = Object.keys(wallet.ids);
                wallet.current = ids.length > 0 ? ids[0] : '';
            }

            await this.saveWallet(wallet);
            return true;
        }
        else {
            throw new UnknownIDError();
        }
    }

    async resolveId(name) {
        const id = await this.fetchIdInfo(name);
        return this.resolveDID(id.did);
    }

    async backupId(controller = null) {
        // Backs up current ID if name is missing
        const id = await this.fetchIdInfo(controller);
        const wallet = await this.loadWallet();
        const keypair = await this.hdKeyPair();
        const data = {
            name: controller || wallet.current,
            id: id,
        };
        const msg = JSON.stringify(data);
        const backup = this.cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
        const doc = await this.resolveDID(id.did);
        const registry = doc.mdip.registry;
        const vaultDid = await this.createAsset({ backup: backup }, { registry, controller });

        doc.didDocumentData.vault = vaultDid;
        return this.updateDID(doc);
    }

    async recoverId(did) {
        try {
            const wallet = await this.loadWallet();
            const keypair = await this.hdKeyPair();
            const doc = await this.resolveDID(did);
            const vault = await this.resolveAsset(doc.didDocumentData.vault);
            const backup = this.cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, vault.backup);
            const data = JSON.parse(backup);

            // TBD handle the case where name already exists in wallet
            wallet.ids[data.name] = data.id;
            wallet.current = data.name;
            wallet.counter += 1;

            await this.saveWallet(wallet);

            return wallet.current;
        }
        catch {
            throw new InvalidDIDError();
        }
    }

    async rotateKeys() {
        const wallet = await this.loadWallet();
        const id = wallet.ids[wallet.current];
        const nextIndex = id.index + 1;
        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed.hdkey);
        const path = `m/44'/0'/${id.account}'/0/${nextIndex}`;
        const didkey = hdkey.derive(path);
        const keypair = this.cipher.generateJwk(didkey.privateKey);
        const doc = await this.resolveDID(id.did);

        if (!doc.didDocumentMetadata.confirmed) {
            throw new KeymasterError('Cannot rotate keys');
        }

        const vmethod = doc.didDocument.verificationMethod[0];

        vmethod.id = `#key-${nextIndex + 1}`;
        vmethod.publicKeyJwk = keypair.publicJwk;
        doc.didDocument.authentication = [vmethod.id];

        const ok = await this.updateDID(doc);

        if (ok) {
            id.index = nextIndex;
            await this.saveWallet(wallet);
            return doc;
        }
        else {
            throw new KeymasterError('Cannot rotate keys');
        }
    }

    async listNames() {
        const wallet = await this.loadWallet();

        return wallet.names || {};
    }

    async addName(name, did) {
        const wallet = await this.loadWallet();

        if (!wallet.names) {
            wallet.names = {};
        }

        if (Object.keys(wallet.names).includes(name)) {
            throw new InvalidParameterError('name already used');
        }

        if (Object.keys(wallet.ids).includes(name)) {
            throw new InvalidParameterError('name already used');
        }

        wallet.names[name] = did;
        return this.saveWallet(wallet);
    }

    async removeName(name) {
        const wallet = await this.loadWallet();

        if (wallet.names && Object.keys(wallet.names).includes(name)) {
            delete wallet.names[name];
            await this.saveWallet(wallet);
        }

        return true;
    }

    async testAgent(id) {
        const doc = await this.resolveDID(id);
        return doc?.mdip?.type === 'agent';
    }

    async bindCredential(schemaId, subjectId, options = {}) {
        let { validFrom, validUntil, credential } = options;

        if (!validFrom) {
            validFrom = new Date().toISOString();
        }

        const id = await this.fetchIdInfo();
        const type = await this.lookupDID(schemaId);
        const subjectDID = await this.lookupDID(subjectId);

        if (!credential) {
            const schema = await this.getSchema(type);
            credential = this.generateSchema(schema);
        }

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

    async issueCredential(credential, options = {}) {
        const id = await this.fetchIdInfo();

        if (options.schema && options.subject) {
            credential = await this.bindCredential(options.schema, options.subject, { credential, ...options });
        }

        if (credential.issuer !== id.did) {
            throw new InvalidParameterError('credential.issuer');
        }

        const signed = await this.addSignature(credential);
        return this.encryptJSON(signed, credential.credentialSubject.id, { ...options, includeHash: true });
    }

    async updateCredential(did, credential) {
        did = await this.lookupDID(did);
        const originalVC = await this.decryptJSON(did);

        if (!originalVC.credential) {
            throw new InvalidParameterError('did is not a credential');
        }

        if (!credential?.credential || !credential?.credentialSubject?.id) {
            throw new InvalidParameterError('credential');
        }

        delete credential.signature;
        const signed = await this.addSignature(credential);
        const msg = JSON.stringify(signed);

        const id = await this.fetchIdInfo();
        const senderKeypair = await this.fetchKeyPair();
        const holder = credential.credentialSubject.id;
        const holderDoc = await this.resolveDID(holder, { confirm: true });
        const receivePublicJwk = holderDoc.didDocument.verificationMethod[0].publicKeyJwk;
        const cipher_sender = this.cipher.encryptMessage(senderKeypair.publicJwk, senderKeypair.privateJwk, msg);
        const cipher_receiver = this.cipher.encryptMessage(receivePublicJwk, senderKeypair.privateJwk, msg);
        const msgHash = this.cipher.hashMessage(msg);

        const doc = await this.resolveDID(did);
        const encrypted = {
            sender: id.did,
            created: new Date().toISOString(),
            cipher_hash: msgHash,
            cipher_sender: cipher_sender,
            cipher_receiver: cipher_receiver,
        };
        doc.didDocumentData = { encrypted };
        return this.updateDID(doc);
    }

    async revokeCredential(credential) {
        const did = await this.lookupDID(credential);
        return this.revokeDID(did);
    }

    async listIssued(issuer) {
        const id = await this.fetchIdInfo(issuer);
        const issued = [];

        if (id.owned) {
            for (const did of id.owned) {
                try {
                    const credential = await this.decryptJSON(did);

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

    async acceptCredential(did) {
        try {
            const id = await this.fetchIdInfo();
            const credential = await this.lookupDID(did);
            const vc = await this.decryptJSON(credential);

            if (vc.credentialSubject.id !== id.did) {
                return false;
            }

            return this.addToHeld(credential);
        }
        catch (error) {
            return false;
        }
    }

    async getCredential(id) {
        const did = await this.lookupDID(id);
        return this.decryptJSON(did);
    }

    async removeCredential(id) {
        const did = await this.lookupDID(id);
        return this.removeFromHeld(did);
    }

    async listCredentials(id) {
        const idInfo = await this.fetchIdInfo(id);
        return idInfo.held || [];
    }

    async publishCredential(did, options = {}) {
        const { reveal = false } = options;

        const id = await this.fetchIdInfo();
        const credential = await this.lookupDID(did);
        const vc = await this.decryptJSON(credential);

        if (vc.credentialSubject.id !== id.did) {
            throw new InvalidParameterError('only subject can publish a credential');
        }

        const doc = await this.resolveDID(id.did);

        if (!doc.didDocumentData.manifest) {
            doc.didDocumentData.manifest = {};
        }

        if (!reveal) {
            // Remove the credential values
            vc.credential = null;
        }

        doc.didDocumentData.manifest[credential] = vc;

        const ok = await this.updateDID(doc);

        if (ok) {
            return vc;
        }
        else {
            throw new KeymasterError('update DID failed');
        }
    }

    async unpublishCredential(did) {
        const id = await this.fetchIdInfo();
        const doc = await this.resolveDID(id.did);
        const credential = await this.lookupDID(did);
        const manifest = doc.didDocumentData.manifest;

        if (credential && manifest && Object.keys(manifest).includes(credential)) {
            delete manifest[credential];
            await this.updateDID(doc);

            return `OK credential ${did} removed from manifest`;
        }

        throw new InvalidParameterError('did');
    }

    async createChallenge(challenge = {}, options = {}) {

        if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge)) {
            throw new InvalidParameterError('challenge');
        }

        if (challenge.credentials && !Array.isArray(challenge.credentials)) {
            throw new InvalidParameterError('challenge.credentials');

            // TBD validate each credential spec
        }

        if (!options.registry) {
            options.registry = this.ephemeralRegistry;
        }

        if (!options.validUntil) {
            const expires = new Date();
            expires.setHours(expires.getHours() + 1); // Add 1 hour
            options.validUntil = expires.toISOString();
        }

        return this.createAsset({ challenge }, options);
    }

    async findMatchingCredential(credential) {
        const id = await this.fetchIdInfo();

        if (!id.held) {
            return;
        }

        for (let did of id.held) {
            try {
                const doc = await this.decryptJSON(did);

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

    async createResponse(challengeDID, options = {}) {
        let { retries = 0, delay = 1000 } = options;

        if (!options.registry) {
            options.registry = this.ephemeralRegistry;
        }

        if (!options.validUntil) {
            const expires = new Date();
            expires.setHours(expires.getHours() + 1); // Add 1 hour
            options.validUntil = expires.toISOString();
        }

        let doc;

        while (retries >= 0) {
            try {
                doc = await this.resolveDID(challengeDID);
                break;
            } catch (error) {
                if (retries === 0) throw error; // If no retries left, throw the error
                retries--; // Decrease the retry count
                await new Promise(resolve => setTimeout(resolve, delay)); // Wait for delay milleseconds
            }
        }

        const requestor = doc.didDocument.controller;
        const { challenge } = await this.resolveAsset(challengeDID);

        if (!challenge) {
            throw new InvalidParameterError('challengeDID');
        }

        // TBD check challenge isValid for expired?

        const matches = [];

        if (challenge.credentials) {
            for (let credential of challenge.credentials) {
                const vc = await this.findMatchingCredential(credential);

                if (vc) {
                    matches.push(vc);
                }
            }
        }

        const pairs = [];

        for (let vcDid of matches) {
            const plaintext = await this.decryptMessage(vcDid);
            const vpDid = await this.encryptMessage(plaintext, requestor, { ...options, includeHash: true });
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

        return await this.encryptJSON({ response }, requestor, options);
    }

    async verifyResponse(responseDID, options = {}) {
        let { retries = 0, delay = 1000 } = options;

        let responseDoc;

        while (retries >= 0) {
            try {
                responseDoc = await this.resolveDID(responseDID);
                break;
            } catch (error) {
                if (retries === 0) throw error; // If no retries left, throw the error
                retries--; // Decrease the retry count
                await new Promise(resolve => setTimeout(resolve, delay)); // Wait for delay milliseconds
            }
        }

        const { response } = await this.decryptJSON(responseDID);
        const { challenge } = await this.resolveAsset(response.challenge);

        const vps = [];

        for (let credential of response.credentials) {
            const vcData = await this.resolveAsset(credential.vc);
            const vpData = await this.resolveAsset(credential.vp);

            if (!vcData) {
                // VC revoked
                continue;
            }

            const vcHash = vcData.encrypted?.cipher_hash;
            const vpHash = vpData.encrypted?.cipher_hash;

            if (vcHash == null || vpHash == null || vcHash !== vpHash) {
                // can't verify that the contents of VP match the VC
                continue;
            }

            const vp = await this.decryptJSON(credential.vp);
            const isValid = await this.verifySignature(vp);

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

    async createGroup(name, options = {}) {
        const group = {
            name: name,
            members: options.members || []
        };

        return this.createAsset({ group }, options);
    }

    async getGroup(id) {
        const asset = await this.resolveAsset(id);

        // TEMP during did:test, return old version groups
        if (asset.members) {
            return asset;
        }

        return asset.group || null;
    }

    async addGroupMember(groupId, memberId) {
        const groupDID = await this.lookupDID(groupId);
        const memberDID = await this.lookupDID(memberId);

        // Can't add a group to itself
        if (memberDID === groupDID) {
            throw new InvalidParameterError("can't add a group to itself");
        }

        try {
            // test for valid member DID
            await this.resolveDID(memberDID);
        }
        catch {
            throw new InvalidDIDError('memberId');
        }

        const group = await this.getGroup(groupId);

        if (!group?.members) {
            throw new InvalidParameterError('groupId');
        }

        // If already a member, return immediately
        if (group.members.includes(memberDID)) {
            return true;
        }

        // Can't add a mutual membership relation
        const isMember = await this.testGroup(memberId, groupId);

        if (isMember) {
            throw new InvalidParameterError("can't create mutual membership");
        }

        const members = new Set(group.members);
        members.add(memberDID);
        group.members = Array.from(members);

        return this.updateAsset(groupDID, { group });
    }

    async removeGroupMember(groupId, memberId) {
        const groupDID = await this.lookupDID(groupId);
        const memberDID = await this.lookupDID(memberId);
        const group = await this.getGroup(groupDID);

        if (!group?.members) {
            throw new InvalidParameterError('groupId');
        }

        try {
            // test for valid member DID
            await this.resolveDID(memberDID);
        }
        catch {
            throw new InvalidDIDError('memberId');
        }

        // If not already a member, return immediately
        if (!group.members.includes(memberDID)) {
            return true;
        }

        const members = new Set(group.members);
        members.delete(memberDID);
        group.members = Array.from(members);

        return this.updateAsset(groupDID, { group });
    }

    async testGroup(groupId, memberId) {
        const group = await this.getGroup(groupId);

        if (!group) {
            return false;
        }

        if (!Array.isArray(group.members)) {
            return false;
        }

        if (!memberId) {
            return true;
        }

        const didMember = await this.lookupDID(memberId);
        let isMember = group.members.includes(didMember);

        if (!isMember) {
            for (const did of group.members) {
                isMember = await this.testGroup(did, didMember);

                if (isMember) {
                    break;
                }
            }
        }

        return isMember;
    }

    async listGroups(owner) {
        const id = await this.fetchIdInfo(owner);
        const schemas = [];

        if (id.owned) {
            for (const did of id.owned) {
                try {
                    const isGroup = await this.testGroup(did);

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

    validateSchema(schema) {
        try {
            // Attempt to instantiate the schema
            this.generateSchema(schema);
            return true;
        }
        catch (error) {
            return false;
        }
    }

    generateSchema(schema) {
        const properties = Object.keys(schema);

        if (!properties.includes('$schema')) {
            throw new InvalidParameterError('schema');
        }

        if (!properties.includes('properties')) {
            throw new InvalidParameterError('schema');
        }

        let template = {};

        for (const property of Object.keys(schema.properties)) {
            template[property] = "TBD";
        }

        return template;
    }

    async createSchema(schema, options = {}) {
        if (!schema) {
            schema = DefaultSchema;
        }

        if (!this.validateSchema(schema)) {
            throw new InvalidParameterError('schema');
        }

        return this.createAsset({ schema }, options);
    }

    async getSchema(id) {
        const asset = await this.resolveAsset(id);

        // TEMP during did:test, return old version schemas
        if (asset.properties) {
            return asset;
        }

        return asset.schema || null;
    }

    async setSchema(id, schema) {
        if (!this.validateSchema(schema)) {
            throw new InvalidParameterError('schema');
        }

        return this.updateAsset(id, { schema });
    }

    // TBD add optional 2nd parameter that will validate JSON against the schema
    async testSchema(id) {
        const schema = await this.getSchema(id);

        // TBD Need a better way because any random object with keys can be a valid schema
        if (!schema || Object.keys(schema).length === 0) {
            return false;
        }

        return this.validateSchema(schema);
    }

    async listSchemas(owner) {
        const id = await this.fetchIdInfo(owner);
        const schemas = [];

        if (id.owned) {
            for (const did of id.owned) {
                try {
                    const isSchema = await this.testSchema(did);

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

    async createTemplate(schemaId) {
        const isSchema = await this.testSchema(schemaId);

        if (!isSchema) {
            throw new InvalidParameterError('schemaId');
        }

        const schemaDID = await this.lookupDID(schemaId);
        const schema = await this.getSchema(schemaDID);
        const template = this.generateSchema(schema);

        template['$schema'] = schemaDID;

        return template;
    }

    async pollTemplate() {
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

    async createPoll(poll, options = {}) {
        if (poll.type !== 'poll') {
            throw new InvalidParameterError('poll');
        }

        if (poll.version !== 1) {
            throw new InvalidParameterError('poll.version');
        }

        if (!poll.description) {
            throw new InvalidParameterError('poll.description');
        }

        if (!poll.options || !Array.isArray(poll.options) || poll.options.length < 2 || poll.options.length > 10) {
            throw new InvalidParameterError('poll.options');
        }

        if (!poll.roster) {
            // eslint-disable-next-line
            throw new InvalidParameterError('poll.roster');
        }

        try {
            const isValidGroup = await this.testGroup(poll.roster);

            if (!isValidGroup) {
                throw new InvalidParameterError('poll.roster');
            }
        }
        catch {
            throw new InvalidParameterError('poll.roster');
        }

        if (!poll.deadline) {
            // eslint-disable-next-line
            throw new InvalidParameterError('poll.deadline');
        }

        const deadline = new Date(poll.deadline);

        if (isNaN(deadline.getTime())) {
            throw new InvalidParameterError('poll.deadline');
        }

        if (deadline < new Date()) {
            throw new InvalidParameterError('poll.deadline');
        }

        return this.createAsset({ poll }, options);
    }

    async getPoll(id) {
        const asset = await this.resolveAsset(id);

        // TEMP during did:test, return old version poll
        if (asset.options) {
            return asset;
        }

        return asset.poll || null;
    }

    async viewPoll(pollId) {
        const id = await this.fetchIdInfo();
        const poll = await this.getPoll(pollId);

        if (!poll || !poll.options || !poll.deadline) {
            throw new InvalidParameterError('pollId');
        }

        let hasVoted = false;

        if (poll.ballots) {
            hasVoted = !!poll.ballots[id.did];
        }

        const voteExpired = Date(poll.deadline) > new Date();
        const isEligible = await this.testGroup(poll.roster, id.did);
        const doc = await this.resolveDID(pollId);

        const view = {
            description: poll.description,
            options: poll.options,
            deadline: poll.deadline,
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

            for (let i = 0; i < poll.options.length; i++) {
                results.tally.push({
                    vote: i + 1,
                    option: poll.options[i],
                    count: 0,
                });
            }

            for (let voter in poll.ballots) {
                const ballot = poll.ballots[voter];
                const decrypted = await this.decryptJSON(ballot.ballot);
                const vote = decrypted.vote;
                results.ballots.push({
                    ...ballot,
                    voter: voter,
                    vote: vote,
                    option: poll.options[vote - 1],
                });
                voted += 1;
                results.tally[vote].count += 1;
            }

            const roster = await this.getGroup(poll.roster);
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

    async votePoll(pollId, vote, options = {}) {
        const { spoil = false } = options;

        const id = await this.fetchIdInfo();
        const didPoll = await this.lookupDID(pollId);
        const doc = await this.resolveDID(didPoll);
        const poll = await this.getPoll(pollId);
        const eligible = await this.testGroup(poll.roster, id.did);
        const expired = (Date(poll.deadline) > new Date());
        const owner = doc.didDocument.controller;

        if (!eligible) {
            throw new InvalidParameterError('voter not in roster');
        }

        if (expired) {
            throw new InvalidParameterError('poll has expired');
        }

        let ballot;

        if (spoil) {
            ballot = {
                poll: didPoll,
                vote: 0,
            };
        }
        else {
            const max = poll.options.length;
            vote = parseInt(vote);

            if (!Number.isInteger(vote) || vote < 1 || vote > max) {
                throw new InvalidParameterError('vote');
            }

            ballot = {
                poll: didPoll,
                vote: vote,
            };
        }

        // Encrypt for receiver only
        options.encryptForSender = false;
        return await this.encryptJSON(ballot, owner, options);
    }

    async updatePoll(ballot) {
        const id = await this.fetchIdInfo();

        const didBallot = await this.lookupDID(ballot);
        const docBallot = await this.resolveDID(ballot);
        const didVoter = docBallot.didDocument.controller;
        let dataBallot;

        try {
            dataBallot = await this.decryptJSON(didBallot);

            if (!dataBallot.poll || !dataBallot.vote) {
                throw new InvalidParameterError('ballot');
            }
        }
        catch {
            throw new InvalidParameterError('ballot');
        }

        const didPoll = dataBallot.poll;
        const docPoll = await this.resolveDID(didPoll);
        const didOwner = docPoll.didDocument.controller;
        const poll = await this.getPoll(didPoll);

        if (id.did !== didOwner) {
            throw new InvalidParameterError('only owner can update a poll');
        }

        const eligible = await this.testGroup(poll.roster, didVoter);

        if (!eligible) {
            throw new InvalidParameterError('voter not in roster');
        }

        const expired = (Date(poll.deadline) > new Date());

        if (expired) {
            throw new InvalidParameterError('poll has expired');
        }

        const max = poll.options.length;
        const vote = parseInt(dataBallot.vote);

        if (!vote || vote < 0 || vote > max) {
            throw new InvalidParameterError('ballot.vote');
        }

        if (!poll.ballots) {
            poll.ballots = {};
        }

        poll.ballots[didVoter] = {
            ballot: didBallot,
            received: new Date().toISOString(),
        };

        return this.updateAsset(didPoll, { poll });
    }

    async publishPoll(pollId, options = {}) {
        const { reveal = false } = options;

        const id = await this.fetchIdInfo();
        const doc = await this.resolveDID(pollId);
        const owner = doc.didDocument.controller;

        if (id.did !== owner) {
            throw new InvalidParameterError('only owner can publish a poll');
        }

        const view = await this.viewPoll(pollId);

        if (!view.results.final) {
            throw new InvalidParameterError('poll not final');
        }

        if (!reveal) {
            delete view.results.ballots;
        }

        const poll = await this.getPoll(pollId);
        poll.results = view.results;

        return this.updateAsset(pollId, { poll });
    }

    async unpublishPoll(pollId) {
        const id = await this.fetchIdInfo();
        const doc = await this.resolveDID(pollId);
        const owner = doc.didDocument.controller;

        if (id.did !== owner) {
            throw new InvalidParameterError(pollId);
        }

        const poll = await this.getPoll(pollId);
        delete poll.results;

        return this.updateAsset(pollId, { poll });
    }
}
