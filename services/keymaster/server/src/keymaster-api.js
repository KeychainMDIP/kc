import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import * as gatekeeper from '@mdip/gatekeeper/sdk';
import * as keymaster from '@mdip/keymaster/lib';
import * as wallet from '@mdip/keymaster/db/json';
import * as cipher from '@mdip/cipher/node';
import config from './config.js';
const app = express();
const v1router = express.Router();

app.use(morgan('dev'));
app.use(express.json());

// Define __dirname in ES module scope
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve the React frontend
app.use(express.static(path.join(__dirname, '../../client/build')));

let serverReady = false;

v1router.get('/ready', async (req, res) => {
    try {
        res.json(serverReady);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/registries', async (req, res) => {
    try {
        const registries = await keymaster.listRegistries();
        res.json(registries);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/wallet', async (req, res) => {
    try {
        const wallet = await keymaster.loadWallet();
        res.json(wallet);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.put('/wallet', async (req, res) => {
    try {
        const { wallet } = req.body;
        const response = await keymaster.saveWallet(wallet);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/wallet/new', async (req, res) => {
    try {
        const { mnemonic, overwrite } = req.body;
        const wallet = await keymaster.newWallet(mnemonic, overwrite);
        res.json(wallet);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/wallet/backup', async (req, res) => {
    try {
        const response = await keymaster.backupWallet();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/wallet/recover', async (req, res) => {
    try {
        const response = await keymaster.recoverWallet();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/wallet/check', async (req, res) => {
    try {
        const response = await keymaster.checkWallet();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/wallet/fix', async (req, res) => {
    try {
        const response = await keymaster.fixWallet();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/wallet/mnemonic', async (req, res) => {
    try {
        const response = await keymaster.decryptMnemonic();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/ids/current', async (req, res) => {
    try {
        const response = await keymaster.getCurrentId();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.put('/ids/current', async (req, res) => {
    try {
        const { name } = req.body;
        const response = await keymaster.setCurrentId(name);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/ids', async (req, res) => {
    try {
        const response = await keymaster.listIds();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/ids/new', async (req, res) => {
    try {
        const { name, options } = req.body;
        const response = await keymaster.createId(name, options);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/ids/:id', async (req, res) => {
    try {
        const doc = await keymaster.resolveId(req.params.id);
        if (!doc) {
            return res.status(404).send({ error: 'ID not found' });
        }
        res.json(doc);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.delete('/ids/:id', async (req, res) => {
    try {
        const response = await keymaster.removeId(req.params.id);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/ids/:id/backup', async (req, res) => {
    try {
        const response = await keymaster.backupId(req.params.id);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/ids/:id/recover', async (req, res) => {
    try {
        const { did } = req.body;
        const response = await keymaster.recoverId(did);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/names', async (req, res) => {
    try {
        const response = await keymaster.listNames();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/names', async (req, res) => {
    try {
        const { name, did } = req.body;
        const response = await keymaster.addName(name, did);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/names/:name', async (req, res) => {
    try {
        const doc = await keymaster.resolveDID(req.params.name);
        if (!doc) {
            return res.status(404).send({ error: 'Name not found' });
        }
        res.json(doc);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.delete('/names/:name', async (req, res) => {
    try {
        const response = await keymaster.removeName(req.params.name);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/challenge', async (req, res) => {
    try {
        const response = await keymaster.createChallenge();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/challenge', async (req, res) => {
    try {
        const { challenge, options } = req.body;
        const response = await keymaster.createChallenge(challenge, options);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/response', async (req, res) => {
    try {
        const { challenge, options } = req.body;
        const response = await keymaster.createResponse(challenge, options);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/response/verify', async (req, res) => {
    try {
        const { response, options } = req.body;
        const verify = await keymaster.verifyResponse(response, options);
        res.json(verify);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/groups', async (req, res) => {
    try {
        const { name, options } = req.body;
        const response = await keymaster.createGroup(name, options);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/groups/:name', async (req, res) => {
    try {
        const group = await keymaster.getGroup(req.params.name);
        if (!group) {
            return res.status(404).send({ error: 'Group not found' });
        }
        res.json(group);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/groups/:name/add', async (req, res) => {
    try {
        const { member } = req.body;
        const response = await keymaster.groupAdd(req.params.name, member);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/groups/:name/remove', async (req, res) => {
    try {
        const { member } = req.body;
        const response = await keymaster.groupRemove(req.params.name, member);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/groups/:name/test', async (req, res) => {
    try {
        const { member } = req.body;
        const response = await keymaster.groupTest(req.params.name, member);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/schemas', async (req, res) => {
    try {
        const { schema, options } = req.body;
        const response = await keymaster.createSchema(schema, options);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/schemas/:id', async (req, res) => {
    try {
        const schema = await keymaster.getSchema(req.params.id);
        if (!schema) {
            return res.status(404).send({ error: 'Schema not found' });
        }
        res.json(schema);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.put('/schemas/:id', async (req, res) => {
    try {
        const { schema } = req.body;
        const response = await keymaster.setSchema(req.params.id, schema);
        res.json(response.data);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/schemas/:id/test', async (req, res) => {
    try {
        const response = await keymaster.testSchema(req.params.id);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/agents/:id/test', async (req, res) => {
    try {
        const response = await keymaster.testAgent(req.params.id);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/credentials/bind', async (req, res) => {
    try {
        const { schema, subject, options } = req.body;
        const response = await keymaster.bindCredential(schema, subject, options);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/credentials/held', async (req, res) => {
    try {
        const response = await keymaster.listCredentials();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/credentials/held', async (req, res) => {
    try {
        const { did } = req.body;
        const response = await keymaster.acceptCredential(did);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/credentials/held/:did', async (req, res) => {
    try {
        const response = await keymaster.getCredential(req.params.did);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.delete('/credentials/held/:did', async (req, res) => {
    try {
        const response = await keymaster.removeCredential(req.params.did);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/credentials/held/:did/publish', async (req, res) => {
    try {
        const did = req.params.did;
        const { options } = req.body;
        const response = await keymaster.publishCredential(did, options);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/credentials/held/:did/unpublish', async (req, res) => {
    try {
        const did = req.params.did;
        const response = await keymaster.unpublishCredential(did);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/credentials/issued', async (req, res) => {
    try {
        const response = await keymaster.listIssued();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/credentials/issued', async (req, res) => {
    try {
        const { credential, options } = req.body;
        const response = await keymaster.issueCredential(credential, options);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

// eslint-disable-next-line
v1router.get('/credentials/issued/:did', async (req, res) => {
    try {
        const did = req.params.did;
        const response = await keymaster.getCredential(did);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/credentials/issued/:did', async (req, res) => {
    try {
        const did = req.params.did;
        const { credential } = req.body;
        const response = await keymaster.updateCredential(did, credential);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.delete('/credentials/issued/:did', async (req, res) => {
    try {
        const did = req.params.did;
        const response = await keymaster.revokeCredential(did);
        res.json(response);
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/keys/rotate', async (req, res) => {
    try {
        const response = await keymaster.rotateKeys();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/encrypt/message', async (req, res) => {
    try {
        const { msg, receiver, options } = req.body;
        const response = await keymaster.encryptMessage(msg, receiver, options);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/decrypt/message', async (req, res) => {
    try {
        const response = await keymaster.decryptMessage(req.body.did);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/encrypt/json', async (req, res) => {
    try {
        const { json, receiver, options } = req.body;
        const response = await keymaster.encryptJSON(json, receiver, options);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/decrypt/json', async (req, res) => {
    try {
        const response = await keymaster.decryptJSON(req.body.did);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/sign', async (req, res) => {
    try {
        const response = await keymaster.addSignature(JSON.parse(req.body.contents));
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/verify', async (req, res) => {
    try {
        const response = await keymaster.verifySignature(req.body.json);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/credentials/new', async (req, res) => {
    try {
        const { schema, options } = req.body;
        const response = await keymaster.createSchema(schema, options);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/schemas/:id/template/new', async (req, res) => {
    try {
        const { schema } = req.body;
        const response = await keymaster.createTemplate(schema);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/assets/new', async (req, res) => {
    try {
        const { asset, options } = req.body;
        const response = await keymaster.createAsset(asset, options);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/assets/:id', async (req, res) => {
    try {
        const asset = await keymaster.resolveAsset(req.params.id);
        if (!asset) {
            return res.status(404).send({ error: 'Asset not found' });
        }
        res.json(asset);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/templates/poll', async (req, res) => {
    try {
        const response = await keymaster.pollTemplate();
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/poll/new', async (req, res) => {
    try {
        const { poll, options } = req.body;
        const response = await keymaster.createPoll(poll, options);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/poll/:poll/view', async (req, res) => {
    try {
        const response = await keymaster.viewPoll(req.params.poll);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/poll/vote', async (req, res) => {
    try {
        const { poll, vote, options } = req.body;
        const response = await keymaster.votePoll(poll, vote, options);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.put('/poll/update', async (req, res) => {
    try {
        const { ballot } = req.body;
        const response = await keymaster.updatePoll(ballot);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/poll/:poll/publish', async (req, res) => {
    try {
        const { poll, options } = req.body;
        const response = await keymaster.publishPoll(poll, options);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.delete('/poll/:poll/unpublish', async (req, res) => {
    try {
        const { poll } = req.params;
        const response = await keymaster.unpublishPoll(poll);
        res.json(response);
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

app.use('/api/v1', v1router);

app.use((req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, '../../client/build', 'index.html'));
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

const port = config.keymasterPort;

app.listen(port, async () => {
    await gatekeeper.start({
        url: config.gatekeeperURL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });
    await keymaster.start({ gatekeeper, wallet, cipher });
    console.log(`keymaster server running on port ${port}`);

    try {
        const currentId = await keymaster.getCurrentId();
        const doc = await keymaster.resolveId();

        console.log(`current ID: ${currentId}`);
        console.log(JSON.stringify(doc, null, 4));
        serverReady = true;
    }
    catch (error) {
        console.log(error);
    }
});
