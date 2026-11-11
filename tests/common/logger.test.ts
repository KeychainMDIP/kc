import { jest } from '@jest/globals';
import { AxiosError } from 'axios';
import pinoMock from './pino.mock.ts';

const realPinoPretty = jest.requireActual<typeof import('pino-pretty')>('pino-pretty');
const pinoPrettyMock = jest.fn(realPinoPretty);
jest.unstable_mockModule('pino-pretty', () => ({ default: pinoPrettyMock }));
const loggerMod = await import('../../packages/common/src/logger.ts');

let originalLogger: any;

beforeAll(() => {
    originalLogger = loggerMod.logger;
});

beforeEach(() => {
    pinoMock.mockClear();
    pinoPrettyMock.mockClear();
});

afterEach(() => {
    loggerMod.setLogger(originalLogger);
});

describe('logger', () => {
    it('createConsoleLogger uses explicit methods and fallback to log', () => {
        const info = jest.fn();
        const warn = jest.fn();
        const log = jest.fn();

        const logger = loggerMod.createConsoleLogger({ info, warn, log });

        logger.info('info');
        logger.warn('warn');
        logger.debug('debug');

        expect(info).toHaveBeenCalledWith('info');
        expect(warn).toHaveBeenCalledWith('warn');
        expect(log).toHaveBeenCalledWith('debug');
    });

    it('createConsoleLogger no-ops when methods are missing', () => {
        const logger = loggerMod.createConsoleLogger({});
        expect(() => logger.info('noop')).not.toThrow();
        expect(() => logger.warn('noop')).not.toThrow();
        expect(() => logger.error('noop')).not.toThrow();
        expect(() => logger.debug('noop')).not.toThrow();
    });

    it('getLogLevel normalizes values and applies defaults', () => {
        expect(loggerMod.getLogLevel({ KC_LOG_LEVEL: undefined })).toBe('info');
        expect(loggerMod.getLogLevel({ KC_LOG_LEVEL: 'warning' })).toBe('warn');
        expect(loggerMod.getLogLevel({ KC_LOG_LEVEL: 'DEBUG' })).toBe('debug');
        expect(loggerMod.getLogLevel({ KC_LOG_LEVEL: 'nope' })).toBe('info');
        expect(loggerMod.getLogLevel()).toBe('info');
    });

    it('getLogLevel falls back cleanly when process.env is unavailable', () => {
        const originalProcess = (globalThis as any).process;

        try {
            (globalThis as any).process = undefined;
            expect(loggerMod.getLogLevel()).toBe('info');
        } finally {
            (globalThis as any).process = originalProcess;
        }
    });

    it('getPrettyEnabled returns the default pretty flag', () => {
        expect(loggerMod.getPrettyEnabled()).toBe(true);
    });

    it('createLogger uses env level and pretty stream defaults', () => {
        loggerMod.createLogger({}, { KC_LOG_LEVEL: 'error' });
        const call = pinoMock.mock.calls.at(-1);
        expect(call).toBeTruthy();
        const options = call?.[0] as any;
        expect(options.level).toBe('error');
        expect(call?.[1]).toBeTruthy();
    });

    it('createLogger uses explicit level over env', () => {
        loggerMod.createLogger({ level: 'debug' }, { KC_LOG_LEVEL: 'error' });
        const call = pinoMock.mock.calls.at(-1);
        const options = call?.[0] as any;
        expect(options.level).toBe('debug');
    });

    it('serializes error messages, stacks, causes and database error codes', () => {
        loggerMod.createLogger();
        const options = pinoMock.mock.calls.at(-1)?.[0] as any;
        const cause = new Error('connection closed');
        const error = Object.assign(new Error('database failure', { cause }), { code: '08006' });
        const serialized = JSON.parse(JSON.stringify(options.serializers.error(error)));

        expect(serialized).toMatchObject({
            type: 'Error',
            message: 'database failure: connection closed',
            stack: expect.stringContaining(error.stack!),
            code: '08006',
        });
        expect(serialized.stack).toContain(cause.stack);
        expect(options.serializers.error('plain error')).toBe('plain error');
    });

    it('preserves caller-supplied serializers', () => {
        const serializers = { error: jest.fn(), custom: jest.fn() };
        loggerMod.createLogger({ serializers });
        const options = pinoMock.mock.calls.at(-1)?.[0] as any;

        expect(options.serializers.error).toBe(serializers.error);
        expect(options.serializers.custom).toBe(serializers.custom);
    });

    it('does not copy private HTTP request or response data into error logs', () => {
        loggerMod.createLogger();
        const options = pinoMock.mock.calls.at(-1)?.[0] as any;
        const error = new AxiosError('request failed', 'ECONNRESET');
        Object.assign(error, {
            config: { headers: { Authorization: 'Bearer secret-token' }, data: 'private request' },
            request: { body: 'private request' },
            response: { data: 'private response' },
        });

        const serialized = JSON.parse(JSON.stringify(options.serializers.error(error)));
        expect(serialized).toEqual({
            type: 'AxiosError', message: 'request failed', stack: error.stack, code: 'ECONNRESET',
        });
    });

    it('logs frozen errors and causes without mutating them', () => {
        loggerMod.createLogger();
        const options = pinoMock.mock.calls.at(-1)?.[0] as any;
        const cause = Object.freeze(new Error('immutable cause'));
        const error = Object.freeze(new Error('immutable failure', { cause }));

        expect(options.serializers.error(error)).toMatchObject({
            type: 'Error', message: 'immutable failure: immutable cause',
            stack: expect.stringContaining(cause.stack!),
        });
        expect(Object.getOwnPropertySymbols(error)).toHaveLength(0);
        expect(Object.getOwnPropertySymbols(cause)).toHaveLength(0);
    });

    it('preserves the receiver of function-style error causes', () => {
        loggerMod.createLogger();
        const options = pinoMock.mock.calls.at(-1)?.[0] as any;
        const error = Object.assign(new Error('legacy cause'), {
            originalCause: new Error('underlying error'),
            cause() { return this.originalCause; },
        });

        expect(options.serializers.error(error).stack).toContain(error.originalCause.stack);
    });

    it('retains Pino default err serialization', () => {
        loggerMod.createLogger();
        const options = pinoMock.mock.calls.at(-1)?.[0] as any;
        const realPino = jest.requireActual<typeof import('pino')>('pino/pino.js');
        const lines: string[] = [];
        const log = realPino(options, { write(line: string) { lines.push(line); } });

        log.error({ err: new Error('existing err field') });

        expect(JSON.parse(lines[0]).err).toMatchObject({
            type: 'Error', message: 'existing err field', stack: expect.any(String),
        });
    });

    it('keeps the error and event context on one physical log line', () => {
        loggerMod.createLogger();
        const options = pinoMock.mock.calls.at(-1)?.[0] as any;
        const prettyOptions = pinoPrettyMock.mock.calls.at(-1)![0]!;
        const format = realPinoPretty.prettyFactory(prettyOptions);
        const error = new Error('database failure');
        const line = format({
            level: 50, time: 0, msg: 'processEvents error',
            did: 'did:test:example', error: options.serializers.error(error),
        });

        expect(line.trim().split('\n')).toHaveLength(1);
        expect(line).toContain('database failure');
        expect(line).toContain('did:test:example');
        expect(line).toContain('"stack":');
        expect(prettyOptions.errorLikeObjectKeys).toEqual(['err']);
    });

    it('createLogger respects explicit transport and accepts falsy transport', () => {
        const customTransport = { target: 'pino-pretty', options: { singleLine: false } };
        loggerMod.createLogger({ transport: customTransport }, { KC_LOG_LEVEL: 'info' });
        let call = pinoMock.mock.calls.at(-1);
        let options = call?.[0] as any;
        expect(options.transport).toBe(customTransport);
        expect(call?.[1]).toBeUndefined();

        loggerMod.createLogger({ transport: false as any }, { KC_LOG_LEVEL: 'info' });
        call = pinoMock.mock.calls.at(-1);
        options = call?.[0] as any;
        expect(options.transport).toBe(false);
        expect(call?.[1]).toBeUndefined();
    });

    it('setLogger and childLogger delegate to the current logger', () => {
        // Exercise default logger child to cover the pino mock child factory.
        loggerMod.childLogger({ service: 'default' });

        const child = jest.fn(() => ({ child: jest.fn() }));
        const fakeLogger = {
            child,
            error: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            debug: jest.fn(),
        };

        loggerMod.setLogger(fakeLogger as any);
        loggerMod.childLogger({ service: 'test' });
        expect(child).toHaveBeenCalledWith({ service: 'test' }, undefined);
    });

    it('asError handles errors, strings, and non-serializable objects', () => {
        const err = new Error('boom');
        expect(loggerMod.asError(err)).toBe(err);
        expect(loggerMod.asError('oops').message).toBe('oops');

        const circular: any = { a: 1 };
        circular.self = circular;
        const fromCircular = loggerMod.asError(circular);
        expect(fromCircular.message).toBe('[object Object]');
    });

    it('logError logs the error object and message', () => {
        const error = new Error('fail');
        const log = { error: jest.fn() } as any;
        loggerMod.logError(error, undefined, log);
        expect(log.error).toHaveBeenCalledWith({ err: error }, 'fail');

        loggerMod.logError(error, 'boom', log);
        expect(log.error).toHaveBeenCalledWith({ err: error }, 'boom');

        const defaultLog = { error: jest.fn() } as any;
        loggerMod.setLogger(defaultLog);
        loggerMod.logError(error);
        expect(defaultLog.error).toHaveBeenCalledWith({ err: error }, 'fail');
    });
});
