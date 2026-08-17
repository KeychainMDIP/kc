import { parseDidPrefix } from '../../services/search-server/src/config.ts';

describe('search-server DID prefix configuration', () => {
    it('accepts supported scopes and treats blank values as unfiltered', () => {
        expect(parseDidPrefix(undefined)).toBeUndefined();
        expect(parseDidPrefix('   ')).toBeUndefined();
        expect(parseDidPrefix('did:test')).toBe('did:test');
        expect(parseDidPrefix(' did:mdip ')).toBe('did:mdip');
        expect(() => parseDidPrefix('did:other')).toThrow(
            'KC_SEARCH_SERVER_DID_PREFIX must be did:test, did:mdip, or empty'
        );
    });
});
