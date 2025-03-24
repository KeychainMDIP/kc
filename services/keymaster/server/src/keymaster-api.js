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

const DIDNotFound = { error: 'DID not found' };

// Serve the React frontend
app.use(express.static(path.join(__dirname, '../../client/build')));

let keymaster;
let serverReady = false;

/**
 * @swagger
 * /ready:
 *   get:
 *     summary: Check if the Keymaster service is ready.
 *     description: Returns a JSON object indicating the readiness status of the Keymaster service.
 *     responses:
 *       200:
 *         description: Keymaster service readiness status.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ready:
 *                   type: boolean
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/ready', async (req, res) => {
    try {
        res.json({ ready: serverReady });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /registries:
 *   get:
 *     summary: List the available registries.
 *     responses:
 *       200:
 *         description: A list of available registry names.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 registries:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/registries', async (req, res) => {
    try {
        const registries = await keymaster.listRegistries();
        res.json({ registries });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /wallet:
 *   get:
 *     summary: Retrieve the current wallet.
 *     responses:
 *       200:
 *         description: The wallet object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet:
 *                   type: object
 *                   properties:
 *                     seed:
 *                       type: object
 *                       properties:
 *                         mnemonic:
 *                           type: string
 *                         hdkey:
 *                           type: object
 *                           properties:
 *                             xpriv:
 *                               type: string
 *                             xpub:
 *                               type: string
 *                     counter:
 *                       type: integer
 *                     ids:
 *                       type: object
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           did:
 *                             type: string
 *                           account:
 *                             type: integer
 *                           index:
 *                             type: integer
 *                           owned:
 *                             type: array
 *                             items:
 *                               type: string
 *                     current:
 *                       type: string
 *                     names:
 *                       type: object
 *                       additionalProperties:
 *                         type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/wallet', async (req, res) => {
    try {
        const wallet = await keymaster.loadWallet();
        res.json({ wallet });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /wallet:
 *   put:
 *     summary: Save the wallet.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               wallet:
 *                 type: object
 *                 properties:
 *                   seed:
 *                     type: object
 *                     properties:
 *                       mnemonic:
 *                         type: string
 *                       hdkey:
 *                         type: object
 *                         properties:
 *                           xpriv:
 *                             type: string
 *                           xpub:
 *                             type: string
 *                   counter:
 *                     type: integer
 *                   ids:
 *                     type: object
 *                     additionalProperties:
 *                       type: object
 *                       properties:
 *                         did:
 *                           type: string
 *                         account:
 *                           type: integer
 *                         index:
 *                           type: integer
 *                         owned:
 *                           type: array
 *                           items:
 *                             type: string
 *                   current:
 *                     type: string
 *                   names:
 *                     type: object
 *                     additionalProperties:
 *                       type: string
 *             required:
 *               - wallet
 *     responses:
 *       200:
 *         description: Indicates whether the wallet was saved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.put('/wallet', async (req, res) => {
    try {
        const { wallet } = req.body;
        const ok = await keymaster.saveWallet(wallet);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /wallet/new:
 *   post:
 *     summary: Create a new wallet.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               mnemonic:
 *                 type: string
 *                 description: "12 words separated by a space (optional)."
 *               overwrite:
 *                 type: boolean
 *                 description: "Whether to overwrite the existing wallet."
 *                 default: false
 *     responses:
 *       200:
 *         description: The newly created wallet object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet:
 *                   type: object
 *                   properties:
 *                     seed:
 *                       type: object
 *                       properties:
 *                         mnemonic:
 *                           type: string
 *                         hdkey:
 *                           type: object
 *                           properties:
 *                             xpriv:
 *                               type: string
 *                             xpub:
 *                               type: string
 *                     counter:
 *                       type: integer
 *                     ids:
 *                       type: object
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           did:
 *                             type: string
 *                           account:
 *                             type: integer
 *                           index:
 *                             type: integer
 *                           owned:
 *                             type: array
 *                             items:
 *                               type: string
 *                     current:
 *                       type: string
 *                     names:
 *                       type: object
 *                       additionalProperties:
 *                         type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/wallet/new', async (req, res) => {
    try {
        const { mnemonic, overwrite } = req.body;
        const wallet = await keymaster.newWallet(mnemonic, overwrite);
        res.json({ wallet });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /wallet/backup:
 *   post:
 *     summary: Create a backup of the current wallet.
 *     responses:
 *       200:
 *         description: The DID of the wallet backup.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: string
 *                   description: The DID associated with the wallet backup.
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/wallet/backup', async (req, res) => {
    try {
        const ok = await keymaster.backupWallet();
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /wallet/recover:
 *   post:
 *     summary: Recover the wallet from an existing backup.
 *     responses:
 *       200:
 *         description: The recovered wallet object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 wallet:
 *                   type: object
 *                   properties:
 *                     seed:
 *                       type: object
 *                       properties:
 *                         mnemonic:
 *                           type: string
 *                         hdkey:
 *                           type: object
 *                           properties:
 *                             xpriv:
 *                               type: string
 *                             xpub:
 *                               type: string
 *                     counter:
 *                       type: integer
 *                     ids:
 *                       type: object
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           did:
 *                             type: string
 *                           account:
 *                             type: integer
 *                           index:
 *                             type: integer
 *                           owned:
 *                             type: array
 *                             items:
 *                               type: string
 *                     current:
 *                       type: string
 *                     names:
 *                       type: object
 *                       additionalProperties:
 *                         type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/wallet/recover', async (req, res) => {
    try {
        const wallet = await keymaster.recoverWallet();
        res.json({ wallet });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /wallet/check:
 *   post:
 *     summary: Check the integrity of the wallet.
 *     responses:
 *       200:
 *         description: The check result object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 check:
 *                   type: object
 *                   properties:
 *                     checked:
 *                       type: integer
 *                       description: Number of IDs checked.
 *                     invalid:
 *                       type: integer
 *                       description: Number of IDs found invalid.
 *                     deleted:
 *                       type: integer
 *                       description: Number of IDs found deleted or deactivated.
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/wallet/check', async (req, res) => {
    try {
        const check = await keymaster.checkWallet();
        res.json({ check });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /wallet/fix:
 *   post:
 *     summary: Fix the wallet by removing invalid or deactivated entries.
 *     responses:
 *       200:
 *         description: The fix result object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 fix:
 *                   type: object
 *                   properties:
 *                     idsRemoved:
 *                       type: integer
 *                     ownedRemoved:
 *                       type: integer
 *                     heldRemoved:
 *                       type: integer
 *                     namesRemoved:
 *                       type: integer
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/wallet/fix', async (req, res) => {
    try {
        const fix = await keymaster.fixWallet();
        res.json({ fix });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});


/**
 * @swagger
 * /wallet/mnemonic:
 *   get:
 *     summary: Decrypt and retrieve the wallet's mnemonic phrase.
 *     responses:
 *       200:
 *         description: The mnemonic phrase.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mnemonic:
 *                   type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/wallet/mnemonic', async (req, res) => {
    try {
        const mnemonic = await keymaster.decryptMnemonic();
        res.json({ mnemonic });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /did/{id}:
 *   get:
 *     summary: Resolve a DID Document.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID or name to resolve.
 *       - in: query
 *         name: atTime
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: >
 *           Timestamp to return the state of the DID as of this specific time (RFC3339/ISO8601 format).
 *       - in: query
 *         name: atVersion
 *         required: false
 *         schema:
 *           type: integer
 *         description: >
 *           Specific version of the DID Document to retrieve. Increments each time an `update` or `delete` operation occurs.
 *       - in: query
 *         name: confirm
 *         required: false
 *         schema:
 *           type: boolean
 *         description: >
 *           If true, returns the DID Document only if it is fully confirmed on the registry it references.
 *       - in: query
 *         name: verify
 *         required: false
 *         schema:
 *           type: boolean
 *         description: >
 *           If true, verifies the signature(s) of the DID operation(s) before returning the DID Document.
 *           If a signature is invalid, an error is thrown.
 *     responses:
 *       200:
 *         description: Successfully resolved the DID Document.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 docs:
 *                   type: object
 *                   description: The resolved DID Document and its metadata.
 *                   properties:
 *                     "@context":
 *                       type: string
 *                       description: DID resolution context (usually "https://w3id.org/did-resolution/v1").
 *                     didDocument:
 *                       type: object
 *                       description: The actual DID Document, if it exists.
 *                       properties:
 *                         "@context":
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: DID Document contexts.
 *                         id:
 *                           type: string
 *                           description: The DID this document represents.
 *                         controller:
 *                           type: string
 *                           description: The DID or entity controlling this asset (if applicable).
 *                         verificationMethod:
 *                           type: array
 *                           description: An array of verification methods (keys).
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:
 *                                 type: string
 *                               controller:
 *                                 type: string
 *                               type:
 *                                 type: string
 *                               publicKeyJwk:
 *                                 type: object
 *                                 description: Public key in JWK format.
 *                         authentication:
 *                           type: array
 *                           items:
 *                             type: string
 *                           description: Verification method references used for authentication.
 *                     didDocumentMetadata:
 *                       type: object
 *                       description: Metadata about the DID Document.
 *                       properties:
 *                         created:
 *                           type: string
 *                           format: date-time
 *                         updated:
 *                           type: string
 *                           format: date-time
 *                         deleted:
 *                           type: string
 *                           format: date-time
 *                         version:
 *                           type: integer
 *                         versionId:
 *                           type: string
 *                           description: A CID or similar identifier for the version.
 *                         canonicalId:
 *                           type: string
 *                         confirmed:
 *                           type: boolean
 *                         deactivated:
 *                           type: boolean
 *                     didDocumentData:
 *                       type: object
 *                       description: Arbitrary data attached to the DID (only present for assets).
 *                     mdip:
 *                       type: object
 *                       description: MDIP-specific metadata fields.
 *                       properties:
 *                         type:
 *                           type: string
 *                           enum: [ "agent", "asset" ]
 *                         registry:
 *                           type: string
 *                           enum: [ "local", "hyperswarm", "TBTC", "TFTC" ]
 *                         version:
 *                           type: integer
 *                         validUntil:
 *                           type: string
 *                           format: date-time
 *                         registration:
 *                           type: string
 *       404:
 *         description: DID not found or cannot be resolved.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/did/:id', async (req, res) => {
    try {
        const docs = await keymaster.resolveDID(req.params.id, req.query);
        res.json({ docs });
    } catch (error) {
        res.status(404).send(DIDNotFound);
    }
});

/**
 * @swagger
 * /ids/current:
 *   get:
 *     summary: Retrieve the current ID name.
 *     responses:
 *       200:
 *         description: The current ID name.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 current:
 *                   type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/ids/current', async (req, res) => {
    try {
        const current = await keymaster.getCurrentId();
        res.json({ current });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /ids/current:
 *   put:
 *     summary: Set the current ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: The name of the ID to set as current.
 *             required:
 *               - name
 *     responses:
 *       200:
 *         description: Indicates if the current ID was successfully updated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       400:
 *         description: Invalid name or unknown ID.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.put('/ids/current', async (req, res) => {
    try {
        const { name } = req.body;
        const ok = await keymaster.setCurrentId(name);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /ids:
 *   get:
 *     summary: List all ID names in the wallet.
 *     responses:
 *       200:
 *         description: A list of ID names.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ids:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/ids', async (req, res) => {
    try {
        const ids = await keymaster.listIds();
        res.json({ ids });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /ids/:
 *   post:
 *     summary: Create a new ID in the wallet.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: The name of the new ID.
 *               options:
 *                 type: object
 *                 description: Optional parameters.
 *                 properties:
 *                   registry:
 *                     type: string
 *                     enum: [ "local", "hyperswarm", "TBTC", "TFTC" ]
 *     responses:
 *       200:
 *         description: The DID created for the new ID.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *                   description: A DID string identifying the new ID.
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/ids/', async (req, res) => {
    try {
        const { name, options } = req.body;
        const did = await keymaster.createId(name, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /ids/{id}:
 *   get:
 *     summary: Resolve an ID to a DID Document.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The name or DID to resolve.
 *     responses:
 *       200:
 *         description: The resolved DID Document.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 docs:
 *                   type: object
 *                   description: The DID Document and associated metadata.
 *       404:
 *         description: ID not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/ids/:id', async (req, res) => {
    try {
        const docs = await keymaster.resolveDID(req.params.id);
        res.json({ docs });
    } catch (error) {
        return res.status(404).send({ error: 'ID not found' });
    }
});

/**
 * @swagger
 * /ids/{id}:
 *   delete:
 *     summary: Remove an existing ID from the wallet.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The name of the ID to remove.
 *     responses:
 *       200:
 *         description: Indicates whether the ID was successfully removed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       400:
 *         description: Invalid ID or request error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.delete('/ids/:id', async (req, res) => {
    try {
        const ok = await keymaster.removeId(req.params.id);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /ids/{id}/rename:
 *   post:
 *     summary: Rename an existing ID in the wallet.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The current name of the ID to be renamed.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: The new name for the ID.
 *             required:
 *               - name
 *     responses:
 *       200:
 *         description: Indicates whether the rename was successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       400:
 *         description: Invalid ID or the new name is unavailable.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/ids/:id/rename', async (req, res) => {
    try {
        const { name } = req.body;
        const ok = await keymaster.renameId(req.params.id, name);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /ids/{id}/backup:
 *   post:
 *     summary: Backup the specified ID.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID name or DID to back up.
 *     responses:
 *       200:
 *         description: Indicates whether the backup operation succeeded.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       400:
 *         description: Invalid ID or request error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/ids/:id/backup', async (req, res) => {
    try {
        const ok = await keymaster.backupId(req.params.id);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /ids/{id}/recover:
 *   post:
 *     summary: Recover an existing ID from a backup reference.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID name or DID to recover.
 *     responses:
 *       200:
 *         description: The ID name that was recovered and is now current.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 recovered:
 *                   type: string
 *       404:
 *         description: Backup DID not found or invalid ID.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Other error when recovering the ID.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/ids/:id/recover', async (req, res) => {
    try {
        const current = await keymaster.recoverId(req.params.id);
        res.json({ recovered: current });
    } catch (error) {
        if (error.error === DIDNotFound.error) {
            res.status(404).send(DIDNotFound);
        }
        else {
            res.status(500).send({ error: error.toString() });
        }
    }
});

/**
 * @swagger
 * /names:
 *   get:
 *     summary: List all name-to-DID mappings in the wallet.
 *     responses:
 *       200:
 *         description: A list of all name-to-DID mappings.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 names:
 *                   type: object
 *                   additionalProperties:
 *                     type: string
 *                   description: An object where each key is a name, and each value is the associated DID.
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/names', async (req, res) => {
    try {
        const names = await keymaster.listNames();
        res.json({ names });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /names:
 *   post:
 *     summary: Add a new name-to-DID mapping.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: The human-readable name to associate with the DID.
 *               did:
 *                 type: string
 *                 description: The DID that this name should refer to.
 *             required:
 *               - name
 *               - did
 *     responses:
 *       200:
 *         description: Indicates whether the mapping was successfully created.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/names', async (req, res) => {
    try {
        const { name, did } = req.body;
        const ok = await keymaster.addName(name, did);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /names/{name}:
 *   get:
 *     summary: Retrieve the DID associated with a specific name.
 *     description: Returns the DID for the provided human-readable name, if it exists.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: The name for which you want the associated DID.
 *     responses:
 *       200:
 *         description: The DID associated with the requested name.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *       404:
 *         description: The requested name was not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/names/:name', async (req, res) => {
    try {
        const did = await keymaster.getName(req.params.name);
        res.json({ did });
    } catch (error) {
        res.status(404).send(DIDNotFound);
    }
});

/**
 * @swagger
 * /names/{name}:
 *   delete:
 *     summary: Remove an existing name-to-DID mapping.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: The name whose mapping should be removed.
 *     responses:
 *       200:
 *         description: Indicates whether the mapping was successfully removed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       400:
 *         description: The requested name was invalid or could not be removed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.delete('/names/:name', async (req, res) => {
    try {
        const ok = await keymaster.removeName(req.params.name);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /challenge:
 *   get:
 *     summary: Create a default challenge DID with no parameters.
 *     responses:
 *       200:
 *         description: A DID representing the newly created challenge.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *                   description: The DID for the newly created challenge.
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/challenge', async (req, res) => {
    try {
        const did = await keymaster.createChallenge();
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});


/**
 * @swagger
 * /challenge:
 *   post:
 *     summary: Create a challenge DID with custom data or options.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               challenge:
 *                 type: object
 *                 description: Arbitrary challenge data.
 *               options:
 *                 type: object
 *                 description: Additional options.
 *                 properties:
 *                   registry:
 *                     type: string
 *                     enum: [ "local", "hyperswarm", "TBTC", "TFTC" ]
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *     responses:
 *       200:
 *         description: DID representing the newly created challenge.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *       400:
 *         description: Bad request (invalid parameters).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/challenge', async (req, res) => {
    try {
        const { challenge, options } = req.body;
        const did = await keymaster.createChallenge(challenge, options);
        res.json({ did });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /response:
 *   post:
 *     summary: Create a response to an existing challenge DID.
 *     description: >
 *       Accepts a challenge DID (the DID of a previously created challenge) and an `options` object, then returns a new DID containing the
 *       response. Internally, the Keymaster finds matching credentials and bundles them into verifiable presentations. The response is
 *       encrypted for the original challenge's controller and stored as a new asset DID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               challenge:
 *                 type: string
 *                 description: DID of the challenge to respond to.
 *               options:
 *                 type: object
 *                 description: Additional parameters controlling how the response is created and stored.
 *                 properties:
 *                   registry:
 *                     type: string
 *                     description: The registry where the new response DID will be created (e.g., "local", "hyperswarm").
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *                     description: Expiration time for the response DID. If omitted, defaults to 1 hour from now.
 *                   retries:
 *                     type: integer
 *                     description: How many times to retry resolving the challenge DID if it is not immediately resolvable.
 *                     default: 0
 *                   delay:
 *                     type: integer
 *                     description: Milliseconds to wait between retries.
 *                     default: 1000
 *                   encryptForSender:
 *                     type: boolean
 *                     description: Whether to include an encrypted copy for the sender (the responding party). Defaults to true.
 *                   includeHash:
 *                     type: boolean
 *                     description: Whether to embed a hash of the plaintext in the stored asset. Defaults to false.
 *                   controller:
 *                     type: string
 *                     description: A specific ID or DID to act as the controller of the newly created asset. If not set, the current ID is used.
 *     responses:
 *       200:
 *         description: A DID containing the response to the challenge.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *                   description: The DID of the newly created response asset.
 *       400:
 *         description: Invalid input (e.g., challenge not found, or required parameters missing).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/response', async (req, res) => {
    try {
        const { challenge, options } = req.body;
        const did = await keymaster.createResponse(challenge, options);
        res.json({ did });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /response/verify:
 *   post:
 *     summary: Verify a response to a challenge.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               response:
 *                 type: string
 *                 description: DID of the challenge response asset to verify.
 *               options:
 *                 type: object
 *                 description: Additional verification parameters.
 *                 properties:
 *                   retries:
 *                     type: integer
 *                     description: How many times to retry resolving the response DID if initially not found.
 *                     default: 0
 *                   delay:
 *                     type: integer
 *                     description: How many milliseconds to wait between resolution retries.
 *                     default: 1000
 *                   atTime:
 *                     type: string
 *                     format: date-time
 *                     description: If provided, attempts to resolve the response DID as of a specific point in time.
 *                   atVersion:
 *                     type: integer
 *                     description: If provided, attempts to resolve the response DID at a specific version.
 *                   confirm:
 *                     type: boolean
 *                     description: If true, only returns the DID if it is fully confirmed on its registry.
 *                   verify:
 *                     type: boolean
 *                     description: If true, verifies the signature(s) of the response operation(s) before returning the DID Document.
 *     responses:
 *       200:
 *         description: The result of the verification process.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verify:
 *                   type: object
 *                   description: A detailed verification result.
 *                   properties:
 *                     challenge:
 *                       type: string
 *                       description: The DID of the original challenge.
 *                     credentials:
 *                       type: array
 *                       items:
 *                         type: object
 *                       description: Each credential pair (vc, vp) the response included.
 *                     match:
 *                       type: boolean
 *                       description: true if the response satisfies all challenge requirements, otherwise `false`.
 *                     vps:
 *                       type: array
 *                       description: Any verifiable presentations that passed verification.
 *                       items:
 *                         type: object
 *                     responder:
 *                       type: string
 *                       description: The DID (controller) of the responder.
 *       400:
 *         description: Verification failed or request was invalid.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/response/verify', async (req, res) => {
    try {
        const { response, options } = req.body;
        const verify = await keymaster.verifyResponse(response, options);
        res.json({ verify });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /groups:
 *   get:
 *     summary: List all group DIDs owned by (or associated with) a specific ID.
 *     parameters:
 *       - in: query
 *         name: owner
 *         required: false
 *         schema:
 *           type: string
 *         description: The name or DID of the owner ID for which to list groups.
 *     responses:
 *       200:
 *         description: An array of group DIDs.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 groups:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/groups', async (req, res) => {
    try {
        const groups = await keymaster.listGroups(req.query.owner);
        res.json({ groups });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /groups:
 *   post:
 *     summary: Create a new group asset (DID).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: The human-readable name of the group.
 *               options:
 *                 type: object
 *                 description: Additional parameters for creating the group.
 *                 properties:
 *                   members:
 *                     type: array
 *                     items:
 *                       type: string
 *                     description: An array of member DIDs or sub-group DIDs to include initially.
 *                   registry:
 *                     type: string
 *                     description: The registry in which to create the group DID (e.g., "local", "hyperswarm").
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *                     description: Timestamp indicating when this group asset should expire (optional).
 *                   retries:
 *                     type: integer
 *                     default: 0
 *                     description: How many times to retry DID creation if immediate creation fails.
 *                   delay:
 *                     type: integer
 *                     default: 1000
 *                     description: Delay in milliseconds between retries.
 *                   encryptForSender:
 *                     type: boolean
 *                     description: Whether to include an encrypted copy for the current ID. Defaults to true if encryption is used.
 *                   includeHash:
 *                     type: boolean
 *                     description: Whether to embed a hash of the group's data in the created asset. Defaults to false.
 *                   controller:
 *                     type: string
 *                     description: An ID or DID that should be set as the controller of this new group asset. Defaults to the current ID if omitted.
 *     responses:
 *       200:
 *         description: The DID representing the newly created group.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/groups', async (req, res) => {
    try {
        const { name, options } = req.body;
        const did = await keymaster.createGroup(name, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /groups/{name}:
 *   get:
 *     summary: Retrieve an existing group.
 *     description: Returns the stored group object (including its name and members) for the given group DID or name.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: The name or DID of the group to retrieve.
 *     responses:
 *       200:
 *         description: The group object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 group:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     members:
 *                       type: array
 *                       items:
 *                         type: string
 *       404:
 *         description: The requested group was not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/groups/:name', async (req, res) => {
    try {
        const group = await keymaster.getGroup(req.params.name);
        res.json({ group });
    } catch (error) {
        return res.status(404).send({ error: 'Group not found' });
    }
});

/**
 * @swagger
 * /groups/{name}/add:
 *   post:
 *     summary: Add a member to an existing group.
 *     description: Adds a DID (or group) as a member of the specified group.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: The name or DID of the group to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               member:
 *                 type: string
 *                 description: The DID (or group DID) to add as a member.
 *             required:
 *               - member
 *     responses:
 *       200:
 *         description: Indicates whether the member was successfully added.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/groups/:name/add', async (req, res) => {
    try {
        const { member } = req.body;
        const ok = await keymaster.addGroupMember(req.params.name, member);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /groups/{name}/remove:
 *   post:
 *     summary: Remove a member from an existing group.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: The name or DID of the group to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               member:
 *                 type: string
 *                 description: The DID (or group DID) to remove from the group.
 *             required:
 *               - member
 *     responses:
 *       200:
 *         description: Indicates whether the member was successfully removed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/groups/:name/remove', async (req, res) => {
    try {
        const { member } = req.body;
        const ok = await keymaster.removeGroupMember(req.params.name, member);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /groups/{name}/test:
 *   post:
 *     summary: Test membership in a group.
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: The name or DID of the group to test.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               member:
 *                 type: string
 *                 description: The DID or group DID to check for membership.
 *     responses:
 *       200:
 *         description: The result of the membership test.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 test:
 *                   type: boolean
 *                   description: true if the member is found in the group, otherwise `false`.
 *       400:
 *         description: Invalid input or request could not be processed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/groups/:name/test', async (req, res) => {
    try {
        const { member } = req.body;
        const test = await keymaster.testGroup(req.params.name, member);
        res.json({ test });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /schemas:
 *   get:
 *     summary: List all schema DIDs owned by (or associated with) a specific ID.
 *     parameters:
 *       - in: query
 *         name: owner
 *         required: false
 *         schema:
 *           type: string
 *         description: The name or DID of the owner whose schemas should be listed.
 *     responses:
 *       200:
 *         description: A list of schema DIDs.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 schemas:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/schemas', async (req, res) => {
    try {
        const schemas = await keymaster.listSchemas(req.query.owner);
        res.json({ schemas });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /schemas:
 *   post:
 *     summary: Create a new schema.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               schema:
 *                 type: object
 *                 description: A valid JSON Schema to be stored.
 *               options:
 *                 type: object
 *                 description: Additional creation parameters.
 *                 properties:
 *                   registry:
 *                     type: string
 *                     description: The registry in which to create the schema DID (e.g., "local", "hyperswarm").
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *                     description: Optional expiration date/time for ephemeral schemas.
 *                   retries:
 *                     type: integer
 *                     default: 0
 *                     description: Number of times to retry resolution or creation steps if necessary.
 *                   delay:
 *                     type: integer
 *                     default: 1000
 *                     description: Delay in milliseconds between retries.
 *                   encryptForSender:
 *                     type: boolean
 *                     description: Whether to include an encrypted copy for the sender. Defaults to true if encryption occurs.
 *                   includeHash:
 *                     type: boolean
 *                     description: Whether to embed a hash of the schema in the stored asset. Defaults to false.
 *                   controller:
 *                     type: string
 *                     description: Specifies the ID or DID that will own/control this schema. Defaults to current ID if omitted.
 *     responses:
 *       200:
 *         description: The DID representing the newly created schema.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/schemas', async (req, res) => {
    try {
        const { schema, options } = req.body;
        const did = await keymaster.createSchema(schema, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /schemas/{id}:
 *   get:
 *     summary: Retrieve a stored schema.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The name or DID of the schema to retrieve.
 *     responses:
 *       200:
 *         description: The JSON Schema object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 schema:
 *                   type: object
 *                   description: The retrieved JSON Schema.
 *       404:
 *         description: Schema not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/schemas/:id', async (req, res) => {
    try {
        const schema = await keymaster.getSchema(req.params.id);
        res.json({ schema });
    } catch (error) {
        return res.status(404).send({ error: 'Schema not found' });
    }
});

/**
 * @swagger
 * /schemas/{id}:
 *   put:
 *     summary: Update an existing schema.
 *     description: >
 *       Replaces the schema (if valid) associated with the given DID or name.
 *       This operation will preserve the same DID while storing an updated schema in the underlying asset data.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The name or DID of the schema to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               schema:
 *                 type: object
 *                 description: The new JSON Schema to store.
 *     responses:
 *       200:
 *         description: Indicates whether the update was successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.put('/schemas/:id', async (req, res) => {
    try {
        const { schema } = req.body;
        const ok = await keymaster.setSchema(req.params.id, schema);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /schemas/{id}/test:
 *   post:
 *     summary: Test if a DID or name refers to a valid schema.
 *     description: >
 *       Checks whether the given DID or name refers to an asset containing a valid JSON Schema.
 *       Returns true if it's a recognized valid schema, otherwise `false`.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The name or DID of the schema to test.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: No required body parameters (reserved for future use).
 *     responses:
 *       200:
 *         description: Whether the asset is recognized as a valid schema.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 test:
 *                   type: boolean
 *                   description: true if the asset is a valid schema, otherwise `false`.
 *       400:
 *         description: Invalid DID/name or request processing error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/schemas/:id/test', async (req, res) => {
    try {
        const test = await keymaster.testSchema(req.params.id);
        res.json({ test });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /agents/{id}/test:
 *   post:
 *     summary: Check whether the given ID (or DID) is an agent.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID name or DID to test.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: No body required for this endpoint.
 *     responses:
 *       200:
 *         description: Whether the specified DID is recognized as an agent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 test:
 *                   type: boolean
 *                   description: true if the DID is an agent; otherwise `false`.
 *       400:
 *         description: Invalid request or DID.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/agents/:id/test', async (req, res) => {
    try {
        const test = await keymaster.testAgent(req.params.id);
        res.json({ test });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /credentials/bind:
 *   post:
 *     summary: Prepare (bind) a credential without issuing it.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               schema:
 *                 type: string
 *                 description: The schema DID or name to which this credential conforms.
 *               subject:
 *                 type: string
 *                 description: The subject DID (or name) for whom this credential is bound.
 *               options:
 *                 type: object
 *                 description: Optional parameters for credential creation.
 *                 properties:
 *                   credential:
 *                     type: object
 *                     description: A pre-built credential object to embed. If omitted, a default is generated from the schema.
 *                   validFrom:
 *                     type: string
 *                     format: date-time
 *                     description: The date/time the credential becomes valid. Defaults to the current time if omitted.
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *                     description: The date/time the credential expires. Omit for an open-ended credential.
 *     responses:
 *       200:
 *         description: The prepared credential object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 credential:
 *                   type: object
 *                   description: The bound credential.
 *       400:
 *         description: Invalid parameters or schema/subject issues.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/credentials/bind', async (req, res) => {
    try {
        const { schema, subject, options } = req.body;
        const credential = await keymaster.bindCredential(schema, subject, options);
        res.json({ credential });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /credentials/held:
 *   get:
 *     summary: List all credentials currently held by the active ID.
 *     responses:
 *       200:
 *         description: The list of held credential DIDs.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 held:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/credentials/held', async (req, res) => {
    try {
        const held = await keymaster.listCredentials();
        res.json({ held });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /credentials/held:
 *   post:
 *     summary: Accept a credential into the "held" list of the current ID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               did:
 *                 type: string
 *                 description: The credential DID to hold.
 *             required:
 *               - did
 *     responses:
 *       200:
 *         description: Whether the acceptance was successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       400:
 *         description: Invalid DID or failure to accept the credential.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/credentials/held', async (req, res) => {
    try {
        const { did } = req.body;
        const ok = await keymaster.acceptCredential(did);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /credentials/held/{did}:
 *   get:
 *     summary: Retrieve (decrypt) a held credential.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         description: The credential DID to retrieve.
 *     responses:
 *       200:
 *         description: The decrypted credential.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 credential:
 *                   type: object
 *                   description: The credential contents (VC).
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/credentials/held/:did', async (req, res) => {
    try {
        const credential = await keymaster.getCredential(req.params.did);
        res.json({ credential });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /credentials/held/{did}:
 *   delete:
 *     summary: Remove a credential from the "held" list.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         description: The credential DID to remove from holdings.
 *     responses:
 *       200:
 *         description: Whether the removal was successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       400:
 *         description: Invalid DID or request error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.delete('/credentials/held/:did', async (req, res) => {
    try {
        const ok = await keymaster.removeCredential(req.params.did);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /credentials/held/{did}/publish:
 *   post:
 *     summary: Publish a held credential publicly.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         description: The credential DID to publish from the holder's wallet.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               options:
 *                 type: object
 *                 description: Additional parameters controlling the publication.
 *                 properties:
 *                   reveal:
 *                     type: boolean
 *                     default: false
 *                     description: Whether to include the full credential data or just a reference.
 *     responses:
 *       200:
 *         description: Indicates whether the publish operation was successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: object
 *                   description: The updated DID Document or partial success info.
 *       400:
 *         description: Credential not held by this ID or invalid request.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
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

/**
 * @swagger
 * /credentials/held/{did}/unpublish:
 *   post:
 *     summary: Remove a published credential from the holder’s DID Document manifest.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         description: The credential DID to unpublish.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: No additional parameters by default.
 *     responses:
 *       200:
 *         description: Indicates whether the unpublish operation was successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: string
 *                   description: Status message or success flag.
 *       400:
 *         description: Credential not found in the DID Document's manifest or invalid request.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/credentials/held/:did/unpublish', async (req, res) => {
    try {
        const did = req.params.did;
        const ok = await keymaster.unpublishCredential(did);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /credentials/issued:
 *   get:
 *     summary: List all credentials issued by the current ID.
 *     responses:
 *       200:
 *         description: The list of credential DIDs issued by the current ID.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 issued:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/credentials/issued', async (req, res) => {
    try {
        const issued = await keymaster.listIssued();
        res.json({ issued });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /credentials/issued:
 *   post:
 *     summary: Issue a new credential.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               credential:
 *                 type: object
 *                 description: A valid credential object. If omitted, `options.schema` and `options.subject` can be used to generate one.
 *               options:
 *                 type: object
 *                 description: Additional issuance parameters.
 *                 properties:
 *                   schema:
 *                     type: string
 *                     description: DID or name of the schema, used if `credential` is not fully provided.
 *                   subject:
 *                     type: string
 *                     description: DID or name of the subject for which the credential is being issued.
 *                   registry:
 *                     type: string
 *                     description: Where to create the credential DID (e.g., "local", "hyperswarm").
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *                     description: Expiration for the credential DID, if ephemeral.
 *                   retries:
 *                     type: integer
 *                     default: 0
 *                     description: Retries for DID creation or resolution if needed.
 *                   delay:
 *                     type: integer
 *                     default: 1000
 *                     description: Delay between retries in milliseconds.
 *                   encryptForSender:
 *                     type: boolean
 *                     description: Include an encrypted copy for the issuer. Defaults to true.
 *                   includeHash:
 *                     type: boolean
 *                     description: Embed a hash of the credential in the asset. Defaults to false.
 *                   controller:
 *                     type: string
 *                     description: Specific ID or DID to set as the controller of the new asset. Defaults to the issuer’s current ID.
 *     responses:
 *       200:
 *         description: The DID of the newly issued credential asset.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *       400:
 *         description: Invalid credential data or issuance error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/credentials/issued', async (req, res) => {
    try {
        const { credential, options } = req.body;
        const did = await keymaster.issueCredential(credential, options);
        res.json({ did });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /credentials/issued/{did}:
 *   get:
 *     summary: Retrieve an issued credential by DID.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID of the issued credential to retrieve.
 *     responses:
 *       200:
 *         description: The decrypted credential object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 credential:
 *                   type: object
 *                   description: The credential data.
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
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

/**
 * @swagger
 * /credentials/issued/{did}:
 *   post:
 *     summary: Update an existing issued credential.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID of the issued credential to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               credential:
 *                 type: object
 *                 description: The new credential data to store.
 *             required:
 *               - credential
 *     responses:
 *       200:
 *         description: Whether the update was successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       400:
 *         description: Invalid credential or operation error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
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

/**
 * @swagger
 * /credentials/issued/{did}:
 *   delete:
 *     summary: Revoke a previously issued credential.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID of the credential to revoke.
 *     responses:
 *       200:
 *         description: Whether the revocation (delete) operation was successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       400:
 *         description: Invalid DID or revocation error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.delete('/credentials/issued/:did', async (req, res) => {
    try {
        const did = req.params.did;
        const ok = await keymaster.revokeCredential(did);
        res.json({ ok });
    } catch (error) {
        res.status(400).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /keys/rotate:
 *   post:
 *     summary: Rotate the current ID's keys.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: No options required. Key rotation applies to the current ID.
 *     responses:
 *       200:
 *         description: The updated DID Document reflecting the new key rotation.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: object
 *                   description: The updated DID Document (with the new key).
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/keys/rotate', async (req, res) => {
    try {
        const ok = await keymaster.rotateKeys();
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /keys/encrypt/message:
 *   post:
 *     summary: Encrypt a plaintext message into a DID asset.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               msg:
 *                 type: string
 *                 description: The plaintext message to encrypt.
 *               receiver:
 *                 type: string
 *                 description: The DID (or name) of the intended recipient.
 *               options:
 *                 type: object
 *                 description: Additional encryption/creation parameters.
 *                 properties:
 *                   registry:
 *                     type: string
 *                     description: Where to create the asset DID (e.g., "local", "hyperswarm").
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *                     description: When this asset should expire. If omitted, it is permanent unless manually revoked.
 *                   retries:
 *                     type: integer
 *                     default: 0
 *                     description: Number of times to retry the operation if not immediately successful.
 *                   delay:
 *                     type: integer
 *                     default: 1000
 *                     description: Milliseconds to wait between retries.
 *                   encryptForSender:
 *                     type: boolean
 *                     default: true
 *                     description: Whether to include an encrypted copy for the sender.
 *                   includeHash:
 *                     type: boolean
 *                     default: false
 *                     description: Whether to embed a hash of the plaintext in the asset.
 *                   controller:
 *                     type: string
 *                     description: Which ID or DID should control this newly created asset. Defaults to the current ID.
 *     responses:
 *       200:
 *         description: The DID of the newly created encrypted asset.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *       500:
 *         description: Internal server error (encryption or wallet issue).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/keys/encrypt/message', async (req, res) => {
    try {
        const { msg, receiver, options } = req.body;
        const did = await keymaster.encryptMessage(msg, receiver, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /keys/decrypt/message:
 *   post:
 *     summary: Decrypt an encrypted message asset by DID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               did:
 *                 type: string
 *                 description: The DID representing the encrypted asset.
 *             required:
 *               - did
 *     responses:
 *       200:
 *         description: The decrypted plaintext message.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: The original message that was encrypted.
 *       500:
 *         description: Internal server error (e.g., no matching key found to decrypt).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/keys/decrypt/message', async (req, res) => {
    try {
        const message = await keymaster.decryptMessage(req.body.did);
        res.json({ message });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /keys/encrypt/json:
 *   post:
 *     summary: Encrypt a JSON object into a DID asset.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               json:
 *                 type: object
 *                 description: The JSON object to be encrypted.
 *               receiver:
 *                 type: string
 *                 description: The DID (or name) of the intended recipient.
 *               options:
 *                 type: object
 *                 description: Additional encryption/creation parameters (same fields as `/keys/encrypt/message`).
 *                 properties:
 *                   registry:
 *                     type: string
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *                   retries:
 *                     type: integer
 *                     default: 0
 *                   delay:
 *                     type: integer
 *                     default: 1000
 *                   encryptForSender:
 *                     type: boolean
 *                     default: true
 *                   includeHash:
 *                     type: boolean
 *                     default: false
 *                   controller:
 *                     type: string
 *     responses:
 *       200:
 *         description: The DID of the encrypted JSON asset.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *       500:
 *         description: Internal server error (e.g., encryption or wallet issue).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/keys/encrypt/json', async (req, res) => {
    try {
        const { json, receiver, options } = req.body;
        const did = await keymaster.encryptJSON(json, receiver, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /keys/decrypt/json:
 *   post:
 *     summary: Decrypt a JSON asset by DID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               did:
 *                 type: string
 *                 description: The DID representing the encrypted JSON asset.
 *             required:
 *               - did
 *     responses:
 *       200:
 *         description: The decrypted JSON object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 json:
 *                   type: object
 *                   description: The original JSON data that was encrypted.
 *       500:
 *         description: Internal server error (no matching key found to decrypt or other error).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/keys/decrypt/json', async (req, res) => {
    try {
        const json = await keymaster.decryptJSON(req.body.did);
        res.json({ json });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /keys/sign:
 *   post:
 *     summary: Add a signature to a JSON object using the current ID's keys.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               contents:
 *                 type: string
 *                 description: A JSON string representing the data to be signed.
 *             required:
 *               - contents
 *     responses:
 *       200:
 *         description: The signed object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 signed:
 *                   type: object
 *                   description: The original JSON plus a `signature` block.
 *       500:
 *         description: Internal server error (e.g., signing failure).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/keys/sign', async (req, res) => {
    try {
        const signed = await keymaster.addSignature(JSON.parse(req.body.contents));
        res.json({ signed });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /keys/verify:
 *   post:
 *     summary: Verify a JSON object's signature.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               json:
 *                 type: object
 *                 description: The signed JSON object to verify, which must include a `signature` property.
 *             required:
 *               - json
 *     responses:
 *       200:
 *         description: Whether the signature is valid.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                   description: true if the signature is valid; otherwise `false`.
 *       500:
 *         description: Internal server error (verification failure or unexpected error).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/keys/verify', async (req, res) => {
    try {
        const ok = await keymaster.verifySignature(req.body.json);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /schemas/{id}/template/:
 *   post:
 *     summary: Generate a JSON template from a schema.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The name or DID of the schema from which to generate a template.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               schema:
 *                 type: string
 *                 description: The DID or name of the schema. (Typically matches the path parameter, but can be re-specified here.)
 *     responses:
 *       200:
 *         description: The generated JSON template object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 template:
 *                   type: object
 *                   description: A skeleton object containing placeholder values that conform to the schema.
 *       500:
 *         description: Internal server error (e.g., invalid or non-existent schema).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/schemas/:id/template/', async (req, res) => {
    try {
        const { schema } = req.body;
        const template = await keymaster.createTemplate(schema);
        res.json({ template });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /assets:
 *   post:
 *     summary: Create a new asset DID.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               data:
 *                 type: object
 *                 description: Arbitrary data to store in this asset.
 *               options:
 *                 type: object
 *                 description: Additional creation parameters.
 *                 properties:
 *                   registry:
 *                     type: string
 *                     description: Where to create the asset DID (e.g., "local", "hyperswarm").
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *                     description: Expiration date/time for an ephemeral asset. Omit for a permanent asset.
 *                   retries:
 *                     type: integer
 *                     default: 0
 *                     description: Number of times to retry creation if not successful at first.
 *                   delay:
 *                     type: integer
 *                     default: 1000
 *                     description: Milliseconds to wait between retries.
 *                   encryptForSender:
 *                     type: boolean
 *                     default: true
 *                     description: Whether to include an encrypted copy for the creator (sender).
 *                   includeHash:
 *                     type: boolean
 *                     default: false
 *                     description: Whether to embed a hash of the `data` in the asset for verification.
 *                   controller:
 *                     type: string
 *                     description: Specific ID or DID to act as the asset’s controller. Defaults to the current ID.
 *     responses:
 *       200:
 *         description: The DID of the newly created asset.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *       500:
 *         description: Internal server error (e.g., invalid parameters or wallet error).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/assets', async (req, res) => {
    try {
        const { data, options } = req.body;
        const did = await keymaster.createAsset(data, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /assets:
 *   get:
 *     summary: List all asset DIDs owned by the current ID.
 *     responses:
 *       200:
 *         description: A list of asset DIDs.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 assets:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/assets', async (req, res) => {
    try {
        const assets = await keymaster.listAssets();
        res.json({ assets });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /assets/{id}:
 *   get:
 *     summary: Resolve (retrieve) an asset by DID or name.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The asset name or DID to resolve.
 *     responses:
 *       200:
 *         description: The resolved asset data.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 asset:
 *                   type: object
 *                   description: The `didDocumentData` for the asset, or null if not found.
 *       404:
 *         description: Asset not found or is deactivated.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/assets/:id', async (req, res) => {
    try {
        const asset = await keymaster.resolveAsset(req.params.id);
        res.json({ asset });
    } catch (error) {
        return res.status(404).send({ error: 'Asset not found' });
    }
});

/**
 * @swagger
 * /assets/{id}:
 *   put:
 *     summary: Update an existing asset.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The asset DID or name to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               data:
 *                 type: object
 *                 description: The new data to store in this asset's DID Document.
 *     responses:
 *       200:
 *         description: Indicates whether the update was successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.put('/assets/:id', async (req, res) => {
    try {
        const { data } = req.body;
        const ok = await keymaster.updateAsset(req.params.id, data);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /templates/poll:
 *   get:
 *     summary: Retrieve a boilerplate poll template.
 *     responses:
 *       200:
 *         description: The default poll template object.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 template:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                     version:
 *                       type: integer
 *                     description:
 *                       type: string
 *                     roster:
 *                       type: string
 *                     options:
 *                       type: array
 *                       items:
 *                         type: string
 *                     deadline:
 *                       type: string
 *                       format: date-time
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/templates/poll', async (req, res) => {
    try {
        const template = await keymaster.pollTemplate();
        res.json({ template });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /polls/:
 *   get:
 *     summary: List polls owned by (or associated with) a given ID.
 *     parameters:
 *       - in: query
 *         name: owner
 *         required: false
 *         schema:
 *           type: string
 *         description: The name or DID of the owner ID to list polls for.
 *     responses:
 *       200:
 *         description: A list of poll DIDs.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 polls:
 *                   type: array
 *                   items:
 *                     type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/polls/', async (req, res) => {
    try {
        const polls = await keymaster.listPolls(req.query.owner);
        res.json({ polls });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /polls/:
 *   post:
 *     summary: Create a new poll.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               poll:
 *                 type: object
 *                 description: The poll definition containing the required fields.
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [ "poll" ]
 *                     default: "poll"
 *                     description: Must be "poll".
 *                   version:
 *                     type: integer
 *                     default: 1
 *                     description: Must be 1 (only version 1 is supported).
 *                   description:
 *                     type: string
 *                     description: A short description or question for the poll.
 *                   roster:
 *                     type: string
 *                     description: The DID or name of a group defining who is eligible to vote.
 *                   options:
 *                     type: array
 *                     description: A list of possible choices for the poll (at least 2, up to 10).
 *                     minItems: 2
 *                     maxItems: 10
 *                     items:
 *                       type: string
 *                   deadline:
 *                     type: string
 *                     format: date-time
 *                     description: The date-time by which the poll closes (must be in the future).
 *                 required:
 *                   - type
 *                   - version
 *                   - description
 *                   - roster
 *                   - options
 *                   - deadline
 *               options:
 *                 type: object
 *                 description: Additional parameters for poll creation.
 *                 properties:
 *                   registry:
 *                     type: string
 *                     description: Where to create the poll DID (e.g., "local", "hyperswarm").
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *                     description: Expiration timestamp for the poll DID itself (not the poll’s internal deadline).
 *                   retries:
 *                     type: integer
 *                     default: 0
 *                     description: Number of times to retry poll creation if it fails initially.
 *                   delay:
 *                     type: integer
 *                     default: 1000
 *                     description: Delay in milliseconds between retries.
 *                   encryptForSender:
 *                     type: boolean
 *                     default: true
 *                     description: Include an encrypted copy for the poll creator if encryption is used.
 *                   includeHash:
 *                     type: boolean
 *                     default: false
 *                     description: Whether to embed a hash of the poll in the DID asset.
 *                   controller:
 *                     type: string
 *                     description: The ID/DID that should own/control this poll. Defaults to the current ID if omitted.
 *     responses:
 *       200:
 *         description: The DID representing the newly created poll.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/polls/', async (req, res) => {
    try {
        const { poll, options } = req.body;
        const did = await keymaster.createPoll(poll, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /polls/{poll}:
 *   get:
 *     summary: Retrieve the raw poll data by DID or name.
 *     parameters:
 *       - in: path
 *         name: poll
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID or name of the poll to retrieve.
 *     responses:
 *       200:
 *         description: The poll object (if found).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 poll:
 *                   type: object
 *                   description: The poll data (type, version, options, roster, ballots, etc.).
 *       500:
 *         description: Internal server error or poll not found.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/polls/:poll', async (req, res) => {
    try {
        const poll = await keymaster.getPoll(req.params.poll);
        res.json({ poll });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /polls/{poll}/test:
 *   get:
 *     summary: Check if a DID or name refers to a valid poll.
 *     parameters:
 *       - in: path
 *         name: poll
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID or name of the poll to test.
 *     responses:
 *       200:
 *         description: Indicates whether the asset is recognized as a valid poll.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 test:
 *                   type: boolean
 *                   description: true if valid poll, otherwise `false`.
 *       500:
 *         description: Internal server error (e.g., resolution error).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/polls/:poll/test', async (req, res) => {
    try {
        const test = await keymaster.testPoll(req.params.poll);
        res.json({ test });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /polls/{poll}/view:
 *   get:
 *     summary: View detailed poll information, including results if the caller is the poll owner.
 *     parameters:
 *       - in: path
 *         name: poll
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID or name of the poll to view.
 *     responses:
 *       200:
 *         description: The poll view object, including voting status and (if owner) results.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 poll:
 *                   type: object
 *                   description: Contains information about eligibility, results, etc.
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.get('/polls/:poll/view', async (req, res) => {
    try {
        const poll = await keymaster.viewPoll(req.params.poll);
        res.json({ poll });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /polls/vote:
 *   post:
 *     summary: Cast a vote in a poll.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               poll:
 *                 type: string
 *                 description: The DID or name of the poll to vote in.
 *               vote:
 *                 type: integer
 *                 description: The numerical option index (1-based). Alternatively, use `spoil` in `options`.
 *               options:
 *                 type: object
 *                 description: Additional vote parameters.
 *                 properties:
 *                   spoil:
 *                     type: boolean
 *                     default: false
 *                     description: If true, casts a spoiled ballot (vote=0).
 *                   registry:
 *                     type: string
 *                     description: Where to create the ballot DID (e.g. "local", "hyperswarm").
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *                     description: Expiration for the ballot DID, if ephemeral.
 *                   retries:
 *                     type: integer
 *                     default: 0
 *                   delay:
 *                     type: integer
 *                     default: 1000
 *                   encryptForSender:
 *                     type: boolean
 *                     default: false
 *                     description: Whether to store an encrypted copy for the voter. Typically false for a secret ballot.
 *                   includeHash:
 *                     type: boolean
 *                     default: false
 *                   controller:
 *                     type: string
 *                     description: Which ID or DID to assign as the ballot’s controller. Defaults to the poll's owner, but usually not changed here.
 *     responses:
 *       200:
 *         description: The DID representing the newly created ballot (to be submitted to the poll owner).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 did:
 *                   type: string
 *       500:
 *         description: Internal server error (e.g., poll not valid, or wallet issue).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/polls/vote', async (req, res) => {
    try {
        const { poll, vote, options } = req.body;
        const did = await keymaster.votePoll(poll, vote, options);
        res.json({ did });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /polls/update:
 *   put:
 *     summary: Record a received ballot in the poll.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ballot:
 *                 type: string
 *                 description: The DID of the ballot to record in the poll.
 *             required:
 *               - ballot
 *     responses:
 *       200:
 *         description: Indicates whether the ballot was successfully recorded.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.put('/polls/update', async (req, res) => {
    try {
        const { ballot } = req.body;
        const ok = await keymaster.updatePoll(ballot);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /polls/{poll}/publish:
 *   post:
 *     summary: Publish final poll results to the poll’s DID Document.
 *     parameters:
 *       - in: path
 *         name: poll
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID or name of the poll to publish.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               options:
 *                 type: object
 *                 description: Publication parameters.
 *                 properties:
 *                   reveal:
 *                     type: boolean
 *                     default: false
 *                     description: If true, includes all ballots. If false, only the summary is published.
 *     responses:
 *       200:
 *         description: Indicates whether the publish operation was successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: object
 *                   description: Typically the updated poll object or success indication.
 *       500:
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/polls/:poll/publish', async (req, res) => {
    try {
        const { options } = req.body;
        const ok = await keymaster.publishPoll(req.params.poll, options);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

/**
 * @swagger
 * /polls/{poll}/unpublish:
 *   post:
 *     summary: Remove previously published poll results from the poll's DID Document.
 *     parameters:
 *       - in: path
 *         name: poll
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID or name of the poll to unpublish.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: No additional parameters, unless needed for future expansions.
 *     responses:
 *       200:
 *         description: Indicates whether the unpublish operation was successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *       500:
 *         description: Internal server error or invalid poll ownership.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post('/polls/:poll/unpublish', async (req, res) => {
    try {
        const ok = await keymaster.unpublishPoll(req.params.poll);
        res.json({ ok });
    } catch (error) {
        res.status(500).send({ error: error.toString() });
    }
});

v1router.post('/images', express.raw({ type: 'application/octet-stream', limit: '10mb' }), async (req, res) => {
    try {
        const data = req.body;
        const response = await keymaster.createImage(data);
        res.send(response);
    } catch (error) {
        res.status(500).send(error.toString());
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
    const defaultRegistry = config.defaultRegistry;
    keymaster = new Keymaster({ gatekeeper, wallet, cipher, defaultRegistry });
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
