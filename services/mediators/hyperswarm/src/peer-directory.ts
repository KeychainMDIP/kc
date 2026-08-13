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
    const knownNodes: Record<string, NodeInfo> = {};
    const knownPeers: Record<string, string> = {};
    const addedPeers = new Set<string>();
    const badPeers = new Set<string>();

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

            knownNodes[did] = data.node;
            knownPeers[id] = data.node.name;
            log.info(`Added IPFS peer: ${did} ${JSON.stringify(data.node, null, 4)}`);
        }
        catch (error) {
            if (!badPeers.has(did)) {
                badPeers.add(did);
                log.error({ error }, `Error adding IPFS peer: ${did}`);
            }
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
            return Object.keys(knownNodes);
        },
        getPeerName(peerId: string): string | undefined {
            return knownPeers[peerId];
        },
        registerNode(did: string, node: NodeInfo): void {
            knownNodes[did] = node;
        },
    };
}
