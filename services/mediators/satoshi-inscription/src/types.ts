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

export type SupportedTypes = 'p2wpkh' | 'p2tr';

export interface FundInput {
    type: SupportedTypes;
    txid: string;
    vout: number;
    amount: number;
    hdkeypath: string;
}

export interface AccountKeys {
    bip86: string;
    bip84?: string;
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
        revealTxids?: string[];
        hdkeypath: string;
        blockCount: number,
    }
}

export interface MediatorDbInterface {
    loadDb(): Promise<MediatorDb | null>;
    saveDb(data: MediatorDb): Promise<boolean>;
}
