export interface BtcClientOptions {
    username?: string;
    password?: string;
    host?: string;
    wallet?: string;
}

export interface ScriptSig {
    asm: string;
    hex: string;
}

export interface Vin {
    txid: string;
    vout: number;
    scriptSig: ScriptSig;
    sequence: number;
    coinbase?: string;
    txinwitness?: string[];
}

export interface ScriptPubKey {
    asm: string;
    hex: string;
    reqSigs?: number;
    type: string;
    addresses?: string[];
    desc?: string;
}

export interface Vout {
    value: number;
    n: number;
    scriptPubKey: ScriptPubKey;
}

export interface TransactionByHash {
    txid: string;
    hash: string;
    size: number;
    vsize: number;
    weight: number;
    version: number;
    locktime: number;
    hex: string;
    in_active_chain?: boolean;
    blockhash?: string;
    confirmations?: number;
    time?: number;
    blocktime?: number;
    vin: Vin[];
    vout: Vout[];
}

export interface BumpFeeOptions {
    conf_target?: number;
    fee_rate?: number | string;
    replaceable?: boolean;
    estimate_mode?: EconomyModes;
}

export interface BumpFeeResult {
    txid?: string;
    psbt?: string;
    origfee: number;
    fee: number;
    errors?: string[];
}

export interface Block {
    nTx: number;
    time: number;
    tx: string[];
}

export type BlockHex = string;

export interface BlockHeader {
    hash?: string;
    confirmations?: number;
    height?: number;
    time?: number;
    nTx?: number;
    previousblockhash?: string;
}

export interface BlockTxVerbose {
    txid: string;
    vin: Vin[];
    vout: Vout[];
}

export interface BlockVerbose {
    nTx: number;
    time: number;
    tx: BlockTxVerbose[];
}

export type Bip125Replaceable = 'yes' | 'no' | 'unknown';

export interface GetTransactionDetails {
    involvesWatchonly?: boolean;
    address?: string;
    category: 'send' | 'receive' | 'generate' | 'immature' | 'orphan';
    amount: number;
    label?: string;
    vout: number;
    fee?: number;
    abandoned?: boolean;
    parent_descs?: string[];
}

export interface GetTransactionResult {
    amount: number;
    fee?: number;
    confirmations: number;
    generated?: boolean;
    trusted?: boolean;
    blockhash?: string;
    blockheight?: number;
    blockindex?: number;
    blocktime?: number;
    txid: string;
    wtxid: string;
    walletconflicts: string[];
    replaced_by_txid?: string;
    replaces_txid?: string;
    to?: string;
    time: number;
    timereceived: number;
    comment?: string;
    "bip125-replaceable": Bip125Replaceable;
    parent_descs?: string[];
    details: GetTransactionDetails[];
    hex: string;
    decoded?: DecodedRawTransaction;
}

export interface WalletInfo {
    balance: number;
}

export interface EstimateSmartFeeResult {
    feerate?: number;
    blocks: number;
    errors?: string[];
}

export interface AddressInfo {
    address: string;
    scriptPubKey: string;
    ismine: boolean;
    iswatchonly: boolean;
    solvable: boolean;
    ischange: boolean;
    labels: string[];
    desc?: string;
    isscript?: boolean;
    iswitness?: boolean;
    witness_version?: number;
    witness_program?: string;
    script?: 'nonstandard' | 'pubkey' | 'pubkeyhash' | 'scripthash' | 'multisig' | 'nulldata' | 'witness_v0_keyhash' | 'witness_v0_scripthash' | 'witness_unknown';
    hex?: string;
    pubkeys?: string[];
    sigsrequired?: number;
    pubkey?: string;
    iscompressed?: boolean;
    embedded?: Partial<AddressInfo>;
    timestamp?: number;
    hdkeypath?: string;
    hdseedid?: string;
    hdmasterfingerprint?: string;
}

export interface MempoolEntryFees {
    base: number;
    modified: number;
    ancestor: number;
    descendant: number;
}

