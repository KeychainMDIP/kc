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

export interface DIDsDb {
    connect(): Promise<void>;
    disconnect(): Promise<void>;

    loadUpdatedAfter(): Promise<string | null>;
    saveUpdatedAfter(timestamp: string): Promise<void>;

    storeDID(did: string, doc: object): Promise<void>;
    replacePublishedCredentials(holderDid: string, records: PublishedCredentialRecord[]): Promise<void>;
    getDID(did: string): Promise<object | null>;
    getPublishedCredentialCountsBySchema(): Promise<PublishedCredentialSchemaCount[]>;
    listPublishedCredentials(options?: PublishedCredentialListOptions): Promise<PublishedCredentialListResult>;
    searchDocs(q: string): Promise<string[]>;
    queryDocs(where: Record<string, unknown>): Promise<string[]>;
    wipeDb(): Promise<void>;
}
