// Run the opt-in Java suite against an isolated reference HTTP service, without P2P or IPFS.
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const javaDir = fileURLToPath(new URL('../', import.meta.url));
const serverPath = fileURLToPath(new URL('../../services/gatekeeper/server/dist/gatekeeper-api.js', import.meta.url));
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mdip-java-live-'));
const logFile = await open(path.join(tempDir, 'gatekeeper.log'), 'w');
let server;
let gradle;
let failed = false;

async function stop(child) {
    if (!child?.pid) return;
    const groups = new Set([child.pid]);
    if (child === gradle && process.platform !== 'win32') {
        let files;
        try { files = await readdir(path.join(tempDir, 'gradle-daemons'), { recursive: true }); }
        catch (error) { if (error.code !== 'ENOENT') throw error; files = []; }
        // The single-use daemon starts its own session. Only this run can write these logs.
        for (const file of files) {
            const match = /^daemon-([1-9]\d*)\.out\.log$/.exec(path.basename(file));
            if (match) groups.add(Number(match[1]));
        }
    }
    const kill = signal => {
        for (const pid of groups) {
            try {
                if (child === gradle && process.platform !== 'win32') process.kill(-pid, signal);
                else child.kill(signal);
            } catch (error) {
                if (error.code !== 'ESRCH') throw error;
            }
        }
    };
    if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        const deadline = setTimeout(() => kill('SIGKILL'), 10_000);
        kill('SIGTERM');
        try { await exited; } finally { clearTimeout(deadline); }
    }
    // A wrapper can exit before a stalled daemon or worker does.
    if (child === gradle && process.platform !== 'win32') kill('SIGKILL');
}

const interrupted = () => {
    failed = true;
    void stop(gradle);
    void stop(server);
};
process.on('SIGINT', interrupted);
process.on('SIGTERM', interrupted);
const deadline = setTimeout(interrupted, 15 * 60_000);

try {
    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    const env = {
        ...process.env,
        KC_ENV_FILE: '',
        KC_LOG_LEVEL: 'info',
        KC_GATEKEEPER_PORT: String(port),
        KC_GATEKEEPER_DB: 'json',
        KC_GATEKEEPER_REGISTRIES: 'local',
        KC_GATEKEEPER_DID_PREFIX: 'did:test',
        KC_IPFS_ENABLE: 'false',
        KC_GATEKEEPER_GC_INTERVAL: '0',
        KC_GATEKEEPER_STATUS_INTERVAL: '0',
        KC_GATEKEEPER_RATE_LIMIT_ENABLED: 'false',
        KC_GATEKEEPER_URL: `http://127.0.0.1:${port}`,
    };
    server = spawn(process.execPath, [serverPath], { cwd: tempDir, env, stdio: ['ignore', logFile.fd, logFile.fd] });
    server.on('error', error => { failed = true; console.error(error); });
    const readyDeadline = Date.now() + 60_000;
    while (true) {
        if (failed || server.exitCode !== null || server.signalCode !== null) throw new Error('Test Gatekeeper exited before becoming ready');
        try {
            const response = await fetch(`${env.KC_GATEKEEPER_URL}/api/v1/ready`, { signal: AbortSignal.timeout(1000) });
            // Do not mistake another listener for this child after releasing the reserved port.
            const listening = (await readFile(path.join(tempDir, 'gatekeeper.log'), 'utf8'))
                .includes(`Server is running on port ${port}`);
            if (listening && response.ok && await response.json() === true) break;
        } catch { /* Retry while this isolated service starts. */ }
        if (Date.now() >= readyDeadline) throw new Error('Test Gatekeeper readiness timed out');
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log(`Isolated reference Gatekeeper ready at ${env.KC_GATEKEEPER_URL} (local registry only)`);
    gradle = spawn('./gradlew', [':keymaster:liveTest', ...process.argv.slice(2), '--no-daemon',
        `-Dorg.gradle.daemon.registry.base=${path.join(tempDir, 'gradle-daemons')}`, '--console=plain'], {
        cwd: javaDir, env, stdio: 'inherit', detached: process.platform !== 'win32',
    });
    const [code, signal] = await once(gradle, 'exit');
    if (code !== 0 || signal || failed) throw new Error(`Java live tests failed (${signal ?? code})`);
} catch (error) {
    failed = true;
    console.error(error);
} finally {
    clearTimeout(deadline);
    await stop(gradle);
    await stop(server);
    await logFile.close();
    const reportDir = path.join(javaDir, 'keymaster/build/reports/interop');
    await mkdir(reportDir, { recursive: true });
    await copyFile(path.join(tempDir, 'gatekeeper.log'), path.join(reportDir, 'gatekeeper.log'));
    if (failed) console.error((await readFile(path.join(tempDir, 'gatekeeper.log'), 'utf8')).slice(-20_000));
    await rm(tempDir, { recursive: true, force: true });
    process.exitCode = failed ? 1 : 0;
}
