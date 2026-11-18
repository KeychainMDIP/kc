import { jest } from '@jest/globals';

const createMockLogger = (options?: unknown): any => {
    const logger: any = {
        options,
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
    };
    logger.child = jest.fn(() => createMockLogger());
    return logger;
};

const pinoMock = Object.assign(
    jest.fn((options?: unknown, _stream?: unknown) => createMockLogger(options)),
    { stdSerializers: jest.requireActual<typeof import('pino')>('pino/pino.js').stdSerializers },
);

export default pinoMock;
