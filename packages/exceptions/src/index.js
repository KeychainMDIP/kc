export const UNKNOWN_ID = 'Unknown ID';
export const NO_CURRENT_ID = 'No current ID';
export const INVALID_PARAMETER = 'Invalid parameter';
export const UPDATE_FAILED = 'Update failed';

export class InvalidDIDError extends Error {
    static message = 'Invalid DID';

    constructor(detail) {
        const message = detail ? `${InvalidDIDError.message}: ${detail}` : InvalidDIDError.message;
        super(message);
    }
}

export class InvalidParameterError extends Error {
    static message = 'Invalid parameter';

    constructor(detail) {
        const message = detail ? `${InvalidParameterError.message}: ${detail}` : InvalidParameterError.message;
        super(message);
    }
}

export class InvalidOperationError extends Error {
    static message = 'Invalid operation';

    constructor(detail) {
        const message = detail ? `${InvalidOperationError.message}: ${detail}` : InvalidOperationError.message;
        super(message);
    }
}

// For unit tests
export class ExpectedExceptionError extends Error {
    static message = 'Expected to throw an exception';

    constructor() {
        super(ExpectedExceptionError.message);
    }
}
