import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { resolveDIDFromEvents } from "@mdip/gatekeeper";
import type { ResolveDIDOptions } from "@mdip/gatekeeper/types";
import GatekeeperClient from "@mdip/gatekeeper/client";
import DIDsSQLite from "./db/sqlite.js";
import DIDsDbMemory from './db/json-memory.js';
import DIDsPostgres from './db/postgres.js';
import DidIndexer from "./DidIndexer.js";
import {DIDsDb} from "./types.js";
import { childLogger } from "@mdip/common/logger";
import config from "./config.js";
import {
    createWhitelistBlockList,
    getSearchStatus,
    isRateLimitWhitelistedRequest,
    parseNonNegativeInteger,
    parseOptionalBoolean,
    parseOptionalPositiveInteger,
    rateLimitWindowUnits,
    shouldSkipRateLimitPath,
} from "./index-helpers.js";

const log = childLogger({ service: 'search-server' });

async function main() {
    const app = express();
    const v1router = express.Router();
    const whitelistBlockList = createWhitelistBlockList(config.rateLimitWhitelist);
    const rateLimitWindowMs = config.rateLimitWindowValue * rateLimitWindowUnits[config.rateLimitWindowUnit];

    app.disable('x-powered-by');
    const corsOptions = {
        origin: '*', // Origin needs to be specified with credentials true
        methods: ['GET', 'POST', 'OPTIONS'],  // Specify which methods are allowed (e.g., GET, POST)
        optionsSuccessStatus: 200  // Some legacy browsers choke on 204
    };

    if (config.trustProxy) {
        app.set('trust proxy', true);
    }

    const apiRateLimiter = config.rateLimitEnabled
        ? rateLimit({
            windowMs: rateLimitWindowMs,
            limit: config.rateLimitMaxRequests,
            statusCode: 429,
            message: { error: 'Too many requests' },
            standardHeaders: 'draft-7',
            legacyHeaders: false,
            skip: (req: express.Request) => {
                if (req.method === 'OPTIONS') {
                    return true;
                }

                if (shouldSkipRateLimitPath(req, config.rateLimitSkipPaths)) {
                    return true;
                }

                if (config.rateLimitWhitelist.length === 0) {
                    return false;
                }

                return isRateLimitWhitelistedRequest(req, whitelistBlockList);
            },
        })
        : null;

    if (config.rateLimitEnabled) {
        log.info(`Rate limiting enabled: ${config.rateLimitMaxRequests} requests per ${config.rateLimitWindowValue} ${config.rateLimitWindowUnit}(s)`);
    }
    else {
        log.info('Rate limiting disabled');
    }

    // eslint-disable-next-line sonarjs/cors
    app.use(cors(corsOptions));
    app.use(express.json({ limit: config.jsonLimit }));

    let didDb: DIDsDb;
    log.info(`Search Server persisting to ${config.db}`);

    if (config.db === 'sqlite') {
        didDb = await DIDsSQLite.create();
    } else if (config.db === 'postgres') {
        didDb = await DIDsPostgres.create(config.postgresURL);
    } else {
        didDb = new DIDsDbMemory();
    }

    const gatekeeper = new GatekeeperClient();
    await gatekeeper.connect({
        url: config.gatekeeperURL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    const indexer = new DidIndexer(gatekeeper, didDb, {
        intervalMs: config.refreshIntervalMs,
    });

    // Let's not await here, we will continue and start
    // the app while the indexer is indexing
    indexer.startIndexing();

    v1router.get('/ready', async (req, res) => {
        try {
            res.json({ ready: true });
        } catch (error: any) {
            res.status(500).send({ error: error.toString() });
        }
    });

    v1router.get('/status', async (req, res) => {
        try {
            res.json(await getSearchStatus(didDb, config.db));
        } catch (error: any) {
            log.error({ error }, 'Status error');
            res.status(500).send({ error: error.toString() });
        }
    });

    v1router.get("/did/:did", async (req, res) => {
        try {
            const { did } = req.params;
            let versionSequence: number | undefined;
            try {
                versionSequence = parseOptionalPositiveInteger(req.query.versionSequence, 'versionSequence');
            }
            catch (error: any) {
                return res.status(400).json({ error: error.message ?? String(error) });
            }
            const versionTime = req.query.versionTime?.toString();
            const hasVersionQuery = versionSequence !== undefined || versionTime !== undefined;
            const events = await didDb.getDIDEvents(did);

            if (events.length === 0) {
                if (!hasVersionQuery) {
                    const cachedDoc = await didDb.getDID(did);
                    if (cachedDoc) {
                        return res.json(cachedDoc);
                    }
                }

                return res.status(404).send("Not found");
            }

            const options: ResolveDIDOptions = {};
            if (versionSequence !== undefined) {
                options.versionSequence = versionSequence;
            }
            if (versionTime !== undefined) {
                options.versionTime = versionTime;
            }

            const doc = await resolveDIDFromEvents({
                did,
                events,
                options,
                getBlock: (registry, block) => didDb.getBlock(registry, block),
            });

            if (doc.didResolutionMetadata?.error) {
                return res.status(404).send("Not found");
            }

            res.json(doc);
        } catch (error) {
            log.error({ error }, 'Get DID error');
            res.status(500).json({ error: String(error) });
        }
    });

    v1router.get("/events", async (req, res) => {
        try {
            const registry = req.query.registry?.toString();
            const updatedAfter = req.query.updatedAfter?.toString();
            const updatedBefore = req.query.updatedBefore?.toString();
            const limit = parseNonNegativeInteger(req.query.limit, 50);
            const offset = parseNonNegativeInteger(req.query.offset, 0);

            const result = await didDb.listEvents({
                registry,
                updatedAfter,
                updatedBefore,
                limit,
                offset,
            });

            res.json(result);
        } catch (error) {
            log.error({ error }, '/events error');
            res.status(500).json({ error: String(error) });
        }
    });

    v1router.get("/search", async (req, res) => {
        try {
            const q = req.query.q?.toString() || "";
            if (!q) {
                return res.json([]);
            }

            const dids = await didDb.searchDocs(q);
            return res.json(dids);
        } catch (error) {
            log.error({ error }, '/api/search error');
            return res.status(500).json({ error: String(error) });
        }
    });

    v1router.post("/query", async (req, res) => {
        try {
            const where = req.body?.where;
            if (!where || typeof where !== "object") {
                return res.status(400).json({ error: "`where` must be an object" });
            }

            const dids = await didDb.queryDocs(where);
            return res.json(dids);
        } catch (err) {
            log.error({ error: err }, '/query error');
            res.status(500).json({ error: String(err) });
        }
    });

    v1router.get("/metrics/schemas/published", async (req, res) => {
        try {
            const schemas = await didDb.getPublishedCredentialCountsBySchema();
            res.json({ schemas });
        } catch (error) {
            log.error({ error }, '/metrics/schemas/published error');
            res.status(500).json({ error: String(error) });
        }
    });

    v1router.get("/metrics/credentials/published", async (req, res) => {
        try {
            const credentialDid = req.query.credentialDid?.toString();
            const schemaDid = req.query.schemaDid?.toString();
            const issuerDid = req.query.issuerDid?.toString();
            const subjectDid = req.query.subjectDid?.toString();
            const revealed = parseOptionalBoolean(req.query.revealed);
            const limit = parseNonNegativeInteger(req.query.limit, 50);
            const offset = parseNonNegativeInteger(req.query.offset, 0);
            const result = await didDb.listPublishedCredentials({
                credentialDid,
                schemaDid,
                issuerDid,
                subjectDid,
                revealed,
                limit,
                offset,
            });

            res.json(result);
        } catch (error) {
            log.error({ error }, '/metrics/credentials/published error');
            res.status(500).json({ error: String(error) });
        }
    });

    v1router.get("/metrics/challenge-receipts", async (req, res) => {
        try {
            const receiptDid = req.query.receiptDid?.toString();
            const attesterDid = req.query.attesterDid?.toString();
            const schemaDid = req.query.schemaDid?.toString();
            const requesterDid = req.query.requesterDid?.toString();
            const responseCommitment = req.query.responseCommitment?.toString();
            const verifiedAfter = req.query.verifiedAfter?.toString();
            const verifiedBefore = req.query.verifiedBefore?.toString();
            const limit = parseNonNegativeInteger(req.query.limit, 50);
            const offset = parseNonNegativeInteger(req.query.offset, 0);
            const result = await didDb.listChallengeReceipts({
                receiptDid,
                attesterDid,
                schemaDid,
                requesterDid,
                responseCommitment,
                verifiedAfter,
                verifiedBefore,
                limit,
                offset,
            });

            res.json(result);
        } catch (error) {
            log.error({ error }, '/metrics/challenge-receipts error');
            res.status(500).json({ error: String(error) });
        }
    });

    v1router.get("/metrics/challenge-receipts/usage", async (req, res) => {
        try {
            const attesterDid = req.query.attesterDid?.toString();
            if (!attesterDid) {
                return res.status(400).json({ error: 'attesterDid is required' });
            }

            const schemaDid = req.query.schemaDid?.toString();
            const requesterDid = req.query.requesterDid?.toString();
            const verifiedAfter = req.query.verifiedAfter?.toString();
            const verifiedBefore = req.query.verifiedBefore?.toString();
            const limit = parseNonNegativeInteger(req.query.limit, 50);
            const offset = parseNonNegativeInteger(req.query.offset, 0);
            const result = await didDb.getChallengeReceiptUsage({
                attesterDid,
                schemaDid,
                requesterDid,
                verifiedAfter,
                verifiedBefore,
                limit,
                offset,
            });

            res.json(result);
        } catch (error) {
            log.error({ error }, '/metrics/challenge-receipts/usage error');
            res.status(500).json({ error: String(error) });
        }
    });

    if (apiRateLimiter) {
        app.use('/api', apiRateLimiter);
    }

    app.use('/api/v1', v1router);

    const port = config.port;
    const server = app.listen(port, () => {
        log.info(`Listening on port ${port}`);
    });

    const shutdown = async () => {
        try {
            server.close();
            indexer.stopIndexing();
            await didDb.disconnect();
        } catch (error: any) {
            log.error({ error }, 'Error during shutdown');
        } finally {
            process.exit(0);
        }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

main().catch((err) => {
    log.error({ error: err }, '[search-server] Fatal error');
    process.exit(1);
});
