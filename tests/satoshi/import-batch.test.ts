import { jest } from '@jest/globals';
import { ResolveDIDOptions } from '@mdip/gatekeeper/types';
import { resolveAnchoredBatchAsset } from '../../services/mediators/satoshi/src/batch-import.ts';

describe('Satoshi batch import', () => {
    it('resolves the batch committed by the asset create operation', async () => {
        const anchoredBatch = { batch: [{ type: 'create' }] };
        const substitutedBatch = { batch: [{ type: 'delete' }] };
        const resolveAsset = jest.fn<(did: string, options?: ResolveDIDOptions) => Promise<unknown>>(
            async (_did, options) => options?.versionSequence === 1 ? anchoredBatch : substitutedBatch
        );

        const result = await resolveAnchoredBatchAsset({ resolveAsset }, 'did:test:batch');

        expect(resolveAsset).toHaveBeenCalledWith('did:test:batch', { versionSequence: 1 });
        expect(result).toBe(anchoredBatch);
    });
});
