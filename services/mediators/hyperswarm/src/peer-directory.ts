import type KeymasterClient from '@mdip/keymaster/client';
import type KuboClient from '@mdip/ipfs/kubo';

import { childLogger } from '@mdip/common/logger';
import type { NodeInfo } from './mediator-state.js';

const log = childLogger({ service: 'hyperswarm-mediator' });

interface PeerDirectoryOptions {
    enabled: boolean;
    keymaster: Pick<KeymasterClient, 'resolveDID'>;
    ipfs: Pick<KuboClient, 'addPeeringPeer'>;
    getLocalIpfsId(): string | null;
}

export function createPeerDirectory(options: PeerDirectoryOptions) {
    const knownDids = new Set<string>();
    const knownPeers: Record<string, string> = {};
    const addedPeers = new Set<string>();

    async function addPeer(did: string): Promise<void> {
        if (!options.enabled) {
            return;
        }

        const suffix = did.split(':').pop() || '';
        if (addedPeers.has(suffix)) {
            return;
        }

        log.info(`Adding peer ${did}...`);
        addedPeers.add(suffix);

        try {
            const docs = await options.keymaster.resolveDID(did);
            const data = docs.didDocumentData as { node?: NodeInfo };
            if (!data?.node?.ipfs) {
                return;
            }

            const { id, addresses } = data.node.ipfs;
            if (!id || !addresses) {
                return;
            }
            if (id !== options.getLocalIpfsId()) {
                await options.ipfs.addPeeringPeer(id, addresses);
            }

            knownDids.add(did);
            knownPeers[id] = data.node.name;
            log.info(`Added IPFS peer: ${did} ${JSON.stringify(data.node, null, 4)}`);
        }
        catch (error) {
            log.error({ error }, `Error adding IPFS peer: ${did}`);
        }
    }

    function addPeers(dids: string[]): void {
        for (const did of dids) {
            void addPeer(did);
        }
    }

    return {
        addPeers,
        getKnownDids(): string[] {
            return [...knownDids];
        },
        getPeerName(peerId: string): string | undefined {
            return knownPeers[peerId];
        },
        registerNode(did: string): void {
            knownDids.add(did);
        },
    };
}
