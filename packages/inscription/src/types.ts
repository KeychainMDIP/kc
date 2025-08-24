export type NetworkName = 'bitcoin' | 'testnet' | 'regtest';
export type SupportedTypes = 'p2wpkh' | 'p2tr';

export interface InscriptionOptions {
    feeMax: number;
    network: NetworkName;
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
