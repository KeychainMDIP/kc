const rawSearchServerUrl = import.meta.env.VITE_SEARCH_SERVER || "http://localhost:4002";
const rawOperationNetworks = import.meta.env.VITE_OPERATION_NETWORKS || "hyperswarm";
const parsedOperationNetworks = uniqueNonEmpty(rawOperationNetworks.split(","));

function trimTrailingSlashes(value: string): string {
    return value.trim().replace(/\/+$/, "");
}

function uniqueNonEmpty(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }

        seen.add(trimmed);
        result.push(trimmed);
    }

    return result;
}

export const searchServerUrl = trimTrailingSlashes(rawSearchServerUrl);
export const operationNetworks = parsedOperationNetworks.length > 0 ? parsedOperationNetworks : ["hyperswarm"];
export const knownRegistries = uniqueNonEmpty(["All", ...operationNetworks, "local"]);
export const pageSizeOptions = [25, 50, 100];
export const schemaPageSizeOptions = [25, 50, 100];
export const usageFetchLimit = 500;
export const receiptBrowseFetchLimit = 500;
export const readinessPollIntervalMs = 5000;
export const eventsPollIntervalMs = 10000;
