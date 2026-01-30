import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { childLogger } from '@mdip/common/logger';

dotenv.config();
const log = childLogger({ service: 'explorer-server' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.VITE_EXPLORER_PORT || 4000;

app.use(express.static(path.join(__dirname, 'dist')));

app.get('{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
    log.info(`Explorer running at http://localhost:${port}`);
});
