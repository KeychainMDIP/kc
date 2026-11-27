import { jest } from '@jest/globals';

import KuboClient, { type PeeringPeer } from '../../packages/ipfs/src/kubo-client.ts';

type RpcOptions = { signal?: AbortSignal; timeout?: number };

describe('KuboClient peering requests', () => {
    function createClient() {
        const id = jest.fn<(options?: RpcOptions) => Promise<{ id: { toString(): string } }>>(
            async () => ({ id: { toString: () => 'local-peer' } }),
        );
        const connect = jest.fn<(address: string, options: RpcOptions) => Promise<void>>(
            async () => undefined,
        );
        const get = jest.fn<(key: string, options: RpcOptions) => Promise<PeeringPeer[]>>(
            async () => [],
        );
        const set = jest.fn<(
            key: string,
            peers: PeeringPeer[],
            options: RpcOptions & { json: boolean },
        ) => Promise<void>>(async () => undefined);
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

        const operationSignal = id.mock.calls[0][0]?.signal;
        expect(operationSignal).toBeDefined();
        expect(operationSignal).not.toBe(controller.signal);
        expect(id).toHaveBeenCalledWith({ signal: operationSignal, timeout: 1234 });
        expect(connect).toHaveBeenCalledWith(
            '/ip4/203.0.113.1/tcp/4001',
            { signal: operationSignal, timeout: 1234 },
        );
        expect(get).toHaveBeenCalledWith(
            client.PeeringPeers,
            { signal: operationSignal, timeout: 1234 },
        );
        expect(set).toHaveBeenCalledWith(
            client.PeeringPeers,
            [{ ID: 'remote-peer', Addrs: ['/ip4/203.0.113.1/tcp/4001'] }],
            { json: true, signal: operationSignal, timeout: 1234 },
        );
    });

    it('applies one deadline across multiple address attempts', async () => {
        jest.useFakeTimers();
        try {
            const { client, connect, get, set } = createClient();
            connect
                .mockImplementationOnce(async () => {
                    await new Promise(resolve => setTimeout(resolve, 40));
                    throw new Error('unreachable');
                })
                .mockImplementationOnce(async (_address, options) => {
                    await new Promise<void>((_resolve, reject) => {
                        const rejectAbort = () => reject(options.signal?.reason);
                        if (options.signal?.aborted) {
                            rejectAbort();
                        } else {
                            options.signal?.addEventListener('abort', rejectAbort, { once: true });
                        }
                    });
                });
            let settled = false;
            const result = client.addPeeringPeer('remote-peer', ['/first', '/second', '/third'], {
                timeoutMs: 100,
            }).then(
                () => ({ ok: true as const }),
                (error: unknown) => ({ ok: false as const, error }),
            ).finally(() => {
                settled = true;
            });

            await jest.advanceTimersByTimeAsync(40);
            expect(connect).toHaveBeenCalledTimes(2);
            await jest.advanceTimersByTimeAsync(59);
            expect(settled).toBe(false);
            await jest.advanceTimersByTimeAsync(1);

            await expect(result).resolves.toMatchObject({
                ok: false,
                error: { name: 'TimeoutError' },
            });
            expect(connect).toHaveBeenCalledTimes(2);
            expect(get).not.toHaveBeenCalled();
            expect(set).not.toHaveBeenCalled();
        } finally {
            jest.useRealTimers();
        }
    });

    it('propagates caller cancellation during an address attempt', async () => {
        const { client, connect, get, set } = createClient();
        const controller = new AbortController();
        let started!: () => void;
        const connectStarted = new Promise<void>(resolve => {
            started = resolve;
        });
        connect.mockImplementationOnce(async (_address, options) => {
            started();
            await new Promise<void>((_resolve, reject) => {
                const rejectAbort = () => reject(options.signal?.reason);
                if (options.signal?.aborted) {
                    rejectAbort();
                } else {
                    options.signal?.addEventListener('abort', rejectAbort, { once: true });
                }
            });
        });

        const pending = client.addPeeringPeer('remote-peer', ['/first', '/second'], {
            signal: controller.signal,
            timeoutMs: 10_000,
        });
        await connectStarted;
        const reason = new Error('shutdown');
        controller.abort(reason);

        await expect(pending).rejects.toBe(reason);
        expect(connect).toHaveBeenCalledTimes(1);
        expect(get).not.toHaveBeenCalled();
        expect(set).not.toHaveBeenCalled();
    });

    it('ignores ordinary unreachable addresses without changing configuration', async () => {
        const { client, connect, get, set } = createClient();
        connect.mockRejectedValue(new Error('unreachable'));

        await expect(client.addPeeringPeer('remote-peer', ['/first', '/second']))
            .resolves.toBeUndefined();

        expect(connect).toHaveBeenCalledTimes(2);
        expect(get).not.toHaveBeenCalled();
        expect(set).not.toHaveBeenCalled();
    });

    it('clears the deadline when signal composition fails', async () => {
        jest.useFakeTimers();
        try {
            const { client } = createClient();

            await expect(client.addPeeringPeer('remote-peer', [], {
                signal: {} as AbortSignal,
                timeoutMs: 100,
            })).rejects.toThrow();

            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
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
