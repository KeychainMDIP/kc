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
            '@mdip/cipher/web': resolvePackageDist('cipher/dist/esm/cipher-web.js'),
            '@mdip/gatekeeper/client': resolvePackageDist('gatekeeper/dist/esm/gatekeeper-client.js'),
            '@mdip/keymaster/wallet/web': resolvePackageDist('keymaster/dist/esm/db/web.js'),
            '@mdip/keymaster/wallet/json-memory': resolvePackageDist('keymaster/dist/esm/db/json-memory.js'),
            '@mdip/keymaster/wallet/mnemonic-hd': resolvePackageDist('keymaster/dist/esm/provider/mnemonic-hd.js'),
            '@mdip/keymaster/wallet/typeGuards': resolvePackageDist('keymaster/dist/esm/db/typeGuards.js'),
            '@mdip/keymaster/search': resolvePackageDist('keymaster/dist/esm/search-client.js'),
            '@mdip/keymaster/encryption': resolvePackageDist('keymaster/dist/esm/encryption.js'),
            '@mdip/keymaster': resolvePackageDist('keymaster/dist/esm/keymaster.js'),
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
