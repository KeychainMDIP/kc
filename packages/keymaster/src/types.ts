import { Cipher, EcdsaJwkPublic } from '@mdip/cipher/types';
import {
    GatekeeperInterface,
    MdipDocument,
    ResolveDIDOptions,
} from '@mdip/gatekeeper/types';

export interface EncryptedWallet {
    salt: string;
    iv: string;
    data: string;
}

export interface HDKey {
    xpriv: string;
    xpub: string;
}

export interface Seed {
    // v0 legacy
    mnemonic?: string;
    hdkey?: HDKey;

    // v1 (passphrase-encrypted mnemonic)
    mnemonicEnc?: {
        salt: string;
        iv: string;
        data: string;
    };
}

export interface IDInfo {
    did: string;
    account: number;
    index: number;
    held?: string[];
    owned?: string[];
    dmail?: Record<string, any>;
    notices?: Record<string, any>;
    [key: string]: any; // Allow custom metadata fields
}

export interface WalletEncFile {
    version: number;
    seed: Seed;
    enc: string
}

export interface WalletFile {
    version?: number;
    seed: Seed;
    counter: number;
    ids: Record<string, IDInfo>;
    current?: string;
    names?: Record<string, string>;
    [key: string]: any; // Allow custom metadata fields
}

export interface CheckWalletResult {
    checked: number;
    invalid: number;
    deleted: number;
}

export interface FixWalletResult {
    idsRemoved: number;
    ownedRemoved: number;
    heldRemoved: number;
    namesRemoved: number;
}

export interface CreateAssetOptions {
    registry?: string;
    controller?: string;
    validUntil?: string;
    name?: string;
}

export interface FileAssetOptions extends CreateAssetOptions {
    filename?: string;
}

export interface EncryptOptions extends CreateAssetOptions {
    encryptForSender?: boolean;
    includeHash?: boolean;
}

export interface Group {
    name: string;
    members: string[];
}

export interface Signature {
    signer?: string;
    signed: string;
    hash: string;
    value: string;
}

export interface VerifiableCredential {
    "@context": string[];
    type: string[];
    issuer: string;
    validFrom: string;
    validUntil?: string;
    credentialSubject?: {
        id: string;
    };
    credential?: Record<string, unknown> | null;
    signature?: Signature;
}

export interface IssueCredentialsOptions extends EncryptOptions {
    schema?: string;
    subject?: string;
    validFrom?: string;
    credential?: Record<string, unknown>;
}

export interface Challenge {
    credentials?: {
        schema: string;
        issuers?: string[];
    }[];
    [key: string]: any;
}

export interface ChallengeResponse {
    challenge: string;
    credentials: {
        vc: string;
        vp: string;
    }[];
    requested: number;
    fulfilled: number;
    match: boolean;
    vps?: unknown[];
    responder?: string;
}

export interface CreateResponseOptions {
    registry?: string;
    validUntil?: string;
    retries?: number;
    delay?: number;
}

export interface PollResults {
    tally: Array<{
        vote: number;
        option: string;
        count: number;
    }>;
    ballots?: Array<{
        ballot: string;
        received: string;
        voter: string;
        vote: number;
        option: string;
    }>;
    votes?: {
        eligible: number;
        received: number;
        pending: number;
    };
    final?: boolean;
}

export interface Poll {
    type: string;
    version: number;
    description: string;
    roster: string;
    options: string[];
    deadline: string;
    ballots?: Record<string, { ballot: string; received: string }>;
    results?: PollResults;
}

export interface ViewPollResult {
    description: string;
    options: string[];
    deadline: string;
    isOwner: boolean;
    isEligible: boolean;
    voteExpired: boolean;
    hasVoted: boolean;
    results?: PollResults;
}

export interface BinaryAsset {
    cid: string;
    type: string;
    bytes: number;
    data?: Buffer;
}

export interface ImageAsset extends BinaryAsset {
    width: number;
    height: number;
}

export interface FileAsset extends BinaryAsset {
    filename: string;
}

export interface GroupVault {
    version?: number;
    publicJwk: EcdsaJwkPublic;
    salt: string;
    config: string;
    members: string;
    keys: Record<string, string>;
    items: string,
    sha256: string,
}

export interface GroupVaultOptions extends CreateAssetOptions {
    secretMembers?: boolean;
    version?: number;
}

export interface GroupVaultLogin {
    service: string;
    username: string;
    password: string;
}

export type StoredWallet = EncryptedWallet | WalletFile | WalletEncFile | null;

