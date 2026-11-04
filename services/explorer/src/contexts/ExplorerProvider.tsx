import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import * as config from "../config.js";
import {
    isSearchServerReady,
    searchClient,
} from "../api/searchClient.js";
import { isRetryableHttpStatus, startPolling } from "../lifecycle.js";

interface ExplorerContextValue {
    config: typeof config;
    searchClient: typeof searchClient;
    isReady: boolean;
    readinessMessage: string;
}

interface ReadinessResult {
    ready: boolean;
    message: string;
    retry: boolean;
}

const ExplorerContext = createContext<ExplorerContextValue | null>(null);

async function getReadinessResult(signal: AbortSignal): Promise<ReadinessResult> {
    try {
        const status = await searchClient.fetchSearchServerStatus(signal);
        const ready = isSearchServerReady(status);

        if (ready) {
            return {
                ready,
                message: "",
                retry: true,
            };
        }

        return {
            ready,
            message: status.sync?.lastSyncError
                ? "Search Server sync error. Retrying..."
                : "Waiting for Search Server sync...",
            retry: true,
        };
    }
    catch (error: any) {
        if (signal.aborted) {
            throw error;
        }

        const status = error?.response?.status;
        const retry = isRetryableHttpStatus(status);

        return {
            ready: false,
            message: retry
                ? "Waiting for Search Server..."
                : `Search Server request failed (HTTP ${status}). Check Explorer configuration.`,
            retry,
        };
    }
}

export function ExplorerProvider({ children }: { children: ReactNode }) {
    const [isReady, setIsReady] = useState<boolean>(false);
    const [readinessMessage, setReadinessMessage] = useState<string>("Waiting for Search Server...");

    useEffect(() => {
        return startPolling({
            intervalMs: config.readinessPollIntervalMs,
            run: getReadinessResult,
            onResult(result) {
                setIsReady(result.ready);
                setReadinessMessage(result.message);
                return result.retry;
            },
            onError() {
                return true;
            },
        });
    }, []);

    const value = useMemo<ExplorerContextValue>(() => ({
        config,
        searchClient,
        isReady,
        readinessMessage,
    }), [isReady, readinessMessage]);

    return (
        <ExplorerContext.Provider value={value}>
            {children}
        </ExplorerContext.Provider>
    );
}

export function useExplorerContext() {
    const ctx = useContext(ExplorerContext);

    if (!ctx) {
        throw new Error("useExplorerContext must be used within ExplorerProvider");
    }

    return ctx;
}
