import swaggerJsdoc from 'swagger-jsdoc';
import fs from 'fs';

const baseDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'Keymaster API',
        version: '1.3.0',
        description: 'Documentation for Keymaster API'
    },
};

const gatekeeperOptions = {
    failOnErrors: true,
    definition: {
        ...baseDefinition,
        info: {
            ...baseDefinition.info,
            title: 'Gatekeeper API'
        }
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
        }
    },
    apis: ['services/keymaster/server/src/keymaster-api.ts']
};

const gatekeeperSpec = swaggerJsdoc(gatekeeperOptions);
const keymasterSpec = swaggerJsdoc(keymasterOptions);
fs.writeFileSync('doc/gatekeeper-api.json', JSON.stringify(gatekeeperSpec, null, 2));
fs.writeFileSync('doc/keymaster-api.json', JSON.stringify(keymasterSpec, null, 2));

