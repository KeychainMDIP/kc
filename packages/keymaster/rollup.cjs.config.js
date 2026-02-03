import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

import pkg from './package.json' with { type: 'json' };

const external = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {})
];
const isExternal = (id) => external.some((pkgName) => id === pkgName || id.startsWith(`${pkgName}/`) || id.includes(`/node_modules/${pkgName}/`));

const config = {
    input: {
        'index': 'dist/esm/index.js',
        'node': 'dist/esm/node.js',
        'keymaster': 'dist/esm/keymaster.js',
        'keymaster-client': 'dist/esm/keymaster-client.js',
        'search-client': 'dist/esm/search-client.js',
        'encryption': 'dist/esm/encryption.js',
        'db/abstract-base': 'dist/esm/db/abstract-base.js',
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
        exports: 'named',
        entryFileNames: '[name].cjs',
        chunkFileNames: '[name]-[hash].cjs'
    },
    external: isExternal,
    plugins: [
        resolve(),
        commonjs()
    ]
};

export default config;
