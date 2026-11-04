import { jest } from '@jest/globals';
import type { LoggerLike } from '@mdip/common/logger';
import {
    isRetryableChainError,
    runService,
} from '../../services/mediators/satoshi/src/lifecycle.ts';

const processEvents = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'] as const;
const logError = jest.fn();
const log = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: logError,
} as unknown as LoggerLike;

let originalListeners: Record<string, ReturnType<typeof process.listeners>>;

async function settle(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

function addedListener(event: typeof processEvents[number]): (...args: any[]) => void {
    return process.listeners(event).find(listener => !originalListeners[event].includes(listener))!;
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    originalListeners = Object.fromEntries(processEvents.map(event => [event, process.listeners(event)]));
    jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

afterEach(() => {
    for (const event of processEvents) {
        for (const listener of process.listeners(event)) {
            if (!originalListeners[event].includes(listener)) {
                process.removeListener(event, listener as never);
            }
        }
    }
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('Satoshi mediator lifecycle', () => {
    it.each([
        -28,
        500,
        599,
        'ECONNREFUSED',
        'ECONNRESET',
        'EAI_AGAIN',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'ENOTFOUND',
        'ESOCKETTIMEDOUT',
        'ETIMEDOUT',
    ])('retries chain error %s', code => {
        expect(isRetryableChainError({ code })).toBe(true);
    });

    it.each([401, 499, 600, 'EACCES', undefined])('does not retry chain error %s', code => {
        expect(isRetryableChainError({ code })).toBe(false);
    });

    it('cleans up and exits non-zero after startup failure', async () => {
        const error = new Error('startup failed');
        const cleanup = jest.fn(async () => {});

        runService({
            start: async () => { throw error; },
            cleanup,
            log,
            timeoutMs: 10_000,
        });
        await settle();

        expect(logError).toHaveBeenCalledWith({ error }, 'Fatal mediator startup error');
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(1);
    });

    it.each(['SIGTERM', 'SIGINT'] as const)('cleans up and exits on %s', async signal => {
        const cleanup = jest.fn(async () => {});

        runService({ start: async () => {}, cleanup, log, timeoutMs: 10_000 });
        addedListener(signal)(signal);
        await settle();

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('does not turn an interrupted startup into a fatal exit', async () => {
        let rejectStart!: (error: Error) => void;
        const start = jest.fn(() => new Promise<void>((_, reject) => { rejectStart = reject; }));

        runService({ start, cleanup: async () => {}, log, timeoutMs: 10_000 });
        addedListener('SIGTERM')('SIGTERM');
        rejectStart(new Error('interrupted'));
        await settle();

        expect(logError).not.toHaveBeenCalledWith(expect.anything(), 'Fatal mediator startup error');
        expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('forces exit when graceful cleanup exceeds its deadline', async () => {
        const cleanup = jest.fn(() => new Promise<void>(() => {}));

        runService({ start: async () => {}, cleanup, log, timeoutMs: 10_000 });
        addedListener('SIGTERM')('SIGTERM');

        await jest.advanceTimersByTimeAsync(9_999);
        expect(process.exit).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(logError).toHaveBeenCalledWith('Mediator shutdown exceeded 10000ms; forcing exit');
        expect(process.exit).toHaveBeenCalledWith(0);
    });

    it.each(['uncaughtException', 'unhandledRejection'] as const)(
        'forces a non-zero exit after %s during stalled shutdown',
        async event => {
            const error = new Error('fatal');
            const cleanup = jest.fn(() => new Promise<void>(() => {}));

            runService({ start: async () => {}, cleanup, log, timeoutMs: 10_000 });
            addedListener('SIGTERM')('SIGTERM');
            addedListener(event)(error, event === 'unhandledRejection' ? Promise.resolve() : 'uncaughtException');
            await jest.advanceTimersByTimeAsync(10_000);

            expect(cleanup).toHaveBeenCalledTimes(1);
            expect(process.exit).toHaveBeenCalledWith(1);
        },
    );
});
