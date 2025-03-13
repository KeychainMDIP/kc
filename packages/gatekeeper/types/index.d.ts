export type WaitUntilReadyOptions = {
    intervalSeconds?: number;
    chatty?: boolean;
    becomeChattyAfter?: number;
};

export type ConnectOptions = WaitUntilReadyOptions & {
    url?: string;
    waitUntilReady?: boolean;
};

export type VerifyDBResults = {
    total: number;
    verified: number;
    expired: number;
    invalid: number;
};

export type ImportEventsResult = {
    added: number;
    merged: number;
}

export type GetStatusDidsByType = {
    agents: number;
    assets: number;
    confirmed: number;
    unconfirmed: number;
    ephemeral: number;
    invalid: number;
}

export type GetStatusDidsRecord = Record<string, number>;

export type GetStatusDids = {
    total: number;
    byType: GetStatusDidsByType;
    byRegistry: GetStatusDidsRecord;
    byVersion: GetStatusDidsRecord;
}

export type GetStatusMemoryUsage = {
    arrayBuffers: number;
    external: number;
    heapTotal: number;
    heapUsed: number;
    rss: number;
}

export type GetStatusResult = {
    uptimeSeconds: number;
    dids: GetStatusDids;
    memoryUsage: GetStatusMemoryUsage;
}

export type CreateDidOpMdip = {
    version: number;
    type: string;
    registry: string;
    validUntil?: string;
};

export type CreateDidOpPublicJwk = {
    kty: string;
    crv: string;
    x: string;
    y: string;
}

export type Signature = {
    signed: string;
    hash: string;
    value?: string;
    signer?: string;
};

export type VerifySig = {
    signed: string;
    hash: string;
    signer?: string;
};

export type CreateDidOp = {
    type: string;
    created: string;
    mdip: CreateDidOpMdip;
    publicJwk: CreateDidOpPublicJwk;
    signature: Signature;
}

export type DeleteDidOp = {
    did: string;
    previd: string;
    signature: Signature;
    type: string;
}

export type ResolveDIDOptions = {
    atTime: string;
    atVersion: number;
    confirm: boolean;
    verify: boolean;
}

export type GetDIDsOptions = {
    dids?: string[];
    updatedAfter: string;
    updatedBefore: string;
    confirm: boolean;
    verify: boolean;
    resolve: boolean;
}

export type ImportResult = {
    queued: number;
    processed: number;
    rejected: number;
    total: number;
}

export type ProcessEventsResult = {
    added: number;
    merged: number;
    pending: number;
}

declare module '@mdip/gatekeeper' {
    export default class Gatekeeper {
        constructor(options: { db: any });
        createDID(operation: CreateDidOp): Promise<string>;
        checkDIDs(options?: { chatty: boolean, dids: string[] }): Promise<GetStatusDids>;
        clearQueue(registry: string, batch: any[]): Promise<boolean>;
        deleteDID(operation: DeleteDidOp): Promise<boolean>;
        exportDID(did: string): Promise<any>;
        exportDIDs(dids?: string[]): Promise<any>;
        exportBatch(dids?: string[]): Promise<any>;
        generateCID(operation: any): Promise<string>;
        generateDID(operation: any): Promise<string>;
        generateDoc(anchor: any): Promise<any>;
        getDIDs(options?: GetDIDsOptions): Promise<any>;
        getQueue(registry: string): Promise<number>;
        initRegistries(csvRegistries?: string[]): Promise<string[]>;
        importBatch(batch: any[]): Promise<ImportResult>;
        importDIDs(dids: any): Promise<ImportResult>;
        importEvent(event: any): Promise<boolean>;
        importEvents(): Promise<ImportEventsResult>;
        listRegistries(): Promise<any>;
        processEvents(): Promise<ProcessEventsResult>;
        removeDIDs(dids: string[]): Promise<boolean>;
        resolveDID(did: string, options?: ResolveDIDOptions): Promise<any>;
        updateDID(operation: any): Promise<boolean>;
        verifyCreateOperation(operation: CreateDidOp): Promise<boolean>;
        verifyDateFormat(time: string): boolean;
        verifyDb(options?: { chatty: boolean }): Promise<VerifyDBResults>;
        verifyDIDFormat(did: string): boolean;
        verifyEvent(event: any): Promise<boolean>;
        verifyHashFormat(hash: string): boolean;
        verifyOperation(operation: any): Promise<boolean>;
        verifyUpdateOperation(operation: any): Promise<boolean>;
        verifySignatureFormat(signature: Signature): boolean;
    }
}

declare module '@mdip/gatekeeper/client' {
    export default class GatekeeperClient {
        constructor();
        createDID(registry: CreateDidOp): Promise<string>;
        clearQueue(registry: string, batch: any[]): Promise<boolean>;
        connect(options?: ConnectOptions): Promise<void>;
        static create(options?: ConnectOptions): Promise<GatekeeperClient>;
        deleteDID(operation: DeleteDidOp): Promise<boolean>;
        exportDIDs(dids?: string[]): Promise<any>;
        exportBatch(dids?: string[]): Promise<any>;
        getDIDs(options?: GetDIDsOptions): Promise<any>;
        getVersion(): Promise<number>;
        getQueue(registry: string): Promise<any[]>;
        getStatus(): Promise<GetStatusResult>;
        importBatch(batch: any[]): Promise<ImportResult>;
        importDIDs(dids: any): Promise<ImportResult>;
        isReady(): Promise<boolean>;
        listRegistries(): Promise<string[]>;
        processEvents(): Promise<ProcessEventsResult>;
        removeDIDs(dids: string[]): Promise<boolean>;
        resolveDID(did: string, options?: ResolveDIDOptions): Promise<any>;
        updateDID(operation: any): Promise<boolean>;
        verifyDb(): Promise<VerifyDBResults>;
        waitUntilReady(options: WaitUntilReadyOptions): Promise<void>;
    }
}
