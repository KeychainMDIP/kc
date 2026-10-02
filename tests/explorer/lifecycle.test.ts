import { createRequire } from 'node:module';
import {
    createLatestRequest,
    isRetryableHttpStatus,
    startPolling,
} from '../../services/explorer/src/lifecycle.js';

const require = createRequire(new URL('../../services/explorer/package.json', import.meta.url));
const { matchPath } = require('react-router-dom');

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

async function waitFor(check: () => boolean) {
    const deadline = Date.now() + 1_000;
    while (!check()) {
        expect(Date.now()).toBeLessThan(deadline);
        await new Promise(resolve => setImmediate(resolve));
    }
}

describe('Explorer browser lifecycle', () => {
    it('accepts a trailing slash on the Events route', () => {
        expect(matchPath('/events', '/events')).toBeTruthy();
        expect(matchPath('/events', '/events/')).toBeTruthy();
        expect(matchPath('/events', '/network')).toBeNull();
    });

    it('serializes polling and aborts active work when stopped', async () => {
        const requests: Array<ReturnType<typeof deferred<number>>> = [];
        const signals: AbortSignal[] = [];
        const results: number[] = [];

        const stop = startPolling({
            intervalMs: 0,
            run(signal) {
                signals.push(signal);
                const request = deferred<number>();
                requests.push(request);
                return request.promise;
            },
            onResult(result) {
                results.push(result);
                return true;
            },
            onError() {
                return true;
            },
        });

        await waitFor(() => requests.length === 1);
        await new Promise(resolve => setImmediate(resolve));
        expect(requests).toHaveLength(1);

        requests[0].resolve(1);
        await waitFor(() => requests.length === 2);
        expect(results).toEqual([1]);

        stop();
        expect(signals[0].aborted).toBe(true);
        requests[1].resolve(2);
        await new Promise(resolve => setImmediate(resolve));
        expect(results).toEqual([1]);
        expect(requests).toHaveLength(2);
    });

    it('stops polling after a permanent result', async () => {
        let calls = 0;
        const stop = startPolling({
            intervalMs: 0,
            async run() {
                calls += 1;
                return false;
            },
            onResult(retry) {
                return retry;
            },
            onError() {
                return true;
            },
        });

        await waitFor(() => calls === 1);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(calls).toBe(1);
        stop();
    });

    it('retries transient polling errors and stops after a permanent error', async () => {
        let calls = 0;
        const errors: unknown[] = [];
        const stop = startPolling({
            intervalMs: 0,
            async run() {
                calls += 1;
                throw new Error(`failure ${calls}`);
            },
            onResult() {
                return true;
            },
            onError(error) {
                errors.push(error);
                return errors.length === 1;
            },
        });

        await waitFor(() => calls === 2);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(errors).toHaveLength(2);
        expect(calls).toBe(2);
        stop();
    });

    it('classifies retryable readiness failures', () => {
        expect(isRetryableHttpStatus(undefined)).toBe(true);
        expect(isRetryableHttpStatus(408)).toBe(true);
        expect(isRetryableHttpStatus(429)).toBe(true);
        expect(isRetryableHttpStatus(500)).toBe(true);
        expect(isRetryableHttpStatus(401)).toBe(false);
        expect(isRetryableHttpStatus(404)).toBe(false);
    });

    it('keeps only the latest request current', () => {
        const requests = createLatestRequest();
        const first = requests.start();
        const second = requests.start();

        expect(first.signal.aborted).toBe(true);
        expect(requests.isCurrent(first)).toBe(false);
        expect(requests.isCurrent(second)).toBe(true);

        requests.finish(first);
        expect(requests.isCurrent(second)).toBe(true);

        second.abort();
        expect(requests.isCurrent(second)).toBe(false);
        requests.finish(second);
        expect(requests.isCurrent(second)).toBe(false);

        const third = requests.start();
        requests.abort();
        requests.abort();
        expect(third.signal.aborted).toBe(true);
        expect(requests.isCurrent(third)).toBe(false);
    });
});
