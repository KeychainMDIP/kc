export interface EncryptedWallet {
    salt: string
    iv: string
    data: string
}
export interface HDKey {
    xpriv?: string
    xpub?: string
}

export interface Seed {
    mnemonic?: string
    hdkey?: HDKey
}

export interface IDInfo {
    did: string
    account: number
    index: number
    held?: string[]
    owned?: string[]
}

export interface WalletFile {
    seed?: Seed
    counter: number
    ids: Record<string, IDInfo>
    current?: string
    names?: Record<string, string>
}

export type WrappedWallet = WalletFile | null;
export type StoredWallet = WrappedWallet | EncryptedWallet;

export interface WalletBase {
    saveWallet(wallet: StoredWallet, overwrite?: boolean): Promise<boolean>
    loadWallet(): Promise<StoredWallet>
}

export interface WalletWrapper {
    saveWallet(wallet: StoredWallet, overwrite?: boolean): Promise<boolean>
    loadWallet(): Promise<WrappedWallet>
}
