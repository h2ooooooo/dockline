import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import rule from './multiline-conditions.mjs';

const require = createRequire(import.meta.url);
const {Linter} = require('eslint');
const parser = require('@typescript-eslint/parser');
const linter = new Linter();

function config(options = {}) {
    return [
        {
            files: ['**/*.ts'],
            languageOptions: {parser},
            plugins: {local: {rules: {'multiline-conditions': rule}}},
            rules: {'local/multiline-conditions': ['error', options]},
        },
    ];
}

function format(source, options = {}) {
    return linter.verifyAndFix(source, config(options), {filename: 'sample.ts'});
}

function tokens(source) {
    return parser.parse(source, {tokens: true, comment: true}).tokens.map(token => [token.type, token.value]);
}

function expectFormat(source, expected, options = {}) {
    const result = format(source, options);

    assert.equal(result.output, expected);
    assert.deepEqual(result.messages, []);
    assert.deepEqual(tokens(result.output), tokens(source));
    assert.equal(format(result.output, options).fixed, false);
}

test('expands a long OR condition with trailing operators and separate outer parentheses', () => {
    const source = 'if (error instanceof AuthError || error instanceof PermissionError || error instanceof NotFoundError || error instanceof NotSupportedError) {\n    return false;\n}';
    const expected = 'if (\n    error instanceof AuthError ||\n    error instanceof PermissionError ||\n    error instanceof NotFoundError ||\n    error instanceof NotSupportedError\n) {\n    return false;\n}';

    expectFormat(source, expected);
});

test('leaves a short logical condition unchanged, including compact TypeScript assertions', () => {
    const source = 'if (code !== undefined && values.includes(code as string)) {\n    return true;\n}';

    expectFormat(source, source);
});

test('does not wrap a short condition because its body is long', () => {
    const source = `if (ready || done) { use('${'x'.repeat(150)}'); }`;

    expectFormat(source, source);
});

test('normalizes an existing multiline condition and preserves mixed parenthesized grouping', () => {
    const source = 'if (first && (second\n    || third)) {\n    run();\n}';
    const expected = 'if (\n    first &&\n    (second ||\n    third)\n) {\n    run();\n}';

    expectFormat(source, expected);
});

test('preserves redundant grouping parentheses and expression tokens', () => {
    const source = 'if (((first || second)) && third) {\n    run();\n}';
    const expected = 'if (\n    ((first ||\n    second)) &&\n    third\n) {\n    run();\n}';

    expectFormat(source, expected, {maxLength: 20});
});

test('does not descend into callbacks or logical function arguments', () => {
    const source = 'if (items.some(item => item.first || item.second) && ready) {\n    run();\n}';
    const expected = 'if (\n    items.some(item => item.first || item.second) &&\n    ready\n) {\n    run();\n}';

    expectFormat(source, expected, {maxLength: 30});
});

test('expands while and do-while logical conditions using their own delimiters', () => {
    expectFormat(
        'while (first || second) {\n    run();\n}',
        'while (\n    first ||\n    second\n) {\n    run();\n}',
        {maxLength: 15},
    );

    expectFormat(
        'do {\n    run();\n} while (first || second);',
        'do {\n    run();\n} while (\n    first ||\n    second\n);',
        {maxLength: 15},
    );
});

test('retains CRLF and parent indentation', () => {
    const source = 'function check() {\r\n    if (first || second) {\r\n        return true;\r\n    }\r\n}';
    const expected = 'function check() {\r\n    if (\r\n        first ||\r\n        second\r\n    ) {\r\n        return true;\r\n    }\r\n}';

    expectFormat(source, expected, {maxLength: 15});
});

test('retains an inline block comment when it does not occupy a changed gap', () => {
    const source = 'if (first /* reason */ || second) {\n    run();\n}';
    const expected = 'if (\n    first /* reason */ ||\n    second\n) {\n    run();\n}';

    expectFormat(source, expected, {maxLength: 15});
    assert.deepEqual(parser.parse(expected, {comment: true}).comments.map(comment => comment.value), [' reason ']);
});

test('reports an unsafe block-comment gap without changing the source', () => {
    const source = 'if (first || /* reason */ second) {\n    run();\n}';
    const result = format(source, {maxLength: 15});

    assert.equal(result.output, source);
    assert.equal(result.fixed, false);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].messageId, 'comments');
});

test('keeps a trailing line comment and its newline intact', () => {
    const source = 'if (first || // reason\n    second) {\n    run();\n}';
    const expected = 'if (\n    first || // reason\n    second\n) {\n    run();\n}';

    expectFormat(source, expected);
    assert.match(expected, /\|\| \/\/ reason\n/u);
});

test('refuses to move an operator across a line comment', () => {
    const source = 'if (first // reason\n    || second) {\n    run();\n}';
    const result = format(source);

    assert.equal(result.output, source);
    assert.equal(result.fixed, false);
    assert.equal(result.messages[0].messageId, 'comments');
});

test('leaves for headers and non-logical tests outside this focused rule', () => {
    const source = 'for (let index = 0; first || second; index += 1) {\n    run();\n}\nif (isReady(first, second)) {\n    run();\n}';

    expectFormat(source, source, {maxLength: 5});
});
