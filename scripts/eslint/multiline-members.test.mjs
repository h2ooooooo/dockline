import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Linter} from 'eslint';
import tseslint from 'typescript-eslint';
import rule from './multiline-members.mjs';

const linter = new Linter();
const config = [
    {
        files: ['**/*.ts'],
        languageOptions: {parser: tseslint.parser},
        plugins: {local: {rules: {members: rule}}},
        rules: {'local/members': 'error'},
    },
];

function tokens(source) {
    return tseslint.parser.parseForESLint(source, {tokens: true}).ast.tokens.map(token => [token.type, token.value]);
}

for (const source of [
    'const options = {\n a: 1, b: 2, c: 3, d: 4,\n};',
    'interface Options {\n name: string; value?: number;\n}',
    'type Options = {\n name: string; value: number;\n};',
    'const options = {\n a: 1, /* next property */ b: 2,\n};',
    'const options = {\r\n a: 1, b: 2,\r\n};',
]) {
    test('expanded members retain all syntax and converge: ' + source.split('\n')[0], () => {
        const result = linter.verifyAndFix(source, config, {filename: 'fixture.ts'});

        assert.deepEqual(result.messages, []);
        assert.deepEqual(tokens(result.output), tokens(source));
        assert.equal(linter.verifyAndFix(result.output, config, {filename: 'fixture.ts'}).fixed, false);

        if (source.includes('/* next property */')) {
            assert.match(result.output, /\/\* next property \*\/\nb:/u);
        }

        if (source.includes('\r\n')) {
            assert.equal(result.output.replaceAll('\r\n', '').includes('\n'), false);
        }
    });
}

test('small inline objects remain compact', () => {
    const source = 'const options = {a: 1, b: 2};';
    const result = linter.verifyAndFix(source, config, {filename: 'fixture.ts'});

    assert.equal(result.output, source);
    assert.deepEqual(result.messages, []);
});
