import { ResolveDIDOptions } from '@mdip/gatekeeper/types';

interface BatchAssetResolver {
    resolveAsset(did: string, options?: ResolveDIDOptions): Promise<unknown>;
}

export function resolveAnchoredBatchAsset(resolver: BatchAssetResolver, did: string): Promise<unknown> {
    return resolver.resolveAsset(did, { versionSequence: 1 });
}
