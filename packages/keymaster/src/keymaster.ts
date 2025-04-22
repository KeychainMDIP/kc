import { imageSize } from 'image-size';
import {
    InvalidDIDError,
    InvalidParameterError,
    KeymasterError,
    UnknownIDError
} from '@mdip/common/errors';
import {
    GatekeeperInterface,
    MdipDocument,
    DocumentMetadata,
    ResolveDIDOptions,
    Operation,
} from '@mdip/gatekeeper/types';
import {
    Challenge,
    ChallengeResponse,
    CheckWalletResult,
    CreateAssetOptions,
    CreateResponseOptions,
    EncryptOptions,
    FixWalletResult,
    Group,
    IDInfo,
    IssueCredentialsOptions,
    KeymasterInterface,
    Poll,
    PollResults,
    Signature,
    StoredWallet,
    VerifiableCredential,
    ViewPollResult,
    WalletBase,
    WalletFile,
} from './types.js';
import {
    Cipher,
    EcdsaJwkPair
} from '@mdip/cipher/types';

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

export interface KeymasterOptions {
    gatekeeper: GatekeeperInterface;
    wallet: WalletBase;
    cipher: Cipher;
    defaultRegistry?: string;
    maxNameLength?: number;
}

export interface EncryptedMessage {
    sender: string;
    created: string;
    cipher_hash?: string | null;
    cipher_sender?: string | null;
    cipher_receiver?: string | null;
}

interface PossiblySigned {
    signature?: Signature;
}

export interface Image {
    cid: string;
    type: string;
    width: number;
    height: number;
    bytes: number;
}

export default class Keymaster implements KeymasterInterface {
    private gatekeeper: GatekeeperInterface;
    private db: WalletBase;
    private cipher: Cipher;
    private readonly defaultRegistry: string;
    private readonly ephemeralRegistry: string;
    private readonly maxNameLength: number;

    constructor(options: KeymasterOptions) {
        if (!options || !options.gatekeeper || !options.gatekeeper.createDID) {
            throw new InvalidParameterError('options.gatekeeper');
        }
        if (!options.wallet || !options.wallet.loadWallet || !options.wallet.saveWallet) {
            throw new InvalidParameterError('options.wallet');
        }
        if (!options.cipher || !options.cipher.verifySig) {
            throw new InvalidParameterError('options.cipher');
        }

        this.gatekeeper = options.gatekeeper;
        this.db = options.wallet;
        this.cipher = options.cipher;

        this.defaultRegistry = options.defaultRegistry || 'hyperswarm';
        this.ephemeralRegistry = 'hyperswarm';
        this.maxNameLength = options.maxNameLength || 32;
    }

    async listRegistries(): Promise<string[]> {
        return this.gatekeeper.listRegistries();
    }

    async loadWallet(): Promise<WalletFile> {
        let wallet = await this.db.loadWallet();

        if (!wallet) {
            wallet = await this.newWallet();
        }

        if ('salt' in wallet) {
            throw new KeymasterError("Wallet is encrypted");
        }

        if (!wallet.seed) {
            throw new KeymasterError("Wallet is corrupted");
        }

        return wallet;
    }

    async saveWallet(
        wallet: StoredWallet,
        overwrite = true
    ): Promise<boolean> {
        // TBD validate wallet before saving
        return this.db.saveWallet(wallet, overwrite);
    }

