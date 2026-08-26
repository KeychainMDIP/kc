import { parseDidPrefix } from '../../services/search-server/src/config.ts';

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
