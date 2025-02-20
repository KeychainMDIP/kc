import swaggerJsdoc from 'swagger-jsdoc';
import fs from 'fs';

const baseDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'Keymaster API',
        version: '1.0.0',
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
    apis: ['services/gatekeeper/server/src/gatekeeper-api.js']
};

const gatekeeperSpec = swaggerJsdoc(gatekeeperOptions);
fs.writeFileSync('doc/gatekeeper-api.json', JSON.stringify(gatekeeperSpec, null, 2));

