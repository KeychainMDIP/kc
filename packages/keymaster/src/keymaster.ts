import { imageSize } from 'image-size';
import { fileTypeFromBuffer } from 'file-type';
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
    EncryptedMessage,
    FileAssetOptions,
    CreateResponseOptions,
    DmailItem,
    DmailMessage,
    EncryptOptions,
    FileAsset,
    FixWalletResult,
    Group,
    GroupVault,
    GroupVaultOptions,
    IDInfo,
    ImageAsset,
    IssueCredentialsOptions,
    KeymasterInterface,
    KeymasterOptions,
    NoticeMessage,
    Poll,
    PollResults,
    PossiblySigned,
    Signature,
    StoredWallet,
    VerifiableCredential,
    ViewPollResult,
    WalletBase,
    WalletFile,
    SearchEngine,
} from './types.js';
import {
    Cipher,
    EcdsaJwkPair,
    EcdsaJwkPrivate,
    EcdsaJwkPublic
} from '@mdip/cipher/types';
import { isValidDID } from '@mdip/ipfs/utils';

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

export enum DmailTags {
    DMAIL = 'dmail',
    INBOX = 'inbox',
    DRAFT = 'draft',
    SENT = 'sent',
    ARCHIVED = 'archived',
    DELETED = 'deleted',
}

export enum PollTags {
    BALLOT = "ballot",
    POLL = "poll",
}

export default class Keymaster implements KeymasterInterface {
    private gatekeeper: GatekeeperInterface;
    private db: WalletBase;
    private cipher: Cipher;
    private searchEngine: SearchEngine | undefined;
    private readonly defaultRegistry: string;
    private readonly ephemeralRegistry: string;
    private readonly maxNameLength: number;
    private readonly maxDataLength: number;

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
        if (options.search && !options.search.search) {
            throw new InvalidParameterError('options.search');
        }

        this.gatekeeper = options.gatekeeper;
        this.db = options.wallet;
        this.cipher = options.cipher;
        this.searchEngine = options.search;

        this.defaultRegistry = options.defaultRegistry || 'hyperswarm';
        this.ephemeralRegistry = 'hyperswarm';
        this.maxNameLength = options.maxNameLength || 32;
        this.maxDataLength = 8 * 1024; // 8 KB max data to store in a JSON object
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

    getPublicKeyJwk(doc: MdipDocument): EcdsaJwkPublic {
        // TBD Return the right public key, not just the first one
        if (!doc.didDocument) {
            throw new KeymasterError('Missing didDocument.');
        }
        const verificationMethods = doc.didDocument.verificationMethod;
        if (!verificationMethods || verificationMethods.length === 0) {
            throw new KeymasterError('The DID document does not contain any verification methods.');
        }
        const publicKeyJwk = verificationMethods[0].publicKeyJwk;
        if (!publicKeyJwk) {
            throw new KeymasterError('The publicKeyJwk is missing in the first verification method.');
        }
        return publicKeyJwk;
    }

    async fetchKeyPair(name?: string): Promise<EcdsaJwkPair | null> {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(name);
        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed!.hdkey);
        const doc = await this.resolveDID(id.did, { confirm: true });
        const confirmedPublicKeyJwk = this.getPublicKeyJwk(doc);

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
        const block = await this.gatekeeper.getBlock(registry);
        const blockid = block?.hash;

