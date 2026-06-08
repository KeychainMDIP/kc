import { EventEmitter } from 'events';
import { BlockList } from 'net';
import { jest } from '@jest/globals';

/* eslint-disable sonarjs/no-hardcoded-ip */

const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

jest.unstable_mockModule('@mdip/common/logger', () => ({
    childLogger: jest.fn(() => mockLogger),
}));

let helpers: typeof import('../../services/gatekeeper/server/src/helpers.ts');

beforeAll(async () => {
    helpers = await import('../../services/gatekeeper/server/src/helpers.ts');
});

beforeEach(() => {
    jest.clearAllMocks();
});

function createResponse(statusCode: number, contentLength?: number | string): EventEmitter & {
    statusCode: number;
    getHeader: jest.Mock;
} {
    const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        getHeader: jest.Mock;
    };

    response.statusCode = statusCode;
    response.getHeader = jest.fn(() => contentLength);

    return response;
}

describe('gatekeeper server helpers', () => {
    it('logs successful, client error, and server error requests', () => {
        const req = { method: 'GET', originalUrl: '/ready' };
        const next = jest.fn();
        const ok = createResponse(200, 42);
        const missing = createResponse(404, '19');
        const failed = createResponse(500);

        helpers.logRequest(req as never, ok as never, next);
        helpers.logRequest(req as never, missing as never, next);
        helpers.logRequest(req as never, failed as never, next);

        ok.emit('finish');
        missing.emit('finish');
        failed.emit('finish');

        expect(next).toHaveBeenCalledTimes(3);
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('GET /ready 200'));
        expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining(' - 42'));
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('GET /ready 404'));
        expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining(' - 19'));
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('GET /ready 500'));
        expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining(' - -'));
    });

    it('normalizes and classifies IP addresses', () => {
        expect(helpers.normalizeIp('::1')).toBe('127.0.0.1');
        expect(helpers.normalizeIp('::ffff:192.168.1.10')).toBe('192.168.1.10');
        expect(helpers.normalizeIp('fe80::1%eth0')).toBe('fe80::1');
        expect(helpers.detectIpFamily('127.0.0.1')).toBe('ipv4');
        expect(helpers.detectIpFamily('2001:db8::1')).toBe('ipv6');
        expect(helpers.detectIpFamily('not-an-ip')).toBeNull();
    });

    it('builds a whitelist block list and checks request candidates', () => {
        const blockList = helpers.createWhitelistBlockList([
            '127.0.0.1',
            '192.168.0.0/16',
            '2001:db8::/32',
            'not-an-ip',
            '10.0.0.0/not-a-prefix',
            '10.0.0.0/99',
        ]);

        expect(helpers.isRateLimitWhitelistedRequest({
            ip: '127.0.0.1',
            socket: {},
        } as never, blockList)).toBe(true);
        expect(helpers.isRateLimitWhitelistedRequest({
            ip: '',
            socket: { remoteAddress: '::ffff:192.168.1.10' },
        } as never, blockList)).toBe(true);
        expect(helpers.isRateLimitWhitelistedRequest({
            socket: { remoteAddress: '2001:db8::1' },
        } as never, blockList)).toBe(true);
        expect(helpers.isRateLimitWhitelistedRequest({
            ip: '203.0.113.10',
            socket: { remoteAddress: 'not-an-ip' },
        } as never, blockList)).toBe(false);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "Ignoring invalid rate limit whitelist entry: 'not-an-ip'"
        );
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "Ignoring invalid rate limit CIDR entry: '10.0.0.0/not-a-prefix'"
        );
        expect(mockLogger.warn).toHaveBeenCalledWith(
            "Ignoring invalid rate limit CIDR entry: '10.0.0.0/99'"
        );
    });

    it('ignores whitelist addresses rejected by the native block list', () => {
        const addAddress = jest.spyOn(BlockList.prototype, 'addAddress')
            .mockImplementationOnce(() => {
                throw new Error('native rejection');
            });

        try {
            helpers.createWhitelistBlockList(['127.0.0.1']);
        }
        finally {
            addAddress.mockRestore();
        }

        expect(mockLogger.warn).toHaveBeenCalledWith(
            "Ignoring invalid rate limit whitelist entry: '127.0.0.1'"
        );
    });

    it('matches exact and nested rate-limit skip paths without query strings', () => {
        expect(helpers.shouldSkipRateLimitPath({
            originalUrl: '/api/v1/ready?verbose=true',
        } as never, ['/api/v1/ready'])).toBe(true);
        expect(helpers.shouldSkipRateLimitPath({
            originalUrl: '/api/v1/status/live',
        } as never, ['/api/v1/status'])).toBe(true);
        expect(helpers.shouldSkipRateLimitPath({
            originalUrl: '/api/v1/status-live',
        } as never, ['/api/v1/status'])).toBe(false);
    });

    it('checks database liveness before reporting ready', async () => {
        const db = {
            isReady: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
        };

        await expect(helpers.isGatekeeperReady(false, db)).resolves.toBe(false);
        expect(db.isReady).not.toHaveBeenCalled();

        await expect(helpers.isGatekeeperReady(true, db)).resolves.toBe(true);
        expect(db.isReady).toHaveBeenCalledTimes(1);

        db.isReady.mockResolvedValue(false);
        await expect(helpers.isGatekeeperReady(true, db)).resolves.toBe(false);

        db.isReady.mockRejectedValue(new Error('db down'));
        await expect(helpers.isGatekeeperReady(true, db)).resolves.toBe(false);
    });

    it('parses optional strings and positive integers', () => {
        expect(helpers.parseOptionalString(undefined, 'cursor')).toBeUndefined();
        expect(helpers.parseOptionalString(null, 'cursor')).toBeNull();
        expect(helpers.parseOptionalString('abc', 'cursor')).toBe('abc');
        expect(() => helpers.parseOptionalString(1, 'cursor')).toThrow('cursor must be a string or null');

        expect(helpers.parseOptionalPositiveInteger(undefined, 'limit')).toBeUndefined();
        expect(helpers.parseOptionalPositiveInteger(null, 'limit')).toBeUndefined();
        expect(helpers.parseOptionalPositiveInteger(25, 'limit')).toBe(25);
        expect(helpers.parseOptionalPositiveInteger('30', 'limit')).toBe(30);
        expect(() => helpers.parseOptionalPositiveInteger(0, 'limit'))
            .toThrow('limit must be a positive integer');
        expect(() => helpers.parseOptionalPositiveInteger(1.5, 'limit'))
            .toThrow('limit must be a positive integer');
        expect(() => helpers.parseOptionalPositiveInteger({}, 'limit'))
            .toThrow('limit must be a positive integer');
    });

    it('parses optional booleans', () => {
        expect(helpers.parseOptionalBoolean(undefined, 'includeOperations')).toBeUndefined();
        expect(helpers.parseOptionalBoolean(null, 'includeOperations')).toBeUndefined();
        expect(helpers.parseOptionalBoolean(true, 'includeOperations')).toBe(true);
        expect(helpers.parseOptionalBoolean(false, 'includeOperations')).toBe(false);
        expect(helpers.parseOptionalBoolean('true', 'includeOperations')).toBe(true);
        expect(helpers.parseOptionalBoolean('false', 'includeOperations')).toBe(false);
        expect(() => helpers.parseOptionalBoolean('yes', 'includeOperations'))
            .toThrow('includeOperations must be a boolean');
    });

    it('parses and rejects index export request shapes', () => {
        expect(helpers.parseIndexExportRequest({
            mode: 'snapshot',
            limit: '10',
        })).toStrictEqual({
            mode: 'snapshot',
            cursor: undefined,
            checkpointCursor: undefined,
            limit: 10,
        });
        expect(helpers.parseIndexExportRequest({
            mode: 'changes',
            cursor: null,
            limit: 2,
            includeOperations: true,
        })).toStrictEqual({
            mode: 'changes',
            cursor: null,
            limit: 2,
            includeOperations: true,
        });
        expect(() => helpers.parseIndexExportRequest(null)).toThrow('request body must be an object');
        expect(() => helpers.parseIndexExportRequest([])).toThrow('request body must be an object');
        expect(() => helpers.parseIndexExportRequest({ mode: 'other' }))
            .toThrow('mode must be "snapshot" or "changes"');
        expect(() => helpers.parseIndexExportRequest({ mode: 'changes', cursor: 12 }))
            .toThrow('cursor must be a string or null');
        expect(() => helpers.parseIndexExportRequest({ mode: 'changes', includeOperations: 'yes' }))
            .toThrow('includeOperations must be a boolean');
        expect(() => helpers.parseIndexExportRequest({ mode: 'snapshot', limit: -1 }))
            .toThrow('limit must be a positive integer');
    });

    it('formats durations and byte counts', () => {
        expect(helpers.formatDuration(0)).toBe('0 seconds');
        expect(helpers.formatDuration(1)).toBe('1 second');
        expect(helpers.formatDuration(61)).toBe('1 minute, 1 second');
        expect(helpers.formatDuration(3661)).toBe('1 hour, 1 minute, 1 second');
        expect(helpers.formatDuration(90061)).toBe('1 day, 1 hour, 1 minute, 1 second');
        expect(helpers.formatDuration(180122)).toBe('2 days, 2 hours, 2 minutes, 2 seconds');

        expect(helpers.formatBytes(0)).toBe('0 Byte');
        expect(helpers.formatBytes(1024)).toBe('1.00 KB');
        expect(helpers.formatBytes(1024 * 1024)).toBe('1.00 MB');
    });
});
