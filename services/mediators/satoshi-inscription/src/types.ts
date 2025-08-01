import { ImportBatchResult, ProcessEventsResult, GatekeeperEvent } from '@mdip/gatekeeper/types';

export interface DiscoveredItem {
    height: number;
    index: number;
    time: string;
    txid: string;
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

export interface HDInfo {
    hdkeypath: string,
    hdmasterfingerprint: string
}

export interface MediatorDb {
    height: number;
    time: string;
    blockCount: number;
    blocksScanned: number;
    blocksPending: number;
    txnsScanned: number;
    discovered: DiscoveredInscribedItem[];
    lastExport?: string;
    pendingTxid?: string;
    pendingTaproot?: {
        commitTxid?: string;
        revealTxid?: string;
        hdInfo: HDInfo;
        blockCount: number,
    }
}

export interface MediatorDbInterface {
    loadDb(): Promise<MediatorDb | null>;
    saveDb(data: MediatorDb): Promise<boolean>;
}
