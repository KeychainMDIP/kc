import type {
    BlockId,
    BlockInfo,
    GatekeeperEvent,
    IndexExportBlockRecord,
} from '@mdip/gatekeeper/types';

export type {
    BlockId,
    BlockInfo,
    GatekeeperEvent,
    IndexExportBlockRecord,
};

export interface PublishedCredentialRecord {
    holderDid: string;
    credentialDid: string;
    schemaDid: string;
    issuerDid: string;
    subjectDid: string;
    revealed: boolean;
    updatedAt: string;
}

export interface PublishedCredentialSchemaCount {
    schemaDid: string;
    count: number;
}

export interface PublishedCredentialListOptions {
    credentialDid?: string;
    schemaDid?: string;
    issuerDid?: string;
    subjectDid?: string;
    revealed?: boolean;
    limit?: number;
    offset?: number;
}

export interface PublishedCredentialListResult {
    total: number;
    credentials: PublishedCredentialRecord[];
}

export interface ChallengeReceiptRecord {
    receiptDid: string;
    attesterDid: string;
    schemaDid: string;
    requesterDid: string;
    verifiedAt: string;
    responseCommitment: string;
    updatedAt: string;
}

export interface ChallengeReceiptListOptions {
    receiptDid?: string;
    attesterDid?: string;
    schemaDid?: string;
    requesterDid?: string;
    responseCommitment?: string;
    verifiedAfter?: string;
    verifiedBefore?: string;
    limit?: number;
    offset?: number;
}

export interface ChallengeReceiptListResult {
    total: number;
    receipts: ChallengeReceiptRecord[];
}

export interface ChallengeReceiptUsageOptions {
    attesterDid?: string;
    schemaDid?: string;
    requesterDid?: string;
    verifiedAfter?: string;
    verifiedBefore?: string;
    limit?: number;
    offset?: number;
}

export interface ChallengeReceiptUsageRecord {
    attesterDid: string;
    schemaDid: string;
    requesterDid: string;
    count: number;
    firstVerifiedAt: string;
    lastVerifiedAt: string;
}

export interface ChallengeReceiptUsageResult {
    total: number;
    usage: ChallengeReceiptUsageRecord[];
}

export interface DIDEventRecord {
    did: string;
    registry: string;
    time: string;
    event: GatekeeperEvent;
}

export interface DIDEventListOptions {
    registry?: string;
    updatedAfter?: string;
    updatedBefore?: string;
    limit?: number;
    offset?: number;
}

export interface DIDEventListResult {
    total: number;
    events: DIDEventRecord[];
}

export interface DIDProjectionUpdate {
    did: string;
    events: GatekeeperEvent[];
    removed?: boolean;
    doc?: object;
    publishedCredentials?: PublishedCredentialRecord[];
    challengeReceipts?: ChallengeReceiptRecord[];
}

export interface ApplyIndexPageOptions {
    dids: DIDProjectionUpdate[];
    blocks: IndexExportBlockRecord[];
    syncStateUpdates?: Record<string, string | null>;
}

export interface ApplyIndexPageResult {
    changedDids: string[];
    storedBlocks: number;
    removedBlocks: number;
    removedDids: number;
}

export interface DIDsDb {
    connect(): Promise<void>;
    disconnect(): Promise<void>;

    loadSyncState(key: string): Promise<string | null>;
    saveSyncState(key: string, value: string | null): Promise<void>;

    getDIDEvents(did: string): Promise<GatekeeperEvent[]>;
    getBlock(registry: string, block?: BlockId): Promise<BlockInfo | null>;
    applyIndexPage(page: ApplyIndexPageOptions): Promise<ApplyIndexPageResult>;
    getDID(did: string): Promise<object | null>;
    getPublishedCredentialCountsBySchema(): Promise<PublishedCredentialSchemaCount[]>;
    listPublishedCredentials(options?: PublishedCredentialListOptions): Promise<PublishedCredentialListResult>;
    listChallengeReceipts(options?: ChallengeReceiptListOptions): Promise<ChallengeReceiptListResult>;
    getChallengeReceiptUsage(options?: ChallengeReceiptUsageOptions): Promise<ChallengeReceiptUsageResult>;
    listEvents(options?: DIDEventListOptions): Promise<DIDEventListResult>;
    searchDocs(q: string): Promise<string[]>;
    queryDocs(where: Record<string, unknown>): Promise<string[]>;
    wipeDb(): Promise<void>;
}
