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

export class InvalidDIDError extends Error {
    constructor(did) {
        super(`${INVALID_DID}: ${did}`);
        this.type = INVALID_DID;
        this.did = did;
    }
}

export class InvalidParameterError extends Error {
    constructor(parameter, value) {
        const message = value ? `${INVALID_PARAMETER}: ${parameter}=${value}` : `${INVALID_PARAMETER}: ${parameter}`;
        super(message);
        this.type = INVALID_PARAMETER;
        this.parameter = parameter;
        this.value = value;
    }
}

export class InvalidOptionError extends Error {
    constructor(option, value) {
        const message = value ? `${INVALID_OPTION}: ${option}=${value}` : `${INVALID_OPTION}: ${option}`;
        super(message);
        this.type = INVALID_OPTION;
        this.option = option;
        this.value = value;
    }
}

export class ExpectedExceptionError extends Error {
    constructor() {
        super(EXPECTED_EXCEPTION);
    }
}
