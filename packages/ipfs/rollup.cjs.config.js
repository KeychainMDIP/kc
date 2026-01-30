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
        'helia-client': 'dist/esm/helia-client.js',
        'kubo-client': 'dist/esm/kubo-client.js',
        utils: 'dist/esm/utils.js'
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
