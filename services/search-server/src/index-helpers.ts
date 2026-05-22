import type { Request } from "express";
import { BlockList, isIP } from "net";

import { childLogger } from "@mdip/common/logger";
import { INDEX_SYNC_STATE_KEYS } from "./DidIndexer.js";
import type { DIDsDb } from "./types.js";

const log = childLogger({ service: 'search-server' });

export const rateLimitWindowUnits = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
} as const;

export function normalizeIp(ip: string): string {
    const withoutZone = ip.split('%')[0];

    if (withoutZone === '::1') {
        return '127.0.0.1';
    }

    if (withoutZone.startsWith('::ffff:')) {
        return withoutZone.slice(7);
    }

    return withoutZone;
}

export function detectIpFamily(ip: string): 'ipv4' | 'ipv6' | null {
    const version = isIP(ip);

    if (version === 4) {
        return 'ipv4';
    }

    if (version === 6) {
        return 'ipv6';
    }

    return null;
}

export function createWhitelistBlockList(whitelist: string[]): BlockList {
    const blockList = new BlockList();

    for (const entry of whitelist) {
        const [rawAddress, rawPrefixLength] = entry.split('/');
        const address = normalizeIp(rawAddress);
        const family = detectIpFamily(address);

        if (!family) {
            log.warn(`Ignoring invalid rate limit whitelist entry: '${entry}'`);
            continue;
        }

        if (rawPrefixLength !== undefined) {
            const prefixLength = Number.parseInt(rawPrefixLength, 10);

            if (!Number.isInteger(prefixLength)) {
                log.warn(`Ignoring invalid rate limit CIDR entry: '${entry}'`);
                continue;
            }

            try {
                blockList.addSubnet(address, prefixLength, family);
            }
            catch {
                log.warn(`Ignoring invalid rate limit CIDR entry: '${entry}'`);
            }
            continue;
        }

        try {
            blockList.addAddress(address, family);
        }
        catch {
            log.warn(`Ignoring invalid rate limit whitelist entry: '${entry}'`);
        }
    }

    return blockList;
}

export function isRateLimitWhitelistedRequest(req: Request, whitelistBlockList: BlockList): boolean {
    const candidates = [req.ip, req.socket.remoteAddress]
        .filter((ip): ip is string => typeof ip === 'string' && ip.length > 0);

    for (const candidate of candidates) {
        const normalizedIp = normalizeIp(candidate);
        const family = detectIpFamily(normalizedIp);

        if (family && whitelistBlockList.check(normalizedIp, family)) {
            return true;
        }
    }

    return false;
}

export function shouldSkipRateLimitPath(req: Request, skipPaths: string[]): boolean {
    const pathOnly = req.originalUrl.split('?')[0];

    return skipPaths.some(skipPath =>
        pathOnly === skipPath || pathOnly.startsWith(`${skipPath}/`));
}

export function parseNonNegativeInteger(value: unknown, fallback: number): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);

    if (Number.isInteger(parsed) && parsed >= 0) {
        return parsed;
    }

    return fallback;
}

export function parseOptionalBoolean(value: unknown): boolean | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
        return true;
    }

    if (normalized === 'false') {
        return false;
    }

    return undefined;
}

export function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
    if (value === undefined) {
        return undefined;
    }

    const parsed = Number.parseInt(String(value), 10);

    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${fieldName} must be a positive integer`);
    }

    return parsed;
}

export async function getSearchStatus(didDb: DIDsDb, dbName: string) {
    const sync = {
        snapshotComplete: await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.snapshotComplete) === 'true',
        snapshotCursor: await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.snapshotCursor),
        snapshotCheckpointCursor: await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.snapshotCheckpointCursor),
        changesCursor: await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.changesCursor),
        lastSyncStartedAt: await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.lastSyncStartedAt),
        lastSyncCompletedAt: await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.lastSyncCompletedAt),
        lastSyncError: await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.lastSyncError),
        lastSyncMode: await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.lastSyncMode),
        lastPagesProcessed: Number.parseInt(
            await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.lastPagesProcessed) ?? '0',
            10
        ),
        lastDidsChanged: Number.parseInt(
            await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.lastDidsChanged) ?? '0',
            10
        ),
        lastBlocksStored: Number.parseInt(
            await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.lastBlocksStored) ?? '0',
            10
        ),
    };

    return {
        ready: true,
        db: dbName,
        sync,
    };
}
