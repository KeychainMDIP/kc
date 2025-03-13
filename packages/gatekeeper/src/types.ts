export interface Signature {
    signer?: string;
    signed: string;
    hash: string;
    value: string;
}

export interface Mdip {
    version: number;
    type: 'agent' | 'asset';
    registry: string;
    validUntil?: string;
    prefix?: string;
    opid?: string;
}

export interface Operation {
    type: 'create' | 'update' | 'delete';
    created?: string;
    signature?: Signature;
    mdip?: Mdip;
    publicJwk?: any;
    controller?: string;
    doc?: any;
    previd?: string;
}

export interface GatekeeperEvent {
    registry: string;
    time: string;
    ordinal?: number;
    operation: Operation;
    did: string;
    opid?: string;
}

export interface JsonDbFile {
    dids: Record<string, GatekeeperEvent[]>
    queue?: Record<string, Operation[]>
}

export interface GatekeeperDb {
    resetDb(): Promise<void | number | JsonDbFile>;
    addEvent(did: string, event: GatekeeperEvent): Promise<void | number>;
    getEvents(did: string): Promise<GatekeeperEvent[]>;
    setEvents(did: string, events: GatekeeperEvent[]): Promise<number | void>;
    deleteEvents(did: string): Promise<void | number>;
    getAllKeys(): Promise<string[]>;
    queueOperation(registry: string, op: Operation): Promise<void | number>;
    getQueue(registry: string): Promise<Operation[]>;
    clearQueue(registry: string, batch: Operation[]): Promise<boolean>;
}
