import { jest } from '@jest/globals';
import { createWalletFromBody } from '../../services/keymaster/server/src/helpers.ts';

describe('keymaster server helpers', () => {
    it('creates a wallet when the request body is absent', async () => {
        const wallet = { seed: {}, counter: 0, ids: {} };
        const newWallet = jest.fn(async () => wallet);

        await expect(createWalletFromBody({ newWallet })).resolves.toBe(wallet);
        expect(newWallet).toHaveBeenCalledWith(undefined, undefined);
    });
});
