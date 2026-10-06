import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { Server } from 'node:http';
import { resolveDIDFromEvents } from "@mdip/gatekeeper";
import type { ResolveDIDOptions } from "@mdip/gatekeeper/types";
import GatekeeperClient from "@mdip/gatekeeper/client";
import DIDsSQLite from "./db/sqlite.js";
import DIDsDbMemory from './db/json-memory.js';
import DIDsPostgres from './db/postgres.js';
import DidIndexer, { INDEX_SYNC_STATE_KEYS } from "./DidIndexer.js";
import type { DIDsDb, NetworkMetricSnapshot } from "./types.js";
import { childLogger } from "@mdip/common/logger";
import config from "./config.js";
import { findDIDReadTarget } from './did-aliases.js';
import {
    createWhitelistBlockList,
    getSearchStatus,
    isRateLimitWhitelistedRequest,
    parseIdentityListOptions,
    parseNonNegativeInteger,
    parseOptionalBoolean,
    parseOptionalPositiveInteger,
    rateLimitWindowUnits,
    shouldSkipRateLimitPath,
} from "./index-helpers.js";
import { isNetworkMetricsScopeCurrent, parseSnapshotDate } from './network-metrics.js';
import { runService, type Shutdown } from './lifecycle.js';

const log = childLogger({ service: 'search-server' });
const SHUTDOWN_TIMEOUT_MS = 10_000;
const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 500;
const MIN_SEARCH_QUERY_LENGTH = 3;

let activeDb: DIDsDb | undefined;
let activeIndexer: DidIndexer | undefined;
let server: Server | undefined;
const dependencyRequests = new AbortController();

async function closeServer(httpServer: Server): Promise<void> {
    if (!httpServer.listening) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        httpServer.close(error => error ? reject(error) : resolve());
    });
}

async function cleanup(): Promise<void> {
    dependencyRequests.abort();
    const errors: unknown[] = [];

    for (const step of [
        () => server ? closeServer(server) : Promise.resolve(),
        () => activeIndexer ? activeIndexer.stopIndexing() : Promise.resolve(),
        () => activeDb ? activeDb.disconnect() : Promise.resolve(),
    ]) {
        try {
            await step();
        }
        catch (error) {
            errors.push(error);
        }
    }

    if (errors.length === 1) {
        throw errors[0];
    }
    if (errors.length > 1) {
        throw new AggregateError(errors, 'Search Server shutdown failed');
    }
}

