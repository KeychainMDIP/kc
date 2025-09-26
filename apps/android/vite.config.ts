import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
    base: './',
    plugins: [react()],
    resolve: {
        alias: {
            "@mdip/cipher/web": path.resolve(__dirname, "../../packages/cipher/dist/esm/cipher-web.js"),
            "@mdip/common/errors": path.resolve(__dirname, "../../packages/common/dist/esm/errors.js"),
            "@mdip/gatekeeper/client": path.resolve(__dirname, "../../packages/gatekeeper/dist/esm/gatekeeper-client.js"),
            "@mdip/gatekeeper/types": path.resolve(__dirname, "../../packages/gatekeeper/dist/types/types.d.js"),
            "@mdip/keymaster/wallet/web": path.resolve(__dirname, "../../packages/keymaster/dist/esm/db/web.js"),
            "@mdip/keymaster/wallet/web-enc": path.resolve(__dirname, "../../packages/keymaster/dist/esm/db/web-enc.js"),
            "@mdip/keymaster/wallet/cache": path.resolve(__dirname, "../../packages/keymaster/dist/esm/db/cache.js"),
            "@mdip/keymaster/wallet/typeGuards": path.resolve(__dirname, "../../packages/keymaster/dist/esm/db/typeGuards.js"),
            "@mdip/keymaster/types": path.resolve(__dirname, "../../packages/keymaster/dist/types/types.d.js"),
            "@mdip/keymaster/search": path.resolve(__dirname, "../../packages/keymaster/dist/esm/search-client.js"),
            "@mdip/keymaster": path.resolve(__dirname, "../../packages/keymaster/dist/esm/keymaster.js"),
            buffer: 'buffer',
        }
    },
    optimizeDeps: {
        include: ['buffer'],
    },
    build: {
        sourcemap: true,
        outDir: 'dist',
        rollupOptions: {
            input: {
                index: path.resolve(__dirname, 'index.html')
            }
        }
    }
});
