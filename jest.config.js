const config = {
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                useESM: true
            }
        ]
    },
    extensionsToTreatAsEsm: ['.ts'],
    testEnvironment: 'node',
    moduleFileExtensions: ['ts', 'js', 'mjs'],
    moduleNameMapper: {
        "^@mdip/(.*)$": "<rootDir>/packages/$1/dist/$1.js"
    },
    testPathIgnorePatterns: [
        "/node_modules/",
        "/kc-app/",
        "/client/"
    ],
};

export default config;
