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

const pinoMock = jest.fn((options?: unknown) => createMockLogger(options));

export default pinoMock;
