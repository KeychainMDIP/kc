import {
    MdipDocument,
    ResolveDIDOptions,
} from '@mdip/gatekeeper/types';
import {Image} from "./keymaster.js";

export interface EncryptedWallet {
    salt: string
    iv: string
    data: string
}

export interface HDKey {
    xpriv: string
    xpub: string
}

export interface Seed {
    mnemonic: string
    hdkey: HDKey
}

export interface IDInfo {
    did: string
    account: number
    index: number
    held?: string[]
    owned?: string[]
}

export interface WalletFile {
    seed: Seed
    counter: number
    ids: Record<string, IDInfo>
    current?: string
    names?: Record<string, string>
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

export type StoredWallet = EncryptedWallet | WalletFile | null;

export interface WalletBase {
    saveWallet(wallet: StoredWallet, overwrite?: boolean): Promise<boolean>
    loadWallet(): Promise<StoredWallet>
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
    resolveAsset(did: string): Promise<unknown | null>;
    updateAsset(did: string, data: Record<string, unknown>): Promise<boolean>;

    // Encryption
    encryptMessage(msg: string, receiver: string, options?: EncryptOptions): Promise<string>;
    decryptMessage(did: string): Promise<string>;
    encryptJSON(json: unknown, receiver: string, options?: EncryptOptions): Promise<string>;
    decryptJSON(did: string): Promise<unknown>;

    // Groups
    createGroup(name: string, options?: { registry?: string; members?: string[] }): Promise<string>;
    getGroup(group: string): Promise<Group | null>;
    addGroupMember(group: string, member: string): Promise<boolean>;
    removeGroupMember(group: string, member: string): Promise<boolean>;
    testGroup(group: string, member?: string): Promise<boolean>;
    listGroups(owner?: string): Promise<string[]>;

    // Schemas
    createSchema(schema?: unknown, options?: { registry?: string; validUntil?: string }): Promise<string>;
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
    createPoll(poll: Poll, options?: { registry?: string; validUntil?: string }): Promise<string>;
    getPoll(pollId: string): Promise<Poll | null>;
    viewPoll(pollId: string): Promise<ViewPollResult>;
    votePoll(pollId: string, vote: number, options?: { spoil?: boolean; registry?: string; validUntil?: string }): Promise<string>;
    updatePoll(ballot: string): Promise<boolean>;
    publishPoll(pollId: string, options?: { reveal?: boolean }): Promise<boolean>;
    unpublishPoll(pollId: string): Promise<boolean>;

    // Images
    createImage(data: Buffer, options?: CreateAssetOptions): Promise<string>;
    getImage(id: string): Promise<Image | null>;
    testImage(id: string): Promise<boolean>;
}
