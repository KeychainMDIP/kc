import express from 'express';
import morgan from 'morgan';
import * as gatekeeper from './gatekeeper.js';

import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

gatekeeper.start();

const app = express();
const v1router = express.Router();

app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' })); // Sets the JSON payload limit to 1MB

v1router.get('/version', async (req, res) => {
    try {
        res.json(1);
    } catch (error) {
        res.status(500).send(error.toString());
    }
});

v1router.post('/did', async (req, res) => {
    try {
        const txn = req.body;
        const did = await gatekeeper.createDID(txn);
        res.json(did);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.get('/did/:did', async (req, res) => {
    try {
        const doc = await gatekeeper.resolveDID(req.params.did, req.query.asof);
        res.json(doc);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.get('/explore/:did', async (req, res) => {
    try {
        const doc = await gatekeeper.resolveDID(req.params.did, req.query.asof);
        var hthead = '<html><body>';
        hthead = hthead + '<h1>MDIP Network Explorer</h1>';
        hthead = hthead + '<table><tr><td><h3>' + req.params.did + '</h3></td>';
        var htdoc = JSON.stringify(doc, null, 5);
        htdoc = htdoc.replace(/"didDocument"/g, '"<b>didDocument</b>"');
        htdoc = htdoc.replace(/"didDocumentMetadata"/g, '"<b>didDocumentMetadata</b>"');
        htdoc = htdoc.replace(/"manifest"/g, '"<b>manifest</b>"');
        htdoc = htdoc.replace(/"issuer"/g, '"<b>issuer</b>"');
        htdoc = htdoc.replace(/"signer"/g, '"<b>signer</b>"');
        htdoc = htdoc.replace(/"id"/g, '"<b>id</b>"');
        htdoc = htdoc.replace(/"credential"/g, '"<b>credential</b>"');
        htdoc = htdoc.replace(/"vault"/g, '"<b>vault</b>"');
        htdoc = htdoc.replace(/"(did:mdip:.*)"/g, '"<a href="/explore/$1">$1</a>"');
        htdoc = hthead + '<tr><td><hr><pre>' + htdoc + '</pre><hr></td></tr>';
        var now = new Date();
        htdoc = htdoc + '</table>' + now + '</body></html>';
        res.send(htdoc);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.post('/did/:did', async (req, res) => {
    try {
        const txn = req.body;
        const ok = await gatekeeper.updateDID(txn);
        res.json(ok);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.delete('/did/:did', async (req, res) => {
    try {
        const txn = req.body;
        const ok = await gatekeeper.deleteDID(txn);
        res.json(ok);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.get('/export/:did', async (req, res) => {
    try {
        const txns = await gatekeeper.exportDID(req.params.did);
        res.json(txns);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.post('/import', async (req, res) => {
    try {
        const txns = req.body;
        const did = await gatekeeper.importDID(txns);
        res.json(did);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

v1router.post('/merge', async (req, res) => {
    try {
        const batch = req.body;
        const did = await gatekeeper.mergeBatch(batch);
        res.json(did);
    } catch (error) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

const port = 3000;

app.use('/api/v1', v1router);

gatekeeper.verifyDb().then((invalid) => {
    if (invalid === 0) {
        app.listen(port, () => {
            console.log(`Server is running on port ${port}`);
        });
    }
    else {
        console.log(`${invalid} invalid DIDs in MDIP db`);
        process.exit();
    }
});

process.on('uncaughtException', (error) => {
    console.error('Unhandled exception caught');
});

process.on('unhandledRejection', (reason, promise) => {
    //console.error('Unhandled rejection at:', promise, 'reason:', reason);
    console.error('Unhandled rejection caught');
});

