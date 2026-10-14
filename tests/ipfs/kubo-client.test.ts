import { jest } from '@jest/globals';

import KuboClient, { type PeeringPeer } from '../../packages/ipfs/src/kubo-client.ts';

describe('KuboClient peering requests', () => {
    function createClient() {
        const id = jest.fn(async () => ({ id: { toString: () => 'local-peer' } }));
        const connect = jest.fn(async () => undefined);
        const get = jest.fn<() => Promise<PeeringPeer[]>>(async () => []);
        const set = jest.fn(async () => undefined);
        const client = new KuboClient();
        (client as unknown as { ipfs: unknown }).ipfs = {
            id,
            swarm: { connect },
            config: { get, set },
        };
        return { client, id, connect, get, set };
    }

    it('passes timeouts and cancellation to peering reads and writes', async () => {
        const { client, id, connect, get, set } = createClient();
        const controller = new AbortController();
        const options = { signal: controller.signal, timeoutMs: 1234 };

        await client.addPeeringPeer('remote-peer', ['/ip4/203.0.113.1/tcp/4001'], options);

        expect(id).toHaveBeenCalledWith({ signal: controller.signal, timeout: 1234 });
        expect(connect).toHaveBeenCalledWith(
            '/ip4/203.0.113.1/tcp/4001',
            { signal: controller.signal, timeout: 1234 },
        );
        expect(get).toHaveBeenCalledWith(
            client.PeeringPeers,
            { signal: controller.signal, timeout: 1234 },
        );
        expect(set).toHaveBeenCalledWith(
            client.PeeringPeers,
            [{ ID: 'remote-peer', Addrs: ['/ip4/203.0.113.1/tcp/4001'] }],
            { json: true, signal: controller.signal, timeout: 1234 },
        );
    });

    it('passes timeouts and cancellation through removal and reset calls', async () => {
        const { client, get, set } = createClient();
        const controller = new AbortController();
        const options = { signal: controller.signal, timeoutMs: 4321 };
        get.mockResolvedValueOnce([
            { ID: 'keep', Addrs: ['/keep'] },
            { ID: 'remove', Addrs: ['/remove'] },
        ]);

        await client.removePeeringPeer('remove', options);
        await client.resetPeeringPeers(options);

        expect(set).toHaveBeenNthCalledWith(
            1,
            client.PeeringPeers,
            [{ ID: 'keep', Addrs: ['/keep'] }],
            { json: true, signal: controller.signal, timeout: 4321 },
        );
        expect(set).toHaveBeenNthCalledWith(
            2,
            client.PeeringPeers,
            [],
            { json: true, signal: controller.signal, timeout: 4321 },
        );
    });

    it('applies a finite default timeout and rejects invalid timeout values', async () => {
        const { client, get } = createClient();

        await client.getPeeringPeers();
        expect(get).toHaveBeenCalledWith(client.PeeringPeers, { timeout: 10_000 });
        await expect(client.getPeeringPeers({ timeoutMs: 0 })).rejects.toThrow(
            'timeoutMs must be a positive finite number',
        );
    });
});
