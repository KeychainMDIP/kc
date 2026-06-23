import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

const rootConfigFiles = [
    'eslint.config.mjs',
    'jest.config.js',
    'swaggerConf.js',
];
const plainJsFiles = [
    ...rootConfigFiles,
    'scripts/**/*.{js,mjs,cjs}',
    'packages/**/*.{js,mjs,cjs}',
    'services/**/*.{js,mjs,cjs}',
    'apps/**/*.{js,mjs,cjs}',
    'demo/**/*.{js,mjs,cjs}',
    'tests/**/*.{js,mjs,cjs}',
];
const repoTsFiles = [
    'packages/**/*.{ts,tsx,mts,cts}',
    'services/**/*.{ts,tsx,mts,cts}',
    'apps/**/*.{ts,tsx,mts,cts}',
    'demo/**/*.{ts,tsx,mts,cts}',
    'tests/**/*.{ts,tsx,mts,cts}',
];
const declarationFiles = ['**/*.d.ts'];
const testFiles = ['tests/**/*.{js,mjs,cjs,ts,tsx,mts,cts}'];
const legacyClientFiles = [
    'services/keymaster/client/src/**/*.{js,jsx}',
    'services/gatekeeper/client/src/**/*.{js,jsx}',
];
const modernFrontendFiles = [
    'apps/react-wallet/src/**/*.{ts,tsx}',
    'apps/chrome-extension/src/**/*.{ts,tsx}',
    'services/explorer/src/**/*.{ts,tsx}',
];
const repoCodeFiles = [
    ...plainJsFiles,
    ...repoTsFiles,
    'services/keymaster/client/src/**/*.{js,jsx}',
    'services/gatekeeper/client/src/**/*.{js,jsx}',
];
const vendoredFiles = [
    'services/mediators/hyperswarm/src/negentropy/Negentropy.cjs',
];

const nodeGlobals = {
    ...globals.node,
};

const frontendGlobals = {
    ...globals.browser,
    ...globals.serviceworker,
    ...globals.webextensions,
};

const testGlobals = {
    ...globals.jest,
    ...globals.node,
};

export default [
    {
        ignores: [
            'data',
            'data/**',
            '**/data/**',
            'build',
            '**/build/**',
            'dist',
            '**/dist/**',
            'java',
            'java/**',
            ...vendoredFiles,
        ],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'off',
        },
    },
    {
        ...js.configs.recommended,
        files: plainJsFiles,
        ignores: [
            ...legacyClientFiles,
        ],
        languageOptions: {
            ...js.configs.recommended.languageOptions,
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: nodeGlobals,
        },
    },
    {
        files: repoCodeFiles,
        ignores: vendoredFiles,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
        rules: {
            indent: ['error', 4],
        },
    },
    {
        ...sonarjs.configs.recommended,
        files: repoCodeFiles,
        ignores: [
            ...rootConfigFiles,
            ...vendoredFiles,
            'services/keymaster/client/src/**',
            'services/gatekeeper/client/src/**',
        ],
        rules: {
            ...sonarjs.configs.recommended.rules,
            'sonarjs/cognitive-complexity': 'off',
            'sonarjs/no-nested-conditional': 'off',
            'sonarjs/no-nested-functions': 'off',
        },
    },
    {
        files: repoTsFiles,
        languageOptions: {
            parser: tseslint.parser,
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
        },
        rules: {
            '@typescript-eslint/no-redeclare': 'warn',
        },
    },
    {
        files: declarationFiles,
        rules: {
            'sonarjs/future-reserved-words': 'off',
            'sonarjs/redundant-type-aliases': 'off',
        },
    },
    {
        files: testFiles,
        languageOptions: {
            globals: testGlobals,
        },
        rules: {
            'sonarjs/no-clear-text-protocols': 'off',
            'sonarjs/no-hardcoded-passwords': 'off',
            'sonarjs/no-hardcoded-secrets': 'off',
            'sonarjs/pseudo-random': 'off',
        },
    },
    {
        files: legacyClientFiles,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: frontendGlobals,
        },
        plugins: {
            react: reactPlugin,
            'react-hooks': reactHooks,
            'jsx-a11y': jsxA11y,
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
        rules: {
            indent: 'off',
            'jsx-a11y/alt-text': 'error',
            'jsx-a11y/aria-props': 'error',
            'jsx-a11y/aria-proptypes': 'error',
            'jsx-a11y/aria-unsupported-elements': 'error',
            'jsx-a11y/role-has-required-aria-props': 'error',
            'jsx-a11y/role-supports-aria-props': 'error',
            'react/jsx-no-undef': 'error',
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },
    {
        files: modernFrontendFiles,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: frontendGlobals,
        },
        plugins: {
            react: reactPlugin,
            'react-hooks': reactHooks,
            'jsx-a11y': jsxA11y,
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
        rules: {
            'jsx-a11y/alt-text': 'error',
            'jsx-a11y/aria-props': 'error',
            'jsx-a11y/aria-proptypes': 'error',
            'jsx-a11y/aria-unsupported-elements': 'error',
            'jsx-a11y/role-has-required-aria-props': 'error',
            'jsx-a11y/role-supports-aria-props': 'error',
            'react/jsx-no-undef': 'error',
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },
];
