/// <reference path="../../services/explorer/src/env.d.ts" />

import { jest } from '@jest/globals';
import { createServer } from 'node:http';

const requests: string[] = [];
const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
        agentDidCount: '10',
        agentDidCountsByPrefix: { 'did:test': '10' },
        credentialCount: '4',
        credentialDidCountsByPrefix: { 'did:test': '4' },
        schemas: [{ schemaDid: 'did:test:schema', count: '3' }],
    }));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();

if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind to a TCP port');
}

jest.unstable_mockModule('../../services/explorer/src/config.ts', () => ({
    searchServerUrl: `http://127.0.0.1:${address.port}`,
}));

const { fetchNetworkMetricSnapshot } = await import(
    '../../services/explorer/src/api/searchClient.ts'
);

describe('fetchNetworkMetricSnapshot', () => {
    afterAll(() => new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
    }));

    it('loads and maps one aggregate snapshot response', async () => {
        await expect(fetchNetworkMetricSnapshot('2026-08-16')).resolves.toStrictEqual({
            agentDidCount: 10,
            agentDidCountsByPrefix: { 'did:test': 10 },
            credentialCount: 4,
            credentialDidCountsByPrefix: { 'did:test': 4 },
            schemas: [{ schemaDid: 'did:test:schema', count: 3 }],
        });
        expect(requests).toStrictEqual(['/api/v1/metrics/snapshots/2026-08-16']);
    });
});
