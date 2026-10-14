import {
    BulkWorkCancelledError,
    createBulkWorkScheduler,
} from '../../services/mediators/hyperswarm/src/bulk-work-scheduler.ts';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function nextTurn(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

describe('bulk work scheduler', () => {
    it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid concurrency %s',
        concurrency => {
            expect(() => createBulkWorkScheduler(concurrency)).toThrow(
                'bulk work concurrency must be a positive safe integer',
            );
        },
    );

    it('runs at most two jobs and starts queued jobs in FIFO order', async () => {
        const scheduler = createBulkWorkScheduler(2);
        const first = deferred<string>();
        const second = deferred<string>();
        const third = deferred<string>();
        const started: string[] = [];
        const run = (key: string, work: { promise: Promise<string> }) => scheduler.run(key, async () => {
            started.push(key);
            return work.promise;
        });

        const firstResult = run('first', first);
        const secondResult = run('second', second);
        const thirdResult = run('third', third);
        await nextTurn();
        expect(started).toStrictEqual(['first', 'second']);

        first.resolve('one');
        await expect(firstResult).resolves.toBe('one');
        await nextTurn();
        expect(started).toStrictEqual(['first', 'second', 'third']);

        second.resolve('two');
        third.resolve('three');
        await expect(Promise.all([secondResult, thirdResult])).resolves.toStrictEqual(['two', 'three']);
        await expect(scheduler.waitForIdle()).resolves.toBeUndefined();
    });

    it('admits one job per key and releases the key after failure', async () => {
        const scheduler = createBulkWorkScheduler(1);
        const blocked = deferred<void>();
        const running = scheduler.run('peer', () => blocked.promise);

        await expect(scheduler.run('peer', async () => undefined)).rejects.toThrow(
            'bulk work already admitted for peer',
        );
        blocked.reject(new Error('read failed'));
        await expect(running).rejects.toThrow('read failed');
        await expect(scheduler.run('peer', async () => 'retry')).resolves.toBe('retry');
    });

    it('cancels pending work without interrupting active work', async () => {
        const scheduler = createBulkWorkScheduler(1);
        const active = deferred<string>();
        const running = scheduler.run('active', () => active.promise);
        const cancelled = scheduler.run('pending', async () => 'not run');

        scheduler.cancel('active');
        scheduler.cancel('pending');
        await expect(cancelled).rejects.toBeInstanceOf(BulkWorkCancelledError);
        active.resolve('complete');
        await expect(running).resolves.toBe('complete');
    });

    it('cancels every pending job while retaining active jobs', async () => {
        const scheduler = createBulkWorkScheduler(1);
        const active = deferred<void>();
        const running = scheduler.run('active', () => active.promise);
        const pendingA = scheduler.run('pending-a', async () => undefined);
        const pendingB = scheduler.run('pending-b', async () => undefined);

        scheduler.cancelPending();
        await expect(pendingA).rejects.toBeInstanceOf(BulkWorkCancelledError);
        await expect(pendingB).rejects.toBeInstanceOf(BulkWorkCancelledError);
        active.resolve();
        await running;
    });

    it('rejects pending and new work during shutdown, then waits for active work', async () => {
        const scheduler = createBulkWorkScheduler(1);
        const active = deferred<void>();
        const running = scheduler.run('active', () => active.promise);
        const pending = scheduler.run('pending', async () => undefined);
        const shutdown = scheduler.shutdown();

        await expect(pending).rejects.toBeInstanceOf(BulkWorkCancelledError);
        await expect(scheduler.run('new', async () => undefined)).rejects.toThrow(
            'bulk work scheduler is shutting down',
        );
        let settled = false;
        shutdown.then(() => { settled = true; });
        await nextTurn();
        expect(settled).toBe(false);

        active.resolve();
        await running;
        await expect(shutdown).resolves.toBeUndefined();
        await expect(scheduler.shutdown()).resolves.toBeUndefined();
    });
});