        const operation: Operation = {
            type: "create",
            created: new Date().toISOString(),
            blockid,
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

    async generateImageAsset(buffer: Buffer): Promise<ImageAsset> {
        let metadata;

        try {
            metadata = imageSize(buffer);
        }
        catch (error) {
            throw new InvalidParameterError('buffer');
        }

        const cid = await this.gatekeeper.addData(buffer);
        const image: ImageAsset = {
            cid,
            bytes: buffer.length,
            ...metadata,
            type: `image/${metadata.type}`
        };

        return image;
    }

    async createImage(
        buffer: Buffer,
        options: CreateAssetOptions = {}
    ): Promise<string> {
        const image = await this.generateImageAsset(buffer);

        return this.createAsset({ image }, options);
    }

    async updateImage(
        id: string,
        buffer: Buffer
    ): Promise<boolean> {
        const image = await this.generateImageAsset(buffer);

        return this.updateAsset(id, { image });
    }

    async getImage(id: string): Promise<ImageAsset | null> {
        const asset = await this.resolveAsset(id) as { image?: ImageAsset };

        return asset.image ?? null;
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

    async getMimeType(buffer: Buffer): Promise<string> {
        // Try magic number detection
        const result = await fileTypeFromBuffer(buffer);
        if (result) return result.mime;

        // Convert to UTF-8 string if decodable
        const text = buffer.toString('utf8');

        // Check for JSON
        try {
            JSON.parse(text);
            return 'application/json';
        } catch { }

        // Default to plain text if printable ASCII
        // eslint-disable-next-line
        if (/^[\x09\x0A\x0D\x20-\x7E]*$/.test(text.replace(/\n/g, ''))) {
            return 'text/plain';
        }

        // Fallback
        return 'application/octet-stream';
    }

    async generateFileAsset(
        filename: string,
        buffer: Buffer,
    ): Promise<FileAsset> {
        const cid = await this.gatekeeper.addData(buffer);
        const type = await this.getMimeType(buffer);

        const file: FileAsset = {
            cid,
            filename,
            type,
            bytes: buffer.length,
        };

        return file;
    }

    async createDocument(
        buffer: Buffer,
        options: FileAssetOptions = {}
    ): Promise<string> {
        const filename = options.filename || 'document';
        const document = await this.generateFileAsset(filename, buffer);

        return this.createAsset({ document }, options);
    }

    async updateDocument(
        id: string,
        buffer: Buffer,
        options: FileAssetOptions = {}
    ): Promise<boolean> {
        const filename = options.filename || 'document';
        const document = await this.generateFileAsset(filename, buffer);

        return this.updateAsset(id, { document });
    }

    async getDocument(id: string): Promise<FileAsset | null> {
        const asset = await this.resolveAsset(id) as { document?: FileAsset };

        return asset.document ?? null;
    }

    async testDocument(id: string): Promise<boolean> {
        try {
            const document = await this.getDocument(id);
            return document !== null;
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
        const receivePublicJwk = this.getPublicKeyJwk(doc);

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

    private decryptWithDerivedKeys(wallet: WalletFile, id: IDInfo, senderPublicJwk: EcdsaJwkPublic, ciphertext: string): string {
        const hdkey = this.cipher.generateHDKeyJSON(wallet.seed!.hdkey);

        // Try all private keys for this ID, starting with the most recent and working backward
        let index = id.index;
        while (index >= 0) {
            const path = `m/44'/0'/${id.account}'/0/${index}`;
            const didkey = hdkey.derive(path);
            const receiverKeypair = this.cipher.generateJwk(didkey.privateKey!);
            try {
                return this.cipher.decryptMessage(senderPublicJwk, receiverKeypair.privateJwk, ciphertext);
            }
            catch (error) {
                index -= 1;
            }
        }

        throw new KeymasterError("ID can't decrypt ciphertext");
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
        const senderPublicJwk = this.getPublicKeyJwk(doc);

        const ciphertext = (crypt.sender === id.did && crypt.cipher_sender) ? crypt.cipher_sender : crypt.cipher_receiver;
        return this.decryptWithDerivedKeys(wallet, id, senderPublicJwk, ciphertext!);
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
        const publicJwk = this.getPublicKeyJwk(doc);

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
        const previd = current.didDocumentMetadata?.versionId;

        // Compare the hashes of the current and updated documents without the metadata
        current.didDocumentMetadata = {};
        doc.didDocumentMetadata = {};

        const currentHash = this.cipher.hashJSON(current);
        const updateHash = this.cipher.hashJSON(doc);

        // If no change, return immediately without updating
        // Maybe add a force update option later if needed?
        if (currentHash === updateHash) {
            return true;
        }

        const block = await this.gatekeeper.getBlock(current.mdip!.registry);
        const blockid = block?.hash;

        const operation: Operation = {
            type: "update",
            did,
            previd,
            blockid,
            doc,
        };

        const controller = current.didDocument?.controller || current.didDocument?.id;
        const signed = await this.addSignature(operation, controller);
        return this.gatekeeper.updateDID(signed);
    }

    async revokeDID(id: string): Promise<boolean> {
        const did = await this.lookupDID(id);
        const current = await this.resolveDID(did);
        const previd = current.didDocumentMetadata?.versionId;
        const block = await this.gatekeeper.getBlock(current.mdip!.registry);
        const blockid = block?.hash;

        const operation: Operation = {
            type: "delete",
            did,
            previd,
            blockid
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
        const currentData = doc.didDocumentData || {};

        doc.didDocumentData = {
            ...currentData,
            ...data
        };

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
        const block = await this.gatekeeper.getBlock(registry);
        const blockid = block?.hash;

        const operation: Operation = {
            type: "create",
            created: new Date().toISOString(),
            blockid,
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

    async listNames(
        options: {
            includeIDs?: boolean
        } = {}
    ): Promise<Record<string, string>> {
        const { includeIDs = false } = options;
        const wallet = await this.loadWallet();
        const names = wallet.names || {};

        if (includeIDs) {
            for (const [name, id] of Object.entries(wallet.ids || {})) {
                names[name] = id.did;
            }
        }

        return names;
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
        const receivePublicJwk = this.getPublicKeyJwk(holderDoc);
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
        options: CreateAssetOptions = {}
    ): Promise<string> {
        const group = {
            name: name,
            members: []
        };

        return this.createAsset({ group }, options);
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
        options: CreateAssetOptions = {}
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
        options: CreateAssetOptions = {}
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

    async createGroupVault(options: GroupVaultOptions = {}): Promise<string> {
        const id = await this.fetchIdInfo();
        const idKeypair = await this.fetchKeyPair();
        // version defaults to 1. To make version undefined (unit testing), set options.version to 0
        const version = typeof options.version === 'undefined'
            ? 1
            : (typeof options.version === 'number' && options.version === 1 ? options.version : undefined);
        const salt = this.cipher.generateRandomSalt();
        const vaultKeypair = this.cipher.generateRandomJwk();
        const keys = {};
        const config = this.cipher.encryptMessage(idKeypair!.publicJwk, vaultKeypair.privateJwk, JSON.stringify(options));
        const publicJwk = options.secretMembers ? idKeypair!.publicJwk : vaultKeypair.publicJwk; // If secret, encrypt for the owner only
        const members = this.cipher.encryptMessage(publicJwk, vaultKeypair.privateJwk, JSON.stringify({}));
        const items = this.cipher.encryptMessage(vaultKeypair.publicJwk, vaultKeypair.privateJwk, JSON.stringify({}));
        const sha256 = this.cipher.hashJSON({});
        const groupVault = {
            version,
            publicJwk: vaultKeypair.publicJwk,
            salt,
            config,
            members,
            keys,
            items,
            sha256,
        };

        await this.addMemberKey(groupVault, id.did, vaultKeypair.privateJwk);
        return this.createAsset({ groupVault }, options);
    }

    async getGroupVault(groupVaultId: string): Promise<GroupVault> {
        const asset = await this.resolveAsset(groupVaultId) as { groupVault?: GroupVault };

        if (!asset.groupVault) {
            throw new InvalidParameterError('groupVaultId');
        }

        return asset.groupVault;
    }

    async testGroupVault(id: string): Promise<boolean> {
        try {
            const groupVault = await this.getGroupVault(id);
            return groupVault !== null;
        }
        catch (error) {
            return false;
        }
    }

    private generateSaltedId(groupVault: GroupVault, memberDID: string): string {
        if (!groupVault.version) {
            return this.cipher.hashMessage(groupVault.salt + memberDID);
        }

        const suffix = memberDID.split(':').pop() as string;
        return this.cipher.hashMessage(groupVault.salt + suffix);
    }

    private async decryptGroupVault(groupVault: GroupVault) {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo();
        const myMemberId = this.generateSaltedId(groupVault, id.did);
        const myVaultKey = groupVault.keys[myMemberId];

        if (!myVaultKey) {
            throw new KeymasterError('No access to group vault');
        }

        const privKeyJSON = this.decryptWithDerivedKeys(wallet, id, groupVault.publicJwk, myVaultKey);
        const privateJwk = JSON.parse(privKeyJSON) as EcdsaJwkPrivate;

        let config: GroupVaultOptions = {};
        let isOwner = false;
        try {
            const configJSON = this.decryptWithDerivedKeys(wallet, id, groupVault.publicJwk, groupVault.config);
            config = JSON.parse(configJSON);
            isOwner = true;
        }
        catch (error) {
            // Can't decrypt config if not the owner
        }

        let members: Record<string, any> = {};

        if (config.secretMembers) {
            try {
                const membersJSON = this.decryptWithDerivedKeys(wallet, id, groupVault.publicJwk, groupVault.members);
                members = JSON.parse(membersJSON);
            }
            catch (error) {
            }
        }
        else {
            try {
                const membersJSON = this.cipher.decryptMessage(groupVault.publicJwk, privateJwk, groupVault.members);
                members = JSON.parse(membersJSON);
            }
            catch (error) {
            }
        }

        const itemsJSON = this.cipher.decryptMessage(groupVault.publicJwk, privateJwk, groupVault.items);
        const items = JSON.parse(itemsJSON);

        return {
            isOwner,
            privateJwk,
            config,
            members,
            items,
        };
    }

    private async checkGroupVaultOwner(vaultId: string): Promise<string> {
        const id = await this.fetchIdInfo();
        const vaultDoc = await this.resolveDID(vaultId);
        const controller = vaultDoc.didDocument?.controller;

        if (controller !== id.did) {
            throw new KeymasterError('Only vault owner can modify the vault');
        }

        return controller
    }

    private async addMemberKey(groupVault: GroupVault, memberDID: string, privateJwk: EcdsaJwkPrivate): Promise<void> {
        const memberDoc = await this.resolveDID(memberDID, { confirm: true });
        const memberPublicJwk = this.getPublicKeyJwk(memberDoc);
        const memberKey = this.cipher.encryptMessage(memberPublicJwk, privateJwk, JSON.stringify(privateJwk));
        const memberKeyId = this.generateSaltedId(groupVault, memberDID);
        groupVault.keys[memberKeyId] = memberKey;
    }

    private async checkVaultVersion(vaultId: string, groupVault: GroupVault): Promise<void> {
        if (groupVault.version === 1) {
            return;
        }

        if (!groupVault.version) {
            const id = await this.fetchIdInfo();
            const { privateJwk, members } = await this.decryptGroupVault(groupVault);

            groupVault.version = 1;
            groupVault.keys = {};

            await this.addMemberKey(groupVault, id.did, privateJwk);

            for (const memberDID of Object.keys(members)) {
                await this.addMemberKey(groupVault, memberDID, privateJwk);
            }

            await this.updateAsset(vaultId, { groupVault });
            return;
        }

        throw new KeymasterError('Unsupported group vault version');
    }

    getAgentDID(doc: MdipDocument): string {
        if (doc.mdip?.type !== 'agent') {
            throw new KeymasterError('Document is not an agent');
        }

        const did = doc.didDocument?.id;

        if (!did) {
            throw new KeymasterError('Agent document does not have a DID');
        }

        return did;
    }

    async addGroupVaultMember(vaultId: string, memberId: string): Promise<boolean> {
        const owner = await this.checkGroupVaultOwner(vaultId);

        const idKeypair = await this.fetchKeyPair();
        const groupVault = await this.getGroupVault(vaultId);
        const { privateJwk, config, members } = await this.decryptGroupVault(groupVault);
        const memberDoc = await this.resolveDID(memberId, { confirm: true });
        const memberDID = this.getAgentDID(memberDoc);

        // Don't allow adding the vault owner
        if (owner === memberDID) {
            return false;
        }

        members[memberDID] = { added: new Date().toISOString() };
        const publicJwk = config.secretMembers ? idKeypair!.publicJwk : groupVault.publicJwk;
        groupVault.members = this.cipher.encryptMessage(publicJwk, privateJwk, JSON.stringify(members));

        await this.addMemberKey(groupVault, memberDID, privateJwk);
        return this.updateAsset(vaultId, { groupVault });
    }

    async removeGroupVaultMember(vaultId: string, memberId: string): Promise<boolean> {
        const owner = await this.checkGroupVaultOwner(vaultId);

        const idKeypair = await this.fetchKeyPair();
        const groupVault = await this.getGroupVault(vaultId);
        const { privateJwk, config, members } = await this.decryptGroupVault(groupVault);
        const memberDoc = await this.resolveDID(memberId, { confirm: true });
        const memberDID = this.getAgentDID(memberDoc);

        // Don't allow removing the vault owner
        if (owner === memberDID) {
            return false;
        }

        delete members[memberDID];
        const publicJwk = config.secretMembers ? idKeypair!.publicJwk : groupVault.publicJwk;
        groupVault.members = this.cipher.encryptMessage(publicJwk, privateJwk, JSON.stringify(members));

        const memberKeyId = this.generateSaltedId(groupVault, memberDID);
        delete groupVault.keys[memberKeyId];

        return this.updateAsset(vaultId, { groupVault });
    }

    async listGroupVaultMembers(vaultId: string): Promise<Record<string, any>> {
        const groupVault = await this.getGroupVault(vaultId);
        const { members, isOwner } = await this.decryptGroupVault(groupVault);

        if (isOwner) {
            await this.checkVaultVersion(vaultId, groupVault);
        }

        return members;
    }

    async addGroupVaultItem(vaultId: string, name: string, buffer: Buffer): Promise<boolean> {
        await this.checkGroupVaultOwner(vaultId);

        const groupVault = await this.getGroupVault(vaultId);
        const { privateJwk, items } = await this.decryptGroupVault(groupVault);
        const validName = this.validateName(name);
        const encryptedData = this.cipher.encryptBytes(groupVault.publicJwk, privateJwk, buffer);
        const cid = await this.gatekeeper.addText(encryptedData);
        const sha256 = this.cipher.hashMessage(buffer);
        const type = await this.getMimeType(buffer);
        const data = encryptedData.length < this.maxDataLength ? encryptedData : undefined;

        items[validName] = {
            cid,
            sha256,
            bytes: buffer.length,
            type,
            added: new Date().toISOString(),
            data,
        };

        groupVault.items = this.cipher.encryptMessage(groupVault.publicJwk, privateJwk, JSON.stringify(items));
        groupVault.sha256 = this.cipher.hashJSON(items);

        return this.updateAsset(vaultId, { groupVault });
    }

    async removeGroupVaultItem(vaultId: string, name: string): Promise<boolean> {
        await this.checkGroupVaultOwner(vaultId);

        const groupVault = await this.getGroupVault(vaultId);
        const { privateJwk, items } = await this.decryptGroupVault(groupVault);

        delete items[name];

        groupVault.items = this.cipher.encryptMessage(groupVault.publicJwk, privateJwk, JSON.stringify(items));
        groupVault.sha256 = this.cipher.hashJSON(items);
        return this.updateAsset(vaultId, { groupVault });
    }

    async listGroupVaultItems(vaultId: string): Promise<Record<string, any>> {
        const groupVault = await this.getGroupVault(vaultId);
        const { items } = await this.decryptGroupVault(groupVault);

        return items;
    }

    async getGroupVaultItem(vaultId: string, name: string): Promise<Buffer | null> {
        try {
            const groupVault = await this.getGroupVault(vaultId);
            const { privateJwk, items } = await this.decryptGroupVault(groupVault);

            if (items[name]) {
                const encryptedData = items[name].data || await this.gatekeeper.getText(items[name].cid);

                if (encryptedData) {
                    const bytes = this.cipher.decryptBytes(groupVault.publicJwk, privateJwk, encryptedData);
                    return Buffer.from(bytes);
                }
            }

            return null;
        }
        catch (error) {
            return null;
        }
    }

    async listDmail(): Promise<Record<string, DmailItem>> {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(undefined, wallet);
        const list = id.dmail || {};
        const dmailList: Record<string, DmailItem> = {};
        const nameList = await this.listNames({ includeIDs: true });
        const didToName: Record<string, string> = Object.entries(nameList).reduce((acc, [name, did]) => {
            acc[did] = name;
            return acc;
        }, {} as Record<string, string>);

        for (const did of Object.keys(list)) {
            const message = await this.getDmailMessage(did);

            if (!message) {
                continue; // Skip if no dmail found for this DID
            }

            const tags = list[did].tags ?? [];
            const docs = await this.resolveDID(did);
            const controller = docs.didDocument?.controller ?? '';
            const sender = didToName[controller] ?? controller;
            const date = docs.didDocumentMetadata?.updated ?? '';
            const to = message.to.map(did => didToName[did] ?? did);
            const cc = message.cc.map(did => didToName[did] ?? did);

            dmailList[did] = {
                message,
                to,
                cc,
                tags,
                sender,
                date,
                docs,
            };
        }

        return dmailList;
    }

    verifyTagList(tags: string[]): string[] {
        if (!Array.isArray(tags)) {
            throw new InvalidParameterError('tags');
        }

        const tagSet = new Set<string>();

        for (const tag of tags) {
            try {
                tagSet.add(this.validateName(tag));
            }
            catch (error) {
                throw new InvalidParameterError(`Invalid tag: '${tag}'`);
            }
        }

        return tagSet.size > 0 ? Array.from(tagSet) : [];
    }

    async fileDmail(
        did: string,
        tags: string[]
    ): Promise<boolean> {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(undefined, wallet);
        const verifiedTags = this.verifyTagList(tags);

        if (!id.dmail) {
            id.dmail = {};
        }

        id.dmail[did] = { tags: verifiedTags };

        return this.saveWallet(wallet);
    }

    async removeDmail(did: string): Promise<boolean> {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(undefined, wallet);

        if (!id.dmail || !id.dmail[did]) {
            return true;
        }

        delete id.dmail[did];

        return this.saveWallet(wallet);
    }

    async verifyRecipientList(list: string[]): Promise<string[]> {
        if (!Array.isArray(list)) {
            throw new InvalidParameterError('list');
        }

        const nameList = await this.listNames({ includeIDs: true });
        let newList = [];

        for (const id of list) {
            if (typeof id !== 'string') {
                throw new InvalidParameterError(`Invalid recipient type: ${typeof id}`);
            }

            if (id in nameList) {
                const did = nameList[id];
                const isAgent = await this.testAgent(did);

                if (isAgent) {
                    newList.push(did);
                    continue;
                }

                throw new InvalidParameterError(`Invalid recipient: ${id}`);
            }

            if (isValidDID(id)) {
                newList.push(id);
                continue;
            }

            throw new InvalidParameterError(`Invalid recipient: ${id}`);
        }

        return newList;
    }

    async verifyDmail(message: DmailMessage): Promise<DmailMessage> {
        const to = await this.verifyRecipientList(message.to);
        const cc = await this.verifyRecipientList(message.cc);

        if (to.length === 0) {
            throw new InvalidParameterError('dmail.to');
        }

        if (!message.subject || typeof message.subject !== 'string' || message.subject.trim() === '') {
            throw new InvalidParameterError('dmail.subject');
        }

        if (!message.body || typeof message.body !== 'string' || message.body.trim() === '') {
            throw new InvalidParameterError('dmail.body');
        }

        return {
            ...message,
            to,
            cc,
        };
    }

    async createDmail(
        message: DmailMessage,
        options: GroupVaultOptions = {}
    ): Promise<string> {
        const dmail = await this.verifyDmail(message);
        const did = await this.createGroupVault(options);

        for (const toDID of dmail.to) {
            await this.addGroupVaultMember(did, toDID);
        }

        for (const ccDID of dmail.cc) {
            await this.addGroupVaultMember(did, ccDID);
        }

        const buffer = Buffer.from(JSON.stringify({ dmail }), 'utf-8');
        await this.addGroupVaultItem(did, DmailTags.DMAIL, buffer);
        await this.fileDmail(did, [DmailTags.DRAFT]);

        return did;
    }

    async updateDmail(
        did: string,
        message: DmailMessage
    ): Promise<boolean> {
        const dmail = await this.verifyDmail(message);

        for (const toDID of dmail.to) {
            await this.addGroupVaultMember(did, toDID);
        }

        for (const ccDID of dmail.cc) {
            await this.addGroupVaultMember(did, ccDID);
        }

        const buffer = Buffer.from(JSON.stringify({ dmail }), 'utf-8');
        return this.addGroupVaultItem(did, DmailTags.DMAIL, buffer);
    }

    async sendDmail(did: string): Promise<string | null> {
        const dmail = await this.getDmailMessage(did);

        if (!dmail) {
            return null;
        }

        const registry = this.ephemeralRegistry;
        const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // Default to 7 days
        const message: NoticeMessage = {
            to: [...dmail.to, ...dmail.cc],
            dids: [did],
        };

        const notice = await this.createNotice(message, { registry, validUntil });

        if (notice) {
            await this.fileDmail(did, [DmailTags.SENT]);
        }

        return notice;
    }

    async getDmailMessage(did: string): Promise<DmailMessage | null> {
        const isGroupVault = await this.testGroupVault(did);

        if (!isGroupVault) {
            return null;
        }

        const buffer = await this.getGroupVaultItem(did, DmailTags.DMAIL);

        if (!buffer) {
            return null;
        }

        try {
            const data = JSON.parse(buffer.toString('utf-8'));
            return data.dmail as DmailMessage;
        }
        catch (error) {
            return null;
        }
    }

    async importDmail(did: string): Promise<boolean> {
        const dmail = await this.getDmailMessage(did);

        if (!dmail) {
            return false;
        }

        return this.fileDmail(did, [DmailTags.INBOX]);
    }

    async verifyDIDList(didList: string[]): Promise<string[]> {
        if (!Array.isArray(didList)) {
            throw new InvalidParameterError('didList');
        }

        for (const did of didList) {
            if (!isValidDID(did)) {
                throw new InvalidParameterError(`Invalid DID: ${did}`);
            }
        }

        return didList;
    }

    async verifyNotice(notice: NoticeMessage): Promise<NoticeMessage> {
        const to = await this.verifyRecipientList(notice.to);
        const dids = await this.verifyDIDList(notice.dids);

        if (to.length === 0) {
            throw new InvalidParameterError('notice.to');
        }

        if (dids.length === 0) {
            throw new InvalidParameterError('notice.dids');
        }

        return { to, dids };
    }

    async createNotice(
        message: NoticeMessage,
        options: CreateAssetOptions = {}
    ): Promise<string> {
        const notice = await this.verifyNotice(message);
        return this.createAsset({ notice }, options);
    }

    async updateNotice(
        id: string,
        message: NoticeMessage,
    ): Promise<boolean> {
        const notice = await this.verifyNotice(message);
        return this.updateAsset(id, { notice });
    }

    async addToNotices(
        did: string,
        tags: string[]
    ): Promise<boolean> {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(undefined, wallet);
        const verifiedTags = this.verifyTagList(tags);

        if (!id.notices) {
            id.notices = {};
        }

        id.notices[did] = { tags: verifiedTags };

        return this.saveWallet(wallet);
    }

    async importNotice(did: string): Promise<boolean> {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(undefined, wallet);

        if (id.notices && id.notices[did]) {
            return true; // Already imported
        }

        const asset = await this.resolveAsset(did) as { notice?: NoticeMessage };

        if (!asset || !asset.notice) {
            return false; // Not a notice
        }

        if (!asset.notice.to.includes(id.did)) {
            return false; // Not for this user
        }

        for (const noticeDID of asset.notice.dids) {
            const dmail = await this.getDmailMessage(noticeDID);

            if (dmail) {
                const imported = await this.importDmail(noticeDID);

                if (imported) {
                    await this.addToNotices(did, [DmailTags.DMAIL]);
                }

                continue;
            }

            const isBallot = await this.isBallot(noticeDID);

            if (isBallot) {
                let imported = false;
                try {
                    imported = await this.updatePoll(noticeDID);
                } catch { }

                if (imported) {
                    await this.addToNotices(did, [PollTags.BALLOT]);
                }

                continue;
            }

            const poll = await this.getPoll(noticeDID);

            if (poll) {
                await this.addUnnamedPoll(noticeDID);
                await this.addToNotices(did, [PollTags.POLL]);

                continue;
            }

            return false;
        }

        return true;
    }

    async searchNotices(): Promise<boolean> {
        if (!this.searchEngine) {
            return false; // Search engine not available
        }

        const id = await this.fetchIdInfo();

        if (!id.notices) {
            id.notices = {};
        }

        // Search for all notice DIDs sent to the current ID
        const where = {
            "didDocumentData.notice.to[*]": {
                "$in": [id.did]
            }
        };

        let notices;

        try {
            // TBD search engine should not return expired notices
            notices = await this.searchEngine.search({ where });
        }
        catch (error) {
            throw new KeymasterError('Failed to search for notices');
        }

        for (const notice of notices) {
            if (notice in id.notices) {
                continue; // Already imported
            }

            try {
                await this.importNotice(notice);
            } catch (error) {
                continue; // Skip if notice is expired or invalid
            }
        }

        return true;
    }

    async cleanupNotices(): Promise<boolean> {
        const wallet = await this.loadWallet();
        const id = await this.fetchIdInfo(undefined, wallet);

        if (!id.notices) {
            return true; // No notices to clean up
        }

        for (const did of Object.keys(id.notices)) {
            try {
                const asset = await this.resolveAsset(did) as { notice?: NoticeMessage };

                if (!asset || !asset.notice) {
                    delete id.notices[did]; // revoked or invalid
                }
            } catch (error) {
                delete id.notices[did]; // expired
            }
        }

        return this.saveWallet(wallet);
    }

    async refreshNotices(): Promise<boolean> {
        await this.searchNotices();
        return this.cleanupNotices();
    }

    private async isBallot(ballotDid: string): Promise<boolean> {
        let payload: any;
        try {
            payload = await this.decryptJSON(ballotDid);
        } catch {
            return false;
        }

        return payload && typeof payload.poll === "string" && typeof payload.vote === "number";
    }

    private async addUnnamedPoll(did: string): Promise<void> {
        const fallbackName = did.slice(-32);
        try {
            await this.addName(fallbackName, did);
        } catch { }
    }
}
