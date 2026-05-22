export function copyJSON<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export function stableStringify(value: unknown): string {
    return JSON.stringify(sortJSON(value));
}

function sortJSON(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortJSON);
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, sortJSON(item)])
    );
}
