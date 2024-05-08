import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import * as gatekeeper from './gatekeeper-sdk.js';
import * as keymaster from './keymaster.js';

const app = express();
const v1router = express.Router();

app.use(morgan('dev'));
app.use(express.json());

// Define __dirname in ES module scope
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve the React frontend
app.use(express.static(path.join(__dirname, 'keymaster-app/build')));

v1router.get('/ready', async (req, res) => {
    try {
        res.json('ready');
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.get('/wallet', async (req, res) => {
    try {
        const wallet = keymaster.loadWallet();
        res.json(wallet);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.get('/ids', async (req, res) => {
    try {
        const ids = keymaster.listIds();
        res.json(ids);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.post('/ids', async (req, res) => {
    try {
        const { name, registry } = req.body;
        const did = await keymaster.createId(name, registry);
        res.json(did);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.get('/current-id', async (req, res) => {
    try {
        const current = keymaster.getCurrentIdName();
        res.json(current);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.post('/current-id', async (req, res) => {
    try {
        const { name } = req.body;
        keymaster.useId(name);
        res.json("OK");
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.get('/challenge', async (req, res) => {
    try {
        const did = await keymaster.createChallenge();
        res.json(did);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.post('/challenge', async (req, res) => {
    try {
        const did = await keymaster.createChallenge(req.body);
        res.json(did);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.post('/response', async (req, res) => {
    try {
        const { challenge } = req.body;
        const did = await keymaster.createResponse(challenge);
        res.json(did);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.post('/response/verify', async (req, res) => {
    try {
        const { response, challenge } = req.body;
        const verify = await keymaster.verifyResponse(response, challenge);
        res.json(verify);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

app.use('/api/v1', v1router);

app.use((req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'keymaster-app/build', 'index.html'));
    } else {
        console.warn(`Warning: Unhandled API endpoint - ${req.method} ${req.originalUrl}`);
        res.status(404).json({ message: 'Endpoint not found' });
    }
});

const port = 7007;

app.listen(port, async () => {
    await keymaster.start(gatekeeper);
    console.log(`keymaster server running on port ${port}`);
});
