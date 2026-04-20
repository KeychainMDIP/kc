import { jest } from '@jest/globals';

const pinoMock = jest.fn((options?: unknown) => ({
    options,
    child: jest.fn(() => ({ child: jest.fn() })),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
}));

export default pinoMock;
