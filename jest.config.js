const config = {
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                useESM: true,
                tsconfig: './tsconfig.json',
            }
        ]
    },
    extensionsToTreatAsEsm: ['.ts'],
    testEnvironment: 'node',
    moduleFileExtensions: ['ts', 'js', 'mjs'],
    moduleNameMapper: {
        '^@mdip/cipher/node$': '<rootDir>/packages/cipher/src/cipher-node.ts',
        '^@mdip/cipher/types': '<rootDir>/packages/cipher/src/types.ts',
        '^@mdip/common/errors$': '<rootDir>/packages/common/src/errors.ts',
        '^@mdip/common/utils$': '<rootDir>/packages/common/src/utils.ts',
        '^@mdip/common/logger': '<rootDir>/packages/common/src/logger.ts',
        '^@mdip/gatekeeper$': '<rootDir>/packages/gatekeeper/src/gatekeeper.ts',
        '^@mdip/gatekeeper/types$': '<rootDir>/packages/gatekeeper/src/types.ts',
        '^@mdip/gatekeeper/client$': '<rootDir>/packages/gatekeeper/src/gatekeeper-client.ts',
        '^@mdip/gatekeeper/db/(.*)$': '<rootDir>/packages/gatekeeper/src/db/$1',
        '^@mdip/ipfs/helia$': '<rootDir>/packages/ipfs/src/helia-client.ts',
        '^@mdip/ipfs/utils$': '<rootDir>/packages/ipfs/src/utils.ts',
        '^@mdip/keymaster/search$': '<rootDir>/packages/keymaster/src/search-client.ts',
        '^@mdip/keymaster$': '<rootDir>/packages/keymaster/src/keymaster.ts',
        '^@mdip/keymaster/client$': '<rootDir>/packages/keymaster/src/keymaster-client.ts',
        '^@mdip/keymaster/wallet/(.*)$': '<rootDir>/packages/keymaster/src/db/$1',
        '^@mdip/keymaster/encryption': '<rootDir>/packages/keymaster/src/encryption.ts',
        '^@mdip/inscription': '<rootDir>/packages/inscription/src/inscription.ts',
        '^pino$': '<rootDir>/tests/common/pino.mock.ts',
        '^\\.\\/typeGuards\\.js$': '<rootDir>/packages/keymaster/src/db/typeGuards.ts',
        '^\\.\\/db\\/typeGuards\\.js$': '<rootDir>/packages/keymaster/src/db/typeGuards.ts',
        '^\\.\\/abstract-json\\.js$': '<rootDir>/packages/gatekeeper/src/db/abstract-json.ts',
        '^\\.\\/cipher-base\\.js$': '<rootDir>/packages/cipher/src/cipher-base.ts',
        '^\\.\\/abstract-base\\.js$': '<rootDir>/packages/keymaster/src/db/abstract-base.ts',
        '^\\.\\/encryption\\.js$': '<rootDir>/packages/keymaster/src/encryption.ts',
    },
    testPathIgnorePatterns: [
        "/node_modules/",
        "/kc-app/",
        "/client/"
    ]
};

export default config;
