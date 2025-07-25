import { ImportBatchResult, ProcessEventsResult, GatekeeperEvent } from '@mdip/gatekeeper/types';

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

export interface DiscoveredInscribedItem {
    events: GatekeeperEvent[];
    imported?: ImportBatchResult;
    processed?: ProcessEventsResult;
    error?: string;
}

export interface MediatorDb {
    height: number;
    time: string;
    blockCount: number;
    blocksScanned: number;
    blocksPending: number;
    txnsScanned: number;
    registered: RegisteredItem[];
    discovered: DiscoveredItem[];
    discoveredInscribed?: DiscoveredInscribedItem[];
    lastExport?: string;
    pendingTxid?: string;
    pendingTaproot?: {
        commitTxid?: string;
        revealTxid?: string;
        walletAddr?: string;
    }
}

export interface MediatorDbInterface {
    loadDb(): Promise<MediatorDb | null>;
    saveDb(data: MediatorDb): Promise<boolean>;
}
