import {BarcodeScanner} from "@capacitor-mlkit/barcode-scanning";
import { toSvg } from "jdenticon";

export function avatarDataUrl(seed: string, size = 64) {
    const svg = toSvg(seed || "anonymous", size);
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

export function formatTime(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
        return "";
    }
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
        ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString();
}

export function extractDid(input: string): string | null {
    if (!input) {
        return null;
    }

    const didRegex = /did:[a-z0-9]+:[^\s&#?]+/i;

    const direct = input.match(didRegex);
    if (direct) {
        return direct[0];
    }

    try {
        const url = new URL(input);

        if (url.protocol === 'mdip:') {
            const host = (url.host || '').toLowerCase();

            if (host === 'auth') {
                const challenge = url.searchParams.get('challenge');
                if (challenge?.startsWith('did:')) {
                    return challenge;
                }
            }

            if (host === 'accept') {
                const credential = url.searchParams.get('credential');
                if (credential?.startsWith('did:')) {
                    return credential;
                }
            }
        }

        if (url.protocol === 'https:' || url.protocol === 'http:') {
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts.length >= 2 && parts[0].toLowerCase() === 'attest') {
                const cand = decodeURIComponent(parts[1]);
                if (cand.startsWith('did:')) {
                    return cand;
                }
            }

            const challenge = url.searchParams.get('challenge');
            if (challenge?.startsWith('did:')) {
                return challenge;
            }

            const credential = url.searchParams.get('credential');
            if (credential?.startsWith('did:')) {
                return credential;
            }
        }

        const fallback = input.match(didRegex)?.[0];
        if (fallback) {
            return fallback;
        }
    } catch {}

    return null;
}

async function ensureGoogleModuleReady(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()) {
            return true;
        }
        await new Promise(r => setTimeout(r, 400));
    }
    return false;
}

export async function scanQrCode() {
    try {
        const perm = await BarcodeScanner.requestPermissions();
        if (perm.camera !== 'granted') {
            return null;
        }

        const ready = await ensureGoogleModuleReady();
        if (!ready) {
            return null;
        }

        const { barcodes } = await BarcodeScanner.scan();

        let did: string | null = null;
        for (const b of barcodes) {
            const candidate = extractDid(b.rawValue);
            if (candidate) {
                did = candidate;
                break;
            }
        }

        if (!did) {
            return null;
        }

        return did;
    } catch {}
    return null;
}

export function truncateMiddle(str: string, max = 34) {
    if (str.length <= max) {
        return str;
    }
    const half = Math.floor((max - 3) / 2);
    return `${str.slice(0, half)}...${str.slice(-half)}`;
}

export function arraysMatchMembers(arr1: string[], arr2: string[]) {
    if (arr1.length !== arr2.length) {
        return false;
    }
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();
    return sorted1.every((val, idx) => val === sorted2[idx]);
}
