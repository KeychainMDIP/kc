export type NetworkName = 'bitcoin' | 'testnet' | 'regtest';
export type SupportedTypes = "p2wpkh" | "p2tr";

export interface MediatorDb {
    pendingTaproot?: {
        commitTxid?: string;
        revealTxids?: string[];
        blockCount: number,
    }
}

export interface MediatorDbInterface {
    loadDb(): Promise<MediatorDb>;
    saveDb(data: MediatorDb): Promise<boolean>;
}

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
