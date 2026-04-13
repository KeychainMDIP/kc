import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const DEFAULT_ENV_FILENAME = '.env';
const DEFAULT_ENV_FILE_VAR = 'KC_ENV_FILE';

export interface LoadEnvOptions {
    cwd?: string;
    envFileVar?: string;
    filenames?: string[];
}

function hasPackageJson(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'package.json'));
}

function hasWorkspaceRootMarker(dir: string): boolean {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'docker-compose.yml'))) {
        return true;
    }

    const packageJsonPath = path.join(dir, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
        return false;
    }

    try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { workspaces?: unknown };
        return Array.isArray(packageJson.workspaces) || Boolean(packageJson.workspaces);
    } catch {
        return false;
    }
}

function collectSearchDirectories(startDir: string): string[] {
    const directories: string[] = [];
    let currentDir = path.resolve(startDir);
    let nearestPackageIndex = -1;

    while (true) {
        directories.push(currentDir);

        if (nearestPackageIndex === -1 && hasPackageJson(currentDir)) {
            nearestPackageIndex = directories.length - 1;
        }

        if (hasWorkspaceRootMarker(currentDir)) {
            return directories;
        }

        const parentDir = path.dirname(currentDir);

        if (parentDir === currentDir) {
            break;
        }

        currentDir = parentDir;
    }

    if (nearestPackageIndex >= 0) {
        return directories.slice(0, nearestPackageIndex + 1);
    }

    return directories;
}

export function resolveEnvFiles(options: LoadEnvOptions = {}): string[] {
    const cwd = options.cwd ?? process.cwd();
    const envFileVar = options.envFileVar ?? DEFAULT_ENV_FILE_VAR;
    const filenames = options.filenames ?? [DEFAULT_ENV_FILENAME];
    const explicitEnvFile = process.env[envFileVar]?.trim();
    const candidates: string[] = [];

    if (explicitEnvFile) {
        const resolvedExplicitEnvFile = path.resolve(cwd, explicitEnvFile);

        if (!fs.existsSync(resolvedExplicitEnvFile)) {
            throw new Error(`Environment file set by ${envFileVar} was not found: ${resolvedExplicitEnvFile}`);
        }

        candidates.push(resolvedExplicitEnvFile);
    }

    for (const dir of collectSearchDirectories(cwd)) {
        for (const filename of filenames) {
            candidates.push(path.join(dir, filename));
        }
    }

    const uniqueFiles = new Set<string>();

    return candidates.filter(candidate => {
        const resolvedCandidate = path.resolve(candidate);

        if (uniqueFiles.has(resolvedCandidate)) {
            return false;
        }

        uniqueFiles.add(resolvedCandidate);

        return fs.existsSync(resolvedCandidate) && fs.statSync(resolvedCandidate).isFile();
    });
}

export function loadEnv(options: LoadEnvOptions = {}): string[] {
    const loadedFiles: string[] = [];

    for (const envFile of resolveEnvFiles(options)) {
        const result = dotenv.config({
            path: envFile,
            override: false,
        });

        if (result.error) {
            throw result.error;
        }

        loadedFiles.push(envFile);
    }

    return loadedFiles;
}
