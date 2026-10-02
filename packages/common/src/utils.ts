export function copyJSON<T>(json: T): T {
    return JSON.parse(JSON.stringify(json)) as T;
}

export function compareOrdinals(a: number[], b: number[]): -1 | 0 | 1 {
    // An ordinal is a list of integers
    // Return -1 if a < b, 0 if a == b, 1 if a > b

    const minLength = Math.min(a.length, b.length);

    for (let i = 0; i < minLength; i++) {
        if (a[i] < b[i]) {
            return -1;
        }
        if (a[i] > b[i]) {
            return 1;
        }
    }

    // If all compared elements are equal, the longer list is considered greater
    if (a.length < b.length) {
        return -1;
    }

    if (a.length > b.length) {
        return 1;
    }

    return 0;
}

const retryableHttpStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const retryableNetworkCodes = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ERR_NETWORK',
    'ESOCKETTIMEDOUT',
    'ETIMEDOUT',
]);

export function isRetryableHttpError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const { code, response } = error as {
        code?: unknown;
        response?: { status?: unknown };
    };

    if (response) {
        return typeof response.status === 'number' && retryableHttpStatuses.has(response.status);
    }

    return typeof code === 'string' && retryableNetworkCodes.has(code);
}
