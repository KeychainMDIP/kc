export interface LoadEnvOptions {
    cwd?: string;
    envFileVar?: string;
    filenames?: string[];
}

export function resolveEnvFiles(_options: LoadEnvOptions = {}): string[] {
    return [];
}

export function loadEnv(_options: LoadEnvOptions = {}): string[] {
    return [];
}
