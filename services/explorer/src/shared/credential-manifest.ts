export function getDIDSuffix(did: string): string {
    return did.split(":").pop()!;
}

export function hasSameDIDSuffix(first: string, second: string): boolean {
    return getDIDSuffix(first) === getDIDSuffix(second);
}

export function countUniqueDIDSuffixes(dids: string[]): number {
    return new Set(dids.map(getDIDSuffix)).size;
}

export function findCredentialManifestEntry(
    manifest: Record<string, unknown>,
    credentialDid: string
): unknown {
    if (Object.hasOwn(manifest, credentialDid)) {
        return manifest[credentialDid];
    }

    return Object.entries(manifest)
        .find(([did]) => hasSameDIDSuffix(did, credentialDid))?.[1];
}
