import { resolveDIDFromEvents } from "@mdip/gatekeeper";
import type {
    BlockId,
    BlockInfo,
    GatekeeperEvent,
} from "@mdip/gatekeeper/types";
import type { DIDProjectionUpdate, DIDsDb } from "./types.js";
import { extractChallengeReceipts } from "./challenge-receipts.js";
import {
    extractPublishedCredentialHistory,
    extractPublishedCredentials,
} from "./published-credentials.js";
import { isAgentDID } from './did-aliases.js';

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
            didPrefixReferences: [],
            publishedCredentials: [],
            challengeReceipts: [],
        };
    }

    const doc = await resolveDIDFromEvents({
        did,
        events,
        getBlock: options.getBlock ?? ((registry, block) => db.getBlock(registry, block)),
    });
    const agent = isAgentDID(events);
    const publishedCredentials = agent
        ? extractPublishedCredentials(did, doc)
        : [];

    return {
        did,
        events,
        doc,
        didPrefixReferences: agent
            ? extractPublishedCredentialHistory(did, events)
                .flatMap(({ credential }) => [credential.credentialDid, credential.schemaDid])
            : [],
        publishedCredentials,
        challengeReceipts: extractChallengeReceipts(did, doc),
    };
}
