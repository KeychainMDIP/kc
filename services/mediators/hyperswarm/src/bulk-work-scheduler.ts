interface BulkWork<T> {
    key: string;
    run(): Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
}

export class BulkWorkCancelledError extends Error {
    constructor(message = 'bulk work cancelled') {
        super(message);
        this.name = 'BulkWorkCancelledError';
    }
}

export interface BulkWorkScheduler {
    run<T>(key: string, work: () => Promise<T>): Promise<T>;
    cancel(key: string): void;
    cancelPending(): void;
    waitForIdle(): Promise<void>;
    shutdown(): Promise<void>;
}

export function createBulkWorkScheduler(concurrency = 2): BulkWorkScheduler {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
        throw new Error('bulk work concurrency must be a positive safe integer');
    }

    const pending: BulkWork<unknown>[] = [];
    const activeKeys = new Set<string>();
    const pendingKeys = new Set<string>();
    const idleWaiters = new Set<() => void>();
    let active = 0;
    let accepting = true;
    let shutdownPromise: Promise<void> | null = null;

    function settleIdle(): void {
        if (active !== 0 || pending.length !== 0) {
            return;
        }
        for (const resolve of idleWaiters) {
            resolve();
        }
        idleWaiters.clear();
    }

    function runNext(): void {
        while (accepting && active < concurrency && pending.length > 0) {
            const index = pending.findIndex(work => !activeKeys.has(work.key));
            if (index < 0) {
                break;
            }
            const [work] = pending.splice(index, 1);
            pendingKeys.delete(work.key);
            activeKeys.add(work.key);
            active += 1;
            Promise.resolve()
                .then(work.run)
                .then(work.resolve, work.reject)
                .then(() => {
                    active -= 1;
                    activeKeys.delete(work.key);
                    runNext();
                    settleIdle();
                });
        }
        settleIdle();
    }

    function rejectPending(predicate: (work: BulkWork<unknown>) => boolean): void {
        for (let index = pending.length - 1; index >= 0; index -= 1) {
            const work = pending[index];
            if (!predicate(work)) {
                continue;
            }
            pending.splice(index, 1);
            pendingKeys.delete(work.key);
            work.reject(new BulkWorkCancelledError());
        }
        settleIdle();
    }

    function waitForIdle(): Promise<void> {
        if (active === 0 && pending.length === 0) {
            return Promise.resolve();
        }
        return new Promise(resolve => idleWaiters.add(resolve));
    }

    return {
        run<T>(key: string, work: () => Promise<T>): Promise<T> {
            if (!accepting) {
                return Promise.reject(new BulkWorkCancelledError('bulk work scheduler is shutting down'));
            }
            if (pendingKeys.has(key)) {
                return Promise.reject(new Error(`bulk work already admitted for ${key}`));
            }
            pendingKeys.add(key);
            return new Promise<T>((resolve, reject) => {
                pending.push({
                    key,
                    run: work,
                    resolve: value => resolve(value as T),
                    reject,
                });
                runNext();
            });
        },
        cancel(key: string): void {
            rejectPending(work => work.key === key);
        },
        cancelPending(): void {
            rejectPending(() => true);
        },
        waitForIdle,
        shutdown(): Promise<void> {
            if (!shutdownPromise) {
                accepting = false;
                rejectPending(() => true);
                shutdownPromise = waitForIdle();
            }
            return shutdownPromise;
        },
    };
}
