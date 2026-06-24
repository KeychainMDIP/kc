import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as config from "../config.js";
import {
    isSearchServerReady,
    searchClient,
} from "../api/searchClient.js";

interface ExplorerContextValue {
    config: typeof config;
    searchClient: typeof searchClient;
    isReady: boolean;
    readinessMessage: string;
    refreshReadiness: () => Promise<boolean>;
}

interface ReadinessResult {
    ready: boolean;
    message: string;
}

const ExplorerContext = createContext<ExplorerContextValue | null>(null);

async function getReadinessResult(): Promise<ReadinessResult> {
    try {
        const status = await searchClient.fetchSearchServerStatus();
        const ready = isSearchServerReady(status);

        if (ready) {
            return {
                ready,
                message: "",
            };
        }

        return {
            ready,
            message: status.sync?.lastSyncError
                ? "Search Server sync error. Retrying..."
                : "Waiting for Search Server sync...",
        };
    }
    catch {
        return {
            ready: false,
            message: "Waiting for Search Server...",
        };
    }
}

export function ExplorerProvider({ children }: { children: ReactNode }) {
    const [isReady, setIsReady] = useState<boolean>(false);
    const [readinessMessage, setReadinessMessage] = useState<string>("Waiting for Search Server...");

    const refreshReadiness = useCallback(async (): Promise<boolean> => {
        const result = await getReadinessResult();

        setIsReady(result.ready);
        if (!result.ready) {
            setReadinessMessage(result.message);
        }

        return result.ready;
    }, []);

    useEffect(() => {
        let cancelled = false;
        let interval: ReturnType<typeof setInterval> | undefined;

        async function checkReadiness() {
            const result = await getReadinessResult();

            if (cancelled) {
                return;
            }

            setIsReady(result.ready);
            if (!result.ready) {
                setReadinessMessage(result.message);
            }

            if (result.ready && interval) {
                clearInterval(interval);
            }
        }

        void checkReadiness();
        interval = setInterval(checkReadiness, config.readinessPollIntervalMs);

        return () => {
            cancelled = true;
            if (interval) {
                clearInterval(interval);
            }
        };
    }, []);

    const value = useMemo<ExplorerContextValue>(() => ({
        config,
        searchClient,
        isReady,
        readinessMessage,
        refreshReadiness,
    }), [isReady, readinessMessage, refreshReadiness]);

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
