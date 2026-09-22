import { createServer, type Server } from 'node:http';

export interface NetworkPeerStatus {
    name: string;
    peerId: string;
    lastSeen: string;
    syncMode: 'negentropy' | 'unknown';
    operationCount: number | null;
    orderedOperationCount: number | null;
}

export interface NetworkStatus {
    generatedAt: string;
    protocol: string;
    node: {
        name: string;
        peerId: string;
        operationCount: number;
        orderedOperationCount: number;
    };
    totals: {
        visibleNodes: number;
        connectedPeers: number;
    };
    peers: NetworkPeerStatus[];
}

export function createStatusServer(
    getStatus: () => NetworkStatus | Promise<NetworkStatus>
): Server {
    return createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');

        if (req.method !== 'GET' || req.url !== '/api/v1/network') {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
        }

        try {
            res.end(JSON.stringify(await getStatus()));
        }
        catch {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Network status unavailable' }));
        }
    });
}
