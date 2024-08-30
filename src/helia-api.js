import { base58btc } from 'multiformats/bases/base58';
import express from 'express';
import morgan from 'morgan';
import * as ipfs from './helia-lib.js';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

const app = express();
const v1router = express.Router();

app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' })); // Sets the JSON payload limit to 1MB

let serverReady = false;

v1router.get('/ready', async (req, res) => {
    try {
        res.json(serverReady);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.get('/version', async (req, res) => {
    try {
        res.json(1);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.post('/ipfs', async (req, res) => {
    try {
        ipfs.add(req.body).then((cid) => {
            res.json({ cid: cid.toString(base58btc) });
        });
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.get('/ipfs/:cid', async (req, res) => {
    try {
        ipfs.get(req.params.cid).then((data) => {
            res.json(data);
        });
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.use('/api/v1', v1router);

async function main() {
    const port = 4228;

    ipfs.start();

    app.listen(port, () => {
        console.log(`Helia server is running on port ${port}`);
        serverReady = true;
    });
}

main();

process.on('uncaughtException', (error) => {
    console.error('Unhandled exception caught', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection caught', reason, promise);
});

