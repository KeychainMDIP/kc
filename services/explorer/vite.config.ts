import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');

    return {
        plugins: [react()],
        root: './',
	    base: '/',
        server: {
            port: parseInt(env.VITE_EXPLORER_PORT) || 4000,
        },
        build: {
            outDir: './dist',
        },
    };
});
