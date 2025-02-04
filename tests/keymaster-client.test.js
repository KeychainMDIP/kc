import nock from 'nock';
import KeymasterClient from '@mdip/keymaster/client';
import { ExpectedExceptionError } from '@mdip/common/errors';

const KeymasterURL = 'http://keymaster.org';
const ServerError = { message: 'Server error' };
const MockDID = 'did:mock:1234';

const mockConsole = {
    log: () => { },
    error: () => { },
    time: () => { },
    timeEnd: () => { },
}

describe('isReady', () => {
    it('should return ready flag', async () => {
        nock(KeymasterURL)
            // eslint-disable-next-line
            .get('/api/v1/ready')
            .reply(200, { ready: true });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const isReady = await keymaster.isReady();

        expect(isReady).toBe(true);
    });

    it('should return false on server error', async () => {
        nock(KeymasterURL)
            .get('/api/v1/ready')
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const isReady = await keymaster.isReady();

        expect(isReady).toBe(false);
    });

    it('should wait until ready', async () => {
        nock(KeymasterURL)
            .get('/api/v1/ready')
            .reply(200, { ready: true });

        const keymaster = await KeymasterClient.create({
            url: KeymasterURL,
            waitUntilReady: true,
            chatty: true,
            console: mockConsole
        });

        expect(keymaster != null).toBe(true);
    });

    it('should timeout if not ready', async () => {
        nock(KeymasterURL)
            .get('/api/v1/ready')
            .reply(200, { ready: false });

        const keymaster = await KeymasterClient.create({
            url: KeymasterURL,
            waitUntilReady: true,
            intervalSeconds: 0.1,
            maxRetries: 2,
            chatty: false,
            becomeChattyAfter: 1,
            console: mockConsole
        });

        expect(keymaster != null).toBe(true);
    });
});

describe('loadWallet', () => {
    it('should return wallet', async () => {
        const mockWallet = { seed: 1 };

        nock(KeymasterURL)
            .get('/api/v1/wallet')
            .reply(200, { wallet: mockWallet });

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });
        const wallet = await keymaster.loadWallet();

        expect(wallet).toStrictEqual(mockWallet);
    });

    it('should throw exception on loadWallet server error', async () => {
        nock(KeymasterURL)
            .get('/api/v1/wallet')
            .reply(500, ServerError);

        const keymaster = await KeymasterClient.create({ url: KeymasterURL });

        try {
            await keymaster.loadWallet();
            throw new ExpectedExceptionError();
        }
        catch (error) {
            expect(error.message).toBe(ServerError.message);
        }
    });
});
