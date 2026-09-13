import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import styleConfig from './scripts/eslint/style.config.mjs';

export default tseslint.config(
    {
        ignores: [
            '**/dist/**',
            '**/node_modules/**',
            '**/.turbo/**',
            '**/.vitepress/cache/**',
            'docs/audit/**',
            'docs/public/**',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{ts,mts,cts,js,mjs,cjs}'],
        languageOptions: {
            globals: globals.node,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['error', {args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_'}],
            '@typescript-eslint/no-empty-object-type': 'off',
            'no-empty': ['error', {allowEmptyCatch: true}],
        },
    },
    {
        files: ['docs/.vitepress/**/*.{ts,mts}'],
        languageOptions: {
            globals: globals.browser,
        },
    },
    styleConfig,
);
