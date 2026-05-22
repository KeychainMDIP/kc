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
    responseCommitment: string;
    updatedAt: string;
}

export interface ChallengeReceiptListOptions {
    receiptDid?: string;
    attesterDid?: string;
    schemaDid?: string;
    requesterDid?: string;
    responseCommitment?: string;
    updatedAfter?: string;
    updatedBefore?: string;
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
    updatedAfter?: string;
    updatedBefore?: string;
    limit?: number;
    offset?: number;
}

export interface ChallengeReceiptUsageRecord {
    attesterDid: string;
    schemaDid: string;
    requesterDid: string;
    count: number;
    firstUpdatedAt: string;
    lastUpdatedAt: string;
}

export interface ChallengeReceiptUsageResult {
    total: number;
    usage: ChallengeReceiptUsageRecord[];
}

export interface DIDsDb {
    connect(): Promise<void>;
    disconnect(): Promise<void>;

    loadUpdatedAfter(): Promise<string | null>;
    saveUpdatedAfter(timestamp: string): Promise<void>;

    storeDID(did: string, doc: object): Promise<void>;
    replacePublishedCredentials(holderDid: string, records: PublishedCredentialRecord[]): Promise<void>;
    replaceChallengeReceipts(receiptDid: string, records: ChallengeReceiptRecord[]): Promise<void>;
    getDID(did: string): Promise<object | null>;
    getPublishedCredentialCountsBySchema(): Promise<PublishedCredentialSchemaCount[]>;
    listPublishedCredentials(options?: PublishedCredentialListOptions): Promise<PublishedCredentialListResult>;
    listChallengeReceipts(options?: ChallengeReceiptListOptions): Promise<ChallengeReceiptListResult>;
    getChallengeReceiptUsage(options?: ChallengeReceiptUsageOptions): Promise<ChallengeReceiptUsageResult>;
    searchDocs(q: string): Promise<string[]>;
    queryDocs(where: Record<string, unknown>): Promise<string[]>;
    wipeDb(): Promise<void>;
}
