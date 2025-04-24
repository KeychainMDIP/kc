import { CSSProperties } from "react";

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
