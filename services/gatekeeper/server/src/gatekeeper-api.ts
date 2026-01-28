import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

import Gatekeeper from '@mdip/gatekeeper';
import DbJsonCache from '@mdip/gatekeeper/db/json-cache';
import DbRedis from '@mdip/gatekeeper/db/redis';
import DbSqlite from '@mdip/gatekeeper/db/sqlite';
import DbMongo from '@mdip/gatekeeper/db/mongo';
import { CheckDIDsResult, ResolveDIDOptions, Operation } from '@mdip/gatekeeper/types';
import KuboClient from '@mdip/ipfs/kubo';
import ClusterClient from '@mdip/ipfs/cluster';
import config from './config.js';

EventEmitter.defaultMaxListeners = 100;

const dbName = 'mdip';
const db = (() => {
    switch (config.db) {
    case 'sqlite': return new DbSqlite(dbName);
    case 'mongodb': return new DbMongo(dbName);
    case 'redis': return new DbRedis(dbName);
    case 'json':
    case 'json-cache': return new DbJsonCache(dbName);
    default: return null;
    }
})();

if (!db) {
    throw new Error(`Unsupported DB type: ${config.db}`);
}

await db.start();

const ipfs = config.ipfsClusterURL
    ? await ClusterClient.create({
        kuboUrl: config.ipfsURL,
        clusterUrl: config.ipfsClusterURL,
        clusterAuthHeader: config.ipfsClusterAuthHeader,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    })
    : await KuboClient.create({
        url: config.ipfsURL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

const gatekeeper = new Gatekeeper({
    db,
    ipfs,
    didPrefix: config.didPrefix,
    registries: config.registries,
    maxOpBytes: config.maxOpBytes,
});
const startTime = new Date();
const app = express();
const v1router = express.Router();

app.use(cors());
app.options('*', cors());

app.use(morgan('dev'));
app.use(express.json({ limit: config.jsonLimit }));

// Define __dirname in ES module scope
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const serveClient = (process.env.KC_GATEKEEPER_SERVE_CLIENT ?? 'true').toLowerCase() === 'true';

if (serveClient) {
    const clientBuildDir = path.join(__dirname, '../../client/build');

    // Serve the React frontend
    app.use(express.static(clientBuildDir));

    app.use((req, res, next) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(clientBuildDir, 'index.html'));
        } else {
            next();
        }
    });
}

let serverReady = false;

/**
 * @swagger
 * /ready:
 *   get:
 *     summary: Check if the Gatekeeper service is ready.
 *     responses:
 *       200:
 *         description: Gatekeeper service is ready.
 *         content:
 *           text/plain:
 *             schema:
 *               type: boolean
 */
