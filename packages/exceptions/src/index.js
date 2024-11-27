export const INVALID_DID = 'Invalid DID';
export const INVALID_OPERATION = 'Invalid operation';
export const INVALID_VERSION = 'Invalid version';
export const INVALID_TYPE = 'Invalid type';
export const INVALID_REGISTRY = 'Invalid registry';

export const UNKNOWN_ID = 'Unknown ID';
export const NO_CURRENT_ID = 'No current ID';
export const INVALID_PARAMETER = 'Invalid parameter';
export const INVALID_OPTION = 'Invalid option';
export const UPDATE_FAILED = 'Update failed';
export const EXPECTED_EXCEPTION = 'Expected to throw an exception';

export class InvalidParameterError extends Error {
    constructor(message) {
        super(`Invalid parameter: ${message}`);
    }
}

// For unit tests
export class ExpectedExceptionError extends Error {
    constructor() {
        super('Expected to throw an exception');
    }
}
