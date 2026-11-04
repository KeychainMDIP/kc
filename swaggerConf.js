import swaggerJsdoc from 'swagger-jsdoc';
import fs from 'fs';

const baseDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'Keymaster API',
        version: '2.2.0',
        description: 'Documentation for Keymaster API'
    },
};

const keymasterSchemas = {
    EncryptedMnemonic: {
        type: 'object',
        required: ['salt', 'iv', 'data'],
        properties: {
            salt: { type: 'string', description: 'Base64-encoded salt used for key derivation.' },
            iv: { type: 'string', description: 'Base64-encoded initialization vector for AES-GCM encryption.' },
            data: { type: 'string', description: 'Base64-encoded encrypted mnemonic.' },
        },
    },
    WalletId: {
        type: 'object',
        required: ['did', 'account', 'index'],
        properties: {
            did: { type: 'string' },
            account: { type: 'integer' },
            index: { type: 'integer' },
            held: { type: 'array', items: { type: 'string' } },
            owned: { type: 'array', items: { type: 'string' } },
            dmail: { type: 'object', additionalProperties: true },
            notices: { type: 'object', additionalProperties: true },
        },
        additionalProperties: true,
    },
    Wallet: {
        type: 'object',
        required: ['version', 'seed', 'counter', 'ids'],
        properties: {
            version: { type: 'integer', enum: [1] },
            seed: {
                type: 'object',
                required: ['mnemonicEnc'],
                properties: {
                    mnemonicEnc: { $ref: '#/components/schemas/EncryptedMnemonic' },
                },
            },
            counter: { type: 'integer' },
            ids: {
                type: 'object',
                additionalProperties: { $ref: '#/components/schemas/WalletId' },
            },
            current: { type: 'string' },
            names: { type: 'object', additionalProperties: { type: 'string' } },
        },
        additionalProperties: true,
    },
    EncryptedWallet: {
        type: 'object',
        required: ['version', 'seed', 'enc'],
        properties: {
            version: { type: 'integer', enum: [1] },
            seed: {
                type: 'object',
                required: ['mnemonicEnc'],
                properties: {
                    mnemonicEnc: { $ref: '#/components/schemas/EncryptedMnemonic' },
                },
            },
            enc: { type: 'string', description: 'Encrypted wallet data (IDs, names, etc.).' },
        },
    },
    LegacyWallet: {
        type: 'object',
        description: 'Legacy v0 wallet accepted for automatic migration to v1.',
        required: ['seed', 'counter', 'ids'],
        properties: {
            version: { type: 'integer', enum: [0] },
            seed: {
                type: 'object',
                required: ['mnemonic', 'hdkey'],
                properties: {
                    mnemonic: { type: 'string' },
                    hdkey: {
                        type: 'object',
                        required: ['xpriv', 'xpub'],
                        properties: {
                            xpriv: { type: 'string' },
                            xpub: { type: 'string' },
                        },
                    },
                },
            },
            counter: { type: 'integer' },
            ids: {
                type: 'object',
                additionalProperties: { $ref: '#/components/schemas/WalletId' },
            },
            current: { type: 'string' },
            names: { type: 'object', additionalProperties: { type: 'string' } },
        },
        additionalProperties: true,
    },
    StoredWallet: {
        oneOf: [
            { $ref: '#/components/schemas/Wallet' },
            { $ref: '#/components/schemas/EncryptedWallet' },
            { $ref: '#/components/schemas/LegacyWallet' },
        ],
    },
};

const gatekeeperOptions = {
    failOnErrors: true,
    definition: {
        ...baseDefinition,
        info: {
            ...baseDefinition.info,
            title: 'Gatekeeper API',
            description: 'Documentation for Gatekeeper API'
        },
        servers: [{ url: 'http://localhost:4224/api/v1', description: 'Local Gatekeeper' }]
    },
    apis: ['services/gatekeeper/server/src/gatekeeper-api.ts']
};

const keymasterOptions = {
    failOnErrors: true,
    definition: {
        ...baseDefinition,
        info: {
            ...baseDefinition.info,
            title: 'Keymaster API'
        },
        components: { schemas: keymasterSchemas },
        servers: [{ url: 'http://localhost:4226/api/v1', description: 'Local Keymaster' }]
    },
    apis: ['services/keymaster/server/src/keymaster-api.ts']
};

const gatekeeperSpec = swaggerJsdoc(gatekeeperOptions);
const keymasterSpec = swaggerJsdoc(keymasterOptions);
fs.writeFileSync('doc/gatekeeper-api.json', JSON.stringify(gatekeeperSpec, null, 2));
fs.writeFileSync('doc/keymaster-api.json', JSON.stringify(keymasterSpec, null, 2));
