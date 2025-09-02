export interface DIDsDb {
    connect(): Promise<void>;
    disconnect(): Promise<void>;

    loadUpdatedAfter(): Promise<string | null>;
    saveUpdatedAfter(timestamp: string): Promise<void>;

    storeDID(did: string, doc: object): Promise<void>;
    getDID(did: string): Promise<object | null>;
    searchDocs(q: string): Promise<string[]>;
    queryDocs(where: Record<string, unknown>): Promise<string[]>;
    wipeDb(): Promise<void>;
}
