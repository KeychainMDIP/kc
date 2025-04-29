import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import GatekeeperClient from "@mdip/gatekeeper/client";
import DIDsSQLite from "./db/sqlite.js";
import DidIndexer from "./DidIndexer.js";

dotenv.config();

async function main() {
    const {
        SEARCH_SERVER_PORT = 3001,
        SEARCH_SERVER_GATEKEEPER_URL = 'http://localhost:4224',
        SEARCH_SERVER_REFRESH_INTERVAL_MS = 60000
    } = process.env;

    const app = express();
    const v1router = express.Router();
    app.use(cors());

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

    app.use('/api/v1', v1router);

    const port = Number(SEARCH_SERVER_PORT) || 3001;
    app.listen(port, () => {
        console.log(`Listening on port ${port}`);
    });
}

main().catch((err) => {
    console.error("[search-server] Fatal error:", err);
    process.exit(1);
});
