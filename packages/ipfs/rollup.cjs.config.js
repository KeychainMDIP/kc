import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

import pkg from './package.json' with { type: 'json' };

const external = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {})
];

export default {
    input: {
        helia: 'dist/esm/helia-client.js',
        kubo: 'dist/esm/kubo-client.js',
        utils: 'dist/esm/utils.js'
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
