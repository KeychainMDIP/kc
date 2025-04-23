import { EcdsaJwkPublic } from '@mdip/cipher/types';

export interface JsonDbFile {
    dids: Record<string, GatekeeperEvent[]>
    queue?: Record<string, Operation[]>
}

export interface ImportBatchResult {
    queued: number;
    processed: number;
    rejected: number;
    total: number;
}

export interface ProcessEventsResult {
    busy?: boolean;
    added?: number;
    merged?: number;
    rejected?: number;
    pending?: number;
}

export interface VerifyDbResult {
    total: number;
    verified: number;
    expired: number;
    invalid: number;
}

export interface ResolveDIDOptions {
    atTime?: string;
    atVersion?: number;
    confirm?: boolean;
    verify?: boolean;
}

export interface CheckDIDsResultByType {
    agents: number;
    assets: number;
    confirmed: number;
    unconfirmed: number;
    ephemeral: number;
    invalid: number;
}

export interface CheckDIDsResult {
    total: number;
    byType: CheckDIDsResultByType;
    byRegistry: Record<string, number>;
    byVersion: Record<string, number>;
    eventsQueue: GatekeeperEvent[];
}

export interface GetDIDOptions {
    dids?: string[];
    updatedAfter?: string;
    updatedBefore?: string;
    confirm?: boolean;
    verify?: boolean;
    resolve?: boolean;
}

export interface GatekeeperEvent {
    registry: string;
    time: string;
    ordinal?: number[];
    operation: Operation;
    did?: string;
    opid?: string;
    blockchain?: MdipRegistration;
}

export interface GetRecentEventsOptions {
    limit?: number;
    offset?: number;
    registry?: string;
}

export interface GetRecentEventsResult {
    total: number;
    events: GatekeeperEvent[];
}

export interface GatekeeperDb {
    resetDb(): Promise<void | number | JsonDbFile>;
    addEvent(did: string, event: GatekeeperEvent): Promise<void | number>;
    getEvents(did: string): Promise<GatekeeperEvent[]>;
    getSortedEvents(options?: GetRecentEventsOptions): Promise<GetRecentEventsResult>;
    setEvents(did: string, events: GatekeeperEvent[]): Promise<number | void>;
    deleteEvents(did: string): Promise<void | number>;
    getAllKeys(): Promise<string[]>;
    queueOperation(registry: string, op: Operation): Promise<number>;
    getQueue(registry: string): Promise<Operation[]>;
    clearQueue(registry: string, batch: Operation[]): Promise<boolean>;
}

export interface GatekeeperInterface {
    listRegistries(): Promise<string[]>;
    resetDb(): Promise<boolean>;
    verifyDb(options?: { chatty?: boolean }): Promise<VerifyDbResult>;
    createDID(operation: Operation): Promise<string>;
    resolveDID(did: string, options?: ResolveDIDOptions): Promise<MdipDocument>;
    updateDID(operation: Operation): Promise<boolean>;
    deleteDID(operation: Operation): Promise<boolean>;
    getDIDs(options?: GetDIDOptions): Promise<string[] | MdipDocument[]>;
    exportDIDs(dids?: string[]): Promise<GatekeeperEvent[][]>;
    importDIDs(dids: GatekeeperEvent[][]): Promise<ImportBatchResult>;
    removeDIDs(dids: string[]): Promise<boolean>;
    exportBatch(dids?: string[]): Promise<GatekeeperEvent[]>;
    importBatch(batch: GatekeeperEvent[]): Promise<ImportBatchResult>;
    processEvents(): Promise<ProcessEventsResult>;
    getQueue(registry: string): Promise<Operation[]>;
    clearQueue(registry: string, events: Operation[]): Promise<boolean>;
    addData(data: Buffer): Promise<string>;
    getData(cid: string): Promise<Buffer | null>;
    addJSON(json: object): Promise<string>;
    getJSON(cid: string): Promise<object | null>;
    addText(text: string): Promise<string>;
    getText(cid: string): Promise<string | null>;
    getRecentEvents(options?: GetRecentEventsOptions): Promise<GetRecentEventsResult>;
}

export interface MdipRegistration {
    height?: number;
    index?: number;
    txid?: string;
    batch?: string;
}

export interface Mdip {
    version: number;
    type: 'agent' | 'asset';
    registry: string;
    validUntil?: string;
    prefix?: string;
    opid?: string;
    registration?: MdipRegistration;
    created?: string;
}

export interface DocumentMetadata {
    created?: string;
    updated?: string;
    canonicalId?: string;
    versionId?: string;
    version?: number;
    confirmed?: boolean;
    deactivated?: boolean;
    deleted?: string;
}

export interface MdipDocument {
    '@context'?: string | string[];
    didDocument?: {
        '@context'?: string[];
        id?: string;
        controller?: string,
        verificationMethod?: Array<{
            id?: string,
            controller?: string,
            type?: string,
            publicKeyJwk?: EcdsaJwkPublic,
        }>,
        authentication?: string[],
    },
    didDocumentMetadata?: DocumentMetadata,
    didDocumentData?: unknown,
    mdip?: Mdip,
}

export interface Signature {
    signer?: string;
    signed: string;
    hash: string;
    value: string;
}

export interface Operation {
    type: 'create' | 'update' | 'delete';
    created?: string;
    signature?: Signature;
    mdip?: Mdip;
    publicJwk?: EcdsaJwkPublic;
    controller?: string;
    doc?: MdipDocument;
    previd?: string;
    did?: string,
    data?: unknown;
}
