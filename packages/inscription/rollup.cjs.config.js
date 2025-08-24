import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

import pkg from './package.json' with { type: 'json' };

const external = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {})
];

const config = {
    input: {
        'index': 'dist/esm/index.js',
        'inscription': 'dist/esm/inscription.js'
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
        resolve(),
        commonjs()
    ]
};

export default config;
