import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';
import { createServerShutdown } from '../../services/explorer/server-lifecycle.js';

const explorerDir = fileURLToPath(new URL('../../services/explorer/', import.meta.url));

async function getAvailablePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>(resolve => server.close(() => resolve()));
    return port;
}

function startExplorer(port: string | number): ChildProcessWithoutNullStreams {
    return spawn(process.execPath, ['server.js'], {
        cwd: explorerDir,
        env: {
            ...process.env,
            KC_LOG_LEVEL: 'info',
            VITE_EXPLORER_PORT: String(port),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
}

function waitForExit(child: ChildProcessWithoutNullStreams) {
    return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
    });
}

function waitForOutput(child: ChildProcessWithoutNullStreams, expected: string) {
    return new Promise<void>((resolve, reject) => {
        let output = '';
        const deadline = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`Timed out waiting for Explorer output: ${output}`));
        }, 5_000);

        function onData(data: Buffer) {
            output += data.toString();
            if (output.includes(expected)) {
                clearTimeout(deadline);
                resolve();
            }
        }

        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.once('exit', code => {
            clearTimeout(deadline);
            reject(new Error(`Explorer exited with ${code}: ${output}`));
        });
    });
}

describe('Explorer server lifecycle', () => {
    it('rejects a nonnumeric port', async () => {
        const child = startExplorer('invalid');
        let output = '';
        child.stderr.on('data', data => {
            output += data.toString();
        });
        const { code } = await waitForExit(child);

        expect(code).not.toBe(0);
        expect(output).toMatch(/VITE_EXPLORER_PORT must be an integer/);
    });

    it('stops the HTTP server cleanly on SIGTERM', async () => {
        const child = startExplorer(await getAvailablePort());
        await waitForOutput(child, 'Explorer running');

        const exited = waitForExit(child);
        child.kill('SIGTERM');

        await expect(exited).resolves.toEqual({ code: 0, signal: null });
    });

    it('reports a listener error and exits nonzero', async () => {
        const blocker = createServer();
        await new Promise<void>(resolve => blocker.listen(0, resolve));
        const port = (blocker.address() as AddressInfo).port;
        const child = startExplorer(port);
        let output = '';
        child.stdout.on('data', data => {
            output += data.toString();
        });
        child.stderr.on('data', data => {
            output += data.toString();
        });

        const { code } = await waitForExit(child);
        await new Promise<void>(resolve => blocker.close(() => resolve()));

        expect(code).not.toBe(0);
        expect(output).toMatch(/Explorer server error/);
    });

    it('is re-entrant and waits for server closure', async () => {
        let closeCallback!: (error?: Error) => void;
        let closeCalls = 0;
        const exits: number[] = [];
        const shutdown = createServerShutdown({
            server: {
                close(callback: (error?: Error) => void) {
                    closeCalls += 1;
                    closeCallback = callback;
                },
            },
            log: { info() {}, error() {} },
            timeoutMs: 50,
            exit(code: number) {
                exits.push(code);
            },
        });

        shutdown('SIGTERM');
        shutdown('SIGINT');
        expect(closeCalls).toBe(1);
        expect(exits).toEqual([]);

        closeCallback();
        await new Promise(resolve => setTimeout(resolve, 60));
        expect(exits).toEqual([]);
    });

    it('forces a nonzero exit after its deadline', async () => {
        const exits: number[] = [];
        const shutdown = createServerShutdown({
            server: { close() {} },
            log: { info() {}, error() {} },
            timeoutMs: 5,
            exit(code: number) {
                exits.push(code);
            },
        });

        shutdown('SIGTERM');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(exits).toEqual([1]);
    });

    it('exits nonzero when server closure fails', () => {
        const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
        const shutdown = createServerShutdown({
            server: {
                close(callback: (error?: Error) => void) {
                    callback(new Error('close failed'));
                },
            },
            log: { info() {}, error() {} },
        });

        shutdown('SIGTERM');
        expect(exit).toHaveBeenCalledWith(1);
        exit.mockRestore();
    });

    it('uses the default timeout when closure succeeds', () => {
        const shutdown = createServerShutdown({
            server: {
                close(callback: (error?: Error) => void) {
                    callback();
                },
            },
            log: { info() {}, error() {} },
            exit: jest.fn(),
        });

        shutdown('SIGTERM');
    });
});
