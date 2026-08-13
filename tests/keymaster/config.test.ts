import { jest } from '@jest/globals';

const CONFIG_PATH = '../../services/keymaster/server/src/config.js';
const ORIGINAL_ENV = { ...process.env };

async function importConfig() {
    let config: any;
    await jest.isolateModulesAsync(async () => {
        config = (await import(CONFIG_PATH)).default;
    });
    return config;
}

describe('keymaster server config', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    it('reads the optional Keymaster DID prefix', async () => {
        process.env.KC_KEYMASTER_DID_PREFIX = 'did:mdip';
        expect((await importConfig()).didPrefix).toBe('did:mdip');

        process.env.KC_KEYMASTER_DID_PREFIX = '';
        expect((await importConfig()).didPrefix).toBeUndefined();
    });
});