export interface WalletBase {
    saveWallet(wallet: StoredWallet, overwrite?: boolean): Promise<boolean>;
    loadWallet(): Promise<StoredWallet | null>;
    updateWallet(mutator: (wallet: StoredWallet) => void | Promise<void>): Promise<void>;
}

export interface SearchEngine {
    search(query: object): Promise<string[]>;
}

export interface KeymasterOptions {
    passphrase: string;
    gatekeeper: GatekeeperInterface;
    wallet: WalletBase;
    cipher: Cipher;
    search?: SearchEngine;
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

export interface PossiblySigned {
    signature?: Signature;
}

export interface RestClientOptions {
    url?: string;
    console?: any;
    waitUntilReady?: boolean;
    intervalSeconds?: number;
    chatty?: boolean;
    becomeChattyAfter?: number;
    maxRetries?: number;
}

export interface KeymasterClientOptions extends RestClientOptions {
}

export interface SearchClientOptions extends RestClientOptions {
}

export interface WaitUntilReadyOptions {
    intervalSeconds?: number;
    chatty?: boolean;
    becomeChattyAfter?: number;
    maxRetries?: number;
}

export interface DmailMessage {
    to: string[];
    cc: string[];
    subject: string;
    body: string;
    reference?: string;
}

export interface DmailItem {
    message: DmailMessage;
    to: string[];
    cc: string[];
    sender: string;
    date: string;
    tags: string[];
    attachments?: any;
    docs?: any;
}

export interface NoticeMessage {
    to: string[];
    dids: string[];
}

export interface KeymasterInterface {
    // Wallet
    loadWallet(): Promise<WalletFile>;
    saveWallet(wallet: StoredWallet, overwrite?: boolean): Promise<boolean>;
    newWallet(mnemonic?: string, overwrite?: boolean): Promise<WalletFile>;
    backupWallet(): Promise<boolean | string>;
    recoverWallet(): Promise<WalletFile>;
    checkWallet(): Promise<CheckWalletResult>;
    fixWallet(): Promise<FixWalletResult>;
    decryptMnemonic(): Promise<string>;
    exportEncryptedWallet(): Promise<WalletEncFile>;

    // IDs
    listIds(): Promise<string[]>;
    getCurrentId(): Promise<string | undefined>;
    setCurrentId(name: string): Promise<boolean>;
    createId(name: string, options?: { registry?: string }): Promise<string>;
    removeId(id: string): Promise<boolean>;
    renameId(id: string, newName: string): Promise<boolean>;
    backupId(id?: string): Promise<boolean>;
    recoverId(did: string): Promise<string>;

    // Name system
    listNames(): Promise<Record<string, string>>;
    addName(name: string, did: string): Promise<boolean>;
    getName(name: string): Promise<string | null>;
    removeName(name: string): Promise<boolean>;

    // DID resolution
    resolveDID(did: string, options?: ResolveDIDOptions): Promise<MdipDocument>;

    // Assets
    createAsset(data: unknown, options?: CreateAssetOptions): Promise<string>;
    listAssets(owner?: string): Promise<string[]>;
    resolveAsset(did: string, options?: ResolveDIDOptions): Promise<unknown | null>;
    updateAsset(did: string, data: Record<string, unknown>): Promise<boolean>;

    // Encryption
    encryptMessage(msg: string, receiver: string, options?: EncryptOptions): Promise<string>;
    decryptMessage(did: string): Promise<string>;
    encryptJSON(json: unknown, receiver: string, options?: EncryptOptions): Promise<string>;
    decryptJSON(did: string): Promise<unknown>;

    // Groups
    createGroup(name: string, options?: CreateAssetOptions): Promise<string>;
    getGroup(group: string): Promise<Group | null>;
    addGroupMember(group: string, member: string): Promise<boolean>;
    removeGroupMember(group: string, member: string): Promise<boolean>;
    testGroup(group: string, member?: string): Promise<boolean>;
    listGroups(owner?: string): Promise<string[]>;

    // Schemas
    createSchema(schema?: unknown, options?: CreateAssetOptions): Promise<string>;
    getSchema(did: string): Promise<unknown | null>;
    setSchema(did: string, schema: unknown): Promise<boolean>;
    testSchema(did: string): Promise<boolean>;
    listSchemas(owner?: string): Promise<string[]>;

    // Agents
    testAgent(did: string): Promise<boolean>;

    // Credentials
    bindCredential(schema: string, subject: string, options?: {
        validFrom?: string;
        validUntil?: string;
        credential?: Record<string, unknown>;
    }): Promise<VerifiableCredential>;

