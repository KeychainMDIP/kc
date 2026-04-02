import { CSSProperties } from "react";
import axios from "axios";

const searchServerURL = import.meta.env.VITE_SEARCH_SERVER || "http://localhost:4002";
const VERSION = "/api/v1";

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

export async function fetchCachedDid(did: string): Promise<Record<string, unknown> | null> {
    try {
        const response = await axios.get(`${searchServerURL}${VERSION}/did/${encodeURIComponent(did)}`);
        return response.data as Record<string, unknown>;
    } catch (error: any) {
        if (error?.response?.status === 404) {
            return null;
        }

        throw error;
    }
}
