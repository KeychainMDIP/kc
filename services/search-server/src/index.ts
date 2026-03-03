import express from "express";
import cors from "cors";
import { BlockList, isIP } from "net";
import rateLimit from "express-rate-limit";
import GatekeeperClient from "@mdip/gatekeeper/client";
import DIDsSQLite from "./db/sqlite.js";
import DIDsDbMemory from './db/json-memory.js';
import DidIndexer from "./DidIndexer.js";
import {DIDsDb} from "./types.js";
import { childLogger } from "@mdip/common/logger";
import config from "./config.js";

const log = childLogger({ service: 'search-server' });
const rateLimitWindowUnits = {
    second: 1000,
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
} as const;

function normalizeIp(ip: string): string {
    const withoutZone = ip.split('%')[0];

    if (withoutZone === '::1') {
        return '127.0.0.1';
    }

    if (withoutZone.startsWith('::ffff:')) {
        return withoutZone.slice(7);
    }

    return withoutZone;
}

function detectIpFamily(ip: string): 'ipv4' | 'ipv6' | null {
    const version = isIP(ip);

    if (version === 4) {
        return 'ipv4';
    }

    if (version === 6) {
        return 'ipv6';
    }

    return null;
}

function createWhitelistBlockList(whitelist: string[]): BlockList {
    const blockList = new BlockList();

    for (const entry of whitelist) {
        const [rawAddress, rawPrefixLength] = entry.split('/');
        const address = normalizeIp(rawAddress);
        const family = detectIpFamily(address);

        if (!family) {
            log.warn(`Ignoring invalid rate limit whitelist entry: '${entry}'`);
            continue;
        }

        if (rawPrefixLength !== undefined) {
            const prefixLength = Number.parseInt(rawPrefixLength, 10);

            if (!Number.isInteger(prefixLength)) {
                log.warn(`Ignoring invalid rate limit CIDR entry: '${entry}'`);
                continue;
            }

            try {
                blockList.addSubnet(address, prefixLength, family);
            }
            catch {
                log.warn(`Ignoring invalid rate limit CIDR entry: '${entry}'`);
            }
            continue;
        }

        try {
            blockList.addAddress(address, family);
        }
        catch {
            log.warn(`Ignoring invalid rate limit whitelist entry: '${entry}'`);
        }
    }

    return blockList;
}

function shouldSkipRateLimitPath(req: express.Request, skipPaths: string[]): boolean {
    const pathOnly = req.originalUrl.split('?')[0];

    return skipPaths.some(skipPath =>
        pathOnly === skipPath || pathOnly.startsWith(`${skipPath}/`));
}

async function main() {
    const app = express();
    const v1router = express.Router();
    const whitelistBlockList = createWhitelistBlockList(config.rateLimitWhitelist);
    const rateLimitWindowMs = config.rateLimitWindowValue * rateLimitWindowUnits[config.rateLimitWindowUnit];

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
            skip: (req) => {
                if (req.method === 'OPTIONS') {
                    return true;
                }

                if (shouldSkipRateLimitPath(req, config.rateLimitSkipPaths)) {
                    return true;
                }

                if (config.rateLimitWhitelist.length === 0) {
                    return false;
                }

                const candidates = [req.ip, req.socket.remoteAddress]
                    .filter((ip): ip is string => typeof ip === 'string' && ip.length > 0);

                for (const candidate of candidates) {
                    const normalizedIp = normalizeIp(candidate);
                    const family = detectIpFamily(normalizedIp);

                    if (family && whitelistBlockList.check(normalizedIp, family)) {
                        return true;
                    }
                }

                return false;
            },
        })
        : null;

    if (config.rateLimitEnabled) {
        log.info(`Rate limiting enabled: ${config.rateLimitMaxRequests} requests per ${config.rateLimitWindowValue} ${config.rateLimitWindowUnit}(s)`);
    }
    else {
        log.info('Rate limiting disabled');
    }

    app.use(cors(corsOptions));
    app.use(express.json({ limit: config.jsonLimit }));

    let didDb: DIDsDb;

    if (config.db === 'sqlite') {
        didDb = await DIDsSQLite.create();
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

    v1router.get("/did/:did", async (req, res) => {
        try {
            const { did } = req.params;
            const doc = await didDb.getDID(did);
            if (!doc) {
                return res.status(404).send("Not found");
            }
            res.json(doc);
        } catch (error) {
            log.error({ error }, 'Get DID error');
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
