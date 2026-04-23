import { jest } from '@jest/globals';

const ADAPTER_PATH = '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';

describe('NegentropyAdapter module loading', () => {
    afterEach(() => {
        jest.resetModules();
    });

    it('throws when the local negentropy module exports are invalid', async () => {
        await jest.isolateModulesAsync(async () => {
            jest.unstable_mockModule('module', () => ({
                createRequire: () => (() => ({
                    // Invalid on purpose.
                    Negentropy: {},
                    NegentropyStorageVector: null,
                })),
            }));

            const { default: NegentropyAdapter } = await import(ADAPTER_PATH);

            expect(() => new NegentropyAdapter({
                syncStore: {
                    start: async () => undefined,
                    stop: async () => undefined,
                    reset: async () => undefined,
                    upsertMany: async () => 0,
                    getByIds: async () => [],
                    has: async () => false,
                    count: async () => 0,
                    iterateSorted: async () => [],
                },
                frameSizeLimit: 0,
            })).toThrow('Invalid local negentropy module exports');

            jest.unstable_unmockModule('module');
        });
    });
});
