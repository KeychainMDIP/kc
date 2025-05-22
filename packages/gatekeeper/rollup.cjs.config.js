import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

import pkg from './package.json' with { type: 'json' };

const external = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {})
];

const config = {
    input: {
        'gatekeeper': 'dist/esm/gatekeeper.js',
        'gatekeeper-client': 'dist/esm/gatekeeper-client.js',
        'db/json': 'dist/esm/db/json.js',
        'db/json-cache': 'dist/esm/db/json-cache.js',
        'db/json-memory': 'dist/esm/db/json-memory.js',
        'db/sqlite': 'dist/esm/db/sqlite.js',
        'db/redis': 'dist/esm/db/redis.js',
        'db/mongo': 'dist/esm/db/mongo.js'
    },
    output: {
        dir: 'dist/cjs',
        format: 'cjs',
        exports: 'named',
        entryFileNames: '[name].cjs',
        chunkFileNames: '[name]-[hash].cjs'
    },
    external,
    plugins: [
        resolve({
            preferBuiltins: true
        }),
        commonjs(),
        json()
    ]
};

export default config;
