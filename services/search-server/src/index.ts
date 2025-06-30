import express from "express";
import cors from "cors";
import "jsr:@std/dotenv/load";
import GatekeeperClient from "@mdip/gatekeeper/client";
import DIDsSQLite from "./db/sqlite.js";
import DidIndexer from "./DidIndexer.js";

async function main() {
    const {
        SEARCH_SERVER_PORT = 4002,
        SEARCH_SERVER_GATEKEEPER_URL = 'http://localhost:4224',
        SEARCH_SERVER_REFRESH_INTERVAL_MS = 60000
    } = process.env;

    const app = express();
    const v1router = express.Router();

    const corsOptions = {
        origin: '*', // Origin needs to be specified with credentials true
        methods: ['GET'],  // Specify which methods are allowed (e.g., GET, POST)
        optionsSuccessStatus: 200  // Some legacy browsers choke on 204
    };

    app.use(cors(corsOptions));
    app.use(express.json({ limit: '2mb' }));

    const didDb = await DIDsSQLite.create();

    const gatekeeper = new GatekeeperClient();
    await gatekeeper.connect({
        url: SEARCH_SERVER_GATEKEEPER_URL,
        waitUntilReady: true,
        intervalSeconds: 5,
        chatty: true,
    });

    const indexer = new DidIndexer(gatekeeper, didDb, {
        intervalMs: Number(SEARCH_SERVER_REFRESH_INTERVAL_MS),
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
            console.error(error);
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
            console.error("/api/search error:", error);
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
            console.error("/query error:", err);
            res.status(500).json({ error: String(err) });
        }
    });

    app.use('/api/v1', v1router);

    const port = Number(SEARCH_SERVER_PORT) || 4002;
    const server = app.listen(port, () => {
        console.log(`Listening on port ${port}`);
    });

    const shutdown = async () => {
        try {
            server.close();
            indexer.stopIndexing();
            await didDb.disconnect();
        } catch (error: any) {
            console.error("Error during shutdown:", error);
        } finally {
            process.exit(0);
        }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

main().catch((err) => {
    console.error("[search-server] Fatal error:", err);
    process.exit(1);
});
