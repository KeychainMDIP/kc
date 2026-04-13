import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnv, resolveEnvFiles } from '../../packages/common/src/env.ts';

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_CWD = process.cwd();

describe('loadEnv', () => {
    let tempDir = '';

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-env-'));
        process.env = { ...ORIGINAL_ENV };
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        process.chdir(ORIGINAL_CWD);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('loads service and workspace env files without overriding process env', () => {
        const workspaceDir = path.join(tempDir, 'repo');
        const serviceDir = path.join(workspaceDir, 'services', 'search-server');
        const distDir = path.join(serviceDir, 'dist');

        fs.mkdirSync(distDir, { recursive: true });
        fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
        fs.writeFileSync(path.join(workspaceDir, '.env'), 'ROOT_ONLY=root\nSHARED=root\nEXISTING=root\n');
        fs.writeFileSync(path.join(serviceDir, '.env'), 'SERVICE_ONLY=service\nSHARED=service\n');

        process.env.EXISTING = 'process';
        process.chdir(distDir);

        const loadedFiles = loadEnv();

        expect(loadedFiles).toEqual([
            path.join(serviceDir, '.env'),
            path.join(workspaceDir, '.env'),
        ]);
        expect(process.env.SERVICE_ONLY).toBe('service');
        expect(process.env.ROOT_ONLY).toBe('root');
        expect(process.env.SHARED).toBe('service');
        expect(process.env.EXISTING).toBe('process');
    });

    test('loads an explicit KC_ENV_FILE before discovered env files', () => {
        const workspaceDir = path.join(tempDir, 'repo');
        const serviceDir = path.join(workspaceDir, 'services', 'search-server');
        const mountedDir = path.join(tempDir, 'mounted');
        const explicitEnvFile = path.join(mountedDir, 'kc.env');

        fs.mkdirSync(serviceDir, { recursive: true });
        fs.mkdirSync(mountedDir, { recursive: true });
        fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
        fs.writeFileSync(path.join(workspaceDir, '.env'), 'ROOT_ONLY=root\n');
        fs.writeFileSync(explicitEnvFile, 'MOUNTED_ONLY=mounted\nROOT_ONLY=mounted\n');

        process.env.KC_ENV_FILE = explicitEnvFile;
        process.chdir(serviceDir);

        const loadedFiles = loadEnv();

        expect(loadedFiles).toEqual([
            explicitEnvFile,
            path.join(workspaceDir, '.env'),
        ]);
        expect(process.env.MOUNTED_ONLY).toBe('mounted');
        expect(process.env.ROOT_ONLY).toBe('mounted');
    });

    test('deduplicates KC_ENV_FILE when it matches a discovered env file', () => {
        const workspaceDir = path.join(tempDir, 'repo');
        const serviceDir = path.join(workspaceDir, 'services', 'search-server');
        const rootEnvFile = path.join(workspaceDir, '.env');

        fs.mkdirSync(serviceDir, { recursive: true });
        fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
        fs.writeFileSync(rootEnvFile, 'ROOT_ONLY=root\n');

        process.env.KC_ENV_FILE = rootEnvFile;
        process.chdir(serviceDir);

        expect(resolveEnvFiles()).toEqual([rootEnvFile]);
    });

    test('stops searching at the nearest package when package.json cannot be parsed', () => {
        const workspaceDir = path.join(tempDir, 'repo');
        const serviceDir = path.join(workspaceDir, 'services', 'search-server', 'dist');
        const workspaceEnvFile = path.join(workspaceDir, '.env');
        const outsideEnvFile = path.join(tempDir, '.env');

        fs.mkdirSync(serviceDir, { recursive: true });
        fs.writeFileSync(path.join(workspaceDir, 'package.json'), '{ not-valid-json');
        fs.writeFileSync(workspaceEnvFile, 'ROOT_ONLY=root\n');
        fs.writeFileSync(outsideEnvFile, 'OUTSIDE=outside\n');

        process.chdir(serviceDir);

        expect(resolveEnvFiles()).toEqual([workspaceEnvFile]);
    });

    test('stops searching when docker-compose.yml marks the workspace root', () => {
        const workspaceDir = path.join(tempDir, 'repo');
        const serviceDir = path.join(workspaceDir, 'services', 'search-server', 'dist');
        const workspaceEnvFile = path.join(workspaceDir, '.env');
        const outsideEnvFile = path.join(tempDir, '.env');

        fs.mkdirSync(serviceDir, { recursive: true });
        fs.writeFileSync(path.join(workspaceDir, 'docker-compose.yml'), 'services:\n  app:\n    image: test\n');
        fs.writeFileSync(workspaceEnvFile, 'ROOT_ONLY=root\n');
        fs.writeFileSync(outsideEnvFile, 'OUTSIDE=outside\n');

        process.chdir(serviceDir);

        expect(resolveEnvFiles()).toEqual([workspaceEnvFile]);
    });

    test('treats a truthy workspaces field as a workspace root marker', () => {
        const workspaceDir = path.join(tempDir, 'repo');
        const serviceDir = path.join(workspaceDir, 'services', 'search-server', 'dist');
        const workspaceEnvFile = path.join(workspaceDir, '.env');
        const outsideEnvFile = path.join(tempDir, '.env');

        fs.mkdirSync(serviceDir, { recursive: true });
        fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify({ workspaces: 'packages/*' }));
        fs.writeFileSync(workspaceEnvFile, 'ROOT_ONLY=root\n');
        fs.writeFileSync(outsideEnvFile, 'OUTSIDE=outside\n');

        process.chdir(serviceDir);

        expect(resolveEnvFiles()).toEqual([workspaceEnvFile]);
    });

    test('searches ancestor directories even outside a package workspace', () => {
        const nestedDir = path.join(tempDir, 'loose', 'service', 'dist');
        const ancestorEnvFile = path.join(tempDir, '.env');

        fs.mkdirSync(nestedDir, { recursive: true });
        fs.writeFileSync(ancestorEnvFile, 'LOOSE=1\n');

        expect(resolveEnvFiles({ cwd: nestedDir })).toContain(ancestorEnvFile);
    });

    test('throws when KC_ENV_FILE points to a missing file', () => {
        process.env.KC_ENV_FILE = path.join(tempDir, 'missing.env');
        process.chdir(tempDir);

        expect(() => resolveEnvFiles()).toThrow(`Environment file set by KC_ENV_FILE was not found: ${path.join(tempDir, 'missing.env')}`);
    });

    test('throws when dotenv reports an error while loading a file', () => {
        const envFile = path.join(tempDir, '.env');

        fs.writeFileSync(envFile, 'ROOT_ONLY=root\n');
        fs.chmodSync(envFile, 0o000);

        expect(() => loadEnv({ cwd: tempDir })).toThrow();

        fs.chmodSync(envFile, 0o600);
    });
});
