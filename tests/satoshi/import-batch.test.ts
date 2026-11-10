import { jest } from '@jest/globals';
import { Operation } from '@mdip/gatekeeper/types';

const ORIGINAL_ENV = { ...process.env };
const resolveAsset = jest.fn();
const importEvents = jest.fn();
const processEvents = jest.fn();

jest.unstable_mockModule('@mdip/common/env', () => ({ loadEnv: jest.fn() }));
jest.unstable_mockModule('@mdip/keymaster/client', () => ({
    default: class {
        resolveAsset = resolveAsset;
    },
}));
jest.unstable_mockModule('@mdip/gatekeeper/client', () => ({
    default: class {
        importBatch = importEvents;
        processEvents = processEvents;
    },
}));
jest.unstable_mockModule('../../services/mediators/satoshi/src/lifecycle.ts', () => ({
    isRetryableChainError: jest.fn(),
    runService: jest.fn(),
}));

describe('Satoshi batch import', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.assign(process.env, {
            KC_KEYMASTER_URL: 'http://keymaster',
            KC_SAT_CHAIN: 'TFTC',
            KC_SAT_DB: 'json',
            KC_SAT_EXPORT_INTERVAL: '0',
        });
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    it('imports the batch committed by the asset create operation', async () => {
        const anchoredOperation = { type: 'create' } as Operation;
        const substitutedOperation = { type: 'delete' } as Operation;
        resolveAsset.mockImplementation(async (_did, options) => options?.versionSequence === 1
            ? { batch: [anchoredOperation] }
            : { batch: [substitutedOperation] });
        importEvents.mockResolvedValue({ queued: 1, processed: 0, rejected: 0, total: 1, rejectedIndices: [] });
        processEvents.mockResolvedValue({ added: 1 });

        const { importBatch } = await import('../../services/mediators/satoshi/src/satoshi-mediator.ts');
        const item = {
            height: 42,
            index: 3,
            time: '2026-11-10T12:00:00.000Z',
            txid: 'txid',
            did: 'did:test:batch',
        };

        const result = await importBatch(item);

        expect(resolveAsset).toHaveBeenCalledWith(item.did, { versionSequence: 1 });
        expect(importEvents).toHaveBeenCalledWith([{
            registry: 'TFTC',
            time: item.time,
            ordinal: [item.height, item.index, 0],
            operation: anchoredOperation,
            blockchain: {
                height: item.height,
                index: item.index,
                txid: item.txid,
                batch: item.did,
                opidx: 0,
            },
        }]);
        expect(result).toMatchObject({
            ...item,
            imported: { queued: 1 },
            processed: { added: 1 },
        });
    });
});
