import stylistic from '@stylistic/eslint-plugin';
import multilineConditions from './multiline-conditions.mjs';
import multilineMembers from './multiline-members.mjs';

const declarations = ['const', 'let', 'var'];
const controlFlow = [
    'if',
    'for',
    'while',
    'do',
    'switch',
    'try',
];

export default {
    name: 'dockline/vertical-readability',
    files: ['**/*.{ts,mts,cts,js,mjs,cjs,vue}'],
    plugins: {
        '@stylistic': stylistic,
        'dockline-style': {
            rules: {
                'multiline-conditions': multilineConditions,
                'multiline-members': multilineMembers,
            },
        },
    },
    rules: {
        'curly': ['error', 'all'],
        '@stylistic/indent': ['error', 4, {SwitchCase: 1}],
        '@stylistic/indent-binary-ops': ['error', 4],
        '@stylistic/brace-style': ['error', '1tbs', {allowSingleLine: false}],
        '@stylistic/quotes': ['error', 'single', {avoidEscape: true}],
        '@stylistic/semi': ['error', 'always'],
        '@stylistic/semi-spacing': ['error', {before: false, after: true}],
        '@stylistic/member-delimiter-style': [
            'error',
            {
                multiline: {delimiter: 'semi', requireLast: true},
                singleline: {delimiter: 'semi', requireLast: false},
            },
        ],
        '@stylistic/comma-dangle': ['error', 'always-multiline'],
        '@stylistic/comma-spacing': ['error', {before: false, after: true}],
        '@stylistic/object-curly-spacing': ['error', 'never'],
        '@stylistic/object-curly-newline': [
            'error',
            {
                ObjectExpression: {multiline: true, minProperties: 4, consistent: true},
                ObjectPattern: {multiline: true, consistent: true},
                ImportDeclaration: {multiline: true, consistent: true},
                ExportDeclaration: {multiline: true, consistent: true},
                TSInterfaceBody: {multiline: true, minProperties: 1, consistent: true},
                TSTypeLiteral: {multiline: true, minProperties: 4, consistent: true},
            },
        ],
        '@stylistic/object-property-newline': ['error', {allowAllPropertiesOnSameLine: true}],
        '@stylistic/array-bracket-spacing': ['error', 'never'],
        '@stylistic/keyword-spacing': ['error', {before: true, after: true}],
        '@stylistic/space-before-blocks': ['error', 'always'],
        '@stylistic/space-before-function-paren': [
            'error',
            {
                anonymous: 'always',
                named: 'never',
                asyncArrow: 'always',
            },
        ],
        '@stylistic/space-in-parens': ['error', 'never'],
        '@stylistic/space-infix-ops': 'error',
        '@stylistic/key-spacing': ['error', {beforeColon: false, afterColon: true}],
        '@stylistic/type-annotation-spacing': 'error',
        '@stylistic/arrow-spacing': 'error',
        '@stylistic/function-call-spacing': ['error', 'never'],
        '@stylistic/operator-linebreak': [
            'error',
            'after',
            {
                overrides: {'&&': 'ignore', '||': 'ignore', '??': 'ignore'},
            },
        ],
        '@stylistic/array-bracket-newline': ['error', {multiline: true, minItems: 5}],
        '@stylistic/array-element-newline': [
            'error',
            {
                ArrayExpression: {multiline: true, minItems: 5, consistent: true},
                ArrayPattern: 'consistent',
            },
        ],
        '@stylistic/padding-line-between-statements': [
            'error',
            {blankLine: 'always', prev: '*', next: controlFlow},
            {blankLine: 'always', prev: controlFlow, next: '*'},
            {blankLine: 'always', prev: declarations, next: '*'},
            {blankLine: 'always', prev: '*', next: declarations},
            {blankLine: 'always', prev: '*', next: 'return'},
            {blankLine: 'always', prev: 'block-like', next: '*'},
            {blankLine: 'always', prev: 'import', next: '*'},
            {blankLine: 'any', prev: 'import', next: 'import'},
            {blankLine: 'any', prev: declarations, next: declarations},
        ],
        '@stylistic/lines-between-class-members': ['error', 'always'],
        '@stylistic/max-statements-per-line': ['error', {max: 1}],
        '@stylistic/no-multiple-empty-lines': ['error', {max: 1, maxBOF: 0, maxEOF: 0}],
        '@stylistic/no-trailing-spaces': 'error',
        '@stylistic/eol-last': ['error', 'always'],
        '@stylistic/max-len': [
            'error',
            {
                code: 120,
                tabWidth: 4,
                ignoreComments: true,
                ignoreUrls: true,
                ignoreStrings: true,
                ignoreTemplateLiterals: true,
                ignoreRegExpLiterals: true,
                ignorePattern: '^\\s*import\\s',
            },
        ],
        'dockline-style/multiline-conditions': ['error', {maxLength: 120}],
        'dockline-style/multiline-members': 'error',
    },
};
