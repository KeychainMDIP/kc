import { CSSProperties } from "react";
import axios from "axios";

const searchServerURL = import.meta.env.VITE_SEARCH_SERVER || "http://localhost:4002";
const VERSION = "/api/v1";

export interface ExplorerDIDDocument extends Record<string, unknown> {
    didDocumentMetadata?: {
        version?: string;
        timestamp?: {
            chain?: string;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    didDocumentData?: unknown;
}

export interface ExplorerDIDEvent extends Record<string, unknown> {
    registry: string;
    time: string;
    operation: {
        type: string;
        [key: string]: unknown;
    };
    did?: string;
}

export interface SearchServerSyncStatus {
    snapshotComplete: boolean;
    snapshotCursor?: string | null;
    snapshotCheckpointCursor?: string | null;
    changesCursor?: string | null;
    lastSyncStartedAt?: string | null;
    lastSyncCompletedAt?: string | null;
    lastSyncError?: string | null;
    lastSyncMode?: string | null;
    lastPagesProcessed?: number;
    lastDidsChanged?: number;
    lastBlocksStored?: number;
}

export interface SearchServerStatus {
    ready: boolean;
    db?: string;
    sync?: SearchServerSyncStatus;
}

export interface SearchServerEventRecord {
    did: string;
    registry: string;
    time: string;
    event: ExplorerDIDEvent;
}

export interface SearchServerEventListResult {
    total: number;
    events: SearchServerEventRecord[];
}

export interface FetchDIDDocumentOptions {
    versionSequence?: number;
    versionTime?: string;
}

export interface FetchEventsOptions {
    registry?: string;
    updatedAfter?: string;
    updatedBefore?: string;
    limit?: number;
    offset?: number;
}

export function getTypeStyle(type: string): CSSProperties {
    const base = { fontWeight: "bold" as const };
    switch (type) {
    case "create":
        return { ...base, color: "green" };
    case "update":
        return { ...base, color: "orange" };
    case "delete":
        return { ...base, color: "red" };
    default:
        return base;
    }
}

export function handleCopyDID(did: string, setError: (error: any) => void) {
    navigator.clipboard.writeText(did).catch((err) => {
        setError(err);
    });
}

export function isSearchServerReady(status: SearchServerStatus): boolean {
    return status.ready === true && status.sync?.snapshotComplete === true;
}

export async function fetchSearchServerStatus(): Promise<SearchServerStatus> {
    const response = await axios.get(`${searchServerURL}${VERSION}/status`);

    return response.data as SearchServerStatus;
}

export async function fetchDIDDocument(
    did: string,
    options: FetchDIDDocumentOptions = {}
): Promise<ExplorerDIDDocument | null> {
    const params: Record<string, string | number> = {};

    if (options.versionSequence !== undefined) {
        params.versionSequence = options.versionSequence;
    }

    if (options.versionTime !== undefined) {
        params.versionTime = options.versionTime;
    }

    try {
        const response = await axios.get(
            `${searchServerURL}${VERSION}/did/${encodeURIComponent(did)}`,
            { params }
        );

        return response.data as ExplorerDIDDocument;
    } catch (error: any) {
        if (error?.response?.status === 404) {
            return null;
        }

        throw error;
    }
}

export async function fetchSearchServerEvents(
    options: FetchEventsOptions = {}
): Promise<SearchServerEventListResult> {
    const response = await axios.get(`${searchServerURL}${VERSION}/events`, {
        params: options,
    });

    return response.data as SearchServerEventListResult;
}

export async function searchDIDDocuments(query: string): Promise<string[]> {
    const response = await axios.get(`${searchServerURL}${VERSION}/search`, {
        params: { q: query }
    });

    return response.data as string[];
}
