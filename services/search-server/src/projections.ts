import { resolveDIDFromEvents } from "@mdip/gatekeeper";
import type {
    BlockId,
    BlockInfo,
    GatekeeperEvent,
} from "@mdip/gatekeeper/types";
import type { DIDProjectionUpdate, DIDsDb } from "./types.js";
import { extractChallengeReceipts } from "./challenge-receipts.js";
import { extractPublishedCredentials } from "./published-credentials.js";

export type ProjectionBlockLookup = (
    registry: string,
    block?: BlockId
) => Promise<BlockInfo | null>;

export async function buildDIDProjectionUpdate(
    db: DIDsDb,
    did: string,
    events: GatekeeperEvent[],
    options: {
        removed?: boolean;
        getBlock?: ProjectionBlockLookup;
    } = {}
): Promise<DIDProjectionUpdate> {
    if (options.removed) {
        return {
            did,
            events,
            removed: true,
            publishedCredentials: [],
            challengeReceipts: [],
        };
    }

    const doc = await resolveDIDFromEvents({
        did,
        events,
        getBlock: options.getBlock ?? ((registry, block) => db.getBlock(registry, block)),
    });

    return {
        did,
        events,
        doc,
        publishedCredentials: extractPublishedCredentials(did, doc),
        challengeReceipts: extractChallengeReceipts(did, doc),
    };
}
