export function createServerShutdown({
    server,
    log,
    timeoutMs = 10_000,
    exit = code => {
        process.exit(code);
    },
}) {
    let shuttingDown = false;

    return signal => {
        if (shuttingDown) {
            return;
        }

        shuttingDown = true;
        log.info({ signal }, 'Stopping Explorer');

        const deadline = setTimeout(() => {
            log.error('Explorer shutdown timed out');
            exit(1);
        }, timeoutMs);
        deadline.unref();

        server.close(error => {
            clearTimeout(deadline);
            if (error) {
                log.error({ error }, 'Failed to stop Explorer');
                exit(1);
            }
        });
    };
}
