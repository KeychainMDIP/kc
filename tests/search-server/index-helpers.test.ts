import { BlockList } from 'node:net';
import { jest } from '@jest/globals';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import { INDEX_SYNC_STATE_KEYS } from '../../services/search-server/src/DidIndexer.ts';
import {
    createWhitelistBlockList,
    detectIpFamily,
    getSearchStatus,
    isRateLimitWhitelistedRequest,
    normalizeIp,
    parseNonNegativeInteger,
    parseOptionalBoolean,
    parseOptionalPositiveInteger,
    rateLimitWindowUnits,
    shouldSkipRateLimitPath,
} from '../../services/search-server/src/index-helpers.ts';

/* eslint-disable sonarjs/no-hardcoded-ip */

describe('Search Server request helpers', () => {
    it('normalizes loopback, mapped IPv4 and zone-qualified IPv6 addresses', () => {
        expect(normalizeIp('::1')).toBe('127.0.0.1');
        expect(normalizeIp('::ffff:192.0.2.10')).toBe('192.0.2.10');
        expect(normalizeIp('fe80::1%eth0')).toBe('fe80::1');
        expect(detectIpFamily('192.0.2.10')).toBe('ipv4');
        expect(detectIpFamily('2001:db8::1')).toBe('ipv6');
        expect(detectIpFamily('invalid')).toBeNull();
        expect(rateLimitWindowUnits).toEqual({ second: 1000, minute: 60_000, hour: 3_600_000 });
    });

    it('whitelists valid addresses and subnets while ignoring malformed entries', () => {
        const whitelist = createWhitelistBlockList([
            '127.0.0.1', '192.0.2.0/24', '2001:db8::/32',
            'invalid', '198.51.100.0/bad', '198.51.100.0/99',
        ]);
        expect(isRateLimitWhitelistedRequest({ ip: '::1', socket: {} } as never, whitelist)).toBe(true);
        expect(isRateLimitWhitelistedRequest({ ip: '', socket: { remoteAddress: '::ffff:192.0.2.10' } } as never, whitelist)).toBe(true);
        expect(isRateLimitWhitelistedRequest({ socket: { remoteAddress: '2001:db8::1' } } as never, whitelist)).toBe(true);
        expect(isRateLimitWhitelistedRequest({ ip: '198.51.100.1', socket: { remoteAddress: 'invalid' } } as never, whitelist)).toBe(false);
        expect(isRateLimitWhitelistedRequest({ socket: {} } as never, whitelist)).toBe(false);
    });

    it('continues building a whitelist if the native address insertion fails', () => {
        const insertion = jest.spyOn(BlockList.prototype, 'addAddress').mockImplementationOnce(() => {
            throw new Error('native insertion failed');
        });
        try {
            const whitelist = createWhitelistBlockList(['192.0.2.1', '192.0.2.2']);
            expect(whitelist.check('192.0.2.1')).toBe(false);
            expect(whitelist.check('192.0.2.2')).toBe(true);
        }
        finally {
            insertion.mockRestore();
        }
    });

    it('skips exact paths and descendants, not similarly named paths', () => {
        const skip = ['/api/v1/status'];
        expect(shouldSkipRateLimitPath({ originalUrl: '/api/v1/status?detail=true' } as never, skip)).toBe(true);
        expect(shouldSkipRateLimitPath({ originalUrl: '/api/v1/status/live' } as never, skip)).toBe(true);
        expect(shouldSkipRateLimitPath({ originalUrl: '/api/v1/status-other' } as never, skip)).toBe(false);
    });

    it('parses existing optional query values and applies their documented defaults', () => {
        expect(parseNonNegativeInteger('12', 50)).toBe(12);
        expect(parseNonNegativeInteger('0', 50)).toBe(0);
        for (const value of [undefined, '-1', 'bad']) {
            expect(parseNonNegativeInteger(value, 50)).toBe(50);
        }
        expect(parseOptionalBoolean(' TRUE ')).toBe(true);
        expect(parseOptionalBoolean(' false ')).toBe(false);
        expect(parseOptionalBoolean('bad')).toBeUndefined();
        expect(parseOptionalBoolean(undefined)).toBeUndefined();
        expect(parseOptionalPositiveInteger(undefined, 'versionSequence')).toBeUndefined();
        expect(parseOptionalPositiveInteger('3', 'versionSequence')).toBe(3);
        for (const value of ['0', '-1', 'bad']) {
            expect(() => parseOptionalPositiveInteger(value, 'versionSequence'))
                .toThrow('versionSequence must be a positive integer');
        }
    });

    it('reports empty and populated synchronization state without modifying it', async () => {
        const db = new DIDsDbMemory();
        expect(await getSearchStatus(db, 'memory')).toEqual({
            ready: true,
            db: 'memory',
            sync: {
                snapshotComplete: false,
                snapshotCursor: null,
                snapshotCheckpointCursor: null,
                changesCursor: null,
                lastSyncStartedAt: null,
                lastSyncCompletedAt: null,
                lastSyncError: null,
                lastSyncMode: null,
                lastPagesProcessed: 0,
                lastDidsChanged: 0,
                lastBlocksStored: 0,
            },
            metrics: { lastRebuiltAt: null, lastError: null },
        });
        const state = {
            snapshotComplete: 'true', snapshotCursor: 'page', snapshotCheckpointCursor: '42', changesCursor: '43',
            lastSyncStartedAt: '2026-09-18T10:00:00Z', lastSyncCompletedAt: '2026-09-18T10:00:01Z',
            lastSyncError: 'retry later', lastSyncMode: 'changes', lastPagesProcessed: '2', lastDidsChanged: '3',
            lastBlocksStored: '4', metricsLastRebuiltAt: '2026-09-18T10:00:02Z', metricsLastError: 'metrics error',
        };
        for (const [name, value] of Object.entries(state)) {
            await db.saveSyncState(INDEX_SYNC_STATE_KEYS[name as keyof typeof state], value);
        }
        const { metricsLastRebuiltAt, metricsLastError, ...sync } = state;
        expect(await getSearchStatus(db, 'memory')).toEqual({
            ready: true,
            db: 'memory',
            sync: { ...sync, snapshotComplete: true, lastPagesProcessed: 2, lastDidsChanged: 3, lastBlocksStored: 4 },
            metrics: { lastRebuiltAt: metricsLastRebuiltAt, lastError: metricsLastError },
        });
        expect(await db.loadSyncState(INDEX_SYNC_STATE_KEYS.changesCursor)).toBe('43');
    });

    it('propagates status storage failures rather than reporting success', async () => {
        const db = new DIDsDbMemory();
        jest.spyOn(db, 'loadSyncState').mockRejectedValue(new Error('database unavailable'));
        await expect(getSearchStatus(db, 'memory')).rejects.toThrow('database unavailable');
    });
});
