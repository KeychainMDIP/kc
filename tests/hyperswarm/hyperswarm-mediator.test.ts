import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';

import InMemoryOperationSyncStore from '../../services/mediators/hyperswarm/src/db/memory.ts';
import NegentropyAdapter from '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';
import {
    createMediatorNode,
    getMediatorNodeContext,
    installMediatorMocks,
    MockHyperswarm,
    type MediatorNode,
} from './hyperswarm-mediator-harness.ts';

installMediatorMocks();
installMediatorMocks();

describe('hyperswarm mediator test harness', () => {
    const nodes: MediatorNode[] = [];

    async function createNode(name: string, keyByte: number): Promise<MediatorNode> {
        const node = await createMediatorNode({
            name,
            publicKey: Buffer.alloc(32, keyByte),
        });
        nodes.push(node);
        return node;
    }

    afterEach(async () => {
        for (const node of nodes.reverse()) {
            await node.dispose();
        }
        nodes.length = 0;
        jest.restoreAllMocks();
    });

    it('isolates mediator state and Gatekeeper client delegates by node', async () => {
        const nodeA = await createNode('node-a', 0x11);
        const nodeB = await createNode('node-b', 0x22);
        const peerKey = Buffer.alloc(32, 0x33).toString('hex');

        expect(nodeA.mediator).not.toBe(nodeB.mediator);
        expect(nodeA.gatekeeper).not.toBe(nodeB.gatekeeper);
        expect(nodeA.gatekeeperDb).not.toBe(nodeB.gatekeeperDb);

        await nodeA.run(async () => {
            expect(getMediatorNodeContext().name).toBe('node-a');
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(getMediatorNodeContext().name).toBe('node-a');
        });

        nodeA.run(() => nodeA.mediator.__test.addConnection(peerKey));

        expect(nodeA.run(() => nodeA.mediator.__test.getConnectionState(peerKey))).not.toBeNull();
        expect(nodeB.run(() => nodeB.mediator.__test.getConnectionState(peerKey))).toBeNull();

        await nodeA.gatekeeperClient.getQueue('local');

        expect(nodeA.gatekeeper.supportedRegistries).toContain('local');
        expect(nodeB.gatekeeper.supportedRegistries).not.toContain('local');
        expect(nodeA.gatekeeperClient.getQueue).toHaveBeenCalledWith('local');
        expect(nodeB.gatekeeperClient.getQueue).not.toHaveBeenCalled();
    });

    it('captures shutdown callbacks and Hyperswarm instances for their owning nodes', async () => {
        const nodeA = await createNode('node-a', 0x11);
        const nodeB = await createNode('node-b', 0x22);

        const shutdownA = nodeA.run(() => getMediatorNodeContext().shutdownHook);
        const shutdownB = nodeB.run(() => getMediatorNodeContext().shutdownHook);
        const swarmA = nodeA.run(() => new MockHyperswarm());
        const swarmB = nodeB.run(() => new MockHyperswarm());

        expect(shutdownA).toEqual(expect.any(Function));
        expect(shutdownB).toEqual(expect.any(Function));
        expect(shutdownA).not.toBe(shutdownB);
        expect(nodeA.swarms).toEqual([swarmA]);
        expect(nodeB.swarms).toEqual([swarmB]);
        expect(swarmA.keyPair.publicKey).toEqual(nodeA.publicKey);
        expect(swarmB.keyPair.publicKey).toEqual(nodeB.publicKey);

        await swarmA.join(Buffer.alloc(32), { client: true, server: true }).flushed();
        swarmA.destroy();
        swarmB.destroy();

        expect(swarmA.join).toHaveBeenCalledTimes(1);
        expect(swarmA.destroyed).toBe(true);
        expect(swarmB.destroyed).toBe(true);
    });

    it('restores listeners without starting external clients, SQLite, or recurring loops', async () => {
        const before = {
            uncaughtException: process.listenerCount('uncaughtException'),
            unhandledRejection: process.listenerCount('unhandledRejection'),
            stdinData: process.stdin.listenerCount('data'),
        };
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        const originalCwd = process.cwd();
        const originalInjectedEnv = process.env.KC_HARNESS_IMPORT_TEST;
        const tempDir = await mkdtemp(path.join(tmpdir(), 'hyperswarm-mediator-'));
        try {
            await writeFile(path.join(tempDir, '.env'), 'KC_HARNESS_IMPORT_TEST=loaded\n');
            process.chdir(tempDir);
            const nodeA = await createNode('node-a', 0x11);
            const nodeB = await createNode('node-b', 0x22);

            expect(process.listenerCount('uncaughtException')).toBe(before.uncaughtException + 2);
            expect(process.listenerCount('unhandledRejection')).toBe(before.unhandledRejection + 2);
            expect(process.stdin.listenerCount('data')).toBe(before.stdinData + 2);
            expect(nodeA.swarms).toHaveLength(0);
            expect(nodeB.swarms).toHaveLength(0);
            expect(nodeA.gatekeeperClient.connect).not.toHaveBeenCalled();
            expect(nodeB.gatekeeperClient.connect).not.toHaveBeenCalled();
            expect(nodeA.keymasterClient.connect).not.toHaveBeenCalled();
            expect(nodeB.keymasterClient.connect).not.toHaveBeenCalled();
            expect(nodeA.kuboClient.connect).not.toHaveBeenCalled();
            expect(nodeB.kuboClient.connect).not.toHaveBeenCalled();
            expect(setTimeoutSpy).not.toHaveBeenCalled();
            expect(process.env.KC_HARNESS_IMPORT_TEST).toBe(originalInjectedEnv);
            await expect(access(path.join(tempDir, 'data/hyperswarm/operations.db'))).rejects.toMatchObject({
                code: 'ENOENT',
            });

            await nodeB.dispose();
            await nodeA.dispose();

            expect(process.listenerCount('uncaughtException')).toBe(before.uncaughtException);
            expect(process.listenerCount('unhandledRejection')).toBe(before.unhandledRejection);
            expect(process.stdin.listenerCount('data')).toBe(before.stdinData);
        }
        finally {
            process.chdir(originalCwd);
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it('accepts a real in-memory store and Negentropy adapter through the existing seam', async () => {
        const node = await createNode('node-a', 0x11);
        const syncStore = new InMemoryOperationSyncStore();
        await syncStore.start();
        const stopSpy = jest.spyOn(syncStore, 'stop');
        const adapter = await NegentropyAdapter.create({
            syncStore,
            deferInitialBuild: true,
        });

        node.run(() => {
            const context = getMediatorNodeContext();
            context.syncStore = syncStore;
            context.negentropyAdapter = adapter;
            node.mediator.__test.setSyncStore(syncStore);
            node.mediator.__test.setNegentropyAdapter(adapter);
        });

        expect(node.run(() => getMediatorNodeContext().syncStore)).toBe(syncStore);
        expect(node.run(() => getMediatorNodeContext().negentropyAdapter)).toBe(adapter);

        await node.dispose();

        expect(stopSpy).toHaveBeenCalledTimes(1);
    });
});
