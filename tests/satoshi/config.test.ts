import { jest } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };
const CONFIGS = [
    ['Satoshi', '../../services/mediators/satoshi/src/config.ts'],
    ['Satoshi inscription', '../../services/mediators/satoshi-inscription/src/config.ts'],
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

async function importConfigIsolated(configPath: string) {
    let loaded: any;

    await jest.isolateModulesAsync(async () => {
        loaded = (await import(configPath)).default;
    });

    return loaded;
}

describe.each(CONFIGS)('%s config', (_name, configPath) => {
    beforeEach(() => {
        process.env = {
            ...ORIGINAL_ENV,
            ...NUMERIC_DEFAULTS,
            KC_SAT_CHAIN: 'BTC',
            KC_SAT_NETWORK: 'bitcoin',
            KC_SAT_DB: 'json',
        };
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

    it('accepts valid numeric settings', async () => {
        Object.assign(process.env, {
            KC_SAT_PORT: '65535',
            KC_SAT_IMPORT_INTERVAL: '0',
            KC_SAT_EXPORT_INTERVAL: '35791',
            KC_SAT_FEE_BLOCK_TARGET: '6',
            KC_SAT_FEE_FALLBACK_SAT_BYTE: '5',
            KC_SAT_FEE_MAX: '0.001',
            KC_SAT_START_BLOCK: '100',
        });

        const config = await importConfigIsolated(configPath);

        expect(config.port).toBe(65535);
        expect(config.importInterval).toBe(0);
        expect(config.exportInterval).toBe(35791);
        expect(config.feeConf).toBe(6);
        expect(config.feeFallback).toBe(5);
        expect(config.feeMax).toBe(0.001);
        expect(config.startBlock).toBe(100);
    });

    it.each([
        ['KC_SAT_PORT', '-1', 'a positive integer no greater than 65535'],
        ['KC_SAT_PORT', '65536', 'a positive integer no greater than 65535'],
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
});
