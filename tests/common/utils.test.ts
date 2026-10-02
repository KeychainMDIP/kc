import { jest } from '@jest/globals';
import { isRetryableHttpError, waitForTimeout } from '@mdip/common/utils';

describe('isRetryableHttpError', () => {
    it.each([408, 425, 429, 500, 502, 503, 504])(
        'should classify HTTP %s as retryable',
        status => expect(isRetryableHttpError({ response: { status } })).toBe(true),
    );

    it.each([400, 401, 403, 404, 501])(
        'should classify HTTP %s as permanent',
        status => expect(isRetryableHttpError({ response: { status } })).toBe(false),
    );

    it.each(['ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ERR_NETWORK', 'ETIMEDOUT'])(
        'should classify %s as retryable',
        code => expect(isRetryableHttpError({ code })).toBe(true),
    );

    it.each([null, new Error('unknown'), { code: 'ENOTFOUND' }, { code: 'ERR_INVALID_URL' }])(
        'should classify unknown or invalid configuration errors as permanent',
        error => expect(isRetryableHttpError(error)).toBe(false),
    );
});

describe('waitForTimeout', () => {
    it('resolves after the requested delay', async () => {
        jest.useFakeTimers();
        const waiting = waitForTimeout(100);

        await jest.advanceTimersByTimeAsync(100);

        await expect(waiting).resolves.toBeUndefined();
        jest.useRealTimers();
    });

    it.each([false, true])('rejects when aborted (already aborted: %s)', async alreadyAborted => {
        const controller = new AbortController();
        if (alreadyAborted) {
            controller.abort();
        }

        const waiting = waitForTimeout(60_000, controller.signal);
        controller.abort();

        await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('creates an abort error when the signal has no reason', async () => {
        const signal = { aborted: true, reason: undefined } as AbortSignal;

        await expect(waitForTimeout(60_000, signal)).rejects.toMatchObject({ name: 'AbortError' });
    });
});
