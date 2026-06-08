import type { NextFunction, Request, Response } from 'express';
import { BlockList, isIP } from 'net';

import type { GatekeeperDb, IndexExportRequest } from '@mdip/gatekeeper/types';
import { childLogger } from '@mdip/common/logger';

const log = childLogger({ service: 'gatekeeper-server' });

export const rateLimitWindowUnits = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
} as const;

export function logRequest(req: Request, res: Response, next: NextFunction): void {
    const startTime = process.hrtime.bigint();

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
        const contentLength = res.getHeader('content-length');
        const size = typeof contentLength === 'number'
            ? String(contentLength)
            : (typeof contentLength === 'string' ? contentLength : '-');
        const msg = `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(3)} ms - ${size}`;

        if (res.statusCode >= 500) {
            log.error(msg);
        }
        else if (res.statusCode >= 400) {
            log.warn(msg);
        }
        else {
            log.info(msg);
        }
    });

    next();
}

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

    return skipPaths.some((skipPath: string) =>
        pathOnly === skipPath || pathOnly.startsWith(`${skipPath}/`));
}

export async function isGatekeeperReady(
    serverReady: boolean,
    db: Pick<GatekeeperDb, 'isReady'>
): Promise<boolean> {
    if (!serverReady) {
        return false;
    }

    try {
        return await db.isReady();
    }
    catch {
        return false;
    }
}

export function parseOptionalString(value: unknown, fieldName: string): string | null | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    if (typeof value !== 'string') {
        throw new Error(`${fieldName} must be a string or null`);
    }

    return value;
}

export function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    const parsed = typeof value === 'number'
        ? value
        : (typeof value === 'string' ? Number.parseInt(value, 10) : NaN);

    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${fieldName} must be a positive integer`);
    }

    return parsed;
}

export function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    if (value === 'true') {
        return true;
    }

    if (value === 'false') {
        return false;
    }

    throw new Error(`${fieldName} must be a boolean`);
}

export function parseIndexExportRequest(body: unknown): IndexExportRequest {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('request body must be an object');
    }

    const raw = body as Record<string, unknown>;
    const mode = raw.mode;

    if (mode === 'snapshot') {
        const cursor = parseOptionalString(raw.cursor, 'cursor');
        const checkpointCursor = parseOptionalString(raw.checkpointCursor, 'checkpointCursor');

        if (cursor && !checkpointCursor) {
            throw new Error('checkpointCursor is required when continuing a snapshot');
        }

        if (!cursor && checkpointCursor) {
            throw new Error('checkpointCursor is only valid when continuing a snapshot');
        }

        return {
            mode,
            cursor,
            checkpointCursor,
            limit: parseOptionalPositiveInteger(raw.limit, 'limit'),
        };
    }

    if (mode === 'changes') {
        return {
            mode,
            cursor: parseOptionalString(raw.cursor, 'cursor'),
            limit: parseOptionalPositiveInteger(raw.limit, 'limit'),
            includeOperations: parseOptionalBoolean(raw.includeOperations, 'includeOperations'),
        };
    }

    throw new Error('mode must be "snapshot" or "changes"');
}

export function formatDuration(seconds: number): string {
    const secPerMin = 60;
    const secPerHour = secPerMin * 60;
    const secPerDay = secPerHour * 24;

    const days = Math.floor(seconds / secPerDay);
    seconds %= secPerDay;

    const hours = Math.floor(seconds / secPerHour);
    seconds %= secPerHour;

    const minutes = Math.floor(seconds / secPerMin);
    seconds %= secPerMin;

    let duration = "";

    if (days > 0) {
        if (days > 1) {
            duration += `${days} days, `;
        } else {
            duration += `1 day, `;
        }
    }

    if (hours > 0) {
        if (hours > 1) {
            duration += `${hours} hours, `;
        } else {
            duration += `1 hour, `;
        }
    }

    if (minutes > 0) {
        if (minutes > 1) {
            duration += `${minutes} minutes, `;
        } else {
            duration += `1 minute, `;
        }
    }

    if (seconds === 1) {
        duration += `1 second`;
    } else {
        duration += `${seconds} seconds`;
    }

    return duration;
}

export function formatBytes(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Byte';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}
