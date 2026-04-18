import { jest } from '@jest/globals';

function makeLogger(options?: unknown) {
    return {
        options,
        child: jest.fn((bindings?: unknown) => makeLogger(bindings)),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
    };
}

const pinoMock = jest.fn((options?: unknown) => makeLogger(options));

export default pinoMock;
