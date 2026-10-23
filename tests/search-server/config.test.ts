import { jest } from '@jest/globals';
import { parseDidPrefix, parseSearchDb } from '../../services/search-server/src/config.ts';

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
        const previous = process.env.KC_SEARCH_SERVER_RATE_LIMIT_SKIP_PATHS;
        jest.unstable_mockModule('@mdip/common/env', () => ({ loadEnv: jest.fn() }));
        try {
            delete process.env.KC_SEARCH_SERVER_RATE_LIMIT_SKIP_PATHS;
            await jest.isolateModulesAsync(async () => {
                const { default: config } = await import('../../services/search-server/src/config.ts');
                expect(config.rateLimitSkipPaths).toEqual(['/api/v1/ready']);
            });
        }
        finally {
            if (previous === undefined) delete process.env.KC_SEARCH_SERVER_RATE_LIMIT_SKIP_PATHS;
            else process.env.KC_SEARCH_SERVER_RATE_LIMIT_SKIP_PATHS = previous;
            jest.unstable_unmockModule('@mdip/common/env');
        }
    });
});
