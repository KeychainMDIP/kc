import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

import pkg from './package.json' with { type: 'json' };

const external = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {})
];

const config = {
    input: {
        'keymaster': 'dist/esm/keymaster.js',
        'keymaster-client': 'dist/esm/keymaster-client.js',
        'db/json': 'dist/esm/db/json.js',
        'db/json-enc': 'dist/esm/db/json-enc.js',
        'db/json-memory': 'dist/esm/db/json-memory.js',
        'db/redis': 'dist/esm/db/redis.js',
        'db/mongo': 'dist/esm/db/mongo.js',
        'db/sqlite': 'dist/esm/db/sqlite.js',
        'db/cache': 'dist/esm/db/cache.js',
        'db/web': 'dist/esm/db/web.js',
        'db/web-enc': 'dist/esm/db/web-enc.js',
        'db/chrome': 'dist/esm/db/chrome.js',
        'db/typeGuards': 'dist/esm/db/typeGuards.js',
    },
    output: {
        dir: 'dist/cjs',
        format: 'cjs',
        exports: 'named'
    },
    external,
    plugins: [
        resolve(),
        commonjs()
    ]
};

export default config;