v1router.get('/ready', async (req, res) => {
    try {
        res.json(serverReady);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /version:
 *   get:
 *     summary: Retrieve the API version
 *     responses:
 *       200:
 *         description: The API version number.
 *         content:
 *           application/json:
 *             schema:
 *               type: integer
 *       500:
 *         description: Internal Server Error.
 */
v1router.get('/version', async (req, res) => {
    try {
        res.json(1);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /status:
 *   get:
 *     summary: Retrieve server status
 *     responses:
 *       200:
 *         description: Status information retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 uptimeSeconds:
 *                   type: integer
 *                   description: The number of seconds since the server started.
 *                 dids:
 *                   type: object
 *                   description: Detailed statistics of DID checks.
 *                   properties:
 *                     total:
 *                       type: integer
 *                       description: Total number of DIDs processed.
 *                     byType:
 *                       type: object
 *                       description: Breakdown of DIDs by type.
 *                       properties:
 *                         agents:
 *                           type: integer
 *                           description: Number of DIDs of type "agent".
 *                         assets:
 *                           type: integer
 *                           description: Number of DIDs of type "asset".
 *                         confirmed:
 *                           type: integer
 *                           description: Number of DIDs that have been confirmed.
 *                         unconfirmed:
 *                           type: integer
 *                           description: Number of DIDs that remain unconfirmed.
 *                         ephemeral:
 *                           type: integer
 *                           description: Number of DIDs with an expiration (validUntil) set.
 *                         invalid:
 *                           type: integer
 *                           description: Number of DIDs that could not be resolved or are invalid.
 *                     byRegistry:
 *                       type: object
 *                       description: Count of DIDs grouped by registry.
 *                       additionalProperties:
 *                         type: integer
 *                     byVersion:
 *                       type: object
 *                       description: Count of DIDs grouped by version.
 *                       additionalProperties:
 *                         type: integer
 *                     eventsQueue:
 *                       type: object
 *                       description: Details of the events queue.
 *                 memoryUsage:
 *                   type: object
 *                   description: Memory usage statistics provided by Node.
 *                   properties:
 *                     rss:
 *                       type: integer
 *                       description: Resident Set Size – total memory allocated for the process.
 *                     heapTotal:
 *                       type: integer
 *                       description: Total size of the allocated heap.
 *                     heapUsed:
 *                       type: integer
 *                       description: Actual memory used during execution.
 *                     external:
 *                       type: integer
 *                       description: Memory usage of C++ objects bound to JavaScript objects managed by V8.
 *                     arrayBuffers:
 *                       type: integer
 *                       description: Memory allocated for ArrayBuffers and SharedArrayBuffers.
 *       500:
 *         description: Internal Server Error.
 */
v1router.get('/status', async (req, res) => {
    try {
        const status = await getStatus();
        res.json(status);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /did:
 *   post:
 *     summary: Create, update, or delete a DID
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 required: [ type, created, mdip, signature ]
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [ "create" ]
 *                     description: Must be "create" to create a new DID.
 *                   created:
 *                     type: string
 *                     format: date-time
 *                     description: Timestamp of when the operation was created.
 *                   mdip:
 *                     type: object
 *                     required: [ version, type, registry ]
 *                     properties:
 *                       version:
 *                         type: integer
 *                         description: MDIP version (e.g., 1).
 *                       type:
 *                         type: string
 *                         enum: [ "agent", "asset" ]
 *                         description: MDIP type.
 *                       registry:
 *                         type: string
 *                         description: Registry where the DID is created.
 *                       validUntil:
 *                         type: string
 *                         format: date-time
 *                         description: Optional expiration time for ephemeral DIDs.
 *                     description: MDIP metadata fields for creation.
 *                   signature:
 *                     type: object
 *                     description: Cryptographic signature verifying the create operation.
 *                     required: [ value, signed ]
 *                     properties:
 *                       value:
 *                         type: string
 *                         description: The signature value (base64, hex, etc.).
 *                       signed:
 *                         type: string
 *                         format: date-time
 *                         description: When the signature was created.
 *                       signer:
 *                         type: string
 *                         description: The DID of the signer (for asset creation, should match `controller`).
 *                       hash:
 *                         type: string
 *                         description: Hash of the operation payload, if applicable.
 *                   publicJwk:
 *                     type: object
 *                     description: Required if mdip.type = "agent". Contains the public key in JWK format.
 *                   controller:
 *                     type: string
 *                     description: Required if mdip.type = "asset". Must match the `signer` in `signature`.
 *
 *               - type: object
 *                 required: [ type, did, signature ]
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [ "update" ]
 *                     description: Must be "update" to modify an existing DID document.
 *                   did:
 *                     type: string
 *                     description: The DID to update.
 *                   doc:
 *                     type: object
 *                     description: The updated DID document or subset of data.
 *                   previd:
 *                     type: string
 *                     description: Reference to the previous version CID/hash.
 *                   signature:
 *                     type: object
 *                     required: [ value, signed ]
 *                     description: Cryptographic signature verifying this update operation.
 *                     properties:
 *                       value:
 *                         type: string
 *                         description: The signature value (base64, hex, etc.).
 *                       signed:
 *                         type: string
 *                         format: date-time
 *                         description: When the signature was created.
 *                       signer:
 *                         type: string
 *                         description: The DID of the signer (often the same as `did`).
 *                       hash:
 *                         type: string
 *                         description: Optional hash of the operation payload.
 *
 *               - type: object
 *                 required: [ type, did, signature ]
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [ "delete" ]
 *                     description: Must be "delete" to deactivate an existing DID.
 *                   did:
 *                     type: string
 *                     description: The DID to deactivate.
 *                   signature:
 *                     type: object
 *                     required: [ value, signed ]
 *                     description: Cryptographic signature verifying this delete operation.
 *                     properties:
 *                       value:
 *                         type: string
 *                         description: The signature value (base64, hex, etc.).
 *                       signed:
 *                         type: string
 *                         format: date-time
 *                         description: When the signature was created.
 *                       signer:
 *                         type: string
 *                         description: The DID of the signer, who must have authority to delete.
 *                       hash:
 *                         type: string
 *                         description: Optional hash of the operation payload.
 *
 *     responses:
 *       200:
 *         description: >
 *           - If `type = "create"`, returns the newly created DID as a string.
 *           - Otherwise (for update or delete), returns a boolean value indicating success.
 *         content:
 *           text/plain:
 *             schema:
 *               oneOf:
 *                 - type: string
 *                   description: A DID string (when a create operation succeeds).
 *                   example: did:mdip:z3v8AuahvBGDMXvCTWedYbxnH6C9ZrsEtEJAvip2XPzcZb8yo6A
 *                 - type: boolean
 *                   description: A success indicator for update/delete operations.
 *                   example: true
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/did', async (req, res) => {
    try {
        const operation = req.body;
        let result;
        if (operation && operation.type === "create") {
            result = await gatekeeper.createDID(operation);
        } else {
            result = await gatekeeper.updateDID(operation);
        }
        res.json(result);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /did/generate:
 *   post:
 *     summary: Generate a DID from an operation (no persistence)
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: An MDIP Operation object.
 *             required: [ type, mdip ]
 *             properties:
 *               type:
 *                 type: string
 *                 description: The operation type. Typically "create" when generating a DID.
 *               created:
 *                 type: string
 *                 format: date-time
 *                 description: Optional creation timestamp (used by create operations elsewhere).
 *               did:
 *                 type: string
 *                 description: Optional DID (usually absent for create when generating).
 *               mdip:
 *                 type: object
 *                 description: MDIP metadata for the operation.
 *                 required: [ version, type, registry ]
 *                 properties:
 *                   version:
 *                     type: integer
 *                     example: 1
 *                   type:
 *                     type: string
 *                     enum: [ agent, asset ]
 *                     example: agent
 *                   registry:
 *                     type: string
 *                     description: Registry name.
 *                     example: local
 *                   prefix:
 *                     type: string
 *                     description: Optional DID prefix override. If omitted, server default is used.
 *                     example: did:test
 *                   validUntil:
 *                     type: string
 *                     format: date-time
 *                     description: Optional expiry timestamp for ephemeral DIDs.
 *               publicJwk:
 *                 type: object
 *                 description: Public key JWK (typically required for agent creates).
 *               controller:
 *                 type: string
 *                 description: Controller DID (typically required for asset creates).
 *               data:
 *                 type: object
 *                 description: Optional arbitrary DID document data (often used for assets).
 *               signature:
 *                 type: object
 *                 description: Optional signature object (not required for mere DID generation).
 *
 *     responses:
 *       200:
 *         description: The generated DID string.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *       400:
 *         description: Bad Request (missing or invalid operation).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
v1router.post("/did/generate", async (req, res) => {
    try {
        const operation = req.body as Operation;

        if (!operation) {
            res.status(400).json({ error: "missing operation" })
            return;
        }

        const did = await gatekeeper.generateDID(operation);
        res.json(did);
    } catch (err: any) {
        res.status(400).json(err?.response?.data ?? err);
    }
});

/**
 * @swagger
 * /did/{did}:
 *   get:
 *     summary: Resolve a DID Document
 *
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID to resolve.
 *       - in: query
 *         name: versionTime
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: >
 *           Timestamp to return the state of the DID as of this specific time.
 *       - in: query
 *         name: versionSequence
 *         required: false
 *         schema:
 *           type: integer
 *         description: >
 *           Specific version of the DID Document to retrieve. Versioning increments each time an `update` or `delete` operation occurs.
 *       - in: query
 *         name: confirm
 *         required: false
 *         schema:
 *           type: boolean
 *         description: >
 *           If `true`, returns the DID Document if it is fully confirmed.
 *       - in: query
 *         name: verify
 *         required: false
 *         schema:
 *           type: boolean
 *         description: >
 *           If `true`, verifies the signature(s) of the DID operation(s) before returning the DID Document.
 *           If a signature is invalid, an error is thrown.
 *     responses:
 *       200:
 *         description: Successfully resolved DID Document.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: The fully-resolved DID Document along with metadata describing its state.
 *               properties:
 *                 "@context":
 *                   type: string
 *                   description: DID resolution context.
 *                 didDocument:
 *                   type: object
 *                   description: The DID Document itself.
 *                   properties:
 *                     "@context":
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: DID document context.
 *                     id:
 *                       type: string
 *                       description: The DID.
 *                     controller:
 *                       type: string
 *                       description: The controller DID (for assets).
 *                     verificationMethod:
 *                       type: array
 *                       description: An array of verification methods (keys).
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             description: Identifier for the verification method.
 *                           controller:
 *                             type: string
 *                             description: The DID or entity controlling this key.
 *                           type:
 *                             type: string
 *                             description: Type of key.
 *                           publicKeyJwk:
 *                             type: object
 *                             description: Public key data in JWK format.
 *                     authentication:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Refers to the verification methods used for authentication.
 *                 didDocumentMetadata:
 *                   type: object
 *                   description: Metadata associated with the DID Document.
 *                   properties:
 *                     created:
 *                       type: string
 *                       format: date-time
 *                       description: Timestamp indicating when the DID was created.
 *                     updated:
 *                       type: string
 *                       format: date-time
 *                       description: Timestamp indicating the last update to the DID, if any.
 *                     deleted:
 *                       type: string
 *                       format: date-time
 *                       description: Timestamp of when the DID was deleted (if it was deleted).
 *                     version:
 *                       type: integer
 *                       description: Current version number of the DID Document.
 *                     versionId:
 *                       type: string
 *                       description: CID (or similar) identifying the current version’s content.
 *                     canonicalId:
 *                       type: string
 *                       description: The canonical DID if a custom prefix was used.
 *                     confirmed:
 *                       type: boolean
 *                       description: Indicates whether the DID is fully confirmed.
 *                     deactivated:
 *                       type: boolean
 *                       description: Indicates if the DID is deactivated (via a delete operation).
 *                 didDocumentData:
 *                   type: object
 *                   description: Arbitrary data attached to the DID (for assets).
 *                 mdip:
 *                   type: object
 *                   description: MDIP-specific metadata fields.
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [ "agent", "asset" ]
 *                       description: The MDIP type.
 *                     registry:
 *                       type: string
 *                       enum: [ "local", "hyperswarm", "TBTC", "TFTC" ]
 *                       description: Registry in which this DID is maintained.
 *                     version:
 *                       type: integer
 *                       description: Supported MDIP version.
 *                     validUntil:
 *                       type: string
 *                       format: date-time
 *                       description: Optional expiration timestamp for ephemeral DIDs.
 *                     registration:
 *                       type: string
 *                       description: Blockchain or other registry reference for an updated or deleted DID.
 *       404:
 *         description: DID not found. The DID either does not exist or cannot be resolved.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Internal Server Error.
 */
v1router.get('/did/:did', async (req, res) => {
    try {
        const options: ResolveDIDOptions = {};
        const { versionTime, versionSequence, confirm, verify } = req.query;

        if (typeof versionTime === 'string') {
            options.versionTime = versionTime;
        }

        if (typeof versionSequence === 'string') {
            const parsed = parseInt(versionSequence, 10);
            if (!isNaN(parsed)) {
                options.versionSequence = parsed;
            }
        }

        if (confirm) {
            options.confirm = confirm === 'true';
        }

        if (verify) {
            options.verify = verify === 'true';
        }

        const doc = await gatekeeper.resolveDID(req.params.did, options);
        res.json(doc);
    } catch (error: any) {
        res.status(404).send({ error: 'DID not found' });
    }
});

/**
 * @deprecated
 * This endpoint is deprecated in favour of POST /did,
 * which accepts { type: "update" } or { type: "delete" } operations.
 *
 * @swagger
 * /did/{did}:
 *   post:
 *     summary: Update an existing DID (deprecated)
 *     deprecated: true
 *
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID to update.
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ type, did, signature ]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [ "update" ]
 *                 description: Must be `"update"` for this operation.
 *               did:
 *                 type: string
 *                 description: The DID being updated. Must match the path parameter `{did}`.
 *               doc:
 *                 type: object
 *                 description: The updated DID Document or subset of data for this DID.
 *               previd:
 *                 type: string
 *                 description: Reference to the previous version.
 *               signature:
 *                 type: object
 *                 description: Cryptographic signature.
 *
 *     responses:
 *       200:
 *         description: A boolean indicating if the update was accepted.
 *         content:
 *           application/json:
 *             schema:
 *               type: boolean
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/did/:did', async (req, res) => {
    try {
        const operation = req.body;
        const ok = await gatekeeper.updateDID(operation);
        res.json(ok);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @deprecated
 * This endpoint is deprecated in favour of POST /did,
 * which accepts { type: "delete" } operations.
 *
 * @swagger
 * /did/{did}:
 *   delete:
 *     summary: Delete a DID (deprecated)
 *     deprecated: true
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         description: The DID to delete.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ type, did, signature ]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [ "delete" ]
 *                 description: Must be "delete" to deactivate the DID.
 *               did:
 *                 type: string
 *                 description: The DID being deleted.
 *               signature:
 *                 type: object
 *                 description: Cryptographic signature.
 *               previd:
 *                 type: string
 *                 description: Reference to the previous version.
 *     responses:
 *       200:
 *         description: A boolean indicating whether the deletion was accepted and processed.
 *         content:
 *           application/json:
 *             schema:
 *               type: boolean
 *       500:
 *         description: Internal Server Error.
 */
v1router.delete('/did/:did', async (req, res) => {
    try {
        const operation = req.body;
        const ok = await gatekeeper.deleteDID(operation);
        res.json(ok);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /dids/:
 *   post:
 *     summary: Retrieve a list of DIDs or DID Documents.
 *
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dids:
 *                 type: array
 *                 description: A list of specific DIDs to check. If omitted, all known DIDs are retrieved.
 *                 items:
 *                   type: string
 *               updatedAfter:
 *                 type: string
 *                 format: date-time
 *                 description: Only return DIDs/DID Docs updated *after* this time.
 *               updatedBefore:
 *                 type: string
 *                 format: date-time
 *                 description: Only return DIDs/DID Docs updated *before* this time.
 *               confirm:
 *                 type: boolean
 *                 description: If true, only return DID Docs that are fully confirmed.
 *               verify:
 *                 type: boolean
 *                 description: If true, verifies signatures during DID resolution. If signature checks fail, an error is thrown.
 *               resolve:
 *                 type: boolean
 *                 description: If true, return DID Documents instead of just string identifiers.
 *
 *     responses:
 *       200:
 *         description: An array of DIDs or DID Documents.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   description: An array of DID strings.
 *                   items:
 *                     type: string
 *                 - type: array
 *                   description: An array of DID Document objects (if `resolve` is true).
 *                   items:
 *                     type: object
 *                     properties:
 *                       "@context":
 *                         type: string
 *                       didDocument:
 *                         type: object
 *                         description: DID Document contents
 *                       didDocumentMetadata:
 *                         type: object
 *                       mdip:
 *                         type: object
 *
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/dids/', async (req, res) => {
    try {
        const dids = await gatekeeper.getDIDs(req.body);
        res.json(dids);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /dids/remove:
 *   post:
 *     summary: Remove one or more DIDs
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: string
 *               description: A valid DID.
 *
 *     responses:
 *       200:
 *         description: Indicates whether the operation succeeded.
 *         content:
 *           application/json:
 *             schema:
 *               type: boolean
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/dids/remove', async (req, res) => {
    try {
        const dids = req.body;
        const response = await gatekeeper.removeDIDs(dids);
        res.json(response);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /dids/export:
 *   post:
 *     summary: Export events for one or more DIDs
 *
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dids:
 *                 type: array
 *                 description: A list of DIDs to export. If omitted, all known DIDs are exported.
 *                 items:
 *                   type: string
 *
 *     responses:
 *       200:
 *         description: Returns an array of arrays, where each sub-array contains the event objects for a single DID.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               description: Each element corresponds to a DID's event list.
 *               items:
 *                 type: array
 *                 description: An array of event objects for a single DID.
 *                 items:
 *                   type: object
 *                   description: A single event in the DID's event history.
 *                   properties:
 *                     registry:
 *                       type: string
 *                       description: The registry.
 *                     time:
 *                       type: string
 *                       format: date-time
 *                       description: Timestamp indicating when this event occurred.
 *                     ordinal:
 *                       oneOf:
 *                         - type: integer
 *                           description: A single integer ordinal (often 0 if unused)
 *                         - type: array
 *                           description: A tuple of integers for multi-part ordinal keys
 *                           items:
 *                             type: integer
 *                     operation:
 *                       type: object
 *                       description: The DID operation that defines changes.
 *                     did:
 *                       type: string
 *                       description: The DID this event belongs to.
 *
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/dids/export', async (req, res) => {
    try {
        const { dids } = req.body;
        const response = await gatekeeper.exportDIDs(dids);
        res.json(response);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /dids/import:
 *   post:
 *     summary: Import one or more DIDs
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             description: >
 *               An array where each item is itself an array of event objects corresponding
 *               to a single DID’s history.
 *             items:
 *               type: array
 *               description: A list of all events that define one DID's state.
 *               items:
 *                 type: object
 *                 required: [ did, operation, registry, time ]
 *                 properties:
 *                   did:
 *                     type: string
 *                     description: The DID these events belong to.
 *                   operation:
 *                     type: object
 *                     description: The DID operation including signatures and other data.
 *                     properties:
 *                       type:
 *                         type: string
 *                         description: The operation type ("create", "update", or "delete").
 *                       created:
 *                         type: string
 *                         format: date-time
 *                         description: Creation timestamp (if `type = "create"`).
 *                       mdip:
 *                         type: object
 *                         description: MDIP metadata.
 *                       publicJwk:
 *                         type: object
 *                         description: Public key in JWK format (required for agent creates).
 *                       signature:
 *                         type: object
 *                         description: Cryptographic signature
 *                     required:
 *                       - type
 *                       - signature
 *                   registry:
 *                     type: string
 *                     description: The registry this event belongs to.
 *                   time:
 *                     type: string
 *                     format: date-time
 *                     description: Timestamp when this event was recorded.
 *                   ordinal:
 *                     oneOf:
 *                       - type: integer
 *                         description: A single integer ordinal (often 0 if unused)
 *                       - type: array
 *                         description: A tuple of integers for multi-part ordinal keys
 *                         items:
 *                           type: integer
 *
 *     responses:
 *       200:
 *         description: Summary of the import operation.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               description: Object containing counts of how many events were queued, processed (duplicates), rejected, and the current queue total.
 *               properties:
 *                 queued:
 *                   type: integer
 *                   description: Number of new events queued.
 *                 processed:
 *                   type: integer
 *                   description: Number of events recognized as duplicates (already known).
 *                 rejected:
 *                   type: integer
 *                   description: Number of events that failed validation (bad signature, size limit, etc.).
 *                 total:
 *                   type: integer
 *                   description: Total number of events in the queue after this import.
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/dids/import', async (req, res) => {
    try {
        const dids = req.body;
        const response = await gatekeeper.importDIDs(dids);
        res.json(response);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /batch/export:
 *   post:
 *     summary: Export non-local DID events in a single sorted batch
 *
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dids:
 *                 type: array
 *                 description: A list of DIDs to export. If omitted, all known DIDs are used for exporting.
 *                 items:
 *                   type: string
 *
 *     responses:
 *       200:
 *         description: A single sorted array of all non-local events for the specified DIDs.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               description: Each item is an event object, sorted by the signature’s signed timestamp.
 *               items:
 *                 type: object
 *                 properties:
 *                   registry:
 *                     type: string
 *                     description: Registry for this event. Local registry events are excluded.
 *                   time:
 *                     type: string
 *                     format: date-time
 *                     description: When this event was recorded in the database.
 *                   ordinal:
 *                     oneOf:
 *                       - type: integer
 *                         description: A single integer ordinal (often 0 if unused)
 *                       - type: array
 *                         description: A tuple of integers for multi-part ordinal keys
 *                         items:
 *                           type: integer
 *                   operation:
 *                     type: object
 *                     description: Details of the DID operation.
 *                     properties:
 *                       type:
 *                         type: string
 *                         description: The operation type.
 *                       did:
 *                         type: string
 *                         description: The DID for which this event applies.
 *                       signature:
 *                         type: object
 *                         description: Cryptographic signature.
 *                   did:
 *                     type: string
 *                     description: The DID this event belongs to, generally matching operation.did.
 *
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/batch/export', async (req, res) => {
    try {
        const { dids } = req.body;
        const response = await gatekeeper.exportBatch(dids);
        res.json(response);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /batch/import:
 *   post:
 *     summary: Import a batch of DID events
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             description: An array of event objects representing DID operations.
 *             items:
 *               type: object
 *               required: [ did, operation, registry, time ]
 *               properties:
 *                 did:
 *                   type: string
 *                   description: The DID to which this event pertains.
 *                 operation:
 *                   type: object
 *                   description: A DID operation, such as "create", "update", or "delete".
 *                   properties:
 *                     type:
 *                       type: string
 *                       description: Operation type.
 *                       example: "create"
 *                     created:
 *                       type: string
 *                       format: date-time
 *                       description: Timestamp when the DID was created (if `type = "create"`).
 *                     mdip:
 *                       type: object
 *                       description: MDIP metadata (type, version, registry).
 *                     publicJwk:
 *                       type: object
 *                       description: Public key in JWK format, required for "agent" creation.
 *                     signature:
 *                       type: object
 *                       description: Cryptographic signature.
 *                 registry:
 *                   type: string
 *                   description: The registry to which this event belongs.
 *                   example: "local"
 *                 time:
 *                   type: string
 *                   format: date-time
 *                   description: Timestamp when the event was recorded.
 *                 ordinal:
 *                   oneOf:
 *                     - type: integer
 *                       description: A single integer ordinal (often 0 if unused)
 *                     - type: array
 *                       description: A tuple of integers for multi-part ordinal keys
 *                       items:
 *                         type: integer
 *
 *     responses:
 *       200:
 *         description: An object summarizing how many events were queued, processed, rejected, and the current queue size.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 queued:
 *                   type: integer
 *                   description: Number of new, valid events that were queued.
 *                 processed:
 *                   type: integer
 *                   description: Number of events recognized as duplicates.
 *                 rejected:
 *                   type: integer
 *                   description: Number of events that failed validation.
 *                 total:
 *                   type: integer
 *                   description: The total event queue size after this import.
 *
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/batch/import', async (req, res) => {
    try {
        const batch = req.body;
        const response = await gatekeeper.importBatch(batch);
        res.json(response);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /queue/{registry}:
 *   get:
 *     summary: Retrieve the queued events for a specific registry
 *
 *     parameters:
 *       - in: path
 *         name: registry
 *         required: true
 *         schema:
 *           type: string
 *         description: >
 *           The name of the registry whose queue is being retrieved.
 *           Valid values may include "local", "hyperswarm", "TBTC", "TFTC", etc.
 *
 *     responses:
 *       200:
 *         description: An array of queued event objects for the specified registry.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 description: An individual event in the queue.
 *                 properties:
 *                   registry:
 *                     type: string
 *                     description: The registry to which the event belongs.
 *                   time:
 *                     type: string
 *                     format: date-time
 *                     description: Timestamp when this event was added to the queue.
 *                   ordinal:
 *                     oneOf:
 *                       - type: integer
 *                         description: A single integer ordinal (often 0 if unused)
 *                       - type: array
 *                         description: A tuple of integers for multi-part ordinal keys
 *                         items:
 *                           type: integer
 *                   operation:
 *                     type: object
 *                     description: Details of the DID operation.
 *                     properties:
 *                       type:
 *                         type: string
 *                         description: The operation type.
 *                       did:
 *                         type: string
 *                         description: The DID to which this event applies.
 *                       signature:
 *                         type: object
 *                         description: Cryptographic signature.
 *                   did:
 *                     type: string
 *                     description: The DID that this queue event references (often identical to `operation.did`).
 *
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.get('/queue/:registry', async (req, res) => {
    try {
        const queue = await gatekeeper.getQueue(req.params.registry);
        res.json(queue);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /queue/{registry}/clear:
 *   post:
 *     summary: Remove specified DIDs from the queue
 *
 *     parameters:
 *       - in: path
 *         name: registry
 *         required: true
 *         schema:
 *           type: string
 *         description: >
 *           The name of the registry from which events will be cleared.
 *           Must be a valid, supported registry.
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             description: An array of DID operation event objects to remove from the queue.
 *             items:
 *               type: object
 *               description: A queued DID operation event.
 *               properties:
 *                 type:
 *                   type: string
 *                   description: The operation type.
 *                 did:
 *                   type: string
 *                   description: The DID targeted by this operation.
 *                 doc:
 *                   type: object
 *                   description: The (optional) DID document content, present if type is "update" or "create" with doc data.
 *                 previd:
 *                   type: string
 *                   description: Reference to the previous version (optional).
 *                 signature:
 *                   type: object
 *                   description: Cryptographic signature.
 *               required:
 *                 - type
 *                 - did
 *                 - signature
 *
 *     responses:
 *       200:
 *         description: The updated queue after clearing the specified events.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               description: An array of remaining events in the queue. Could be empty if all events were cleared.
 *               items:
 *                 type: object
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/queue/:registry/clear', async (req, res) => {
    try {
        const events = req.body;
        const queue = await gatekeeper.clearQueue(req.params.registry, events);
        res.json(queue);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /registries:
 *   get:
 *     summary: Retrieve supported registries
 *     responses:
 *       200:
 *         description: An array of registry names.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: string
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.get('/registries', async (req, res) => {
    try {
        const registries = await gatekeeper.listRegistries();
        res.json(registries);
    } catch (error: any) {
        console.error(error);
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /db/reset:
 *   get:
 *     summary: Reset the database
 *
 *     responses:
 *       200:
 *         description: The database was successfully reset.
 *         content:
 *           application/json:
 *             schema:
 *               type: boolean
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.get('/db/reset', async (req, res) => {
    try {
        await gatekeeper.resetDb();
        res.json(true);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /db/verify:
 *   get:
 *     summary: Verify all DIDs in the database
 *
 *     responses:
 *       200:
 *         description: Verification results for all DIDs in the database.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: The total number of DIDs that were checked.
 *                 verified:
 *                   type: integer
 *                   description: The count of DIDs that passed verification.
 *                 expired:
 *                   type: integer
 *                   description: The count of DIDs that had expired and were removed.
 *                 invalid:
 *                   type: integer
 *                   description: The count of DIDs that failed verification and were removed.
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.get('/db/verify', async (req, res) => {
    try {
        const response = await gatekeeper.verifyDb();
        res.json(response);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /events/process:
 *   post:
 *     summary: Process queued events
 *     description: >
 *       Iterates over all queued events, importing them if they are valid (adding or merging).
 *       Continues until no more new events can be processed. If `processEvents` is already running,
 *       it may return `{ busy: true }` to indicate that processing is in progress.
 *
 *     responses:
 *       200:
 *         description: >
 *           A summary of how many events were added, merged, rejected, or still pending in the queue.
 *           Or `{ busy: true }` if processing is already underway.
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     busy:
 *                       type: boolean
 *                       description: Indicates that the processing is already in progress.
 *                 - type: object
 *                   properties:
 *                     added:
 *                       type: integer
 *                       description: Number of newly imported events.
 *                     merged:
 *                       type: integer
 *                       description: Number of duplicate events merged.
 *                     rejected:
 *                       type: integer
 *                       description: Number of events that failed validation.
 *                     pending:
 *                       type: integer
 *                       description: Number of events still left in the queue after processing.
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/events/process', async (req, res) => {
    try {
        const response = await gatekeeper.processEvents();
        res.json(response);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /cas/json:
 *   post:
 *     summary: Adds a JSON object to the CAS (Content Addressable Storage)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *       description: The JSON object to store in the CAS
 *
 *     responses:
 *       200:
 *         description: >
 *           A CID (Content Identifier) for the added JSON object in base58btc format
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: z3v8AuahvBGDMXvCTWedYbxnH6C9ZrsEtEJAvip2XPzcZb8yo6A
 *
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/cas/json', async (req, res) => {
    try {
        const response = await gatekeeper.addJSON(req.body);
        res.send(response);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /cas/json/{cid}:
 *   get:
 *     summary: Retrieve a JSON object from the CAS (Content Addressable Storage)
 *     parameters:
 *       - in: path
 *         name: cid
 *         required: true
 *         schema:
 *           type: string
 *         description: The CID (Content Identifier) of the JSON object to retrieve
 *     responses:
 *       200:
 *         description: Successfully retrieved the JSON object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *       404:
 *         description: JSON object not found
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: "Not Found"
 *       500:
 *         description: Internal Server Error
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.get('/cas/json/:cid', async (req, res) => {
    try {
        const response = await gatekeeper.getJSON(req.params.cid);
        res.json(response);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /cas/text:
 *   post:
 *     summary: Adds text to the CAS (Content Addressable Storage)
 *     requestBody:
 *       required: true
 *       content:
 *         text/plain:
 *           schema:
 *             type: string
 *       description: The text to store in the CAS
 *
 *     responses:
 *       200:
 *         description: >
 *           A CID (Content Identifier) for the added text in base58btc format
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: zb2rhoVn27TzH1yQD1Bux7XKxaUBp3Rwzvd8Re9Shp4bEGokf
 *
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/cas/text', express.text({ type: 'text/plain', limit: '10mb' }), async (req, res) => {
    try {
        const response = await gatekeeper.addText(req.body);
        res.send(response);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /cas/text/{cid}:
 *   get:
 *     summary: Retrieve text from the CAS (Content Addressable Storage)
 *     parameters:
 *       - in: path
 *         name: cid
 *         required: true
 *         schema:
 *           type: string
 *         description: The CID (Content Identifier) of the text to retrieve
 *     responses:
 *       200:
 *         description: Successfully retrieved the text
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *       404:
 *         description: Text not found
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: "Not Found"
 *       500:
 *         description: Internal Server Error
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.get('/cas/text/:cid', async (req, res) => {
    try {
        const response = await gatekeeper.getText(req.params.cid);
        res.send(response);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /cas/data:
 *   post:
 *     summary: Adds an octet-stream to the CAS (Content Addressable Storage)
 *     requestBody:
 *       required: true
 *       content:
 *         application/octet-stream:
 *           schema:
 *             type: string
 *             format: binary
 *       description: The data to store in the CAS
 *
 *     responses:
 *       200:
 *         description: >
 *           A CID (Content Identifier) for the added data in base58btc format
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *               example: zdj7WnZAJEYaTTvvDRXCfDpN8raDkX63VrrZBTpV5fw4cVciw
 *
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/cas/data', express.raw({ type: 'application/octet-stream', limit: '10mb' }), async (req, res) => {
    try {
        const data = req.body;
        const response = await gatekeeper.addData(data);
        res.send(response);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /cas/data/{cid}:
 *   get:
 *     summary: Retrieve data from the CAS (Content Addressable Storage)
 *     parameters:
 *       - in: path
 *         name: cid
 *         required: true
 *         schema:
 *           type: string
 *         description: The CID (Content Identifier) of the data to retrieve
 *     responses:
 *       200:
 *         description: Successfully retrieved the data
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Data not found
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *               example: "Not Found"
 *       500:
 *         description: Internal Server Error
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.get('/cas/data/:cid', async (req, res) => {
    try {
        const response = await gatekeeper.getData(req.params.cid);
        res.set('Content-Type', 'application/octet-stream');
        res.send(response);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /block/{registry}/latest:
 *   get:
 *     summary: Retrieve the latest block for a specific registry
 *     parameters:
 *       - in: path
 *         name: registry
 *         required: true
 *         schema:
 *           type: string
 *         description: The name of the registry to retrieve the latest block from.
 *     responses:
 *       200:
 *         description: Successfully retrieved the latest block.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hash:
 *                   type: string
 *                   description: The hash of the latest block.
 *                 height:
 *                   type: integer
 *                   description: The height of the latest block.
 *                 time:
 *                   type: integer
 *                   description: The timestamp of the latest block in seconds since the Unix epoch.
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.get('/block/:registry/latest', async (req, res) => {
    try {
        const { registry } = req.params;
        const block = await gatekeeper.getBlock(registry);
        res.json(block);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /block/{registry}/{blockId}:
 *   get:
 *     summary: Retrieve a specific block for a given registry
 *     parameters:
 *       - in: path
 *         name: registry
 *         required: true
 *         schema:
 *           type: string
 *         description: The name of the registry to retrieve the block from.
 *       - in: path
 *         name: blockId
 *         required: true
 *         schema:
 *           oneOf:
 *             - type: string
 *               description: The hash of the block.
 *             - type: integer
 *               description: The height of the block.
 *         description: >
 *           The identifier of the block to retrieve. Can be either a block hash (string) or a block height (integer).
 *     responses:
 *       200:
 *         description: Successfully retrieved the block.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 hash:
 *                   type: string
 *                   description: The hash of the block.
 *                 height:
 *                   type: integer
 *                   description: The height of the block.
 *                 time:
 *                   type: integer
 *                   description: The timestamp of the block in seconds since the Unix epoch.
 *                 timeISO:
 *                   type: string
 *                   format: date-time
 *                   description: The timestamp of the block in ISO 8601 format.
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.get('/block/:registry/:blockId', async (req, res) => {
    try {
        const { registry, blockId } = req.params;
        const parsedBlockId = /^\d+$/.test(blockId) ? parseInt(blockId, 10) : blockId;
        const block = await gatekeeper.getBlock(registry, parsedBlockId);
        res.json(block);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

/**
 * @swagger
 * /block/{registry}:
 *   post:
 *     summary: Add a new block to a specific registry
 *     parameters:
 *       - in: path
 *         name: registry
 *         required: true
 *         schema:
 *           type: string
 *         description: The name of the registry to which the block will be added.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - hash
 *               - height
 *               - time
 *             properties:
 *               hash:
 *                 type: string
 *                 description: The hash of the block.
 *               height:
 *                 type: integer
 *                 description: The height of the block.
 *               time:
 *                 type: integer
 *                 description: The timestamp of the block in seconds since the Unix epoch.
 *     responses:
 *       200:
 *         description: Successfully added the block.
 *         content:
 *           application/json:
 *             schema:
 *               type: boolean
 *               example: true
 *       500:
 *         description: Internal Server Error.
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 */
v1router.post('/block/:registry', async (req, res) => {
    try {
        const { registry } = req.params;
        const block = req.body;
        const ok = await gatekeeper.addBlock(registry, block);
        res.json(ok);
    } catch (error: any) {
        res.status(500).send(error.toString());
    }
});

app.use('/api/v1', v1router);

app.use('/api', (req, res) => {
    console.warn(`Warning: Unhandled API endpoint - ${req.method} ${req.originalUrl}`);
    res.status(404).json({ message: 'Endpoint not found' });
});

async function gcLoop() {
    try {
        const response = await gatekeeper.verifyDb();
        console.log(`DID garbage collection: ${JSON.stringify(response)} waiting ${config.gcInterval} minutes...`);
        await checkDids();
    }
    catch (error: any) {
        console.error(`Error in DID garbage collection: ${error}`);
    }
    setTimeout(gcLoop, config.gcInterval * 60 * 1000);
}

let didCheck: CheckDIDsResult;

async function checkDids() {
    console.time('checkDIDs');
    didCheck = await gatekeeper.checkDIDs();
    console.timeEnd('checkDIDs');
}

async function getStatus() {
    return {
        uptimeSeconds: Math.round((Date.now() - startTime.getTime()) / 1000),
        dids: didCheck,
        memoryUsage: process.memoryUsage()
    };
}

async function reportStatus() {
    await checkDids();
    const status = await getStatus();

    console.log('Status -----------------------------');

    console.log(`DID Database (${config.db}):`);
    console.log(`  Total: ${status.dids.total}`);

    if (status.dids.total > 0) {
        console.log(`  By type:`);
        console.log(`    Agents: ${status.dids.byType.agents}`);
        console.log(`    Assets: ${status.dids.byType.assets}`);
        console.log(`    Confirmed: ${status.dids.byType.confirmed}`);
        console.log(`    Unconfirmed: ${status.dids.byType.unconfirmed}`);
        console.log(`    Ephemeral: ${status.dids.byType.ephemeral}`);
        console.log(`    Invalid: ${status.dids.byType.invalid}`);

        console.log(`  By registry:`);
        const registries = Object.keys(status.dids.byRegistry).sort();
        for (let registry of registries) {
            console.log(`    ${registry}: ${status.dids.byRegistry[registry]}`);
        }

        console.log(`  By version:`);
        let count = 0;
        for (let version of [1, 2, 3, 4, 5]) {
            const num = status.dids.byVersion[version] || 0;
            console.log(`    ${version}: ${num}`);
            count += num;
        }
        console.log(`    6+: ${status.dids.total - count}`);
    }

    console.log(`Events Queue: ${status.dids.eventsQueue.length} pending`);

    console.log(`Memory Usage Report:`);
    console.log(`  RSS: ${formatBytes(status.memoryUsage.rss)} (Resident Set Size - total memory allocated for the process)`);
    console.log(`  Heap Total: ${formatBytes(status.memoryUsage.heapTotal)} (Total heap allocated)`);
    console.log(`  Heap Used: ${formatBytes(status.memoryUsage.heapUsed)} (Heap actually used)`);
    console.log(`  External: ${formatBytes(status.memoryUsage.external)} (Memory used by C++ objects bound to JavaScript)`);
    console.log(`  Array Buffers: ${formatBytes(status.memoryUsage.arrayBuffers)} (Memory used by ArrayBuffer and SharedArrayBuffer)`);

    console.log(`Uptime: ${status.uptimeSeconds}s (${formatDuration(status.uptimeSeconds)})`);

    console.log('------------------------------------');
}

function formatDuration(seconds: number) {
    const secPerMin = 60;
    const secPerHour = secPerMin * 60;
    const secPerDay = secPerHour * 24;

    const days = Math.floor(seconds / secPerDay);
    seconds %= secPerDay;

    const hours = Math.floor(seconds / secPerHour);
    seconds %= secPerHour;

    const minutes = Math.floor(seconds / secPerMin);
    seconds %= secPerMin;

    let duration = "";

    if (days > 0) {
        if (days > 1) {
            duration += `${days} days, `;
        } else {
            duration += `1 day, `;
        }
    }

    if (hours > 0) {
        if (hours > 1) {
            duration += `${hours} hours, `;
        } else {
            duration += `1 hour, `;
        }
    }

    if (minutes > 0) {
        if (minutes > 1) {
            duration += `${minutes} minutes, `;
        } else {
            duration += `1 minute, `;
        }
    }

    if (seconds === 1) {
        duration += `1 second`;
    } else {
        duration += `${seconds} seconds`;
    }

    return duration;
}

function formatBytes(bytes: number) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Byte';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

async function main() {
    console.log(`Starting KeychainMDIP Gatekeeper with a db (${config.db}) check...`);
    await reportStatus();

    if (config.statusInterval > 0) {
        console.log(`Starting status update every ${config.statusInterval} minutes`);
        setInterval(reportStatus, config.statusInterval * 60 * 1000);
    }
    else {
        console.log(`Status update disabled`);
    }

    if (config.gcInterval > 0) {
        console.log(`Starting DID garbage collection in ${config.gcInterval} minutes`);
        setTimeout(gcLoop, config.gcInterval * 60 * 1000);
    }
    else {
        console.log(`DID garbage collection disabled`);
    }

    console.log(`DID prefix: ${JSON.stringify(gatekeeper.didPrefix)}`);
    console.log(`Supported registries: ${JSON.stringify(gatekeeper.supportedRegistries)}`);

    const server = app.listen(config.port, () => {
        console.log(`Server is running on port ${config.port}`);
        serverReady = true;
    });

    const shutdown = async () => {
        try {
            server.close();
            if (db) {
                db.stop();
            }
        } catch (error: any) {
            console.error("Error during shutdown:", error);
        } finally {
            process.exit(0);
        }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

main();

process.on('uncaughtException', (error) => {
    console.error('Unhandled exception caught', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection caught', reason, promise);
});
