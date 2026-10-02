interface ClosableServer {
    close(callback: (error?: Error) => void): void;
}

interface ExplorerLogger {
    info(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

interface ServerShutdownOptions {
    server: ClosableServer;
    log: ExplorerLogger;
    timeoutMs?: number;
    exit?: (code: number) => void;
}

export function createServerShutdown(options: ServerShutdownOptions): (signal: string) => void;
