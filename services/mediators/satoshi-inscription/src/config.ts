import dotenv from 'dotenv';

dotenv.config();

export type NetworkName = 'bitcoin' | 'testnet' | 'regtest';
export type ChainName = 'BTC' | 'TBTC' | 'Signet' | 'TFTC';
export type SatoshiDB = 'json' | 'sqlite' | 'mongodb' | 'redis';

export interface AppConfig {
    nodeID?: string;
    gatekeeperURL: string;
    keymasterURL?: string;
    chain: ChainName;
    network: NetworkName;
    host: string;
    port: number;
    wallet?: string;
    user?: string;
    pass?: string;
    importInterval: number;
    exportInterval: number;
    feeConf: number;
    feeMax: number;
    feeFallback: number;
    rbfEnabled: boolean;
    startBlock: number;
    reimport: boolean;
    db: SatoshiDB;
}

function toChain(name: string | undefined): ChainName {
    switch (name) {
    case 'BTC':
    case undefined:
        return 'BTC';
    case 'TBTC':
        return 'TBTC';
    case 'Signet':
        return 'Signet';
    case 'TFTC':
        return 'TFTC';
    default:
        throw new Error(`Unsupported chain "${name}"`);
    }
}

function toNetwork(name: string | undefined): NetworkName {
    switch (name) {
    case 'bitcoin':
    case 'mainnet':
    case undefined:
        return 'bitcoin';
    case 'testnet':
        return 'testnet';
    case 'regtest':
        return 'regtest';
    default:
        throw new Error(`Unsupported network "${name}"`);
    }
}

function toDB(name: string | undefined): SatoshiDB {
    switch (name) {
    case 'json':
    case undefined:
        return 'json';
    case 'sqlite':
        return 'sqlite';
    case 'mongodb':
        return 'mongodb';
    case 'redis':
        return 'redis';
    default:
        throw new Error(`Unsupported DB "${name}"`);
    }
}

const config: AppConfig = {
    nodeID: process.env.KC_NODE_ID,
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    keymasterURL: process.env.KC_KEYMASTER_URL,
    chain: toChain(process.env.KC_SAT_CHAIN),
    network: toNetwork(process.env.KC_SAT_NETWORK),
    host: process.env.KC_SAT_HOST || 'localhost',
    port: process.env.KC_SAT_PORT ? parseInt(process.env.KC_SAT_PORT) : 8332,
    wallet: process.env.KC_SAT_WALLET,
    user: process.env.KC_SAT_USER,
    pass: process.env.KC_SAT_PASS,
    importInterval: process.env.KC_SAT_IMPORT_INTERVAL ? parseInt(process.env.KC_SAT_IMPORT_INTERVAL) : 0,
    exportInterval: process.env.KC_SAT_EXPORT_INTERVAL ? parseInt(process.env.KC_SAT_EXPORT_INTERVAL) : 0,
    feeConf: process.env.KC_SAT_FEE_BLOCK_TARGET ? parseInt(process.env.KC_SAT_FEE_BLOCK_TARGET) : 1,
    feeFallback: process.env.KC_SAT_FEE_FALLBACK_SAT_BYTE ? parseInt(process.env.KC_SAT_FEE_FALLBACK_SAT_BYTE) : 10,
    feeMax: process.env.KC_SAT_FEE_MAX ? parseFloat(process.env.KC_SAT_FEE_MAX) : 0.00002,
    rbfEnabled: process.env.KC_SAT_RBF_ENABLED === 'true',
    startBlock: process.env.KC_SAT_START_BLOCK ? parseInt(process.env.KC_SAT_START_BLOCK) : 0,
    reimport: process.env.KC_SAT_REIMPORT ? (process.env.KC_SAT_REIMPORT === 'true') : true,
    db: toDB(process.env.KC_SAT_DB),
};

export default config;
