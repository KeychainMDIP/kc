import { isRetryableHttpError } from '@mdip/common/utils';

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
