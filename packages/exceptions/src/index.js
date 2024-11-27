export const UNKNOWN_ID = 'Unknown ID';
export const NO_CURRENT_ID = 'No current ID';
export const INVALID_PARAMETER = 'Invalid parameter';
export const UPDATE_FAILED = 'Update failed';

export class InvalidDIDError extends Error {
    static message = 'Invalid DID';

    constructor() {
        super(InvalidDIDError.message);
    }
}

export class InvalidParameterError extends Error {
    static message = 'Invalid parameter';

    constructor(detail) {
        super(`${InvalidParameterError.message}: ${detail}`);
    }
}

export class InvalidOperationError extends Error {
    static message = 'Invalid operation';

    constructor(detail) {
        super(`${InvalidOperationError.message}: ${detail}`);
    }
}

// For unit tests
export class ExpectedExceptionError extends Error {
    static message = 'Expected to throw an exception';

    constructor() {
        super(ExpectedExceptionError.message);
    }
}
