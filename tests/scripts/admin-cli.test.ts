import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/admin-cli.js', import.meta.url));

interface Event {
    registry: string;
    time: string;
    operation: { type: string; data: { id: number; payload: string }; signature: { hash: string } };
}

function events(count: number): Event[] {
    return Array.from({ length: count }, (_, id) => ({
        registry: 'local', time: '2026-01-01T00:00:00Z',
        operation: { type: 'create', data: { id, payload: 'x'.repeat(100) }, signature: { hash: `hash-${id}` } },
    }));
}

async function importFile(batch: Event[], options: {
    maxBytes?: number; unblockAt?: number; permanentRefusal?: boolean; dependentIds?: number[]; fillBeforeImport?: 'first' | 'every';
    command?: 'import-did' | 'import-dids';
} = {}) {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'mdip-admin-import-'));
    const applied = new Set<number>();
    const queue: Event[] = [];
    const imported: Event[][] = [];
    let capacityResponses = 0;
    let processingCalls = 0;
    const server = createServer((request, response) => {
        (async () => {
            let result: unknown;
            if (request.url === '/api/v1/batch/import' || request.url === '/api/v1/dids/import') {
                const chunks: Buffer[] = [];
                for await (const chunk of request) chunks.push(chunk);
                const parsed = JSON.parse(Buffer.concat(chunks).toString()) as Event[] | Event[][];
                const input = (request.url === '/api/v1/dids/import' ? parsed.flat() : parsed) as Event[];
                imported.push(input);
                if (options.fillBeforeImport === 'every' || options.fillBeforeImport === 'first' && imported.length === 1) {
                    queue.push(...events(300).map(event => ({
                        ...event, operation: { ...event.operation, data: { ...event.operation.data, id: event.operation.data.id + 10000 } },
                    })));
                }
                const capacityDeferredIndices: number[] = [];
                let bytes = queue.reduce((total, event) => total + Buffer.byteLength(JSON.stringify(event)), 0);
                for (const [index, event] of input.entries()) {
                    const size = Buffer.byteLength(JSON.stringify(event));
                    if (queue.length >= 300 || bytes + size > (options.maxBytes ?? Infinity)) {
                        capacityDeferredIndices.push(index);
                    } else {
                        queue.push(event);
                        bytes += size;
                    }
                }
                if (capacityDeferredIndices.length) capacityResponses += 1;
                result = {
                    queued: input.length - capacityDeferredIndices.length, processed: 0, rejected: 0,
                    total: queue.length, rejectedIndices: [], capacityDeferred: capacityDeferredIndices.length,
                    capacityDeferredIndices, processedIndices: [],
                };
            } else if (request.url === '/api/v1/events/process') {
                processingCalls += 1;
                const page = queue.splice(0, 50);
                const deferred = page.filter(event => (options.dependentIds ?? [0]).includes(event.operation.data.id)
                    && (options.permanentRefusal || options.unblockAt !== undefined && !applied.has(options.unblockAt)));
                for (const event of page) {
                    if (!deferred.includes(event)) applied.add(event.operation.data.id);
                }
                result = {
                    added: page.length - deferred.length, merged: 0, rejected: 0, pending: 0,
                    hasMore: queue.length > 0, acceptedHashes: [], acceptedEvents: [],
                    capacityDeferred: deferred.length,
                    capacityDeferredHashes: deferred.map(event => event.operation.signature.hash),
                };
            } else {
                throw new Error(`Unexpected request ${request.url}`);
            }
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify(result));
        })().catch(error => { response.writeHead(500); response.end(String(error)); });
    });
    try {
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('No fixture address');
        const file = path.join(folder, 'batch.json');
        const command = options.command ?? 'import-batch-file';
        const contents = command === 'import-did' ? [batch]
            : command === 'import-dids' ? batch.map(event => [event]) : batch;
        await writeFile(file, JSON.stringify(contents));
        const args = [script, command, file, ...(command === 'import-batch-file' ? ['hyperswarm'] : [])];
        const child = spawn(process.execPath, args, {
            cwd: folder,
            env: { ...process.env, KC_GATEKEEPER_URL: `http://127.0.0.1:${address.port}` },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let error = '';
        child.stdout.on('data', data => { output = (output + String(data)).slice(0, 65536); });
        child.stderr.on('data', data => { error = (error + String(data)).slice(0, 65536); });
        const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
        try {
            const [code, signal] = await once(child, 'close');
            return { code, signal, output, error, applied, imported, capacityResponses, processingCalls };
        } finally { clearTimeout(deadline); child.kill(); }
    } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await rm(folder, { recursive: true, force: true });
    }
}

