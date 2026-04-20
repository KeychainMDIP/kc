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

    it('throws on invalid positive integer env values', async () => {
        process.env.KC_HYPR_EXPORT_INTERVAL = '0';

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

    it('throws on invalid KC_HYPR_DB values', async () => {
        process.env.KC_HYPR_DB = 'redis';

        await expect(
            jest.isolateModulesAsync(async () => {
                await import(CONFIG_PATH);
            })
        ).rejects.toThrow('Invalid KC_HYPR_DB; expected sqlite or postgres');
    });
});