async function main(shutdown: Shutdown) {
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
    activeDb = didDb;

    const gatekeeper = new GatekeeperClient();
    await gatekeeper.connect({
        url: config.gatekeeperURL,
        signal: dependencyRequests.signal,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    const indexer = new DidIndexer(gatekeeper, didDb, {
        intervalMs: config.refreshIntervalMs,
        metricsRefreshIntervalMs: config.metricsRefreshIntervalMs,
        didPrefix: config.didPrefix,
    });
    activeIndexer = indexer;

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

    v1router.get("/did/:did/events", async (req, res) => {
        try {
            const target = await findDIDReadTarget(didDb, req.params.did, config.didPrefix);
            res.json(target.events);
        } catch (error) {
            log.error({ error }, 'Get DID events error');
            res.status(500).json({ error: String(error) });
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
            const { storedDid, resolutionDid, events, scopeRejected } = await findDIDReadTarget(
                didDb,
                did,
                config.didPrefix
            );

            if (events.length === 0) {
                if (scopeRejected) {
                    return res.status(404).send("Not found");
                }
                if (!hasVersionQuery) {
                    const cachedDoc = await didDb.getDID(storedDid);
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
                did: resolutionDid,
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
                didPrefix: config.didPrefix,
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
        const rawQuery = req.query.q;
        if (rawQuery !== undefined && (typeof rawQuery !== 'string'
            || [...rawQuery].length < MIN_SEARCH_QUERY_LENGTH)) {
            return res.status(400).json({
                error: `q must contain at least ${MIN_SEARCH_QUERY_LENGTH} Unicode characters`,
            });
        }
        const rawLimit = req.query.limit;
        if (rawLimit !== undefined && (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit)
            || !Number.isSafeInteger(Number(rawLimit)) || Number(rawLimit) < 1
            || Number(rawLimit) > MAX_SEARCH_LIMIT)) {
            return res.status(400).json({ error: `limit must be an integer from 1 to ${MAX_SEARCH_LIMIT}` });
        }
        const cursor = req.query.cursor;
        if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length === 0)) {
            return res.status(400).json({ error: 'cursor must be a non-empty string' });
        }

        try {
            const q = rawQuery ?? "";
            if (!q) {
                return res.json({ dids: [], nextCursor: null });
            }

            return res.json(await didDb.searchDocs(q, {
                didPrefix: config.didPrefix,
                limit: rawLimit === undefined ? DEFAULT_SEARCH_LIMIT : Number(rawLimit),
                cursor,
            }));
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === '57014') {
                log.warn({ error }, '/api/search timed out');
                return res.status(503).json({ error: 'Search timed out' });
            }
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

            const dids = await didDb.queryDocs(where, config.didPrefix);
            return res.json(dids);
        } catch (err) {
            log.error({ error: err }, '/query error');
            res.status(500).json({ error: String(err) });
        }
    });

    v1router.get('/identities', async (req, res) => {
        let options;
        try {
            options = parseIdentityListOptions(req.query);
        }
        catch (error) {
            return res.status(400).json({ error: String(error) });
        }

        try {
            return res.json(await didDb.listIdentities({ ...options, didPrefix: config.didPrefix }));
        }
        catch (error) {
            log.error({ error }, '/identities error');
            return res.status(500).json({ error: String(error) });
        }
    });

    v1router.get("/metrics/schemas/published", async (req, res) => {
        try {
            if (req.query.date !== undefined) {
                return res.status(400).json({
                    error: 'Use /api/v1/metrics/snapshots/schemas/:date for historical snapshots',
                });
            }

            const schemas = await didDb.getPublishedCredentialCountsBySchema(config.didPrefix);
            return res.json({ schemas });
        } catch (error) {
            log.error({ error }, '/metrics/schemas/published error');
            return res.status(500).json({ error: String(error) });
        }
    });

    const snapshotHandler = (
        select: (snapshot: NetworkMetricSnapshot) => unknown
    ) => async (req: express.Request, res: express.Response) => {
        try {
            const date = parseSnapshotDate(req.params.date);
            if (!date) {
                return res.status(400).json({ error: 'date must be a valid, non-future UTC date in YYYY-MM-DD format' });
            }
            const storedDidPrefix = await didDb.loadSyncState(INDEX_SYNC_STATE_KEYS.metricsDidPrefix);
            if (!isNetworkMetricsScopeCurrent(storedDidPrefix, config.didPrefix)) {
                return res.status(503).json({ error: 'Network metrics are rebuilding for the configured DID prefix' });
            }

            const snapshot = await didDb.getNetworkMetricSnapshot(date);
            if (!snapshot) {
                return res.status(404).json({ error: 'Snapshot not found' });
            }

            return res.json(select(snapshot));
        }
        catch (error) {
            log.error({ error }, 'Network metrics snapshot error');
            return res.status(500).json({ error: String(error) });
        }
    };

    v1router.get('/metrics/snapshots/:date', snapshotHandler(snapshot => snapshot));
    v1router.get('/metrics/snapshots/dids/:date', snapshotHandler(
        snapshot => ({
            didCount: snapshot.didCount,
            didCountsByPrefix: snapshot.didCountsByPrefix,
        })
    ));
    v1router.get('/metrics/snapshots/schemas/:date', snapshotHandler(
        snapshot => ({ schemas: snapshot.schemas })
    ));
    v1router.get('/metrics/snapshots/agents/:date', snapshotHandler(
        snapshot => ({
            agentDidCount: snapshot.agentDidCount,
            agentDidCountsByPrefix: snapshot.agentDidCountsByPrefix,
        })
    ));
    v1router.get('/metrics/snapshots/credentials/:date', snapshotHandler(
        snapshot => ({
            credentialCount: snapshot.credentialCount,
            credentialDidCountsByPrefix: snapshot.credentialDidCountsByPrefix,
        })
    ));

    v1router.get("/metrics/credentials/published", async (req, res) => {
        try {
            const credentialDid = req.query.credentialDid?.toString();
            const schemaDid = req.query.schemaDid?.toString();
            const issuerDid = req.query.issuerDid?.toString();
            const subjectDid = req.query.subjectDid?.toString();
            const revealed = parseOptionalBoolean(req.query.revealed);
            const limit = Math.min(parseNonNegativeInteger(req.query.limit, 50), 500);
            const offset = parseNonNegativeInteger(req.query.offset, 0);
            const result = await didDb.listPublishedCredentials({
                didPrefix: config.didPrefix,
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
            const updatedAfter = req.query.updatedAfter?.toString();
            const updatedBefore = req.query.updatedBefore?.toString();
            const limit = parseNonNegativeInteger(req.query.limit, 50);
            const offset = parseNonNegativeInteger(req.query.offset, 0);
            const result = await didDb.listChallengeReceipts({
                didPrefix: config.didPrefix,
                receiptDid,
                attesterDid,
                schemaDid,
                requesterDid,
                responseCommitment,
                updatedAfter,
                updatedBefore,
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
            const updatedAfter = req.query.updatedAfter?.toString();
            const updatedBefore = req.query.updatedBefore?.toString();
            const limit = parseNonNegativeInteger(req.query.limit, 50);
            const offset = parseNonNegativeInteger(req.query.offset, 0);
            const result = await didDb.getChallengeReceiptUsage({
                didPrefix: config.didPrefix,
                attesterDid,
                schemaDid,
                requesterDid,
                updatedAfter,
                updatedBefore,
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
    await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server = app.listen(port, () => {
            server!.off('error', onError);
            resolve();
        });
        server.once('error', onError);
    });

    log.info(`Listening on port ${port}`);
    server!.on('error', error => {
        log.error({ error }, 'HTTP server error');
        void shutdown(1);
    });

    // Start indexing without delaying HTTP availability.
    indexer.startIndexing().catch(error => {
        if (dependencyRequests.signal.aborted) {
            return;
        }
        log.error({ error }, 'Initial indexing failed');
        void shutdown(1);
    });
}

runService({
    start: main,
    cleanup,
    log,
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
});
