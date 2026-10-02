import { jest } from '@jest/globals';
import { runService } from '../../services/search-server/src/lifecycle.ts';

const lifecycleEvents = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'] as const;
let originalListeners: Record<string, ReturnType<typeof process.listeners>>;

const log = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
};

beforeEach(() => {
    jest.clearAllMocks();
    originalListeners = Object.fromEntries(lifecycleEvents.map(event => [event, process.listeners(event)]));
    jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
});

afterEach(() => {
    jest.useRealTimers();
    for (const event of lifecycleEvents) {
        for (const listener of process.listeners(event)) {
            if (!originalListeners[event].includes(listener)) {
                process.removeListener(event, listener);
            }
        }
    }
    jest.restoreAllMocks();
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}

describe('Search Server lifecycle', () => {
    it('runs cleanup once and preserves a fatal exit code across repeated shutdown requests', async () => {
        const pending = deferred();
        const cleanup = jest.fn(() => pending.promise);
        runService({ start: async () => {}, cleanup, log, timeoutMs: 10_000 });

        const sigterm = process.listeners('SIGTERM').find(listener => !originalListeners.SIGTERM.includes(listener))!;
        const sigint = process.listeners('SIGINT').find(listener => !originalListeners.SIGINT.includes(listener))!;
        const uncaught = process.listeners('uncaughtException')
            .find(listener => !originalListeners.uncaughtException.includes(listener))!;

        const first = sigterm('SIGTERM');
        const second = sigint('SIGINT');
        const fatal = uncaught(new Error('fatal'), 'uncaughtException');

        expect(cleanup).toHaveBeenCalledTimes(1);
        pending.resolve();
        await Promise.all([first, second, fatal]);

        expect(process.exit).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(1);
        expect(log.error).toHaveBeenCalledWith({ error: expect.any(Error) }, 'Unhandled exception caught');
    });

    it('exits non-zero when cleanup fails', async () => {
        const shutdown = runService({
            start: async () => {},
            cleanup: async () => { throw new Error('cleanup failed'); },
            log,
            timeoutMs: 10_000,
        });

        await shutdown();

        expect(process.exit).toHaveBeenCalledWith(1);
        expect(log.error).toHaveBeenCalledWith({ error: expect.any(Error) }, 'Error during shutdown');
    });

    it('forces a non-zero exit when cleanup exceeds the shutdown deadline', async () => {
        jest.useFakeTimers();
        const pending = deferred();
        const shutdown = runService({
            start: async () => {},
            cleanup: () => pending.promise,
            log,
            timeoutMs: 100,
        });

        const stopping = shutdown();
        await jest.advanceTimersByTimeAsync(100);

        expect(process.exit).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(1);
        expect(log.error).toHaveBeenCalledWith('Search Server shutdown exceeded 100ms; forcing exit');

        pending.resolve();
        await stopping;
        expect(process.exit).toHaveBeenCalledTimes(1);
    });

    it('cleans up after a startup failure', async () => {
        const cleanup = jest.fn(async () => {});
        runService({
            start: async () => { throw new Error('startup failed'); },
            cleanup,
            log,
            timeoutMs: 10_000,
        });

        await new Promise(resolve => setImmediate(resolve));

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(1);
        expect(log.error).toHaveBeenCalledWith({ error: expect.any(Error) }, '[search-server] Fatal error');
    });

    it('does not treat an interrupted startup as fatal during shutdown', async () => {
        let rejectStartup!: (error: Error) => void;
        const startup = new Promise<void>((_resolve, reject) => {
            rejectStartup = reject;
        });
        const cleanup = jest.fn(async () => {});
        const shutdown = runService({
            start: () => startup,
            cleanup,
            log,
            timeoutMs: 10_000,
        });
        await new Promise(resolve => setImmediate(resolve));

        const stopping = shutdown();
        rejectStartup(new Error('aborted'));
        await stopping;
        await new Promise(resolve => setImmediate(resolve));

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(0);
        expect(log.error).not.toHaveBeenCalledWith(
            expect.anything(),
            '[search-server] Fatal error',
        );
    });

    it('cleans up after an unhandled rejection', async () => {
        const cleanup = jest.fn(async () => {});
        runService({ start: async () => {}, cleanup, log, timeoutMs: 10_000 });
        const unhandled = process.listeners('unhandledRejection')
            .find(listener => !originalListeners.unhandledRejection.includes(listener))!;
        const reason = new Error('unhandled');
        const promise = Promise.resolve();

        await unhandled(reason, promise);

        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(1);
        expect(log.error).toHaveBeenCalledWith({ reason, promise }, 'Unhandled rejection caught');
    });
});