describe('admin batch-file import', () => {
    it.each(['import-did', 'import-dids'] as const)('drains and retries exported histories with %s', async command => {
        const result = await importFile(events(501), { command });
        expect(result.code).toBe(0);
        expect(result.error).toBe('');
        expect(result.applied.size).toBe(501);
        expect(result.imported.every(batch => batch.every(event => event.registry === 'local'))).toBe(true);
        expect(result.processingCalls).toBeGreaterThan(result.imported.length);
    });

    it('drains processing pages while importing more than the transient queue capacity', async () => {
        const result = await importFile(events(501));
        expect(result.code).toBe(0);
        expect(result.error).toBe('');
        expect(result.applied.size).toBe(501);
        expect(result.imported).toHaveLength(6);
        expect(result.imported.every(batch => batch.every(event => event.registry === 'hyperswarm'))).toBe(true);
        expect(result.processingCalls).toBeGreaterThan(result.imported.length);
    });

    it('retries only refused inputs when a chunk exceeds the admission byte budget', async () => {
        const result = await importFile(events(120), { maxBytes: 1200 });
        expect(result.code).toBe(0);
        expect(result.error).toBe('');
        expect(result.capacityResponses).toBeGreaterThan(0);
        expect(result.applied.size).toBe(120);
        expect(result.imported.flat().filter(event => event.operation.data.id === 1)).toHaveLength(1);
    });

    it('lets later file chunks supply a dependency before retrying a refused earlier event', async () => {
        const result = await importFile(events(501), { unblockAt: 500 });
        expect(result.code).toBe(0);
        expect(result.error).toBe('');
        expect(result.applied.size).toBe(501);
        expect(result.imported.at(-1)?.map(event => event.operation.data.id)).toEqual([0]);
        expect(result.imported.flat().filter(event => event.operation.data.id === 1)).toHaveLength(1);
    });

    it('tries admission-refused events before retrying processing refusals in the same byte-limited chunk', async () => {
        const result = await importFile(events(20), {
            maxBytes: 1200, unblockAt: 19, dependentIds: Array.from({ length: 19 }, (_, id) => id),
        });
        expect(result.code).toBe(0);
        expect(result.error).toBe('');
        expect(result.applied.size).toBe(20);
        expect(result.imported.flat().filter(event => event.operation.data.id === 0)).toHaveLength(2);
    });

    it('retries when draining another client frees a completely occupied transient lane', async () => {
        const result = await importFile(events(2), { fillBeforeImport: 'first' });
        expect(result.code).toBe(0);
        expect(result.error).toBe('');
        expect(result.applied.has(0)).toBe(true);
        expect(result.applied.has(1)).toBe(true);
        expect(result.imported).toHaveLength(2);
    });

    it('stops after bounded retries when competing admissions keep taking all freed capacity', async () => {
        const result = await importFile(events(2), { fillBeforeImport: 'every' });
        expect(result.code).toBe(1);
        expect(result.signal).toBeNull();
        expect(result.error).toContain('Gatekeeper import capacity remains full');
        expect(result.applied.has(0)).toBe(false);
        expect(result.applied.has(1)).toBe(false);
        expect(result.imported).toHaveLength(2);
    });

    it('fails explicitly after a full retry pass makes no progress', async () => {
        const result = await importFile(events(1), { permanentRefusal: true });
        expect(result.code).toBe(1);
        expect(result.signal).toBeNull();
        expect(result.error).toContain('No progress on 1 capacity-deferred events');
        expect(result.applied.size).toBe(0);
        expect(result.imported).toHaveLength(1);
    });
});
