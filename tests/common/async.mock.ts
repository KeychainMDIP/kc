type QueueWorker<T> = (task: T, callback: (error?: Error | null) => void) => void | Promise<void>;

function queue<T>(worker: QueueWorker<T>) {
    const tasks: T[] = [];
    let running = 0;

    const runNext = (): void => {
        const task = tasks.shift();
        if (!task) {
            return;
        }

        running += 1;
        Promise.resolve(worker(task, () => undefined))
            .catch(() => undefined)
            .finally(() => {
                running -= 1;
                runNext();
            });
    };

    return {
        push(task: T): void {
            tasks.push(task);
            runNext();
        },
        length(): number {
            return tasks.length;
        },
        running(): number {
            return running;
        },
    };
}

export default {
    queue,
};
