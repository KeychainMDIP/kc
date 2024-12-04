export class MDIPError extends Error {
    constructor(type, detail) {
        const message = detail ? `${type}: ${detail}` : type;
        super(message);
        this.type = type;
        this.detail = detail;
    }
}

export class InvalidDIDError extends MDIPError {
    static type = 'Invalid DID';

    constructor(detail) {
        super(InvalidDIDError.type, detail);
    }
}

export class InvalidParameterError extends MDIPError {
    static type = 'Invalid parameter';

    constructor(detail) {
        super(InvalidParameterError.type, detail);
    }
}

export class InvalidOperationError extends MDIPError {
    static type = 'Invalid operation';

    constructor(detail) {
        super(InvalidOperationError.type, detail);
    }
}

export class KeymasterError extends MDIPError {
    static type = 'Keymaster';

    constructor(detail) {
        super(KeymasterError.type, detail);
    }
}

export class UnknownIDError extends MDIPError {
    static type = 'Unknown ID';

    constructor(detail) {
        super(UnknownIDError.type, detail);
    }
}

export class PassphraseError extends MDIPError {
    static type = 'Passphrase';

    constructor(detail) {
        super(PassphraseError.type, detail);
    }
}

// For unit tests
export class ExpectedExceptionError extends MDIPError {
    static type = 'Expected to throw an exception';

    constructor() {
        super(ExpectedExceptionError.type);
    }
}
