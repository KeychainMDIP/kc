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
        process.env.KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT = '1024';

        await expect(
            jest.isolateModulesAsync(async () => {
                await import(CONFIG_PATH);
            })
        ).rejects.toThrow('KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT must be 0 or >= 4096');
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
});
