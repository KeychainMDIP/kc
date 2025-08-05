declare module 'bitcoin-core' {
    interface BtcClientOptions {
        network?: string;
        username?: string;
        password?: string;
        host?: string;
        port?: number;
        wallet?: string;
    }

    interface TransactionByHash {
        vout: Array<{
            scriptPubKey: {
                asm: string;
            };
        }>;
    }

    interface Block {
        nTx: number;
        time: number;
        tx: string[];
    }

    interface WalletInfo {
        balance: number;
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
        listUnspent(): Promise<any[]>;
        createRawTransaction(inputs: any[], outputs: Record<string, unknown>): Promise<string>;
        signRawTransactionWithWallet(rawtx: string): Promise<{ hex: string }>;
        signRawTransaction(rawtx: string): Promise<{ hex: string }>;
        sendRawTransaction(rawtx: string): Promise<string>;
        getRawTransaction(txid: string, verbose?: number): Promise<any>;
        getMempoolEntry(txid: string): Promise<any>;
        getBlockchainInfo(): Promise<unknown>;
    }
}
