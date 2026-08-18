import {
    countUniqueDIDSuffixes,
    findCredentialManifestEntry,
    hasSameDIDSuffix,
} from '../../services/explorer/src/shared/credential-manifest.ts';

describe('hasSameDIDSuffix', () => {
    it('matches DID prefix aliases but not different identities', () => {
        expect(hasSameDIDSuffix('did:test:schema', 'did:mdip:schema')).toBe(true);
        expect(hasSameDIDSuffix('did:test:schema', 'did:mdip:other')).toBe(false);
        expect(countUniqueDIDSuffixes([
            'did:test:schema',
            'did:mdip:schema',
            'did:test:other',
        ])).toBe(2);
    });
});

describe('findCredentialManifestEntry', () => {
    const exactEntry = { name: 'exact' };
    const aliasEntry = { name: 'alias' };
    const manifest = {
        'did:test:credential': aliasEntry,
        'did:mdip:credential': exactEntry,
    };

    it('prefers the exact manifest key', () => {
        expect(findCredentialManifestEntry(manifest, 'did:mdip:credential')).toBe(exactEntry);
    });

    it('falls back to a manifest key with the same CID suffix', () => {
        expect(findCredentialManifestEntry(
            { 'did:test:credential': aliasEntry },
            'did:mdip:credential'
        )).toBe(aliasEntry);
    });

    it('returns undefined when no manifest key has the requested suffix', () => {
        expect(findCredentialManifestEntry(manifest, 'did:mdip:other')).toBeUndefined();
    });
});
