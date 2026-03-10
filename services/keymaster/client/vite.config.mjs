import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagesDirCandidates = [
    path.resolve(__dirname, '../../../packages'),
    path.resolve(__dirname, '../../packages'),
];
const packagesDir = packagesDirCandidates.find(candidate => fs.existsSync(candidate));

if (!packagesDir) {
    throw new Error(`Unable to locate packages directory from ${__dirname}`);
}

function resolvePackageDist(...segments) {
    return path.join(packagesDir, ...segments);
}

export default defineConfig({
    base: './',
    plugins: [react()],
    resolve: {
        alias: {
            '@mdip/keymaster/client': resolvePackageDist('keymaster/dist/esm/keymaster-client.js'),
            buffer: 'buffer',
        },
    },
    optimizeDeps: {
        include: ['buffer'],
    },
    build: {
        outDir: 'build',
        sourcemap: true,
        chunkSizeWarningLimit: 2000,
        rollupOptions: {
            input: {
                index: path.resolve(__dirname, 'index.html'),
            },
        },
    },
});
