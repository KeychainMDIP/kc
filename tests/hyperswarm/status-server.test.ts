import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import {
    createStatusServer,
    type NetworkStatus,
} from '../../services/mediators/hyperswarm/src/status-server.ts';

const status: NetworkStatus = {
    generatedAt: '2026-09-22T12:00:00.000Z',
    protocol: '/MDIP/v1.0-public',
    node: {
        name: 'local',
        peerId: 'local-peer',
        operationCount: 10,
        orderedOperationCount: 10,
    },
    totals: {
        visibleNodes: 2,
        connectedPeers: 1,
    },
    peers: [{
        name: 'remote',
        peerId: 'remote-peer',
        lastSeen: '2026-09-22T11:59:59.000Z',
        syncMode: 'negentropy',
        operationCount: 10,
        orderedOperationCount: 10,
    }],
};

async function listen(server: Server): Promise<string> {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
    await new Promise<void>(resolve => server.close(() => resolve()));
}

describe('Hyperswarm network status server', () => {
    it('serves current network status and rejects other routes', async () => {
        const server = createStatusServer(() => status);
        const base = await listen(server);

        try {
            const response = await fetch(`${base}/api/v1/network`);
            expect(response.status).toBe(200);
            expect(response.headers.get('cache-control')).toBe('no-store');
            await expect(response.json()).resolves.toEqual(status);

            const missing = await fetch(`${base}/other`);
            expect(missing.status).toBe(404);

            const wrongMethod = await fetch(`${base}/api/v1/network`, { method: 'POST' });
            expect(wrongMethod.status).toBe(404);
        }
        finally {
            await close(server);
        }
    });

    it('reports status collection failures', async () => {
        const server = createStatusServer(() => {
            throw new Error('store unavailable');
        });
        const base = await listen(server);

        try {
            const response = await fetch(`${base}/api/v1/network`);
            expect(response.status).toBe(500);
            await expect(response.json()).resolves.toEqual({ error: 'Network status unavailable' });
        }
        finally {
            await close(server);
        }
    });
});
