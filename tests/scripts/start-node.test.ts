import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const startNode = fileURLToPath(new URL('../../start-node', import.meta.url));

describe('start-node', () => {
    let folder: string;
    let dockerLog: string;

    beforeEach(() => {
        folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-start-node-'));
        dockerLog = path.join(folder, 'docker.log');
        const bin = path.join(folder, 'bin');
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
printf 'RESET=%s|' "\${KC_SEARCH_SERVER_RESET_DB-}" >> "\${DOCKER_LOG}"
printf '%s ' "$@" >> "\${DOCKER_LOG}"
printf '\n' >> "\${DOCKER_LOG}"
`, { mode: 0o755 });
        fs.writeFileSync(path.join(folder, '.env'), [
            'KC_IPFS_ENABLE=false',
            'KC_SEARCH_SERVER_RESET_DB=false',
            '',
        ].join('\n'));
    });

    afterEach(() => {
        fs.rmSync(folder, { recursive: true, force: true });
    });

    async function run(args: string[]) {
        return execFileAsync(startNode, args, {
            cwd: folder,
            env: {
                ...process.env,
                DOCKER_LOG: dockerLog,
                PATH: `${path.join(folder, 'bin')}:${process.env.PATH}`,
            },
        });
    }

    function dockerCalls(): string[] {
        if (!fs.existsSync(dockerLog)) return [];
        return fs.readFileSync(dockerLog, 'utf8').trim().split('\n');
    }

    it('starts Search with reset enabled in the long-running process', async () => {
        await run(['search-server', '--reset-db']);

        expect(dockerCalls()).toEqual([
            'RESET=false|compose --profile ipfs down ',
            'RESET=false|compose down ',
            'RESET=false|compose build search-server ',
            'RESET=true|compose up search-server',
        ]);
    });

    it('preserves ordinary startup and its configured reset environment', async () => {
        fs.writeFileSync(path.join(folder, '.env'), [
            'KC_IPFS_ENABLE=false',
            'KC_SEARCH_SERVER_RESET_DB=true',
            '',
        ].join('\n'));
        await run(['search-server']);

        expect(dockerCalls()).toEqual([
            'RESET=true|compose --profile ipfs down ',
            'RESET=true|compose down ',
            'RESET=true|compose build search-server ',
            'RESET=true|compose up search-server',
        ]);
    });

    it('rejects reset when Search Server is not explicitly selected', async () => {
        await expect(run(['gatekeeper', '--reset-db'])).rejects.toMatchObject({
            code: 2,
            stderr: expect.stringContaining('--reset-db requires search-server'),
        });
        expect(dockerCalls()).toEqual([]);
    });

    it('rejects repeated reset options before invoking Docker', async () => {
        await expect(run(['search-server', '--reset-db', '--reset-db'])).rejects.toMatchObject({
            code: 2,
            stderr: expect.stringContaining('--reset-db may be specified only once'),
        });
        expect(dockerCalls()).toEqual([]);
    });
});
