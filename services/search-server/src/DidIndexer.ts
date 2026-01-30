import GatekeeperClient from "@mdip/gatekeeper/client";
import type { DIDsDb } from "./types.js";
import { childLogger } from "@mdip/common/logger";

export interface DidIndexerOptions {
    intervalMs: number;
}

export default class DidIndexer {
    private gatekeeper: GatekeeperClient;
    private db: DIDsDb;
    private readonly intervalMs: number;
    private timer: NodeJS.Timeout | null;
    private refreshInProgress: boolean;
    private log = childLogger({ service: 'search-server', module: 'DidIndexer' });

    constructor(
        gatekeeper: GatekeeperClient,
        db: DIDsDb,
        options: DidIndexerOptions
    ) {
        this.gatekeeper = gatekeeper;
        this.db = db;
        this.intervalMs = options.intervalMs;
        this.timer = null;
        this.refreshInProgress = false;
    }

    async startIndexing(): Promise<void> {
        this.log.info("Starting indexing...");
        await this.refreshIndex();

        this.timer = setInterval(() => {
            this.refreshIndex().catch((err) => {
                this.log.error({ error: err }, "refreshIndex error");
            });
        }, this.intervalMs);
    }

    stopIndexing(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private async refreshIndex(): Promise<void> {
        if (!(await this.gatekeeper.isReady()) || this.refreshInProgress) {
            return;
        }
        this.refreshInProgress = true;

        try {
            // Get the time now before the call to getDIDs()
            const now = new Date().toISOString();

            const updatedAfter = await this.db.loadUpdatedAfter() || undefined;
            const dids = (await this.gatekeeper.getDIDs({ updatedAfter })) as string[];

            for (const did of dids) {
                const doc = await this.gatekeeper.resolveDID(did);
                await this.db.storeDID(did, doc);
            }

            await this.db.saveUpdatedAfter(now);

            this.log.info(`Indexed ${dids.length} DIDs. updatedAfter set to ${now}`);
        } catch (err) {
            this.log.error({ error: err }, "Error in refreshIndex");
        } finally {
            this.refreshInProgress = false;
        }
    }
}
