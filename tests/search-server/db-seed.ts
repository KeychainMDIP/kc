import type {
    BlockInfo,
    ChallengeReceiptRecord,
    DIDsDb,
    GatekeeperEvent,
    PublishedCredentialRecord,
} from '../../services/search-server/src/types.ts';

let seedCounter = 0;

export function createSeedEvent(did: string): GatekeeperEvent {
    seedCounter += 1;
    const time = new Date(Date.UTC(2026, 3, 1, 0, 0, seedCounter)).toISOString();

    return {
        registry: 'local',
        time,
        ordinal: [seedCounter],
        did,
        operation: {
            type: 'create',
            created: time,
            mdip: {
                version: 1,
                type: 'asset',
                registry: 'local',
            },
            controller: did,
            data: { seed: seedCounter },
        },
    };
}

export async function seedDID(
    db: DIDsDb,
    did: string,
    options: {
        events?: GatekeeperEvent[];
        doc?: object;
        publishedCredentials?: PublishedCredentialRecord[];
        challengeReceipts?: ChallengeReceiptRecord[];
        removed?: boolean;
    } = {}
): Promise<void> {
    await db.applyIndexPage({
        dids: [{
            did,
            events: options.removed ? [] : options.events ?? [createSeedEvent(did)],
            doc: options.doc,
            publishedCredentials: options.publishedCredentials,
            challengeReceipts: options.challengeReceipts,
            removed: options.removed,
        }],
        blocks: [],
    });
}

export async function seedBlock(
    db: DIDsDb,
    registry: string,
    block: BlockInfo
): Promise<void> {
    await db.applyIndexPage({
        dids: [],
        blocks: [{ registry, block }],
    });
}
