import { jest } from '@jest/globals';

const CONFIG_PATH = '../../services/gatekeeper/server/src/config.js';
const ORIGINAL_ENV = { ...process.env };
const CONFIG_ENV_KEYS = [
    'KC_GATEKEEPER_PORT',
    'KC_GATEKEEPER_DB',
    'KC_IPFS_URL',
    'KC_IPFS_CLUSTER_URL',
    'KC_IPFS_CLUSTER_AUTH_HEADER',
    'KC_IPFS_ENABLE',
    'KC_GATEKEEPER_DID_PREFIX',
    'KC_GATEKEEPER_REGISTRIES',
    'KC_GATEKEEPER_JSON_LIMIT',
    'KC_GATEKEEPER_MAX_OP_BYTES',
    'KC_GATEKEEPER_GC_INTERVAL',
    'KC_GATEKEEPER_STATUS_INTERVAL',
    'KC_GATEKEEPER_TRUST_PROXY',
    'KC_GATEKEEPER_RATE_LIMIT_ENABLED',
    'KC_GATEKEEPER_RATE_LIMIT_WINDOW_VALUE',
    'KC_GATEKEEPER_RATE_LIMIT_WINDOW_UNIT',
    'KC_GATEKEEPER_RATE_LIMIT_MAX_REQUESTS',
    'KC_GATEKEEPER_RATE_LIMIT_WHITELIST',
    'KC_GATEKEEPER_RATE_LIMIT_SKIP_PATHS',
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

describe('gatekeeper server config', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    it('uses defaults when settings are absent', async () => {
        expect(await importConfig()).toMatchObject({
            port: 4224,
            db: 'redis',
            ipfsURL: 'http://localhost:5001/api/v0',
            ipfsClusterURL: undefined,
            ipfsClusterAuthHeader: undefined,
            ipfsEnabled: true,
            didPrefix: 'did:test',
            registries: undefined,
            jsonLimit: '4mb',
            maxOpBytes: undefined,
            gcInterval: 15,
            statusInterval: 5,
            gatekeeperTrustProxy: false,
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
            KC_GATEKEEPER_PORT: '1234',
            KC_GATEKEEPER_DB: 'json',
            KC_IPFS_URL: 'http://ipfs',
            KC_IPFS_CLUSTER_URL: 'http://ipfs-cluster',
            KC_IPFS_CLUSTER_AUTH_HEADER: 'Basic test',
            KC_IPFS_ENABLE: 'false',
            KC_GATEKEEPER_DID_PREFIX: 'did:mdip',
            KC_GATEKEEPER_REGISTRIES: 'local,hyperswarm',
            KC_GATEKEEPER_JSON_LIMIT: '10mb',
            KC_GATEKEEPER_MAX_OP_BYTES: '123',
            KC_GATEKEEPER_GC_INTERVAL: '30',
            KC_GATEKEEPER_STATUS_INTERVAL: '10',
            KC_GATEKEEPER_TRUST_PROXY: 'true',
            KC_GATEKEEPER_RATE_LIMIT_ENABLED: 'true',
            KC_GATEKEEPER_RATE_LIMIT_WINDOW_VALUE: '2',
            KC_GATEKEEPER_RATE_LIMIT_WINDOW_UNIT: 'seconds',
            KC_GATEKEEPER_RATE_LIMIT_MAX_REQUESTS: '3',
            KC_GATEKEEPER_RATE_LIMIT_WHITELIST: 'one, , two',
            KC_GATEKEEPER_RATE_LIMIT_SKIP_PATHS: '/one, , /two',
        })).toMatchObject({
            port: 1234,
            db: 'json',
            ipfsURL: 'http://ipfs',
            ipfsClusterURL: 'http://ipfs-cluster',
            ipfsClusterAuthHeader: 'Basic test',
            ipfsEnabled: false,
            didPrefix: 'did:mdip',
            registries: ['local', 'hyperswarm'],
            jsonLimit: '10mb',
            maxOpBytes: 123,
            gcInterval: 30,
            statusInterval: 10,
            gatekeeperTrustProxy: true,
            rateLimitEnabled: true,
            rateLimitWindowValue: 2,
            rateLimitWindowUnit: 'second',
            rateLimitMaxRequests: 3,
            rateLimitWhitelist: ['one', 'two'],
            rateLimitSkipPaths: ['/one', '/two'],
        });
    });

    it('falls back for invalid settings', async () => {
        expect(await importConfig({
            KC_IPFS_ENABLE: 'true',
            KC_GATEKEEPER_TRUST_PROXY: 'invalid',
            KC_GATEKEEPER_RATE_LIMIT_ENABLED: 'false',
            KC_GATEKEEPER_RATE_LIMIT_WINDOW_VALUE: '0',
            KC_GATEKEEPER_RATE_LIMIT_WINDOW_UNIT: 'weeks',
            KC_GATEKEEPER_RATE_LIMIT_MAX_REQUESTS: 'invalid',
        })).toMatchObject({
            ipfsEnabled: true,
            gatekeeperTrustProxy: false,
            rateLimitEnabled: false,
            rateLimitWindowValue: 1,
            rateLimitWindowUnit: 'minute',
            rateLimitMaxRequests: 600,
        });
    });

    it('uses the default DID prefix when the setting is blank', async () => {
        expect((await importConfig({ KC_GATEKEEPER_DID_PREFIX: '' })).didPrefix).toBe('did:test');
        expect((await importConfig({ KC_GATEKEEPER_DID_PREFIX: '   ' })).didPrefix).toBe('did:test');
    });

    it('normalizes a valid DID prefix', async () => {
        expect((await importConfig({ KC_GATEKEEPER_DID_PREFIX: ' did:mdip ' })).didPrefix).toBe('did:mdip');
        expect((await importConfig({ KC_GATEKEEPER_DID_PREFIX: 'did:m123' })).didPrefix).toBe('did:m123');
    });

    it.each([
        'invalid',
        'did:',
        'did:mdip:test',
        'did:MDIP',
        'did:m-dip',
    ])('rejects invalid DID prefix %s', async (didPrefix) => {
        await expect(importConfig({ KC_GATEKEEPER_DID_PREFIX: didPrefix }))
            .rejects
            .toThrow('KC_GATEKEEPER_DID_PREFIX must be a did:<method> prefix using lowercase letters and digits');
    });

    it.each([
        ['second', 'second'],
        ['seconds', 'second'],
        ['hour', 'hour'],
        ['hours', 'hour'],
    ])('normalizes the %s window unit', async (value, expected) => {
        expect((await importConfig({
            KC_GATEKEEPER_RATE_LIMIT_WINDOW_UNIT: value,
        })).rateLimitWindowUnit).toBe(expected);
    });
});