export interface MempoolEntry {
    vsize: number;
    weight: number;
    time: number;
    height: number;
    descendantcount: number;
    descendantsize: number;
    ancestorcount: number;
    ancestorsize: number;
    wtxid: string;
    "bip125-replaceable": boolean;
    unbroadcast: boolean;
    fees: MempoolEntryFees;
    depends: string[];
    spentby: string[];
}

export type MempoolDescendantsResult = string[] | Record<string, MempoolEntry>;

export interface RawTransactionVerbose extends TransactionByHash {
    hex: string;
    in_active_chain?: boolean;
}

export type RawTransactionResult = string | RawTransactionVerbose;

export interface NetworkInfoNetwork {
    name: string;
    limited: boolean;
    reachable: boolean;
    proxy: string;
    proxy_randomize_credentials: boolean;
}

export interface NetworkInfoLocalAddress {
    address: string;
    port: number;
    score: number;
}

export interface NetworkInfo {
    version: number;
    subversion: string;
    protocolversion: number;
    localservices: string;
    localservicesnames: string[];
    localrelay: boolean;
    timeoffset: number;
    connections: number;
    connections_in: number;
    connections_out: number;
    networkactive: boolean;
    networks: NetworkInfoNetwork[];
    relayfee: number;
    incrementalfee: number;
    localaddresses: NetworkInfoLocalAddress[];
    warnings: string[] | string;
}

export interface ImportDescriptorRequest {
    desc: string;
    timestamp: number | 'now';
    active?: boolean;
    range?: number | [number, number];
    next_index?: number;
    internal?: boolean;
    label?: string;
}

export interface ImportDescriptorResult {
    success: boolean;
    warnings?: string[];
    error?: {
        code: number;
        message: string;
    };
}

export interface DescriptorInfoResult {
    descriptor: string;
    checksum: string;
    isrange: boolean;
    issolvable: boolean;
    hasprivatekeys: boolean;
}

export interface Descriptor {
    desc: string;
    timestamp: number;
    active: boolean;
    internal?: boolean;
    range?: [number, number];
    next?: number;
}

export interface ListDescriptorsResult {
    wallet_name: string;
    descriptors: Descriptor[];
}

export interface DecodedRawTransaction {
    txid: string;
    hash: string;
    size: number;
    vsize: number;
    weight: number;
    version: number;
    locktime: number;
    vin: Vin[];
    vout: Vout[];
}

export interface ListUnspentQueryOptions {
    minimumAmount?: number | string;
    maximumAmount?: number | string;
    maximumCount?: number;
    minimumSumAmount?: number | string;
    minDepth?: number;
    maxDepth?: number;
}

export type EconomyModes = 'UNSET' | 'ECONOMICAL' | 'CONSERVATIVE';

export interface UnspentOutput {
    txid: string;
    vout: number;
    address?: string;
    label?: string;
    scriptPubKey: string;
    amount: number;
    confirmations: number;
    redeemScript?: string;
    witnessScript?: string;
    spendable: boolean;
    solvable: boolean;
    desc?: string;
    safe: boolean;
}

export interface PsbtBumpFeeResult {
    psbt: string;
    origfee: number;
    fee: number;
    errors?: string[];
}

export interface PsbtInput {
    txid: string;
    vout: number;
    sequence?: number;
}

export type PsbtOutput = Record<string, number | string>;

export interface WalletCreateFundedPsbtOptions {
    changeAddress?: string;
    changePosition?: number;
    change_type?: 'legacy' | 'p2sh-segwit' | 'bech32' | 'bech32m';
    includeWatching?: boolean;
    lockUnspents?: boolean;
    fee_rate?: number | string;
    feeRate?: number | string;
    subtractFeeFromOutputs?: number[];
    replaceable?: boolean;
    conf_target?: number;
    estimate_mode?: EconomyModes;
    add_inputs?: boolean;
    include_unsafe?: boolean;
    max_fee_rate?: number | string;
}

export interface WalletCreateFundedPsbtResult {
    psbt: string;
    fee: number;
    changepos: number;
}

