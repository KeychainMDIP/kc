declare module 'bitcoin-core' {
    interface BtcClientOptions {
        network?: string;
        username?: string;
        password?: string;
        host?: string;
        port?: number;
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
        txinwitness?: string[];
    }

    export interface ScriptPubKey {
        asm: string;
        hex: string;
        reqSigs?: number;
        type: string;
        addresses?: string[];
    }

    export interface Vout {
        value: number;
        n: number;
        scriptPubKey: ScriptPubKey;
    }

    interface TransactionByHash {
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
        confTarget?: number;
        feeRate?: number | string;
        replaceable?: boolean;
        estimateMode?: EconomyModes;
    }

    export interface BumpFeeResult {
        txid?: string;
        psbt?: string;
        origfee: number;
        fee: number;
        errors?: string[];
    }

    interface Block {
        nTx: number;
        time: number;
        tx: string[];
    }

    interface WalletInfo {
        balance: number;
    }

    interface EstimateSmartFeeResult {
        feerate?: number;
        blocks: number;
        errors?: string[];
    }

    interface AddressInfo {
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

    export interface Vin {
        txid?: string;
        vout?: number;
        scriptSig?: ScriptSig;
        sequence: number;
        coinbase?: string;
        txinwitness?: string[];
    }

    export interface ScriptSig {
        asm: string;
        hex: string;
    }

    export interface Vout {
        value: number;
        n: number;
        scriptPubKey: ScriptPubKey;
    }

    export interface ScriptPubKey {
        asm: string;
        hex: string;
        reqSigs?: number;
        type: string;
        addresses?: string[];
        desc?: string;
    }

    export interface ListUnspentQueryOptions {
        minimumAmount?: number | string;
        maximumAmount?: number | string;
        maximumCount?: number;
        minimumSumAmount?: number | string;
        minDepth?: number;
        maxDepth?: number;
    }

    export type EconomyModes = 'unset' | 'economical' | 'conservative';

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

    export default class BtcClient {
        constructor(options: BtcClientOptions);
        getTransactionByHash(txid: string): Promise<TransactionByHash>;
        getBlockHash(height: number): Promise<string>;
        getBlock(blockHash: string): Promise<Block>;
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
        getRawTransaction(txid: string, verbose?: number): Promise<RawTransactionResult>;
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
        finalizePsbt(psbt: string): Promise<{ psbt: string, hex: string, complete: boolean }>;
        getNetworkInfo(): Promise<NetworkInfo>;
        getDescriptorInfo(descriptor: string): Promise<DescriptorInfoResult>;
        importDescriptors(requests: ImportDescriptorRequest[]): Promise<ImportDescriptorResult[]>;
        deriveAddresses(descriptor: string, range?: number | [number, number]): Promise<string[]>;
        listDescriptors(private: boolean): Promise<ListDescriptorsResult>;
        decodeRawTransaction(hexstring: string, iswitness?: boolean): Promise<DecodedRawTransaction>;
    }
}
