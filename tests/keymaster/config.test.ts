import { jest } from '@jest/globals';

const CONFIG_PATH = '../../services/keymaster/server/src/config.js';
const ORIGINAL_ENV = { ...process.env };
const CONFIG_ENV_KEYS = [
    'KC_GATEKEEPER_URL',
    'KC_SEARCH_URL',
    'KC_DISABLE_SEARCH',
    'KC_KEYMASTER_PORT',
    'KC_NODE_ID',
    'KC_KEYMASTER_DB',
    'KC_ENCRYPTED_PASSPHRASE',
    'KC_WALLET_CACHE',
    'KC_DEFAULT_REGISTRY',
    'KC_KEYMASTER_DID_PREFIX',
    'KC_KEYMASTER_TRUST_PROXY',
    'KC_KEYMASTER_RATE_LIMIT_ENABLED',
    'KC_KEYMASTER_RATE_LIMIT_WINDOW_VALUE',
    'KC_KEYMASTER_RATE_LIMIT_WINDOW_UNIT',
    'KC_KEYMASTER_RATE_LIMIT_MAX_REQUESTS',
    'KC_KEYMASTER_RATE_LIMIT_WHITELIST',
    'KC_KEYMASTER_RATE_LIMIT_SKIP_PATHS',
];

jest.unstable_mockModule('@mdip/common/env', () => ({ loadEnv: jest.fn() }));

async function importConfig(env: Record<string, string> = {}) {
    for (const key of CONFIG_ENV_KEYS) {
        delete process.env[key];
    }
    Object.assign(process.env, env);

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

    it('uses defaults when settings are absent', async () => {
        expect(await importConfig()).toMatchObject({
            gatekeeperURL: 'http://localhost:4224',
            searchURL: 'http://localhost:4002',
            disableSearch: false,
            keymasterPort: 4226,
            nodeID: '',
            db: 'json',
            keymasterPassphrase: '',
            walletCache: false,
            defaultRegistry: undefined,
            didPrefix: undefined,
            keymasterTrustProxy: false,
            rateLimitEnabled: false,
            rateLimitWindowValue: 1,
            rateLimitWindowUnit: 'minute',
            rateLimitMaxRequests: 600,
            rateLimitWhitelist: [],
            rateLimitSkipPaths: ['/api/v1/ready'],
        });
    });

    it('reads configured settings', async () => {
        expect(await importConfig({
            KC_GATEKEEPER_URL: 'http://gatekeeper',
            KC_SEARCH_URL: 'http://search',
            KC_DISABLE_SEARCH: 'true',
            KC_KEYMASTER_PORT: '1234',
            KC_NODE_ID: 'node',
            KC_KEYMASTER_DB: 'sqlite',
            KC_ENCRYPTED_PASSPHRASE: 'passphrase',
            KC_WALLET_CACHE: 'true',
            KC_DEFAULT_REGISTRY: 'local',
            KC_KEYMASTER_DID_PREFIX: 'did:mdip',
            KC_KEYMASTER_TRUST_PROXY: 'true',
            KC_KEYMASTER_RATE_LIMIT_ENABLED: 'false',
            KC_KEYMASTER_RATE_LIMIT_WINDOW_VALUE: '2',
            KC_KEYMASTER_RATE_LIMIT_WINDOW_UNIT: 'seconds',
            KC_KEYMASTER_RATE_LIMIT_MAX_REQUESTS: '3',
            KC_KEYMASTER_RATE_LIMIT_WHITELIST: 'one, , two',
            KC_KEYMASTER_RATE_LIMIT_SKIP_PATHS: '/one, , /two',
        })).toMatchObject({
            gatekeeperURL: 'http://gatekeeper',
            searchURL: 'http://search',
            disableSearch: true,
            keymasterPort: 1234,
            nodeID: 'node',
            db: 'sqlite',
            keymasterPassphrase: 'passphrase',
            walletCache: true,
            defaultRegistry: 'local',
            didPrefix: 'did:mdip',
            keymasterTrustProxy: true,
            rateLimitEnabled: false,
            rateLimitWindowValue: 2,
            rateLimitWindowUnit: 'second',
            rateLimitMaxRequests: 3,
            rateLimitWhitelist: ['one', 'two'],
            rateLimitSkipPaths: ['/one', '/two'],
        });
    });

    it('falls back for invalid settings', async () => {
        expect(await importConfig({
            KC_DISABLE_SEARCH: 'false',
            KC_WALLET_CACHE: 'false',
            KC_KEYMASTER_DID_PREFIX: '',
            KC_KEYMASTER_TRUST_PROXY: 'invalid',
            KC_KEYMASTER_RATE_LIMIT_ENABLED: 'true',
            KC_KEYMASTER_RATE_LIMIT_WINDOW_VALUE: '0',
            KC_KEYMASTER_RATE_LIMIT_WINDOW_UNIT: 'weeks',
            KC_KEYMASTER_RATE_LIMIT_MAX_REQUESTS: 'invalid',
        })).toMatchObject({
            disableSearch: false,
            walletCache: false,
            didPrefix: undefined,
            keymasterTrustProxy: false,
            rateLimitEnabled: true,
            rateLimitWindowValue: 1,
            rateLimitWindowUnit: 'minute',
            rateLimitMaxRequests: 600,
        });
    });

    it.each([
        ['second', 'second'],
        ['hour', 'hour'],
        ['hours', 'hour'],
    ])('normalizes the %s window unit', async (value, expected) => {
        expect((await importConfig({
            KC_KEYMASTER_RATE_LIMIT_WINDOW_UNIT: value,
        })).rateLimitWindowUnit).toBe(expected);
    });
});