export interface FundRawTransactionOptions {
    changeAddress?: string;
    changePosition?: number;
    change_type?: 'legacy' | 'p2sh-segwit' | 'bech32' | 'bech32m';
    includeWatching?: boolean;
    lockUnspents?: boolean;
    fee_rate?: number | string;
    feeRate?: number | string;
    subtractFeeFromOutputs?: number[];
    replaceable?: boolean;
    conf_target?: number;
    estimate_mode?: EconomyModes;
}

export interface FundRawTransactionResult {
    hex: string;
    fee: number;
    changepos: number;
}

export default class BtcClient {
    constructor(options: BtcClientOptions);
    getTransactionByHash(txid: string): Promise<TransactionByHash>;
    getTransaction(txid: string, include_watchonly?: boolean, verbose?: boolean): Promise<GetTransactionResult>;
    getBlockHash(height: number): Promise<string>;
    getBlock(blockHash: string, verbosity?: number): Promise<BlockHex | Block | BlockVerbose>;
    getBlockHeader(blockHash: string, verbose?: boolean): Promise<BlockHeader>;
    getBlockCount(): Promise<number>;
    createWallet(walletName: string): Promise<any>;
    getWalletInfo(): Promise<WalletInfo>;
    getNewAddress(label?: string, addressType?: string): Promise<string>;
    listUnspent(
        minconf?: number,
        maxconf?: number,
        addresses?: string[],
        include_unsafe?: boolean,
        query_options?: ListUnspentQueryOptions
    ): Promise<UnspentOutput[]>;
    createRawTransaction(inputs: any[], outputs: Record<string, unknown>): Promise<string>;
    signRawTransactionWithWallet(rawtx: string): Promise<{
        hex: string;
        complete: boolean;
    }>;
    signRawTransaction(rawtx: string): Promise<{ hex: string }>;
    sendRawTransaction(rawtx: string): Promise<string>;
    getRawTransaction(txid: string, verbose?: number, blockhash?: string): Promise<RawTransactionResult>;
    getMempoolEntry(txid: string): Promise<MempoolEntry>;
    getBlockchainInfo(): Promise<unknown>;
    getAddressInfo(address: string): Promise<AddressInfo>;
    estimateSmartFee(
        confTarget: number,
        estimateMode?: EconomyModes
    ): Promise<EstimateSmartFeeResult>;
    dumpPrivKey(address: string): Promise<string>;
    bumpFee(
        txid: string,
        options?: BumpFeeOptions
    ): Promise<BumpFeeResult>;
    psbtBumpFee(txid: string, options?: BumpFeeOptions): Promise<PsbtBumpFeeResult>;
    walletProcessPsbt(
        psbt: string,
        sign?: boolean,
        sighashtype?: string,
        bip32derivs?: boolean
    ): Promise<{
        psbt: string,
        complete: boolean,
    }>;
    walletCreateFundedPsbt(
        inputs: PsbtInput[],
        outputs: PsbtOutput[],
        locktime?: number,
        options?: WalletCreateFundedPsbtOptions,
        bip32derivs?: boolean
    ): Promise<WalletCreateFundedPsbtResult>;
    finalizePsbt(psbt: string): Promise<{ psbt: string, hex: string, complete: boolean }>;
    getNetworkInfo(): Promise<NetworkInfo>;
    getDescriptorInfo(descriptor: string): Promise<DescriptorInfoResult>;
    importDescriptors(requests: ImportDescriptorRequest[]): Promise<ImportDescriptorResult[]>;
    deriveAddresses(descriptor: string, range?: number | [number, number]): Promise<string[]>;
    listDescriptors(private: boolean): Promise<ListDescriptorsResult>;
    decodeRawTransaction(hexstring: string, iswitness?: boolean): Promise<DecodedRawTransaction>;
    getMempoolDescendants(txid: string, verbose?: boolean): Promise<MempoolDescendantsResult>;
    fundRawTransaction(
        hexstring: string,
        options?: FundRawTransactionOptions,
        iswitness?: boolean
    ): Promise<FundRawTransactionResult>;
}
