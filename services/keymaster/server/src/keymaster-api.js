import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import GatekeeperClient from '@mdip/gatekeeper/client';
import Keymaster from '@mdip/keymaster';
import WalletJson from '@mdip/keymaster/wallet/json';
import WalletRedis from '@mdip/keymaster/wallet/redis';
import WalletMongo from '@mdip/keymaster/wallet/mongo';
import WalletSQLite from '@mdip/keymaster/wallet/sqlite';
import WalletEncrypted from '@mdip/keymaster/wallet/json-enc';
import WalletCache from '@mdip/keymaster/wallet/cache';
import CipherNode from '@mdip/cipher/node';
import { InvalidParameterError } from '@mdip/common/errors';
import config from './config.js';
const app = express();
const v1router = express.Router();

app.use(morgan('dev'));
app.use(express.json());

// Define __dirname in ES module scope
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve the React frontend
app.use(express.static(path.join(__dirname, '../../client/build')));

let keymaster;
let serverReady = false;

v1router.get('/ready', async (req, res) => {
    try {
        res.json({ ready: serverReady });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/registries', async (req, res) => {
    try {
        const registries = await keymaster.listRegistries();
        res.json({ registries });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/wallet', async (req, res) => {
    try {
        const wallet = await keymaster.loadWallet();
        res.json({ wallet });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.put('/wallet', async (req, res) => {
    try {
        const { wallet } = req.body;
        const ok = await keymaster.saveWallet(wallet);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/wallet/new', async (req, res) => {
    try {
        const { mnemonic, overwrite } = req.body;
        const wallet = await keymaster.newWallet(mnemonic, overwrite);
        res.json({ wallet });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/wallet/backup', async (req, res) => {
    try {
        const ok = await keymaster.backupWallet();
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/wallet/recover', async (req, res) => {
    try {
        const wallet = await keymaster.recoverWallet();
        res.json({ wallet });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/wallet/check', async (req, res) => {
    try {
        const check = await keymaster.checkWallet();
        res.json({ check });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/wallet/fix', async (req, res) => {
    try {
        const fix = await keymaster.fixWallet();
        res.json({ fix });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/wallet/mnemonic', async (req, res) => {
    try {
        const mnemonic = await keymaster.decryptMnemonic();
        res.json({ mnemonic });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/did/:id', async (req, res) => {
    try {
        const docs = await keymaster.resolveDID(req.params.id, req.query);
        res.json({ docs });
    } catch (error) {
        res.status(404).send({ error: 'DID not found' });
    }
});

v1router.get('/ids/current', async (req, res) => {
    try {
        const current = await keymaster.getCurrentId();
        res.json({ current });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.put('/ids/current', async (req, res) => {
    try {
        const { name } = req.body;
        const ok = await keymaster.setCurrentId(name);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/ids', async (req, res) => {
    try {
        const ids = await keymaster.listIds();
        res.json({ ids });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/ids/', async (req, res) => {
    try {
        const { name, options } = req.body;
        const did = await keymaster.createId(name, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/ids/:id', async (req, res) => {
    try {
        const docs = await keymaster.resolveDID(req.params.id);
        res.json({ docs });
    } catch (error) {
        return res.status(404).send({ error: 'ID not found' });
    }
});

v1router.delete('/ids/:id', async (req, res) => {
    try {
        const ok = await keymaster.removeId(req.params.id);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/ids/:id/backup', async (req, res) => {
    try {
        const ok = await keymaster.backupId(req.params.id);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/ids/:id/recover', async (req, res) => {
    try {
        const { did } = req.body;
        const current = await keymaster.recoverId(did);
        res.json({ recovered: current });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/names', async (req, res) => {
    try {
        const names = await keymaster.listNames();
        res.json({ names });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/names', async (req, res) => {
    try {
        const { name, did } = req.body;
        const ok = await keymaster.addName(name, did);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/names/:name', async (req, res) => {
    try {
        const did = await keymaster.getName(req.params.name);
        res.json({ did });
    } catch (error) {
        res.status(404).send({ error: 'DID not found' });
    }
});

v1router.delete('/names/:name', async (req, res) => {
    try {
        const ok = await keymaster.removeName(req.params.name);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/challenge', async (req, res) => {
    try {
        const did = await keymaster.createChallenge();
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/challenge', async (req, res) => {
    try {
        const { challenge, options } = req.body;
        const did = await keymaster.createChallenge(challenge, options);
        res.json({ did });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/response', async (req, res) => {
    try {
        const { challenge, options } = req.body;
        const did = await keymaster.createResponse(challenge, options);
        res.json({ did });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/response/verify', async (req, res) => {
    try {
        const { response, options } = req.body;
        const verify = await keymaster.verifyResponse(response, options);
        res.json({ verify });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/groups', async (req, res) => {
    try {
        const groups = await keymaster.listGroups(req.query.owner);
        res.json({ groups });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/groups', async (req, res) => {
    try {
        const { name, options } = req.body;
        const did = await keymaster.createGroup(name, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/groups/:name', async (req, res) => {
    try {
        const group = await keymaster.getGroup(req.params.name);
        res.json({ group });
    } catch (error) {
        return res.status(404).send({ error: 'Group not found' });
    }
});

v1router.post('/groups/:name/add', async (req, res) => {
    try {
        const { member } = req.body;
        const ok = await keymaster.addGroupMember(req.params.name, member);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/groups/:name/remove', async (req, res) => {
    try {
        const { member } = req.body;
        const ok = await keymaster.removeGroupMember(req.params.name, member);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/groups/:name/test', async (req, res) => {
    try {
        const { member } = req.body;
        const test = await keymaster.testGroup(req.params.name, member);
        res.json({ test });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/schemas', async (req, res) => {
    try {
        const schemas = await keymaster.listSchemas(req.query.owner);
        res.json({ schemas });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/schemas', async (req, res) => {
    try {
        const { schema, options } = req.body;
        const did = await keymaster.createSchema(schema, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/schemas/:id', async (req, res) => {
    try {
        const schema = await keymaster.getSchema(req.params.id);
        res.json({ schema });
    } catch (error) {
        return res.status(404).send({ error: 'Schema not found' });
    }
});

v1router.put('/schemas/:id', async (req, res) => {
    try {
        const { schema } = req.body;
        const ok = await keymaster.setSchema(req.params.id, schema);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/schemas/:id/test', async (req, res) => {
    try {
        const test = await keymaster.testSchema(req.params.id);
        res.json({ test });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/agents/:id/test', async (req, res) => {
    try {
        const test = await keymaster.testAgent(req.params.id);
        res.json({ test });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/credentials/bind', async (req, res) => {
    try {
        const { schema, subject, options } = req.body;
        const credential = await keymaster.bindCredential(schema, subject, options);
        res.json({ credential });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/credentials/held', async (req, res) => {
    try {
        const held = await keymaster.listCredentials();
        res.json({ held });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/credentials/held', async (req, res) => {
    try {
        const { did } = req.body;
        const ok = await keymaster.acceptCredential(did);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/credentials/held/:did', async (req, res) => {
    try {
        const credential = await keymaster.getCredential(req.params.did);
        res.json({ credential });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.delete('/credentials/held/:did', async (req, res) => {
    try {
        const ok = await keymaster.removeCredential(req.params.did);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/credentials/held/:did/publish', async (req, res) => {
    try {
        const did = req.params.did;
        const { options } = req.body;
        const ok = await keymaster.publishCredential(did, options);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/credentials/held/:did/unpublish', async (req, res) => {
    try {
        const did = req.params.did;
        const ok = await keymaster.unpublishCredential(did);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.get('/credentials/issued', async (req, res) => {
    try {
        const issued = await keymaster.listIssued();
        res.json({ issued });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/credentials/issued', async (req, res) => {
    try {
        const { credential, options } = req.body;
        const did = await keymaster.issueCredential(credential, options);
        res.json({ did });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

// eslint-disable-next-line
v1router.get('/credentials/issued/:did', async (req, res) => {
    try {
        const did = req.params.did;
        const credential = await keymaster.getCredential(did);
        res.json({ credential });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/credentials/issued/:did', async (req, res) => {
    try {
        const did = req.params.did;
        const { credential } = req.body;
        const ok = await keymaster.updateCredential(did, credential);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.delete('/credentials/issued/:did', async (req, res) => {
    try {
        const did = req.params.did;
        const ok = await keymaster.revokeCredential(did);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

v1router.post('/keys/rotate', async (req, res) => {
    try {
        const ok = await keymaster.rotateKeys();
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/encrypt/message', async (req, res) => {
    try {
        const { msg, receiver, options } = req.body;
        const did = await keymaster.encryptMessage(msg, receiver, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/decrypt/message', async (req, res) => {
    try {
        const message = await keymaster.decryptMessage(req.body.did);
        res.json({ message });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/encrypt/json', async (req, res) => {
    try {
        const { json, receiver, options } = req.body;
        const did = await keymaster.encryptJSON(json, receiver, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/decrypt/json', async (req, res) => {
    try {
        const json = await keymaster.decryptJSON(req.body.did);
        res.json({ json });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/sign', async (req, res) => {
    try {
        const signed = await keymaster.addSignature(JSON.parse(req.body.contents));
        res.json({ signed });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/keys/verify', async (req, res) => {
    try {
        const ok = await keymaster.verifySignature(req.body.json);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/schemas/:id/template/', async (req, res) => {
    try {
        const { schema } = req.body;
        const template = await keymaster.createTemplate(schema);
        res.json({ template });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/assets', async (req, res) => {
    try {
        const { data, options } = req.body;
        const did = await keymaster.createAsset(data, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/assets', async (req, res) => {
    try {
        const assets = await keymaster.listAssets();
        res.json({ assets });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/assets/:id', async (req, res) => {
    try {
        const asset = await keymaster.resolveAsset(req.params.id);
        res.json({ asset });
    } catch (error) {
        return res.status(404).send({ error: 'Asset not found' });
    }
});

v1router.get('/templates/poll', async (req, res) => {
    try {
        const template = await keymaster.pollTemplate();
        res.json({ template });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/polls/', async (req, res) => {
    try {
        const polls = await keymaster.listPolls(req.query.owner);
        res.json({ polls });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/polls/', async (req, res) => {
    try {
        const { poll, options } = req.body;
        const did = await keymaster.createPoll(poll, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/polls/:poll', async (req, res) => {
    try {
        const poll = await keymaster.getPoll(req.params.poll);
        res.json({ poll });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/polls/:poll/test', async (req, res) => {
    try {
        const test = await keymaster.testPoll(req.params.poll);
        res.json({ test });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.get('/polls/:poll/view', async (req, res) => {
    try {
        const poll = await keymaster.viewPoll(req.params.poll);
        res.json({ poll });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/polls/vote', async (req, res) => {
    try {
        const { poll, vote, options } = req.body;
        const did = await keymaster.votePoll(poll, vote, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.put('/polls/update', async (req, res) => {
    try {
        const { ballot } = req.body;
        const ok = await keymaster.updatePoll(ballot);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/polls/:poll/publish', async (req, res) => {
    try {
        const { options } = req.body;
        const ok = await keymaster.publishPoll(req.params.poll, options);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/polls/:poll/unpublish', async (req, res) => {
    try {
        const ok = await keymaster.unpublishPoll(req.params.poll);
        res.json({ ok });
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

async function waitForCurrentId() {
    let isReady = false;
    const currentId = await keymaster.getCurrentId();

    if (!currentId) {
        return;
    }

    while (!isReady) {
        try {
            console.log(`Resolving current ID: ${currentId}`);
            const doc = await keymaster.resolveDID(currentId);
            console.log(JSON.stringify(doc, null, 4));
            isReady = true;
        }
        catch {
            console.log(`Waiting for gatekeeper to sync...`);
        }

        if (!isReady) {
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }
}

async function initWallet() {
    let wallet = (config.db === 'redis') ? await WalletRedis.create()
        : (config.db === 'mongodb') ? await WalletMongo.create()
            : (config.db === 'sqlite') ? await WalletSQLite.create()
                : (config.db === 'json') ? new WalletJson()
                    : null;

    if (!wallet) {
        throw new InvalidParameterError(`db=${config.db}`);
    }

    if (config.keymasterPassphrase) {
        wallet = new WalletEncrypted(wallet, config.keymasterPassphrase);
    }

    if (config.walletCache) {
        wallet = new WalletCache(wallet);
    }

    return wallet;
}

const port = config.keymasterPort;

app.listen(port, async () => {
    const gatekeeper = new GatekeeperClient();

    await gatekeeper.connect({
        url: config.gatekeeperURL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    const wallet = await initWallet();
    const cipher = new CipherNode();
    keymaster = new Keymaster({ gatekeeper, wallet, cipher });
    console.log(`Keymaster server running on port ${port}`);
    console.log(`Keymaster server persisting to ${config.db}`);

    try {
        await waitForCurrentId();
    }
    catch(error) {
        console.error('Failed to resolve current ID:', error);
    }

    serverReady = true;
});
