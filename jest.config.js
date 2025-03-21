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
        '^@mdip/cipher$': '<rootDir>/packages/cipher/src/cipher.ts',
        '^@mdip/gatekeeper$': '<rootDir>/packages/gatekeeper/src/gatekeeper.ts',
        '^@mdip/gatekeeper/types$': '<rootDir>/packages/gatekeeper/src/types.ts',
        '^@mdip/gatekeeper/client$': '<rootDir>/packages/gatekeeper/src/gatekeeper-client.ts',
        '^@mdip/gatekeeper/db/(.*)$': '<rootDir>/packages/gatekeeper/src/db/$1',
        '^@mdip/ipfs$': '<rootDir>/packages/ipfs/src/ipfs.ts',
        '^@mdip/keymaster$': '<rootDir>/packages/keymaster/src/keymaster-lib.js',
        '^@mdip/keymaster/wallet/(.*)$': '<rootDir>/packages/keymaster/src/db/$1',
        '^\\./typeGuards\\.js$': '<rootDir>/packages/keymaster/src/db/typeGuards.ts',
    },
    testPathIgnorePatterns: [
        "/node_modules/",
        "/kc-app/",
        "/client/"
    ],
};

export default config;
