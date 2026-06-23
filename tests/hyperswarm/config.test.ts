import { jest } from '@jest/globals';

const CONFIG_PATH = '../../services/mediators/hyperswarm/src/config.js';
const ORIGINAL_ENV = { ...process.env };

async function importConfigIsolated() {
    let loaded: any;
    await jest.isolateModulesAsync(async () => {
        loaded = (await import(CONFIG_PATH)).default;
    });
    return loaded;
}

describe('hyperswarm config', () => {
    beforeEach(() => {
        process.env = {
            ...ORIGINAL_ENV,
            KC_HYPR_DB: 'sqlite',
        };
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        jest.resetModules();
    });

    it('throws when both negentropy and legacy sync are disabled', async () => {
        process.env.KC_HYPR_NEGENTROPY_ENABLE = 'false';
        process.env.KC_HYPR_LEGACY_SYNC_ENABLE = 'false';

        await expect(
            jest.isolateModulesAsync(async () => {
                await import(CONFIG_PATH);
            })
        ).rejects.toThrow(
            'Invalid sync configuration; at least one of KC_HYPR_NEGENTROPY_ENABLE or KC_HYPR_LEGACY_SYNC_ENABLE must be true'
        );
    });

    it('allows startup when at least one sync mode is enabled', async () => {
        process.env.KC_HYPR_NEGENTROPY_ENABLE = 'false';
        process.env.KC_HYPR_LEGACY_SYNC_ENABLE = 'true';

        const config = await importConfigIsolated();

        expect(config.negentropyEnabled).toBe(false);
        expect(config.legacySyncEnabled).toBe(true);
    });

    it('uses defaults when optional env vars are empty', async () => {
        process.env.KC_HYPR_EXPORT_INTERVAL = '';
        process.env.KC_HYPR_NEGENTROPY_ENABLE = '';
        process.env.KC_HYPR_LEGACY_SYNC_ENABLE = '';

        const config = await importConfigIsolated();

        expect(config.exportInterval).toBe(2);
        expect(config.negentropyEnabled).toBe(true);
        expect(config.legacySyncEnabled).toBe(true);
    });

    it('uses built-in defaults when basic service env vars are blank', async () => {
        process.env.KC_DEBUG = '';
        process.env.KC_GATEKEEPER_URL = '';
        process.env.KC_KEYMASTER_URL = '';
        process.env.KC_IPFS_URL = '';
        process.env.KC_IPFS_ENABLE = '';
        process.env.KC_NODE_ID = '';
        process.env.KC_NODE_NAME = '';
        process.env.KC_MDIP_PROTOCOL = '';

        const config = await importConfigIsolated();

        expect(config.debug).toBe(false);
        expect(config.gatekeeperURL).toBe('http://localhost:4224');
        expect(config.keymasterURL).toBe('http://localhost:4226');
        expect(config.ipfsURL).toBe('http://localhost:5001/api/v0');
        expect(config.ipfsEnabled).toBe(true);
        expect(config.nodeID).toBe('');
        expect(config.nodeName).toBe('anon');
        expect(config.protocol).toBe('/MDIP/v1.0-public');
    });

    it('uses explicit env values for basic service and node settings', async () => {
        process.env.KC_DEBUG = 'true';
        process.env.KC_GATEKEEPER_URL = 'http://gatekeeper:4224';
        process.env.KC_KEYMASTER_URL = 'http://keymaster:4226';
        process.env.KC_IPFS_URL = 'http://ipfs:5001/api/v0';
        process.env.KC_IPFS_ENABLE = 'TRUE';
        process.env.KC_NODE_ID = 'did:test:node';
        process.env.KC_NODE_NAME = 'BushStar';
        process.env.KC_MDIP_PROTOCOL = '/MDIP/v1.0-test';

        const config = await importConfigIsolated();

        expect(config.debug).toBe(true);
        expect(config.gatekeeperURL).toBe('http://gatekeeper:4224');
        expect(config.keymasterURL).toBe('http://keymaster:4226');
        expect(config.ipfsURL).toBe('http://ipfs:5001/api/v0');
        expect(config.ipfsEnabled).toBe(true);
        expect(config.nodeID).toBe('did:test:node');
        expect(config.nodeName).toBe('BushStar');
        expect(config.protocol).toBe('/MDIP/v1.0-test');
    });

    it('treats KC_IPFS_ENABLE=false as disabled', async () => {
        process.env.KC_IPFS_ENABLE = 'false';

        const config = await importConfigIsolated();

        expect(config.ipfsEnabled).toBe(false);
    });

    it('throws on invalid positive integer env values', async () => {
        process.env.KC_HYPR_EXPORT_INTERVAL = '0';

        await expect(
            jest.isolateModulesAsync(async () => {
                await import(CONFIG_PATH);
            })
        ).rejects.toThrow('Invalid KC_HYPR_EXPORT_INTERVAL; expected a positive integer');
    });

    it('throws on negative integer env values', async () => {
        process.env.KC_HYPR_EXPORT_INTERVAL = '-1';

        await expect(
            jest.isolateModulesAsync(async () => {
                await import(CONFIG_PATH);
            })
        ).rejects.toThrow('Invalid KC_HYPR_EXPORT_INTERVAL; expected a positive integer');
    });

    it('throws when frame size limit is non-zero and below minimum', async () => {
        process.env.KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT = '2';

        await expect(
            jest.isolateModulesAsync(async () => {
                await import(CONFIG_PATH);
            })
        ).rejects.toThrow('KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT must be 0 or >= 4 (KB)');
    });

    it('throws on negative frame size limit values', async () => {
        process.env.KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT = '-1';

        await expect(
            jest.isolateModulesAsync(async () => {
                await import(CONFIG_PATH);
            })
        ).rejects.toThrow('Invalid KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT; expected a non-negative integer');
    });

    it('interprets frame size limit env value as KB', async () => {
        process.env.KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT = '4';

        const config = await importConfigIsolated();
        expect(config.negentropyFrameSizeLimit).toBe(4096);
    });

    it('throws on invalid boolean env values', async () => {
        process.env.KC_HYPR_NEGENTROPY_ENABLE = 'maybe';
        process.env.KC_HYPR_LEGACY_SYNC_ENABLE = 'true';

        await expect(
            jest.isolateModulesAsync(async () => {
                await import(CONFIG_PATH);
            })
        ).rejects.toThrow('Invalid KC_HYPR_NEGENTROPY_ENABLE; expected true or false');
    });

    it('throws when KC_HYPR_DB is empty or whitespace', async () => {
        process.env.KC_HYPR_DB = '';

        await expect(importConfigIsolated())
            .rejects
            .toThrow('Missing KC_HYPR_DB; expected sqlite or postgres');

        process.env.KC_HYPR_DB = '   ';

        await expect(importConfigIsolated())
            .rejects
            .toThrow('Missing KC_HYPR_DB; expected sqlite or postgres');
    });

    it('accepts postgres sync DB and uses service postgres URL before shared URL', async () => {
        process.env.KC_HYPR_DB = 'postgres';
        process.env.KC_HYPR_POSTGRES_URL = 'postgresql://hypr-user:hypr-pass@db:5432/hypr';
        // eslint-disable-next-line sonarjs/no-duplicate-string
        process.env.KC_POSTGRES_URL = 'postgresql://shared-user:shared-pass@db:5432/shared';

        const config = await importConfigIsolated();
        expect(config.db).toBe('postgres');
        expect(config.postgresURL).toBe('postgresql://hypr-user:hypr-pass@db:5432/hypr');
    });

    it('uses shared KC_POSTGRES_URL when KC_HYPR_POSTGRES_URL is not set', async () => {
        process.env.KC_HYPR_DB = 'postgres';
        process.env.KC_HYPR_POSTGRES_URL = '';
        process.env.KC_POSTGRES_URL = 'postgresql://shared-user:shared-pass@db:5432/shared';

        const config = await importConfigIsolated();
        expect(config.postgresURL).toBe('postgresql://shared-user:shared-pass@db:5432/shared');
    });

    it('uses built-in postgres URL default when no postgres env vars are set', async () => {
        process.env.KC_HYPR_DB = 'postgres';
        delete process.env.KC_HYPR_POSTGRES_URL;
        delete process.env.KC_POSTGRES_URL;

        const config = await importConfigIsolated();
        expect(config.postgresURL).toBe('postgresql://mdip:mdip@localhost:5432/mdip');
    });

    it('uses built-in postgres URL default when postgres env vars are blank', async () => {
        process.env.KC_HYPR_DB = 'postgres';
        process.env.KC_HYPR_POSTGRES_URL = '';
        process.env.KC_POSTGRES_URL = '';

        const config = await importConfigIsolated();
        expect(config.postgresURL).toBe('postgresql://mdip:mdip@localhost:5432/mdip');
    });

    it('throws on invalid KC_HYPR_DB values', async () => {
        process.env.KC_HYPR_DB = 'redis';

        await expect(
            jest.isolateModulesAsync(async () => {
                await import(CONFIG_PATH);
            })
        ).rejects.toThrow('Invalid KC_HYPR_DB; expected sqlite or postgres');
    });
});
