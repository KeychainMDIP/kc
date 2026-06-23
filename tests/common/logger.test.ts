import { jest } from '@jest/globals';
import pinoMock from './pino.mock.ts';
import * as loggerMod from '../../packages/common/src/logger.ts';

let originalLogger: any;

beforeAll(() => {
    originalLogger = loggerMod.logger;
});

beforeEach(() => {
    pinoMock.mockClear();
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

    it('getPrettyEnabled always returns true', () => {
        expect(loggerMod.getPrettyEnabled()).toBe(true);
    });

    it('createLogger uses env level and pretty transport defaults', () => {
        loggerMod.createLogger({}, { KC_LOG_LEVEL: 'error' });
        const call = pinoMock.mock.calls.at(-1);
        expect(call).toBeTruthy();
        const options = call?.[0] as any;
        expect(options.level).toBe('error');
        expect(options.transport?.target).toBe('pino-pretty');
        expect(options.transport?.options?.singleLine).toBe(true);
        expect(options.transport?.options?.ignore).toContain('service');
        expect(options.transport?.options?.colorize).toBe(false);
    });

    it('createLogger uses explicit level over env', () => {
        loggerMod.createLogger({ level: 'debug' }, { KC_LOG_LEVEL: 'error' });
        const call = pinoMock.mock.calls.at(-1);
        const options = call?.[0] as any;
        expect(options.level).toBe('debug');
    });

    it('createLogger respects explicit transport and accepts falsy transport', () => {
        const customTransport = { target: 'pino-pretty', options: { singleLine: false } };
        loggerMod.createLogger({ transport: customTransport }, { KC_LOG_LEVEL: 'info' });
        let options = pinoMock.mock.calls.at(-1)?.[0] as any;
        expect(options.transport).toBe(customTransport);

        loggerMod.createLogger({ transport: false as any }, { KC_LOG_LEVEL: 'info' });
        options = pinoMock.mock.calls.at(-1)?.[0] as any;
        expect(options.transport).toBe(false);
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
