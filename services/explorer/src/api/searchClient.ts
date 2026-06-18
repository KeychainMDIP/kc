import axios from "axios";
import type {
    GatekeeperEvent,
    MdipDocument,
    ResolveDIDOptions,
} from "@mdip/gatekeeper/types";
import type { ChallengeReceipt } from "@mdip/keymaster/types";
import { searchServerUrl } from "../config.js";

const apiVersion = "/api/v1";
const apiBaseUrl = `${searchServerUrl}${apiVersion}`;

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
    event: GatekeeperEvent;
}

export interface SearchServerEventListResult {
    total: number;
    events: SearchServerEventRecord[];
}

export type FetchDIDDocumentOptions = Pick<ResolveDIDOptions, "versionSequence" | "versionTime">;

export interface FetchEventsOptions {
    registry?: string;
    updatedAfter?: string;
    updatedBefore?: string;
    limit?: number;
    offset?: number;
}

export interface PublishedSchemaMetric {
    schemaDid: string;
    count: number;
}

export interface PublishedCredentialRow {
    holderDid: string;
    credentialDid: string;
    schemaDid: string;
    issuerDid: string;
    subjectDid: string;
    revealed: boolean;
    updatedAt: string;
}

export interface FetchPublishedCredentialsOptions {
    credentialDid?: string;
    schemaDid?: string;
    issuerDid?: string;
    subjectDid?: string;
    revealed?: boolean;
    limit?: number;
    offset?: number;
}

export interface PublishedCredentialsResult {
    total: number;
    credentials: PublishedCredentialRow[];
}

type ChallengeReceiptFields = Pick<
    ChallengeReceipt,
    "attesterDid" | "schemaDid" | "requesterDid" | "responseCommitment"
>;

export interface ChallengeReceiptRow extends ChallengeReceiptFields {
    receiptDid: string;
    updatedAt: string;
}

export interface FetchChallengeReceiptsOptions {
    receiptDid?: string;
    attesterDid?: string;
    schemaDid?: string;
    requesterDid?: string;
    responseCommitment?: string;
    updatedAfter?: string;
    updatedBefore?: string;
    limit?: number;
    offset?: number;
}

export interface ChallengeReceiptsResult {
    total: number;
    receipts: ChallengeReceiptRow[];
}

export interface ChallengeReceiptUsageRow {
    attesterDid: string;
    schemaDid: string;
    requesterDid: string;
    count: number;
    firstUpdatedAt: string;
    lastUpdatedAt: string;
}

export interface FetchChallengeReceiptUsageOptions {
    attesterDid: string;
    schemaDid?: string;
    requesterDid?: string;
    updatedAfter?: string;
    updatedBefore?: string;
    limit?: number;
    offset?: number;
}

export interface ChallengeReceiptUsageResult {
    total: number;
    usage: ChallengeReceiptUsageRow[];
}

function toNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function mapPublishedCredentialRow(row: any): PublishedCredentialRow {
    return {
        holderDid: row.holderDid,
        credentialDid: row.credentialDid,
        schemaDid: row.schemaDid,
        issuerDid: row.issuerDid,
        subjectDid: row.subjectDid,
        revealed: row.revealed === true,
        updatedAt: row.updatedAt,
    };
}

function mapChallengeReceiptRow(row: any): ChallengeReceiptRow {
    return {
        receiptDid: row.receiptDid,
        attesterDid: row.attesterDid,
        schemaDid: row.schemaDid,
        requesterDid: row.requesterDid,
        responseCommitment: row.responseCommitment,
        updatedAt: row.updatedAt,
    };
}

function mapChallengeReceiptUsageRow(row: any): ChallengeReceiptUsageRow {
    return {
        attesterDid: row.attesterDid,
        schemaDid: row.schemaDid,
        requesterDid: row.requesterDid,
        count: toNumber(row.count),
        firstUpdatedAt: row.firstUpdatedAt,
        lastUpdatedAt: row.lastUpdatedAt,
    };
}

export function isSearchServerReady(status: SearchServerStatus): boolean {
    return status.ready === true && status.sync?.snapshotComplete === true;
}

export async function fetchSearchServerStatus(): Promise<SearchServerStatus> {
    const response = await axios.get(`${apiBaseUrl}/status`);

    return response.data as SearchServerStatus;
}

export async function fetchDIDDocument(
    did: string,
    options: FetchDIDDocumentOptions = {}
): Promise<MdipDocument | null> {
    const params: Record<string, string | number> = {};

    if (options.versionSequence !== undefined) {
        params.versionSequence = options.versionSequence;
    }

    if (options.versionTime !== undefined) {
        params.versionTime = options.versionTime;
    }

    try {
        const response = await axios.get(
            `${apiBaseUrl}/did/${encodeURIComponent(did)}`,
            { params }
        );

        return response.data as MdipDocument;
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
    const response = await axios.get(`${apiBaseUrl}/events`, {
        params: options,
    });

    return response.data as SearchServerEventListResult;
}

export async function searchDIDDocuments(query: string): Promise<string[]> {
    const response = await axios.get(`${apiBaseUrl}/search`, {
        params: { q: query }
    });

    return response.data as string[];
}

export async function fetchPublishedSchemaMetrics(): Promise<PublishedSchemaMetric[]> {
    const response = await axios.get(`${apiBaseUrl}/metrics/schemas/published`);

    return (response.data.schemas ?? []).map((row: any) => ({
        schemaDid: row.schemaDid,
        count: toNumber(row.count),
    }));
}

export async function fetchPublishedCredentials(
    options: FetchPublishedCredentialsOptions = {}
): Promise<PublishedCredentialsResult> {
    const response = await axios.get(`${apiBaseUrl}/metrics/credentials/published`, {
        params: options,
    });

    return {
        total: toNumber(response.data.total),
        credentials: (response.data.credentials ?? []).map(mapPublishedCredentialRow),
    };
}

export async function fetchChallengeReceipts(
    options: FetchChallengeReceiptsOptions = {}
): Promise<ChallengeReceiptsResult> {
    const response = await axios.get(`${apiBaseUrl}/metrics/challenge-receipts`, {
        params: options,
    });

    return {
        total: toNumber(response.data.total),
        receipts: (response.data.receipts ?? []).map(mapChallengeReceiptRow),
    };
}

export async function fetchChallengeReceiptUsage(
    options: FetchChallengeReceiptUsageOptions
): Promise<ChallengeReceiptUsageResult> {
    const response = await axios.get(`${apiBaseUrl}/metrics/challenge-receipts/usage`, {
        params: options,
    });

    return {
        total: toNumber(response.data.total),
        usage: (response.data.usage ?? []).map(mapChallengeReceiptUsageRow),
    };
}

export const searchClient = {
    fetchSearchServerStatus,
    fetchDIDDocument,
    fetchSearchServerEvents,
    searchDIDDocuments,
    fetchPublishedSchemaMetrics,
    fetchPublishedCredentials,
    fetchChallengeReceipts,
    fetchChallengeReceiptUsage,
};
