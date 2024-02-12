import express from 'express';
import morgan from 'morgan';
import * as gatekeeper from './gatekeeper.js';

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

app.get('/peerId', async (req, res) => {
    try {
        res.json(gatekeeper.getPeerId());
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

app.get('/did/:did', async (req, res) => {
    try {
        const doc = await gatekeeper.resolveDid(req.params.did, req.query.asof);
        res.json(doc);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.post('/did', async (req, res) => {
    try {
        const txn = req.body;
        const did = await gatekeeper.createDid(txn);
        res.json(did);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.post('/did/:did', async (req, res) => {
    try {
        const txn = req.body;
        const doc = await gatekeeper.updateDid(txn);
        res.json(doc);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

app.delete('/did/:did', async (req, res) => {
    try {
        const txn = req.body;
        const ok = await gatekeeper.deleteDid(txn);
        res.json(ok);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

const port = 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});


