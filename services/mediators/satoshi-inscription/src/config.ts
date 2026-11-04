import { loadEnv } from '@mdip/common/env';

loadEnv();

// Larger Node.js timeouts are clamped to 1 ms.
const MAX_INTERVAL_MINUTES = 35_791;

export type NetworkName = 'bitcoin' | 'testnet';
export type ChainName = 'BTC' | 'Signet';
export type RpcChainName = 'main' | 'signet';
export type SatoshiDB = 'json' | 'sqlite' | 'mongodb' | 'redis' | 'postgres';

export interface AppConfig {
    gatekeeperURL: string;
    chain: ChainName;
    network: NetworkName;
    rpcChain: RpcChainName;
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

function parseIntegerEnv(
    name: string,
    defaultValue: number,
    options: { allowZero?: boolean; max?: number } = {}
): number {
    const raw = process.env[name];

    if (raw === undefined || raw === '') {
        return defaultValue;
    }

    const normalized = raw.trim();
    const value = Number(normalized);
    const minimum = options.allowZero ? 0 : 1;

    if (!/^\d+$/.test(normalized)
        || !Number.isSafeInteger(value)
        || value < minimum
        || (options.max !== undefined && value > options.max)) {
        const expected = options.allowZero ? 'a non-negative integer' : 'a positive integer';
        const maximum = options.max === undefined ? '' : ` no greater than ${options.max}`;
        throw new Error(`Invalid ${name}, expected ${expected}${maximum}`);
    }

    return value;
}

function parsePositiveNumberEnv(name: string, defaultValue: number): number {
    const raw = process.env[name];

    if (raw === undefined || raw === '') {
        return defaultValue;
    }

    const value = Number(raw);

    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid ${name}, expected a positive number`);
    }

    return value;
}

function toChain(name: string | undefined): ChainName {
    switch (name) {
    case 'BTC':
    case undefined:
        return 'BTC';
    case 'Signet':
        return 'Signet';
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
    default:
        throw new Error(`Unsupported network "${name}"`);
    }
}

function toRpcChain(chain: ChainName, network: NetworkName): RpcChainName {
    if (chain === 'BTC' && network === 'bitcoin') {
        return 'main';
    }

    if (chain === 'Signet' && network === 'testnet') {
        return 'signet';
    }

    throw new Error(`Network "${network}" is incompatible with chain "${chain}"`);
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
    case 'postgres':
        return 'postgres';
    default:
        throw new Error(`Unsupported DB "${name}"`);
    }
}

const chain = toChain(process.env.KC_SAT_CHAIN);
const network = toNetwork(process.env.KC_SAT_NETWORK);

const config: AppConfig = {
    gatekeeperURL: process.env.KC_GATEKEEPER_URL || 'http://localhost:4224',
    chain,
    network,
    rpcChain: toRpcChain(chain, network),
    host: process.env.KC_SAT_HOST || 'localhost',
    port: parseIntegerEnv('KC_SAT_PORT', 8332, { max: 65535 }),
    wallet: process.env.KC_SAT_WALLET,
    user: process.env.KC_SAT_USER,
    pass: process.env.KC_SAT_PASS,
    importInterval: parseIntegerEnv('KC_SAT_IMPORT_INTERVAL', 0, { allowZero: true, max: MAX_INTERVAL_MINUTES }),
    exportInterval: parseIntegerEnv('KC_SAT_EXPORT_INTERVAL', 0, { allowZero: true, max: MAX_INTERVAL_MINUTES }),
    feeConf: parseIntegerEnv('KC_SAT_FEE_BLOCK_TARGET', 1),
    feeFallback: parseIntegerEnv('KC_SAT_FEE_FALLBACK_SAT_BYTE', 10),
    feeMax: parsePositiveNumberEnv('KC_SAT_FEE_MAX', 0.00002),
    rbfEnabled: process.env.KC_SAT_RBF_ENABLED === 'true',
    startBlock: parseIntegerEnv('KC_SAT_START_BLOCK', 0, { allowZero: true }),
    reimport: process.env.KC_SAT_REIMPORT ? (process.env.KC_SAT_REIMPORT === 'true') : true,
    db: toDB(process.env.KC_SAT_DB),
};

export default config;