    issueCredential(credential: Partial<VerifiableCredential>, options?: IssueCredentialsOptions): Promise<string>;
    sendCredential(did: string, options?: CreateAssetOptions): Promise<string | null>;
    updateCredential(did: string, credential: VerifiableCredential): Promise<boolean>;
    revokeCredential(did: string): Promise<boolean>;
    listIssued(issuer?: string): Promise<string[]>;
    acceptCredential(did: string): Promise<boolean>;
    getCredential(did: string): Promise<VerifiableCredential | null>;
    removeCredential(did: string): Promise<boolean>;
    listCredentials(id?: string): Promise<string[]>;
    publishCredential(did: string, options?: { reveal?: boolean }): Promise<VerifiableCredential | boolean>;
    unpublishCredential(did: string): Promise<string | boolean>;

    // Challenges
    createChallenge(challenge?: Challenge, options?: { registry?: string; validUntil?: string }): Promise<string>;
    createResponse(challengeDid: string, options?: CreateResponseOptions): Promise<string>;
    verifyResponse(responseDid: string, options?: { retries?: number; delay?: number }): Promise<ChallengeResponse>;

    // Polls
    pollTemplate(): Promise<Poll>;
    createPoll(poll: Poll, options?: CreateAssetOptions): Promise<string>;
    getPoll(pollId: string): Promise<Poll | null>;
    viewPoll(pollId: string): Promise<ViewPollResult>;
    votePoll(pollId: string, vote: number, options?: { spoil?: boolean; registry?: string; validUntil?: string }): Promise<string>;
    updatePoll(ballot: string): Promise<boolean>;
    publishPoll(pollId: string, options?: { reveal?: boolean }): Promise<boolean>;
    unpublishPoll(pollId: string): Promise<boolean>;

    // Images
    createImage(data: Buffer, options?: CreateAssetOptions): Promise<string>;
    updateImage(did: string, data: Buffer): Promise<boolean>;
    getImage(id: string): Promise<ImageAsset | null>;
    testImage(id: string): Promise<boolean>;

    // Documents
    createDocument(data: Buffer, options?: FileAssetOptions): Promise<string>;
    updateDocument(did: string, data: Buffer, options?: FileAssetOptions): Promise<boolean>;
    getDocument(id: string): Promise<FileAsset | null>;
    testDocument(id: string): Promise<boolean>;

    // GroupVaults
    createGroupVault(options?: CreateAssetOptions): Promise<string>;
    getGroupVault(vaultId: string, options?: ResolveDIDOptions): Promise<GroupVault>;
    testGroupVault(vaultId: string, options?: ResolveDIDOptions): Promise<boolean>;
    addGroupVaultMember(vaultId: string, memberId: string): Promise<boolean>;
    removeGroupVaultMember(vaultId: string, memberId: string): Promise<boolean>;
    addGroupVaultItem(vaultId: string, name: string, buffer: Buffer): Promise<boolean>;
    removeGroupVaultItem(vaultId: string, name: string): Promise<boolean>;
    listGroupVaultItems(vaultId: string, options?: ResolveDIDOptions): Promise<Record<string, any>>;
    getGroupVaultItem(vaultId: string, name: string, options?: ResolveDIDOptions): Promise<Buffer | null>;

    // Dmail
    createDmail(message: DmailMessage, options?: CreateAssetOptions): Promise<string>;
    updateDmail(did: string, message: DmailMessage): Promise<boolean>;
    fileDmail(did: string, tags: string[]): Promise<boolean>
    removeDmail(did: string): Promise<boolean>;
    importDmail(did: string): Promise<boolean>;
    getDmailMessage(did: string, options?: ResolveDIDOptions): Promise<DmailMessage | null>;
    listDmail(): Promise<Record<string, DmailItem>>;
    sendDmail(did: string): Promise<string | null>;
    addDmailAttachment(did: string, name: string, buffer: Buffer): Promise<boolean>;
    removeDmailAttachment(did: string, name: string): Promise<boolean>;
    listDmailAttachments(did: string, options?: ResolveDIDOptions): Promise<Record<string, any>>;
    getDmailAttachment(did: string, name: string): Promise<Buffer | null>;

    // Notices
    createNotice(message: NoticeMessage, options: CreateAssetOptions): Promise<string>;
    updateNotice(did: string, message: NoticeMessage): Promise<boolean>;
    refreshNotices(): Promise<boolean>;
}