    async newWallet(
        mnemonic?: string,
        overwrite = false
    ): Promise<WalletFile> {
        let wallet: WalletFile;

        try {
            if (!mnemonic) {
                mnemonic = this.cipher.generateMnemonic();
            }
            const hdkey = this.cipher.generateHDKey(mnemonic);
            const keypair = this.cipher.generateJwk(hdkey.privateKey!);
            const backup = this.cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, mnemonic);

            const keys = hdkey.toJSON();
            if (!keys.xpub || !keys.xpriv) {
                throw new KeymasterError('No xpub or xpriv found');
            }

            wallet = {
                seed: {
                    mnemonic: backup,
                    hdkey: {
                        xpriv: keys.xpriv,
                        xpub: keys.xpub
                    },
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

    async decryptMnemonic(): Promise<string> {
        const wallet = await this.loadWallet();
        const keypair = await this.hdKeyPair();

        return this.cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, wallet.seed!.mnemonic);
    }

    async checkWallet(): Promise<CheckWalletResult> {
        const wallet = await this.loadWallet();

        let checked = 0;
        let invalid = 0;
        let deleted = 0;

        // Validate keys
        await this.resolveSeedBank();

        for (const name of Object.keys(wallet.ids)) {
            try {
                const doc = await this.resolveDID(wallet.ids[name].did);

                if (doc.didDocumentMetadata?.deactivated) {
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

                        if (doc.didDocumentMetadata?.deactivated) {
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

                        if (doc.didDocumentMetadata?.deactivated) {
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

                    if (doc.didDocumentMetadata?.deactivated) {
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

    async fixWallet(): Promise<FixWalletResult> {
        const wallet = await this.loadWallet();
        let idsRemoved = 0;
        let ownedRemoved = 0;
        let heldRemoved = 0;
        let namesRemoved = 0;

        for (const name of Object.keys(wallet.ids)) {
            let remove = false;

            try {
                const doc = await this.resolveDID(wallet.ids[name].did);

                if (doc.didDocumentMetadata?.deactivated) {
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

                        if (doc.didDocumentMetadata?.deactivated) {
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

                        if (doc.didDocumentMetadata?.deactivated) {
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

                    if (doc.didDocumentMetadata?.deactivated) {
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

    async resolveSeedBank(): Promise<MdipDocument> {
        const keypair = await this.hdKeyPair();

        const operation: Operation = {
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
        const signed: Operation = {
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

    async updateSeedBank(doc: MdipDocument): Promise<boolean> {
        const keypair = await this.hdKeyPair();
        const did = doc.didDocument?.id;
        if (!did) {
            throw new InvalidParameterError('seed bank missing DID');
        }
        const current = await this.gatekeeper.resolveDID(did);
        const previd = current.didDocumentMetadata?.versionId;

        const operation: Operation = {
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

    async backupWallet(registry = this.defaultRegistry): Promise<string> {
        const wallet = await this.loadWallet();
        const keypair = await this.hdKeyPair();
        const seedBank = await this.resolveSeedBank();
        const msg = JSON.stringify(wallet);
        const backup = this.cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);

        const operation: Operation = {
            type: "create",
            created: new Date().toISOString(),
            mdip: {
                version: 1,
                type: "asset",
                registry: registry,
            },
            controller: seedBank.didDocument?.id,
            data: { backup: backup },
        };

        const msgHash = this.cipher.hashJSON(operation);
        const signature = this.cipher.signHash(msgHash, keypair.privateJwk);

        const signed: Operation = {
            ...operation,
            signature: {
                signer: seedBank.didDocument?.id,
                signed: new Date().toISOString(),
                hash: msgHash,
                value: signature,
            }
        };

        const backupDID = await this.gatekeeper.createDID(signed);

        if (seedBank.didDocumentData && typeof seedBank.didDocumentData === 'object' && !Array.isArray(seedBank.didDocumentData)) {
            const data = seedBank.didDocumentData as { wallet?: string };
            data.wallet = backupDID;
            await this.updateSeedBank(seedBank);
        }

        return backupDID;
    }

    async recoverWallet(did?: string): Promise<WalletFile> {
        try {
            if (!did) {
                const seedBank = await this.resolveSeedBank();
                if (seedBank.didDocumentData && typeof seedBank.didDocumentData === 'object' && !Array.isArray(seedBank.didDocumentData)) {
                    const data = seedBank.didDocumentData as { wallet?: string };
                    did = data.wallet;
                }
                if (!did) {
                    throw new InvalidParameterError('No backup DID found');
                }
            }

            const keypair = await this.hdKeyPair();
            const data = await this.resolveAsset(did);
            if (!data) {
                throw new InvalidParameterError('No asset data found');
            }

            const castData = data as { backup?: string };

            if (typeof castData.backup !== 'string') {
                throw new InvalidParameterError('Asset "backup" is missing or not a string');
            }

            const backup = this.cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, castData.backup);
            const wallet = JSON.parse(backup);

            await this.saveWallet(wallet);
            return wallet;
        }
        catch (error) {
            // If we can't recover the wallet, just return the current one
            return this.loadWallet();
        }
    }

    async listIds(): Promise<string[]> {
        const wallet = await this.loadWallet();
        return Object.keys(wallet.ids);
    }

    async getCurrentId(): Promise<string | undefined> {
        const wallet = await this.loadWallet();
        return wallet.current;
    }

    async setCurrentId(name: string) {
        const wallet = await this.loadWallet();
        if (name in wallet.ids) {
            wallet.current = name;
            return this.saveWallet(wallet);
        }
        else {
            throw new UnknownIDError();
        }
    }

    didMatch(
        did1: string,
        did2: string
    ): boolean {
        const suffix1 = did1.split(':').pop();
        const suffix2 = did2.split(':').pop();

        return (suffix1 === suffix2);
    }

    async fetchIdInfo(id?: string, wallet?: WalletFile): Promise<IDInfo> {
        // Callers should pass in the wallet if they are going to modify and save it later
        if (!wallet) {
            wallet = await this.loadWallet();
        }

        let idInfo = null;

        if (id) {
            if (id.startsWith('did')) {
                for (const name of Object.keys(wallet.ids)) {
                    const info = wallet.ids[name];

                    if (this.didMatch(id, info.did)) {
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
            if (!wallet.current) {
                throw new KeymasterError('No current ID');
            }

            idInfo = wallet.ids[wallet.current];
        }

        if (!idInfo) {
            throw new UnknownIDError();
        }

        return idInfo;
    }

    async hdKeyPair(): Promise<EcdsaJwkPair> {
        const wallet = await this.loadWallet();
        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed!.hdkey);

        return this.cipher.generateJwk(hdkey.privateKey!);
    }

    async fetchKeyPair(name?: string): Promise<EcdsaJwkPair | null> {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(name);
        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed!.hdkey);
        const doc = await this.resolveDID(id.did, { confirm: true });
        const verificationMethod = doc.didDocument?.verificationMethod;
        if (!verificationMethod || verificationMethod.length === 0) {
            return null;
        }
        const confirmedPublicKeyJwk = verificationMethod[0].publicKeyJwk!;

        for (let i = id.index; i >= 0; i--) {
            const path = `m/44'/0'/${id.account}'/0/${i}`;
            const didkey = hdkey.derive(path);
            const keypair = this.cipher.generateJwk(didkey.privateKey!);

            if (keypair.publicJwk.x === confirmedPublicKeyJwk.x &&
                keypair.publicJwk.y === confirmedPublicKeyJwk.y
            ) {
                return keypair;
            }
        }

        return null;
    }

    async createAsset(
        data: unknown,
        options: CreateAssetOptions = {}
    ): Promise<string> {
        let { registry = this.defaultRegistry, controller, validUntil, name } = options;

        if (validUntil) {
            const validate = new Date(validUntil);

            if (isNaN(validate.getTime())) {
                throw new InvalidParameterError('options.validUntil');
            }
        }

        if (name) {
            const wallet = await this.loadWallet();
            this.validateName(name, wallet);
        }

        if (!data) {
            throw new InvalidParameterError('data');
        }

        const id = await this.fetchIdInfo(controller);

        const operation: Operation = {
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

        if (name) {
            await this.addName(name, did);
        }

        return did;
    }

    async cloneAsset(
        id: string,
        options: CreateAssetOptions = {}
    ): Promise<string> {
        const assetDoc = await this.resolveDID(id);

        if (assetDoc.mdip?.type !== 'asset') {
            throw new InvalidParameterError('id');
        }

        const assetData = assetDoc.didDocumentData || {};
        const cloneData = { ...assetData, cloned: assetDoc.didDocument!.id };

        return this.createAsset(cloneData, options);
    }

    async createImage(
        buffer: Buffer,
        options: CreateAssetOptions = {}
    ): Promise<string> {
        let metadata;

        try {
            metadata = imageSize(buffer);
        }
        catch (error) {
            throw new InvalidParameterError('buffer');
        }

        const cid = await this.gatekeeper.addData(buffer);
        const data = {
            image: {
                cid,
                bytes: buffer.length,
                ...metadata
            }
        };

        return this.createAsset(data, options);
    }

    async updateImage(
        id: string,
        buffer: Buffer
    ): Promise<boolean> {
        let metadata;

        try {
            metadata = imageSize(buffer);
        }
        catch (error) {
            throw new InvalidParameterError('buffer');
        }

        const cid = await this.gatekeeper.addData(buffer);
        const data = {
            image: {
                cid,
                bytes: buffer.length,
                ...metadata
            }
        };

        return this.updateAsset(id, data);
    }

    async getImage(id: string): Promise<Image | null> {
        const asset = await this.resolveAsset(id);
        const castAsset = asset as { image?: Image };

        return castAsset.image ?? null;
    }

    async testImage(id: string): Promise<boolean> {
        try {
            const image = await this.getImage(id);
            return image !== null;
        }
        catch (error) {
            return false;
        }
    }

    async encryptMessage(
        msg: string,
        receiver: string,
        options: EncryptOptions = {}
    ): Promise<string> {
        const {
            encryptForSender = true,
            includeHash = false,
        } = options;

        const id = await this.fetchIdInfo();
        const senderKeypair = await this.fetchKeyPair();
        if (!senderKeypair) {
            throw new KeymasterError('No valid sender keypair');
        }

        const doc = await this.resolveDID(receiver, { confirm: true });
        const receivePublicJwk = doc.didDocument?.verificationMethod?.[0].publicKeyJwk;
        if (!receivePublicJwk) {
            throw new InvalidParameterError('receiver has no public key');
        }

        const cipher_sender = encryptForSender ? this.cipher.encryptMessage(senderKeypair.publicJwk, senderKeypair.privateJwk, msg) : null;
        const cipher_receiver = this.cipher.encryptMessage(receivePublicJwk, senderKeypair.privateJwk, msg);
        const cipher_hash = includeHash ? this.cipher.hashMessage(msg) : null;

        const encrypted: EncryptedMessage = {
            sender: id.did,
            created: new Date().toISOString(),
            cipher_hash,
            cipher_sender,
            cipher_receiver,
        }

        return await this.createAsset({ encrypted }, options);
    }

    async decryptMessage(did: string): Promise<string> {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo();
        const asset = await this.resolveAsset(did);

        if (!asset) {
            throw new InvalidParameterError('did not encrypted');
        }

        const castAsset = asset as { encrypted?: EncryptedMessage, cipher_hash?: string };
        if (!castAsset.encrypted && !castAsset.cipher_hash) {
            throw new InvalidParameterError('did not encrypted');
        }

        const crypt = (castAsset.encrypted ? castAsset.encrypted : castAsset) as EncryptedMessage;

        const doc = await this.resolveDID(crypt.sender, { confirm: true, atTime: crypt.created });
        const senderPublicJwk = doc.didDocument?.verificationMethod?.[0].publicKeyJwk;
        if (!senderPublicJwk) {
            throw new KeymasterError('sender key not found');
        }

        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed!.hdkey);
        const ciphertext = (crypt.sender === id.did && crypt.cipher_sender) ? crypt.cipher_sender : crypt.cipher_receiver;

        // Try all private keys for this ID, starting with the most recent and working backward
        let index = id.index;
        while (index >= 0) {
            const path = `m/44'/0'/${id.account}'/0/${index}`;
            const didkey = hdkey.derive(path);
            const receiverKeypair = this.cipher.generateJwk(didkey.privateKey!);
            try {
                return this.cipher.decryptMessage(senderPublicJwk, receiverKeypair.privateJwk, ciphertext!);
            }
            catch (error) {
                index -= 1;
            }
        }

        throw new KeymasterError('cannot decrypt');
    }

    async encryptJSON(
        json: unknown,
        did: string,
        options: EncryptOptions = {}
    ): Promise<string> {
        const plaintext = JSON.stringify(json);
        return this.encryptMessage(plaintext, did, options);
    }

    async decryptJSON(did: string): Promise<unknown> {
        const plaintext = await this.decryptMessage(did);

        try {
            return JSON.parse(plaintext);
        }
        catch (error) {
            throw new InvalidParameterError('did not encrypted JSON');
        }
    }

    async addSignature<T extends object>(
        obj: T,
        controller?: string
    ): Promise<T & { signature: Signature }> {
        if (obj == null) {
            throw new InvalidParameterError('obj');
        }

        // Fetches current ID if name is missing
        const id = await this.fetchIdInfo(controller);
        const keypair = await this.fetchKeyPair(controller);

        if (!keypair) {
            throw new KeymasterError('addSignature: no keypair');
        }

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

    async verifySignature<T extends PossiblySigned>(obj: T): Promise<boolean> {
        if (!obj?.signature) {
            return false;
        }

        const { signature } = obj;
        if (!signature.signer) {
            return false;
        }

        const jsonCopy = JSON.parse(JSON.stringify(obj));
        delete jsonCopy.signature;
        const msgHash = this.cipher.hashJSON(jsonCopy);

        if (signature.hash && signature.hash !== msgHash) {
            return false;
        }

        const doc = await this.resolveDID(signature.signer, { atTime: signature.signed });

        // TBD get the right signature, not just the first one
        const publicJwk = doc.didDocument?.verificationMethod?.[0].publicKeyJwk;
        if (!publicJwk) {
            return false;
        }

        try {
            return this.cipher.verifySig(msgHash, signature.value, publicJwk);
        }
        catch (error) {
            return false;
        }
    }

    async updateDID(doc: MdipDocument): Promise<boolean> {
        const did = doc.didDocument?.id;

        if (!did) {
            throw new InvalidParameterError('doc.didDocument.id');
        }

        const current = await this.resolveDID(did);

        // Compare the hashes of the current and updated documents without the metadata
        const currentHash = this.cipher.hashJSON({
            didDocument: current.didDocument,
            didDocumentData: current.didDocumentData,
            mdip: current.mdip,
        });
        const updateHash = this.cipher.hashJSON({
            didDocument: doc.didDocument,
            didDocumentData: doc.didDocumentData,
            mdip: doc.mdip,
        });

        // If no change, return immediately without updating
        // Maybe add a force update option later if needed?
        if (currentHash === updateHash) {
            return true;
        }

        const previd = current.didDocumentMetadata?.versionId;

        const operation: Operation = {
            type: "update",
            did,
            previd,
            doc,
        };

        const controller = current.didDocument?.controller || current.didDocument?.id;
        const signed = await this.addSignature(operation, controller);
        return this.gatekeeper.updateDID(signed);
    }

    async revokeDID(did: string): Promise<boolean> {
        const current = await this.resolveDID(did);
        const previd = current.didDocumentMetadata?.versionId;

        const operation: Operation = {
            type: "delete",
            did,
            previd,
        };

        const controller = current.didDocument?.controller || current.didDocument?.id;
        const signed = await this.addSignature(operation, controller);

        const ok = await this.gatekeeper.deleteDID(signed);

        if (ok && current.didDocument?.controller) {
            await this.removeFromOwned(did, current.didDocument.controller);
        }

        return ok;
    }

    async addToOwned(
        did: string,
        owner?: string
    ): Promise<boolean> {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(owner, wallet);
        const owned = new Set(id.owned);

        owned.add(did);
        id.owned = Array.from(owned);

        return this.saveWallet(wallet);
    }

    async removeFromOwned(
        did: string,
        owner: string
    ): Promise<boolean> {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(owner, wallet);
        if (!id.owned) {
            return false;
        }

        id.owned = id.owned.filter(item => item !== did);

        return this.saveWallet(wallet);
    }

    async addToHeld(did: string): Promise<boolean> {
        const wallet = await this.loadWallet();
        const id = wallet.ids[wallet.current!];
        const held = new Set(id.held);

        held.add(did);
        id.held = Array.from(held);

        return this.saveWallet(wallet);
    }

    async removeFromHeld(did: string): Promise<boolean> {
        const wallet = await this.loadWallet();
        const id = wallet.ids[wallet.current!];
        const held = new Set(id.held);

        if (held.delete(did)) {
            id.held = Array.from(held);
            return this.saveWallet(wallet);
        }

        return false;
    }

    async lookupDID(name: string): Promise<string> {
        try {
            if (name.startsWith('did:')) {
                return name;
            }
        }
        catch {
            throw new InvalidDIDError();
        }

        const wallet = await this.loadWallet();

        if (wallet.names && name in wallet.names) {
            return wallet.names[name];
        }

        if (wallet.ids && name in wallet.ids) {
            return wallet.ids[name].did;
        }

        throw new UnknownIDError();
    }

    async resolveDID(
        did: string,
        options?: ResolveDIDOptions
    ): Promise<MdipDocument> {
        const actualDid = await this.lookupDID(did);
        const docs = await this.gatekeeper.resolveDID(actualDid, options);
        const controller = docs.didDocument?.controller || docs.didDocument?.id;
        const isOwned = await this.idInWallet(controller);

        // Augment the DID document metadata with the DID ownership status
        docs.didDocumentMetadata = {
            ...docs.didDocumentMetadata,
            isOwned,
        } as DocumentMetadata & { isOwned?: boolean };

        return docs;
    }

    async idInWallet(did?: string): Promise<boolean> {
        try {
            await this.fetchIdInfo(did);
            return true;
        }
        catch (error) {
            return false;
        }
    }

    async resolveAsset(did: string): Promise<any> {
        const doc = await this.resolveDID(did);

        if (!doc?.didDocument?.controller || !doc?.didDocumentData || doc.didDocumentMetadata?.deactivated) {
            return {};
        }

        return doc.didDocumentData;
    }

    async updateAsset(
        did: string,
        data: Record<string, unknown>
    ): Promise<boolean> {
        const doc = await this.resolveDID(did);

        doc.didDocumentData = data;

        return this.updateDID(doc);
    }

    async transferAsset(
        id: string,
        controller: string
    ): Promise<boolean> {
        const assetDoc = await this.resolveDID(id);

        if (assetDoc.mdip?.type !== 'asset') {
            throw new InvalidParameterError('id');
        }

        if (assetDoc.didDocument!.controller === controller) {
            return true;
        }

        const agentDoc = await this.resolveDID(controller);

        if (agentDoc.mdip?.type !== 'agent') {
            throw new InvalidParameterError('controller');
        }

        const assetDID = assetDoc.didDocument!.id;
        const prevOwner = assetDoc.didDocument!.controller;

        assetDoc.didDocument!.controller = agentDoc.didDocument!.id;

        const ok = await this.updateDID(assetDoc);

        if (ok && assetDID && prevOwner) {
            await this.removeFromOwned(assetDID, prevOwner);

            try {
                await this.addToOwned(assetDID, controller);
            }
            catch (error) {
                // New controller is not in our wallet
            }
        }

        return ok;
    }

    async listAssets(owner?: string) {
        const id = await this.fetchIdInfo(owner);
        return id.owned || [];
    }

    validateName(
        name: string,
        wallet?: WalletFile
    ) {
        if (typeof name !== 'string' || !name.trim()) {
            throw new InvalidParameterError('name must be a non-empty string');
        }

        name = name.trim(); // Remove leading/trailing whitespace

        if (name.length > this.maxNameLength) {
            throw new InvalidParameterError(`name too long`);
        }

        if (/[^\P{Cc}]/u.test(name)) {
            throw new InvalidParameterError('name contains unprintable characters');
        }

        const alreadyUsedError = 'name already used';

        if (wallet && wallet.names && name in wallet.names) {
            throw new InvalidParameterError(alreadyUsedError);
        }

        if (wallet && wallet.ids && name in wallet.ids) {
            throw new InvalidParameterError(alreadyUsedError);
        }

        return name;
    }

    async createId(
        name: string,
        options: { registry?: string } = {}
    ): Promise<string> {
        const { registry = this.defaultRegistry } = options;

        const wallet = await this.loadWallet();
        name = this.validateName(name, wallet);

        const account = wallet.counter;
        const index = 0;
        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed!.hdkey);
        const path = `m/44'/0'/${account}'/0/${index}`;
        const didkey = hdkey.derive(path);
        const keypair = this.cipher.generateJwk(didkey.privateKey!);

        const operation: Operation = {
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
        const signed: Operation = {
            ...operation,
            signature: {
                signed: new Date().toISOString(),
                hash: msgHash,
                value: signature
            }
        }
        const did = await this.gatekeeper.createDID(signed);

        wallet.ids[name] = {
            did: did,
            account: account,
            index: index,
        };
        wallet.counter += 1;
        wallet.current = name;
        await this.saveWallet(wallet);

        return did;
    }

    async removeId(name: string): Promise<boolean> {
        const wallet = await this.loadWallet();

        if (!(name in wallet.ids)) {
            throw new UnknownIDError();
        }

        delete wallet.ids[name];

        if (wallet.current === name) {
            wallet.current = Object.keys(wallet.ids)[0] || '';
        }

        return this.saveWallet(wallet);
    }

    async renameId(
        id: string,
        name: string
    ): Promise<boolean> {
        const wallet = await this.loadWallet();

        name = this.validateName(name);

        if (!(id in wallet.ids)) {
            throw new UnknownIDError();
        }

        if (name in wallet.ids) {
            throw new InvalidParameterError('name already used');
        }

        wallet.ids[name] = wallet.ids[id];
        delete wallet.ids[id];

        if (wallet.current && wallet.current === id) {
            wallet.current = name;
        }

        return this.saveWallet(wallet);
    }

    async backupId(id?: string): Promise<boolean> {
        // Backs up current ID if id is not provided
        const wallet = await this.loadWallet();
        const name = id || wallet.current;
        const idInfo = await this.fetchIdInfo(name, wallet);
        const keypair = await this.hdKeyPair();
        const data = {
            name: name,
            id: idInfo,
        };
        const msg = JSON.stringify(data);
        const backup = this.cipher.encryptMessage(keypair.publicJwk, keypair.privateJwk, msg);
        const doc = await this.resolveDID(idInfo.did);
        const registry = doc.mdip?.registry;
        if (!registry) {
            throw new InvalidParameterError('no registry found for agent DID');
        }

        const vaultDid = await this.createAsset({ backup: backup }, { registry, controller: name });

        if (doc.didDocumentData) {
            const docData = doc.didDocumentData as { vault: string };
            docData.vault = vaultDid;
            return this.updateDID(doc);
        }
        return false;
    }

    async recoverId(did: string): Promise<string> {
        try {
            const wallet = await this.loadWallet();
            const keypair = await this.hdKeyPair();

            const doc = await this.resolveDID(did);
            const docData = doc.didDocumentData as { vault?: string };
            if (!docData.vault) {
                throw new InvalidDIDError('didDocumentData missing vault');
            }

            const vault = await this.resolveAsset(docData.vault);
            const castVault = vault as { backup?: string };
            if (typeof castVault.backup !== 'string') {
                throw new InvalidDIDError('backup not found in vault');
            }

            const backup = this.cipher.decryptMessage(keypair.publicJwk, keypair.privateJwk, castVault.backup);
            const data = JSON.parse(backup);

            if (wallet.ids[data.name]) {
                throw new KeymasterError(`${data.name} already exists in wallet`);
            }

            wallet.ids[data.name] = data.id;
            wallet.current = data.name;
            wallet.counter += 1;

            await this.saveWallet(wallet);
            return wallet.current!;
        }
        catch (error: any) {
            if (error.type === 'Keymaster') {
                throw error;
            }
            else {
                throw new InvalidDIDError();
            }
        }
    }

    async rotateKeys(): Promise<boolean> {
        const wallet = await this.loadWallet();
        const id = wallet.ids[wallet.current!];
        const nextIndex = id.index + 1;
        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed!.hdkey);
        const path = `m/44'/0'/${id.account}'/0/${nextIndex}`;
        const didkey = hdkey.derive(path);
        const keypair = this.cipher.generateJwk(didkey.privateKey!);
        const doc = await this.resolveDID(id.did);

        if (!doc.didDocumentMetadata?.confirmed) {
            throw new KeymasterError('Cannot rotate keys');
        }

        if (!doc.didDocument?.verificationMethod) {
            throw new KeymasterError('DID Document missing verificationMethod');
        }

        const vmethod = doc.didDocument.verificationMethod[0];

        vmethod.id = `#key-${nextIndex + 1}`;
        vmethod.publicKeyJwk = keypair.publicJwk;
        doc.didDocument.authentication = [vmethod.id];

        const ok = await this.updateDID(doc);

        if (ok) {
            id.index = nextIndex;
            await this.saveWallet(wallet);
        }
        else {
            throw new KeymasterError('Cannot rotate keys');
        }

        return ok;
    }

    async listNames(): Promise<Record<string, string>> {
        const wallet = await this.loadWallet();

        return wallet.names || {};
    }

    async addName(
        name: string,
        did: string
    ): Promise<boolean> {
        const wallet = await this.loadWallet();

        if (!wallet.names) {
            wallet.names = {};
        }

        name = this.validateName(name, wallet);
        wallet.names[name] = did;
        return this.saveWallet(wallet);
    }

    async getName(name: string): Promise<string | null> {
        const wallet = await this.loadWallet();

        if (wallet.names && name in wallet.names) {
            return wallet.names[name];
        }

        return null;
    }

    async removeName(name: string): Promise<boolean> {
        const wallet = await this.loadWallet();

        if (wallet.names && name in wallet.names) {
            delete wallet.names[name];
            await this.saveWallet(wallet);
        }

        return true;
    }

    async testAgent(id: string): Promise<boolean> {
        const doc = await this.resolveDID(id);
        return doc.mdip?.type === 'agent';
    }

    async bindCredential(
        schemaId: string,
        subjectId: string,
        options: {
            validFrom?: string;
            validUntil?: string;
            credential?: Record<string, unknown>;
        } = {}
    ): Promise<VerifiableCredential> {
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

    async issueCredential(
        credential: Partial<VerifiableCredential>,
        options: IssueCredentialsOptions = {}
    ): Promise<string> {
        const id = await this.fetchIdInfo();

        if (options.schema && options.subject) {
            credential = await this.bindCredential(options.schema, options.subject, { credential, ...options });
        }

        if (credential.issuer !== id.did) {
            throw new InvalidParameterError('credential.issuer');
        }

        const signed = await this.addSignature(credential);
        return this.encryptJSON(signed, credential.credentialSubject!.id, { ...options, includeHash: true });
    }

    private isVerifiableCredential(obj: unknown): obj is VerifiableCredential {
        if (typeof obj !== 'object' || !obj) {
            return false;
        }

        const vc = obj as Partial<VerifiableCredential>;

        return !(!Array.isArray(vc["@context"]) || !Array.isArray(vc.type) || !vc.issuer || !vc.credentialSubject);
    }

    async updateCredential(
        did: string,
        credential: VerifiableCredential
    ): Promise<boolean> {
        did = await this.lookupDID(did);
        const originalVC = await this.decryptJSON(did);

        if (!this.isVerifiableCredential(originalVC)) {
            throw new InvalidParameterError("did is not a credential");
        }

        if (!credential ||
            !credential.credential ||
            !credential.credentialSubject ||
            !credential.credentialSubject.id) {
            throw new InvalidParameterError('credential');
        }

        delete credential.signature;
        const signed = await this.addSignature(credential);
        const msg = JSON.stringify(signed);

        const id = await this.fetchIdInfo();
        const senderKeypair = await this.fetchKeyPair();
        if (!senderKeypair) {
            throw new KeymasterError('No valid sender keypair');
        }

        const holder = credential.credentialSubject.id;
        const holderDoc = await this.resolveDID(holder, { confirm: true });
        const receivePublicJwk = holderDoc.didDocument?.verificationMethod?.[0].publicKeyJwk;
        if (!receivePublicJwk) {
            throw new InvalidParameterError('holder DID has no public key');
        }

        const cipher_sender = this.cipher.encryptMessage(senderKeypair.publicJwk, senderKeypair.privateJwk, msg);
        const cipher_receiver = this.cipher.encryptMessage(receivePublicJwk, senderKeypair.privateJwk, msg);
        const msgHash = this.cipher.hashMessage(msg);

        const doc = await this.resolveDID(did);
        const encrypted: EncryptedMessage = {
            sender: id.did,
            created: new Date().toISOString(),
            cipher_hash: msgHash,
            cipher_sender: cipher_sender,
            cipher_receiver: cipher_receiver,
        };
        doc.didDocumentData = { encrypted };
        return this.updateDID(doc);
    }

    async revokeCredential(credential: string): Promise<boolean> {
        const did = await this.lookupDID(credential);
        return this.revokeDID(did);
    }

    async listIssued(issuer?: string): Promise<string[]> {
        const id = await this.fetchIdInfo(issuer);
        const issued = [];

        if (id.owned) {
            for (const did of id.owned) {
                try {
                    const credential = await this.decryptJSON(did);

                    if (this.isVerifiableCredential(credential) &&
                        credential.issuer === id.did) {
                        issued.push(did);
                    }
                }
                catch (error) { }
            }
        }

        return issued;
    }

    async acceptCredential(did: string): Promise<boolean> {
        try {
            const id = await this.fetchIdInfo();
            const credential = await this.lookupDID(did);
            const vc = await this.decryptJSON(credential);

            if (this.isVerifiableCredential(vc) &&
                vc.credentialSubject?.id !== id.did) {
                return false;
            }

            return this.addToHeld(credential);
        }
        catch (error) {
            return false;
        }
    }

    async getCredential(id: string): Promise<VerifiableCredential | null> {
        const did = await this.lookupDID(id);

        const vc = await this.decryptJSON(did);

        if (!this.isVerifiableCredential(vc)) {
            return null;
        }

        return vc;
    }

    async removeCredential(id: string): Promise<boolean> {
        const did = await this.lookupDID(id);
        return this.removeFromHeld(did);
    }

    async listCredentials(id?: string): Promise<string[]> {
        const idInfo = await this.fetchIdInfo(id);
        return idInfo.held || [];
    }

    async publishCredential(
        did: string,
        options: { reveal?: boolean } = {}
    ): Promise<VerifiableCredential> {
        const { reveal = false } = options;

        const id = await this.fetchIdInfo();
        const credential = await this.lookupDID(did);
        const vc = await this.decryptJSON(credential);
        if (!this.isVerifiableCredential(vc)) {
            throw new InvalidParameterError("did is not a credential");
        }

        if (vc.credentialSubject?.id !== id.did) {
            throw new InvalidParameterError('only subject can publish a credential');
        }

        const doc = await this.resolveDID(id.did);

        if (!doc.didDocumentData) {
            doc.didDocumentData = {};
        }

        const data = doc.didDocumentData as { manifest?: Record<string, unknown> };

        if (!data.manifest) {
            data.manifest = {};
        }

        if (!reveal) {
            // Remove the credential values
            vc.credential = null;
        }

        data.manifest[credential] = vc;

        const ok = await this.updateDID(doc);
        if (ok) {
            return vc;
        }

        throw new KeymasterError('update DID failed');
    }

    async unpublishCredential(did: string): Promise<string> {
        const id = await this.fetchIdInfo();
        const doc = await this.resolveDID(id.did);
        const credential = await this.lookupDID(did);
        const data = doc.didDocumentData as { manifest?: Record<string, unknown> };

        if (credential && data.manifest && credential in data.manifest) {
            delete data.manifest[credential];
            await this.updateDID(doc);

            return `OK credential ${did} removed from manifest`;
        }

        throw new InvalidParameterError('did');
    }

    async createChallenge(
        challenge: Challenge = {},
        options: CreateAssetOptions = {}
    ): Promise<string> {

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

    private async findMatchingCredential(
        credential: {
            schema: string;
            issuers?: string[]
        }
    ): Promise<string | undefined> {
        const id = await this.fetchIdInfo();

        if (!id.held) {
            return;
        }

        for (let did of id.held) {
            try {
                const doc = await this.decryptJSON(did);

                if (!this.isVerifiableCredential(doc)) {
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

    async createResponse(
        challengeDID: string,
        options: CreateResponseOptions = {}
    ): Promise<string> {
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
        if (!doc!) {
            throw new InvalidParameterError('challengeDID does not resolve');
        }

        const result = await this.resolveAsset(challengeDID);
        if (!result) {
            throw new InvalidParameterError('challengeDID');
        }

        const challenge = (result as { challenge?: Challenge }).challenge;
        if (!challenge) {
            throw new InvalidParameterError('challengeDID');
        }

        const requestor = doc.didDocument?.controller;
        if (!requestor) {
            throw new InvalidParameterError('requestor undefined');
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

        return await this.encryptJSON({ response }, requestor!, options);
    }

    async verifyResponse(
        responseDID: string,
        options: { retries?: number; delay?: number } = {}
    ): Promise<ChallengeResponse> {
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
        if (!responseDoc!) {
            throw new InvalidParameterError('responseDID does not resolve');
        }

        const wrapper = await this.decryptJSON(responseDID);
        if (typeof wrapper !== 'object' || !wrapper || !('response' in wrapper)) {
            throw new InvalidParameterError('responseDID not a valid challenge response');
        }
        const { response } = wrapper as { response: ChallengeResponse };

        const result = await this.resolveAsset(response.challenge);
        if (!result) {
            throw new InvalidParameterError('challenge not found');
        }

        const challenge = (result as { challenge?: Challenge }).challenge;
        if (!challenge) {
            throw new InvalidParameterError('challengeDID');
        }

        const vps: unknown[] = [];

        for (let credential of response.credentials) {
            const vcData = await this.resolveAsset(credential.vc);
            const vpData = await this.resolveAsset(credential.vp);

            const castVCData = vcData as { encrypted?: EncryptedMessage };
            const castVPData = vpData as { encrypted?: EncryptedMessage };

            if (!vcData || !vpData || !castVCData.encrypted || !castVPData.encrypted) {
                // VC revoked
                continue;
            }

            const vcHash = castVCData.encrypted;
            const vpHash = castVPData.encrypted;

            if (vcHash.cipher_hash !== vpHash.cipher_hash) {
                // can't verify that the contents of VP match the VC
                continue;
            }

            const vp = await this.decryptJSON(credential.vp) as VerifiableCredential;
            const isValid = await this.verifySignature(vp);

            if (!isValid) {
                continue;
            }

            if (!vp.type || !Array.isArray(vp.type)) {
                continue;
            }

            // Check VP against VCs specified in challenge
            if (vp.type.length >= 2 && vp.type[1].startsWith('did:')) {
                const schema = vp.type[1];
                const credential = challenge.credentials?.find(item => item.schema === schema);

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
        response.responder = responseDoc.didDocument?.controller;

        return response;
    }

    async createGroup(
        name: string,
        options: { registry?: string; members?: string[] } = {}
    ): Promise<string> {
        const group = {
            name: name,
            members: options.members || []
        };

        return this.createAsset({ group }, { ...options, name });
    }

    async getGroup(id: string): Promise<Group | null> {
        const asset = await this.resolveAsset(id);
        if (!asset) {
            return null;
        }

        // TEMP during did:test, return old version groups
        const castOldAsset = asset as Group;
        if (castOldAsset.members) {
            return castOldAsset;
        }

        const castAsset = asset as { group?: Group };
        if (!castAsset.group) {
            return null;
        }

        return castAsset.group;
    }

    async addGroupMember(
        groupId: string,
        memberId: string
    ): Promise<boolean> {
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
            throw new InvalidParameterError('memberId');
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

    async removeGroupMember(
        groupId: string,
        memberId: string
    ): Promise<boolean> {
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
            throw new InvalidParameterError('memberId');
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

    async testGroup(
        groupId: string,
        memberId?: string
    ): Promise<boolean> {
        try {
            const group = await this.getGroup(groupId);

            if (!group) {
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
        catch (error) {
            return false;
        }
    }

    async listGroups(owner?: string): Promise<string[]> {
        const assets = await this.listAssets(owner);
        const groups = [];

        for (const did of assets) {
            const isGroup = await this.testGroup(did);

            if (isGroup) {
                groups.push(did);
            }
        }

        return groups;
    }

    private validateSchema(schema: unknown): boolean {
        try {
            // Attempt to instantiate the schema
            this.generateSchema(schema);
            return true;
        }
        catch (error) {
            return false;
        }
    }

    private generateSchema(schema: unknown): Record<string, unknown> {
        if (
            typeof schema !== 'object' ||
            !schema ||
            !('$schema' in schema) ||
            !('properties' in schema)
        ) {
            throw new InvalidParameterError('schema');
        }

        const template: Record<string, unknown> = {};

        const props = (schema as { properties: Record<string, unknown> }).properties;
        for (const property of Object.keys(props)) {
            template[property] = "TBD";
        }

        return template;
    }

    async createSchema(
        schema?: unknown,
        options: {
            registry?: string,
            validUntil?: string
        } = {}
    ): Promise<string> {
        if (!schema) {
            schema = DefaultSchema;
        }

        if (!this.validateSchema(schema)) {
            throw new InvalidParameterError('schema');
        }

        return this.createAsset({ schema }, options);
    }

    async getSchema(id: string): Promise<unknown | null> {
        const asset = await this.resolveAsset(id);
        if (!asset) {
            return null;
        }

        // TEMP during did:test, return old version schemas
        const castOldAsset = asset as { properties?: unknown };
        if (castOldAsset.properties) {
            return asset;
        }

        const castAsset = asset as { schema?: unknown };
        if (!castAsset.schema) {
            return null;
        }

        return castAsset.schema;
    }

    async setSchema(
        id: string,
        schema: unknown
    ): Promise<boolean> {
        if (!this.validateSchema(schema)) {
            throw new InvalidParameterError('schema');
        }

        return this.updateAsset(id, { schema });
    }

    // TBD add optional 2nd parameter that will validate JSON against the schema
    async testSchema(id: string): Promise<boolean> {
        try {
            const schema = await this.getSchema(id);

            // TBD Need a better way because any random object with keys can be a valid schema
            if (!schema || Object.keys(schema).length === 0) {
                return false;
            }

            return this.validateSchema(schema);
        }
        catch (error) {
            return false;
        }
    }

    async listSchemas(owner?: string): Promise<string[]> {
        const assets = await this.listAssets(owner);
        const schemas = [];

        for (const did of assets) {
            const isSchema = await this.testSchema(did);

            if (isSchema) {
                schemas.push(did);
            }
        }

        return schemas;
    }

    async createTemplate(schemaId: string): Promise<Record<string, unknown>> {
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

    async pollTemplate(): Promise<Poll> {
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

    async createPoll(
        poll: Poll,
        options: { registry?: string; validUntil?: string } = {}
    ): Promise<string> {
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

    async getPoll(id: string): Promise<Poll | null> {
        const asset = await this.resolveAsset(id);
        if (!asset) {
            return null;
        }

        // TEMP during did:test, return old version poll
        const castOldAsset = asset as Poll;
        if (castOldAsset.options) {
            return castOldAsset;
        }

        const castAsset = asset as { poll?: Poll };
        if (!castAsset.poll) {
            return null;
        }

        return castAsset.poll;
    }

    async testPoll(id: string): Promise<boolean> {
        try {
            const poll = await this.getPoll(id);
            return poll !== null;
        }
        catch (error) {
            return false;
        }
    }

    async listPolls(owner?: string): Promise<string[]> {
        const assets = await this.listAssets(owner);
        const polls: string[] = [];

        for (const did of assets) {
            const isPoll = await this.testPoll(did);

            if (isPoll) {
                polls.push(did);
            }
        }

        return polls;
    }

    async viewPoll(pollId: string): Promise<ViewPollResult> {
        const id = await this.fetchIdInfo();
        const poll = await this.getPoll(pollId);

        if (!poll) {
            throw new InvalidParameterError('pollId');
        }

        let hasVoted = false;

        if (poll.ballots) {
            hasVoted = !!poll.ballots[id.did];
        }

        const voteExpired = Date.now() > new Date(poll.deadline).getTime();
        const isEligible = await this.testGroup(poll.roster, id.did);
        const doc = await this.resolveDID(pollId);

        const view: ViewPollResult = {
            description: poll.description,
            options: poll.options,
            deadline: poll.deadline,
            isOwner: (doc.didDocument?.controller === id.did),
            isEligible: isEligible,
            voteExpired: voteExpired,
            hasVoted: hasVoted,
        };

        if (id.did === doc.didDocument?.controller) {
            let voted = 0;

            const results: PollResults = {
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
                const vote = (decrypted as { vote: number }).vote;
                if (results.ballots) {
                    results.ballots.push({
                        ...ballot,
                        voter,
                        vote,
                        option: poll.options[vote - 1],
                    });
                }
                voted += 1;
                results.tally[vote].count += 1;
            }

            const roster = await this.getGroup(poll.roster);
            const total = roster!.members.length;

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

    async votePoll(
        pollId: string,
        vote: number,
        options: { spoil?: boolean; registry?: string; validUntil?: string } = {}
    ): Promise<string> {
        const { spoil = false } = options;

        const id = await this.fetchIdInfo();
        const didPoll = await this.lookupDID(pollId);
        const doc = await this.resolveDID(didPoll);
        const poll = await this.getPoll(pollId);
        if (!poll) {
            throw new InvalidParameterError('pollId');
        }

        const eligible = await this.testGroup(poll.roster, id.did);
        const expired = Date.now() > new Date(poll.deadline).getTime();
        const owner = doc.didDocument?.controller;

        if (!owner) {
            throw new KeymasterError('owner mising from poll');
        }

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

            if (!Number.isInteger(vote) || vote < 1 || vote > max) {
                throw new InvalidParameterError('vote');
            }

            ballot = {
                poll: didPoll,
                vote: vote,
            };
        }

        // Encrypt for receiver only
        return await this.encryptJSON(ballot, owner, { ...options, encryptForSender: false });
    }

    async updatePoll(ballot: string): Promise<boolean> {
        const id = await this.fetchIdInfo();

        const didBallot = await this.lookupDID(ballot);
        const docBallot = await this.resolveDID(ballot);
        const didVoter = docBallot.didDocument!.controller!;
        let dataBallot: { poll: string; vote: number };

        try {
            dataBallot = await this.decryptJSON(didBallot) as { poll: string; vote: number };

            if (!dataBallot.poll || !dataBallot.vote) {
                throw new InvalidParameterError('ballot');
            }
        }
        catch {
            throw new InvalidParameterError('ballot');
        }

        const didPoll = dataBallot.poll;
        const docPoll = await this.resolveDID(didPoll);
        const didOwner = docPoll.didDocument!.controller!;
        const poll = await this.getPoll(didPoll);

        if (!poll) {
            throw new KeymasterError('Cannot find poll related to ballot');
        }

        if (id.did !== didOwner) {
            throw new InvalidParameterError('only owner can update a poll');
        }

        const eligible = await this.testGroup(poll.roster, didVoter);

        if (!eligible) {
            throw new InvalidParameterError('voter not in roster');
        }

        const expired = Date.now() > new Date(poll.deadline).getTime();

        if (expired) {
            throw new InvalidParameterError('poll has expired');
        }

        const max = poll.options.length;
        const vote = dataBallot.vote;

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

    async publishPoll(
        pollId: string,
        options: { reveal?: boolean } = {}
    ): Promise<boolean> {
        const { reveal = false } = options;

        const id = await this.fetchIdInfo();
        const doc = await this.resolveDID(pollId);
        const owner = doc.didDocument?.controller;

        if (id.did !== owner) {
            throw new InvalidParameterError('only owner can publish a poll');
        }

        const view = await this.viewPoll(pollId);

        if (!view.results?.final) {
            throw new InvalidParameterError('poll not final');
        }

        if (!reveal && view.results.ballots) {
            delete view.results.ballots;
        }

        const poll = await this.getPoll(pollId);

        if (!poll) {
            throw new InvalidParameterError(pollId);
        }

        poll.results = view.results;

        return this.updateAsset(pollId, { poll });
    }

    async unpublishPoll(pollId: string): Promise<boolean> {
        const id = await this.fetchIdInfo();
        const doc = await this.resolveDID(pollId);
        const owner = doc.didDocument?.controller;

        if (id.did !== owner) {
            throw new InvalidParameterError(pollId);
        }

        const poll = await this.getPoll(pollId);

        if (!poll) {
            throw new InvalidParameterError(pollId);
        }

        delete poll.results;

        return this.updateAsset(pollId, { poll });
    }
}
