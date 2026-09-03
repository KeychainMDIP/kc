import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };
const CONFIGS = [
    ['Satoshi', '../../services/mediators/satoshi/src/config.ts', true],
    ['Satoshi inscription', '../../services/mediators/satoshi-inscription/src/config.ts', false],
] as const;
const NUMERIC_DEFAULTS = {
    KC_SAT_PORT: '',
    KC_SAT_IMPORT_INTERVAL: '',
    KC_SAT_EXPORT_INTERVAL: '',
    KC_SAT_FEE_BLOCK_TARGET: '',
    KC_SAT_FEE_FALLBACK_SAT_BYTE: '',
    KC_SAT_FEE_MAX: '',
    KC_SAT_START_BLOCK: '',
};

jest.unstable_mockModule('@mdip/common/env', () => ({ loadEnv: jest.fn() }));

async function importConfigIsolated(configPath: string) {
    let loaded: any;

    await jest.isolateModulesAsync(async () => {
        loaded = (await import(configPath)).default;
    });

    return loaded;
}

describe.each(CONFIGS)('%s config', (_name, configPath, usesKeymaster) => {
    beforeEach(() => {
        process.env = {
            ...ORIGINAL_ENV,
            ...NUMERIC_DEFAULTS,
            KC_SAT_CHAIN: 'BTC',
            KC_SAT_NETWORK: 'bitcoin',
            KC_SAT_DB: 'json',
        };
        delete process.env.KC_GATEKEEPER_URL;
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    it('uses numeric defaults when settings are empty', async () => {
        const config = await importConfigIsolated(configPath);

        expect(config.port).toBe(8332);
        expect(config.importInterval).toBe(0);
        expect(config.exportInterval).toBe(0);
        expect(config.feeConf).toBe(1);
        expect(config.feeFallback).toBe(10);
        expect(config.feeMax).toBe(0.00002);
        expect(config.startBlock).toBe(0);
    });

    it('uses defaults when settings are absent', async () => {
        for (const key of Object.keys(NUMERIC_DEFAULTS)) {
            delete process.env[key];
        }
        delete process.env.KC_SAT_CHAIN;
        delete process.env.KC_SAT_NETWORK;
        delete process.env.KC_SAT_DB;

        const config = await importConfigIsolated(configPath);

        expect(config).toMatchObject({
            chain: 'BTC',
            host: 'localhost',
            port: 8332,
            importInterval: 0,
            exportInterval: 0,
            feeConf: 1,
            feeFallback: 10,
            feeMax: 0.00002,
            rbfEnabled: false,
            startBlock: 0,
            reimport: true,
            db: 'json',
        });

        if (!usesKeymaster) {
            expect(config).toMatchObject({ network: 'bitcoin', rpcChain: 'main' });
        }
    });

    it('accepts valid numeric settings', async () => {
        Object.assign(process.env, {
            KC_GATEKEEPER_URL: 'http://gatekeeper',
            KC_SAT_HOST: 'bitcoin',
            KC_SAT_PORT: '65535',
            KC_SAT_WALLET: 'mdip',
            KC_SAT_USER: 'user',
            KC_SAT_PASS: 'pass',
            KC_SAT_IMPORT_INTERVAL: '0',
            KC_SAT_EXPORT_INTERVAL: '35791',
            KC_SAT_FEE_BLOCK_TARGET: '6',
            KC_SAT_FEE_FALLBACK_SAT_BYTE: '5',
            KC_SAT_FEE_MAX: '0.001',
            KC_SAT_RBF_ENABLED: 'true',
            KC_SAT_START_BLOCK: '100',
            KC_SAT_REIMPORT: 'false',
        });

        const config = await importConfigIsolated(configPath);

        expect(config.gatekeeperURL).toBe('http://gatekeeper');
        expect(config.host).toBe('bitcoin');
        expect(config.port).toBe(65535);
        expect(config.wallet).toBe('mdip');
        expect(config.user).toBe('user');
        expect(config.pass).toBe('pass');
        expect(config.importInterval).toBe(0);
        expect(config.exportInterval).toBe(35791);
        expect(config.feeConf).toBe(6);
        expect(config.feeFallback).toBe(5);
        expect(config.feeMax).toBe(0.001);
        expect(config.rbfEnabled).toBe(true);
        expect(config.startBlock).toBe(100);
        expect(config.reimport).toBe(false);
    });

    it('only exposes batch-asset settings when they are used', async () => {
        process.env.KC_NODE_ID = 'node';
        process.env.KC_KEYMASTER_URL = 'http://keymaster:4226';
        process.env.KC_SAT_REIMPORT = 'true';

        const config = await importConfigIsolated(configPath);

        expect(config.reimport).toBe(true);

        if (usesKeymaster) {
            expect(config).toMatchObject({ nodeID: 'node', keymasterURL: 'http://keymaster:4226' });
        }
        else {
            expect(config).not.toHaveProperty('nodeID');
            expect(config).not.toHaveProperty('keymasterURL');
        }
    });

    it.each([
        'json',
        'sqlite',
        'mongodb',
        'redis',
        'postgres',
    ])('accepts the %s database adapter', async (db) => {
        process.env.KC_SAT_DB = db;

        expect((await importConfigIsolated(configPath)).db).toBe(db);
    });

    it('rejects an unsupported database adapter', async () => {
        process.env.KC_SAT_DB = 'memory';

        await expect(importConfigIsolated(configPath)).rejects.toThrow('Unsupported DB "memory"');
    });

    it.each([
        ['KC_SAT_PORT', '-1', 'a positive integer no greater than 65535'],
        ['KC_SAT_PORT', '65536', 'a positive integer no greater than 65535'],
        ['KC_SAT_PORT', '9007199254740992', 'a positive integer no greater than 65535'],
        ['KC_SAT_IMPORT_INTERVAL', '-1', 'a non-negative integer no greater than 35791'],
        ['KC_SAT_IMPORT_INTERVAL', '   ', 'a non-negative integer no greater than 35791'],
        ['KC_SAT_EXPORT_INTERVAL', '35792', 'a non-negative integer no greater than 35791'],
        ['KC_SAT_FEE_BLOCK_TARGET', '0', 'a positive integer'],
        ['KC_SAT_FEE_FALLBACK_SAT_BYTE', '-1', 'a positive integer'],
        ['KC_SAT_FEE_FALLBACK_SAT_BYTE', '1.5', 'a positive integer'],
        ['KC_SAT_FEE_MAX', '-0.1', 'a positive number'],
        ['KC_SAT_FEE_MAX', '1btc', 'a positive number'],
        ['KC_SAT_START_BLOCK', '-1', 'a non-negative integer'],
    ])('rejects invalid %s values', async (name, value, expected) => {
        process.env[name] = value;

        await expect(importConfigIsolated(configPath))
            .rejects
            .toThrow(`Invalid ${name}, expected ${expected}`);
    });

    if (usesKeymaster) {
        it.each([
            'BTC',
            'TBTC',
            'Signet',
            'TFTC',
        ])('accepts the %s chain', async (chain) => {
            process.env.KC_SAT_CHAIN = chain;

            expect((await importConfigIsolated(configPath)).chain).toBe(chain);
        });

        it('rejects an unsupported chain', async () => {
            process.env.KC_SAT_CHAIN = 'invalid';

            await expect(importConfigIsolated(configPath)).rejects.toThrow('Unsupported chain "invalid"');
        });
    }
    else {
        it.each([
            ['BTC', 'bitcoin', 'main'],
            ['BTC', 'mainnet', 'main'],
            ['Signet', 'testnet', 'signet'],
        ])('accepts %s with %s', async (chain, network, rpcChain) => {
            process.env.KC_SAT_CHAIN = chain;
            process.env.KC_SAT_NETWORK = network;

            const config = await importConfigIsolated(configPath);

            expect(config).toMatchObject({
                chain,
                network: network === 'mainnet' ? 'bitcoin' : network,
                rpcChain,
            });
        });

        it.each([
            ['TBTC', 'testnet', 'Unsupported chain "TBTC"'],
            ['TFTC', 'testnet', 'Unsupported chain "TFTC"'],
            ['BTC', 'regtest', 'Unsupported network "regtest"'],
            ['BTC', 'testnet', 'Network "testnet" is incompatible with chain "BTC"'],
            ['Signet', 'bitcoin', 'Network "bitcoin" is incompatible with chain "Signet"'],
        ])('rejects %s with %s', async (chain, network, expected) => {
            process.env.KC_SAT_CHAIN = chain;
            process.env.KC_SAT_NETWORK = network;

            await expect(importConfigIsolated(configPath)).rejects.toThrow(expected);
        });
    }
});
