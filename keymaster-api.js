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
app.use(express.static(path.join(__dirname, 'kc-app/build')));

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

        if (!name) {
            throw "No name provided";
        }

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

v1router.get('/resolve-id', async (req, res) => {
    try {
        const doc = await keymaster.resolveId();
        res.json(doc);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.post('/remove-id', async (req, res) => {
    try {
        const { name } = req.body;
        const response = keymaster.removeId(name);
        res.json(response);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.post('/backup-id', async (req, res) => {
    try {
        const { name } = req.body;
        const response = await keymaster.backupId(name);
        res.json(response);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.post('/recover-id', async (req, res) => {
    try {
        const { did } = req.body;
        const response = await keymaster.recoverId(did);
        res.json(response);
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

v1router.post('/verify-response', async (req, res) => {
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
        res.sendFile(path.join(__dirname, 'kc-app/build', 'index.html'));
    } else {
        console.warn(`Warning: Unhandled API endpoint - ${req.method} ${req.originalUrl}`);
        res.status(404).json({ message: 'Endpoint not found' });
    }
});

process.on('uncaughtException', (error) => {
    //console.error('Unhandled exception caught');
    console.error('Unhandled exception caught', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    //console.error('Unhandled rejection caught');
});

const port = 4226;

app.listen(port, async () => {
    await keymaster.start(gatekeeper);
    await gatekeeper.waitUntilReady();
    console.log(`keymaster server running on port ${port}`);

    try {
        const currentId = keymaster.getCurrentIdName();
        const doc = await keymaster.resolveId();

        console.log(`current ID: ${currentId}`);
        console.log(JSON.stringify(doc, null, 4));
    }
    catch (error) {
        console.log(error);
    }
});
