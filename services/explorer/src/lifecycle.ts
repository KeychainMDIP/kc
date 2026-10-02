interface PollOptions<T> {
    intervalMs: number;
    run: (signal: AbortSignal) => Promise<T>;
    onResult: (result: T) => boolean;
    onError: (error: unknown) => boolean;
}

export function startPolling<T>({ intervalMs, run, onResult, onError }: PollOptions<T>): () => void {
    const controller = new AbortController();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
        try {
            const result = await run(controller.signal);
            if (!stopped && onResult(result)) {
                timer = setTimeout(() => void poll(), intervalMs);
            }
        }
        catch (error) {
            if (!stopped && onError(error)) {
                timer = setTimeout(() => void poll(), intervalMs);
            }
        }
    }

    void poll();

    return () => {
        stopped = true;
        controller.abort();
        if (timer) {
            clearTimeout(timer);
        }
    };
}

export function isRetryableHttpStatus(status: unknown): boolean {
    return typeof status !== "number" || status === 408 || status === 429 || status >= 500;
}

export function createLatestRequest() {
    let current: AbortController | null = null;

    return {
        start(): AbortController {
            current?.abort();
            current = new AbortController();
            return current;
        },
        isCurrent(controller: AbortController): boolean {
            return current === controller && !controller.signal.aborted;
        },
        finish(controller: AbortController): void {
            if (current === controller) {
                current = null;
            }
        },
        abort(): void {
            current?.abort();
            current = null;
        },
    };
}
