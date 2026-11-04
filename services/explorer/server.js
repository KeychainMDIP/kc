import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from '@mdip/common/env';
import { childLogger } from '@mdip/common/logger';
import { createServerShutdown } from './server-lifecycle.js';

loadEnv();
const log = childLogger({ service: 'explorer-server' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.VITE_EXPLORER_PORT ?? 4000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('VITE_EXPLORER_PORT must be an integer between 1 and 65535');
}

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'dist')));

app.get('{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(port, () => {
    log.info(`Explorer running at http://localhost:${port}`);
});

const shutdown = createServerShutdown({ server, log });

server.on('error', error => {
    log.error({ error }, 'Explorer server error');
    process.exit(1);
});

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
