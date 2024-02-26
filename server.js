import express from 'express';
import morgan from 'morgan';
import * as gatekeeper from './gatekeeper.js';
import * as hyperswarm from './hyperswarm.js';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

gatekeeper.start();

const protocol = '/MDIP/v22.02.26';
hyperswarm.start(protocol);

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

app.get('/ipfs/peerid', async (req, res) => {
    try {
        res.json(gatekeeper.getPeerId());
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.get('/ipfs/multiaddr', async (req, res) => {
    try {
        res.json(gatekeeper.getMultiaddr());
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.post('/ipfs/dial', async (req, res) => {
    try {
        const { multiaddr } = req.body;
        console.log(`dialing ${multiaddr}...`);
        const response = await gatekeeper.dialMultiaddr(multiaddr);
        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.post('/did', async (req, res) => {
    try {
        const txn = req.body;
        const did = await gatekeeper.createDID(txn);
        await hyperswarm.publishTxn(txn);
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
        const doc = await gatekeeper.updateDID(txn);
        await hyperswarm.publishTxn(txn);
        res.json(doc);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.delete('/did/:did', async (req, res) => {
    try {
        const txn = req.body;
        const ok = await gatekeeper.deleteDID(txn);
        await hyperswarm.publishTxn(txn);
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


