import type { HyperswarmConnection } from 'hyperswarm';

import { createHyperswarmTransport } from '../../services/mediators/hyperswarm/src/hyperswarm-transport.ts';
import { createConnectionInfo } from '../../services/mediators/hyperswarm/src/mediator-state.ts';
import { createMediatorSyncStats } from '../../services/mediators/hyperswarm/src/sync-stats.ts';
import { encodeFramedMessage } from '../../services/mediators/hyperswarm/src/transport-framing.ts';

describe('hyperswarm transport routing', () => {
    it('routes decoded ping, queue, and sync messages to their handlers', async () => {
        const peerKey = Buffer.alloc(32, 0x22).toString('hex');
        const routes: string[] = [];
        const connection = {
            destroy: () => undefined,
            write: () => undefined,
        } as unknown as HyperswarmConnection;
        const transport = createHyperswarmTransport({
            framingVersion: 1,
            syncStats: createMediatorSyncStats(),
            buildInitialPing: async () => ({
                type: 'ping', time: '', node: 'local', relays: [], peers: [], transportFramingVersion: 1,
            }),
            onPing: () => { routes.push('ping'); },
            onQueue: () => { routes.push('queue'); },
            onSyncMessage: () => { routes.push('sync'); },
            onDisconnected: () => undefined,
            onQuarantined: () => undefined,
        });
        transport.setConnection(peerKey, createConnectionInfo({
            connection,
            peerName: 'peer',
        }));

        const messages = [
            { type: 'ping', time: '', node: 'peer', relays: [], peers: [], transportFramingVersion: 1 },
            { type: 'queue', time: '', node: 'peer', relays: [], data: [] },
            { type: 'neg_close', time: '', node: 'peer', relays: [], sessionId: 's', windowId: 'w', round: 0 },
        ].map(message => encodeFramedMessage(JSON.stringify(message)));

        await transport.processInboundPeerData(peerKey, Buffer.concat(messages));

        expect(routes).toEqual(['ping', 'queue', 'sync']);
    });
});
