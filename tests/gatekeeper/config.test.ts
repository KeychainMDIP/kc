import { jest } from '@jest/globals';

const CONFIG_PATH = '../../services/gatekeeper/server/src/config.js';
const ORIGINAL_ENV = { ...process.env };

jest.unstable_mockModule('@mdip/common/env', () => ({ loadEnv: jest.fn() }));

async function importConfig(didPrefix?: string) {
    delete process.env.KC_GATEKEEPER_DID_PREFIX;

    if (didPrefix !== undefined) {
        process.env.KC_GATEKEEPER_DID_PREFIX = didPrefix;
    }

    let config: any;
    await jest.isolateModulesAsync(async () => {
        config = (await import(CONFIG_PATH)).default;
    });
    return config;
}

describe('gatekeeper server DID prefix config', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    it('uses the default when the setting is absent or blank', async () => {
        expect((await importConfig()).didPrefix).toBe('did:test');
        expect((await importConfig('')).didPrefix).toBe('did:test');
        expect((await importConfig('   ')).didPrefix).toBe('did:test');
    });

    it('normalizes a valid DID prefix', async () => {
        expect((await importConfig(' did:mdip ')).didPrefix).toBe('did:mdip');
        expect((await importConfig('did:m123')).didPrefix).toBe('did:m123');
    });

    it.each([
        'invalid',
        'did:',
        'did:mdip:test',
        'did:MDIP',
        'did:m-dip',
    ])('rejects invalid DID prefix %s', async (didPrefix) => {
        await expect(importConfig(didPrefix))
            .rejects
            .toThrow('KC_GATEKEEPER_DID_PREFIX must be a did:<method> prefix using lowercase letters and digits');
    });
});
