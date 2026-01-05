import { ImportBatchResult, ProcessEventsResult } from '@mdip/gatekeeper/types';

export interface DiscoveredItem {
    height: number;
    index: number;
    time: string;
    txid: string;
    did: string;
    imported?: ImportBatchResult;
    processed?: ProcessEventsResult;
    error?: string;
}

export interface RegisteredItem {
    did: string;
    txid: string;
}

export interface MediatorDb {
    height: number;
    hash?: string;
    time: string;
    blockCount: number;
    blocksScanned: number;
    blocksPending: number;
    txnsScanned: number;
    registered: RegisteredItem[];
    discovered: DiscoveredItem[];
    lastExport?: string;
    pending?: {
        txids?: string[];
        blockCount: number;
    }
}

export interface MediatorDbInterface {
    loadDb(): Promise<MediatorDb | null>;
    saveDb(data: MediatorDb): Promise<boolean>;
    updateDb(mutator: (db: MediatorDb) => void | Promise<void>): Promise<void>;
}

export const BlockVerbosity = {
    HEX: 0,
    JSON: 1,
    JSON_TX_DATA: 2,
};

export type BlockVerbosity = typeof BlockVerbosity[keyof typeof BlockVerbosity];
