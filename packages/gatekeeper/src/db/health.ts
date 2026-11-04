export const DB_HEALTH_TIMEOUT_MS = 1_000;

export async function withHealthCheckTimeout<T>(
    check: Promise<T>,
    message: string,
    timeoutMs: number = DB_HEALTH_TIMEOUT_MS
): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;

    try {
        return await Promise.race([
            check,
            new Promise<T>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}
