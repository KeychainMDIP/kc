export class MDIPError extends Error {
    public type: string;
    public detail?: string;

    constructor(type: string, detail?: string) {
        const message = detail ? `${type}: ${detail}` : type;
        super(message);
        this.type = type;
        this.detail = detail;
    }
}

export class InvalidDIDError extends MDIPError {
    static readonly type = 'Invalid DID';

    constructor(detail?: string) {
        super(InvalidDIDError.type, detail);
    }
}

export class InvalidParameterError extends MDIPError {
    static readonly type = 'Invalid parameter';

    constructor(detail?: string) {
        super(InvalidParameterError.type, detail);
    }
}

export class InvalidOperationError extends MDIPError {
    static readonly type = 'Invalid operation';

    constructor(detail?: string) {
        super(InvalidOperationError.type, detail);
    }
}

export class KeymasterError extends MDIPError {
    static readonly type = 'Keymaster';

    constructor(detail?: string) {
        super(KeymasterError.type, detail);
    }
}

export class UnknownIDError extends MDIPError {
    static readonly type = 'Unknown ID';

    constructor(detail?: string) {
        super(UnknownIDError.type, detail);
    }
}

// For unit tests
export class ExpectedExceptionError extends MDIPError {
    static readonly type = 'Expected to throw an exception';

    constructor() {
        super(ExpectedExceptionError.type);
    }
}
