import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');

    return {
        plugins: [react()],
        root: './',
        server: {
            port: parseInt(env.VITE_EXPLORER_PORT) || 3000,
        },
        build: {
            outDir: '../dist',
        },
    };
});
