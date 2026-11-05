import { jest } from '@jest/globals';
import { parseDidPrefix, parseSearchDb } from '../../services/search-server/src/config.ts';

async function loadConfigWithEnv(env: Record<string, string | undefined>) {
    const previous = { ...process.env };
    jest.unstable_mockModule('@mdip/common/env', () => ({ loadEnv: jest.fn() }));
    try {
        for (const [key, value] of Object.entries(env)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        let config: any;
        await jest.isolateModulesAsync(async () => {
            config = (await import('../../services/search-server/src/config.ts')).default;
        });
        return config;
    }
    finally {
        process.env = previous;
        jest.unstable_unmockModule('@mdip/common/env');
    }
}

describe('search-server DID prefix configuration', () => {
    it('accepts DID method scopes and treats blank values as unfiltered', () => {
        expect(parseDidPrefix(undefined)).toBeUndefined();
        expect(parseDidPrefix('   ')).toBeUndefined();
        expect(parseDidPrefix('did:test')).toBe('did:test');
        expect(parseDidPrefix(' did:mdip ')).toBe('did:mdip');
        expect(parseDidPrefix('did:arbitrary')).toBe('did:arbitrary');
        expect(() => parseDidPrefix('test')).toThrow(
            'KC_SEARCH_SERVER_DID_PREFIX must be a did:<method> prefix or empty'
        );
        expect(() => parseDidPrefix('did:mdip:test')).toThrow();
    });
});

describe('search-server database configuration', () => {
    it('accepts documented database adapters and defaults to sqlite', () => {
        expect(parseSearchDb(undefined)).toBe('sqlite');
        expect(parseSearchDb('')).toBe('sqlite');
        expect(parseSearchDb('sqlite')).toBe('sqlite');
        expect(parseSearchDb('postgres')).toBe('postgres');
        expect(parseSearchDb('memory')).toBe('memory');
    });

    it('rejects unsupported database adapters', () => {
        expect(() => parseSearchDb('postres')).toThrow(
            'Unsupported KC_SEARCH_SERVER_DB "postres", expected sqlite, postgres, or memory'
        );
    });
});

describe('search-server status rate limiting', () => {
    it('exempts readiness but keeps status subject to the configured rate limit by default', async () => {
        const config = await loadConfigWithEnv({ KC_SEARCH_SERVER_RATE_LIMIT_SKIP_PATHS: undefined });
        expect(config.rateLimitSkipPaths).toEqual(['/api/v1/ready']);
    });
});

describe('search-server startup reset configuration', () => {
    it.each([
        [undefined, false], ['false', false], ['true', true], [' TRUE ', true], ['1', false], ['invalid', false],
    ])('requires an explicit true to reset the database (%s)', async (value, resetDb) => {
        const config = await loadConfigWithEnv({ KC_SEARCH_SERVER_RESET_DB: value });
        expect(config.resetDb).toBe(resetDb);
    });
});
