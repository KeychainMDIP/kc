import express from 'express';
import morgan from 'morgan';
import * as gatekeeper from './gatekeeper.js';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

gatekeeper.start();

const app = express();

app.use(morgan('dev'));
app.use(express.json());

app.get('/version', async (req, res) => {
    try {
        res.json(1);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

app.post('/did', async (req, res) => {
    try {
        const txn = req.body;
        const did = await gatekeeper.createDID(txn);
        res.json(did);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.get('/did/:did', async (req, res) => {
    try {
        const doc = await gatekeeper.resolveDID(req.params.did, req.query.asof);
        res.json(doc);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.post('/did/:did', async (req, res) => {
    try {
        const txn = req.body;
        const ok = await gatekeeper.updateDID(txn);
        res.json(ok);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.delete('/did/:did', async (req, res) => {
    try {
        const txn = req.body;
        const ok = await gatekeeper.deleteDID(txn);
        res.json(ok);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.get('/export/:did', async (req, res) => {
    try {
        const txns = await gatekeeper.exportDID(req.params.did);
        res.json(txns);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.post('/import', async (req, res) => {
    try {
        const txns = req.body;
        const did = await gatekeeper.importDID(txns);
        res.json(did);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

const port = 3000;

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

process.on('uncaughtException', (error) => {
    console.error('Unhandled exception caught');
});

process.on('unhandledRejection', (reason, promise) => {
    //console.error('Unhandled rejection at:', promise, 'reason:', reason);
    console.error('Unhandled rejection caught');
});

