import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

import pkg from './package.json' with { type: 'json' };

const external = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {})
];

export default {
    input: {
        node: 'dist/esm/cipher-node.js',
        web: 'dist/esm/cipher-web.js'
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
