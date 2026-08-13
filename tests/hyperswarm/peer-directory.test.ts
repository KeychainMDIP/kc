import { jest } from '@jest/globals';
import type KeymasterClient from '@mdip/keymaster/client';
import type KuboClient from '@mdip/ipfs/kubo';

import { createPeerDirectory } from '../../services/mediators/hyperswarm/src/peer-directory.ts';

describe('peer directory', () => {
    it('deduplicates DID aliases and does not add the local IPFS peer', async () => {
        const resolveDID = jest.fn(async (did: string) => ({
            didDocumentData: {
                node: {
                    name: did,
                    ipfs: {
                        id: did.endsWith('self') ? 'local-id' : 'remote-id',
                        addresses: ['/ip4/127.0.0.1/tcp/4001'],
                    },
                },
            },
        }));
        const addPeeringPeer = jest.fn(async () => undefined);
        const directory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: { addPeeringPeer } as unknown as Pick<KuboClient, 'addPeeringPeer'>,
            getLocalIpfsId: () => 'local-id',
        });

        directory.addPeers(['did:test:remote', 'did:alias:remote', 'did:test:self']);
        await new Promise(resolve => setImmediate(resolve));

        expect(resolveDID).toHaveBeenCalledTimes(2);
        expect(addPeeringPeer).toHaveBeenCalledTimes(1);
        expect(directory.getKnownDids().sort()).toEqual(['did:test:remote', 'did:test:self']);
        expect(directory.getPeerName('remote-id')).toBe('did:test:remote');
    });
});
