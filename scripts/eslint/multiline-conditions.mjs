const logicalConditionNodes = new Set(['IfStatement', 'WhileStatement', 'DoWhileStatement']);

function collectOperators(node, sourceCode, operators) {
    if (node.type !== 'LogicalExpression') {
        return;
    }

    collectOperators(node.left, sourceCode, operators);

    operators.push(sourceCode.getTokenAfter(node.left, token => token.value === node.operator));

    collectOperators(node.right, sourceCode, operators);
}

function findConditionParens(node, sourceCode) {
    const keyword = node.type === 'DoWhileStatement' ?
        sourceCode.getTokenAfter(node.body) :
        sourceCode.getFirstToken(node);
    const opening = sourceCode.getTokenAfter(keyword);

    if (opening.value !== '(') {
        return null;
    }

    let depth = 0;

    for (const token of sourceCode.getTokens(node)) {
        if (token.range[0] < opening.range[0] || token.type !== 'Punctuator') {
            continue;
        }

        if (token.value === '(') {
            depth += 1;
        }

        if (token.value === ')') {
            depth -= 1;

            if (depth === 0) {
                return {opening, closing: token};
            }
        }
    }

    return null;
}

export default {
    meta: {
        type: 'layout',
        docs: {
            description: 'Expand long or already multiline logical conditions without changing tokens.',
        },
        fixable: 'whitespace',
        schema: [
            {
                type: 'object',
                properties: {
                    maxLength: {type: 'integer', minimum: 1},
                    indent: {type: 'integer', minimum: 1},
                },
                additionalProperties: false,
            },
        ],
        messages: {
            expand: 'Put this logical condition on separate lines, with operators at the end of each operand and the outer parentheses on separate lines.',
            comments: 'Put this logical condition on separate lines; adjust the commented gaps manually to preserve the comments.',
        },
    },

    create(context) {
        const sourceCode = context.sourceCode;
        const {maxLength = 120, indent = 4} = context.options[0] ?? {};
        const linebreak = sourceCode.text.includes('\r\n') ? '\r\n' : '\n';

        function checkCondition(node) {
            if (!logicalConditionNodes.has(node.type) || node.test?.type !== 'LogicalExpression') {
                return;
            }

            const parens = findConditionParens(node, sourceCode);

            if (!parens) {
                return;
            }

            const {opening, closing} = parens;
            const multiline = opening.loc.start.line !== closing.loc.end.line;

            if (!multiline && closing.loc.end.column <= maxLength) {
                return;
            }

            const headerIndent = sourceCode.lines[opening.loc.start.line - 1].match(/^\s*/u)[0];
            const operandIndent = headerIndent + ' '.repeat(indent);
            const operators = [];
            const edits = [];

            collectOperators(node.test, sourceCode, operators);

            function requireGap(left, right, newline, indentation = operandIndent) {
                const hasNewline = left.loc.end.line < right.loc.start.line;

                if (hasNewline === newline) {
                    return;
                }

                const range = [left.range[1], right.range[0]];
                const existing = sourceCode.text.slice(...range);

                edits.push({
                    range,
                    text: newline ? linebreak + indentation : ' ',
                    safe: /^\s*$/u.test(existing),
                });
            }

            requireGap(opening, sourceCode.getTokenAfter(opening), true);

            for (const operator of operators) {
                requireGap(sourceCode.getTokenBefore(operator), operator, false);
                requireGap(operator, sourceCode.getTokenAfter(operator), true);
            }

            requireGap(sourceCode.getTokenBefore(closing), closing, true, headerIndent);

            if (edits.length === 0) {
                return;
            }

            const safe = edits.every(edit => edit.safe);

            context.report({
                node: node.test,
                messageId: safe ? 'expand' : 'comments',
                // A commented gap needs human placement; keep the complete condition intact.
                fix: safe ?
                    fixer => edits.map(edit => fixer.replaceTextRange(edit.range, edit.text)) :
                    null,
            });
        }

        return {
            IfStatement: checkCondition,
            WhileStatement: checkCondition,
            DoWhileStatement: checkCondition,
        };
    },
};
