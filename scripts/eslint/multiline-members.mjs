export default {
    meta: {
        type: 'layout',
        docs: {description: 'Separate members when an object or type has already expanded across lines.'},
        fixable: 'whitespace',
        schema: [],
        messages: {newline: 'Put each member of this multiline structure on its own line.'},
    },
    create(context) {
        const sourceCode = context.sourceCode;
        const newline = sourceCode.text.includes('\r\n') ? '\r\n' : '\n';

        function checkMembers(node) {
            if (node.loc.start.line === node.loc.end.line) {
                return;
            }

            const members = node.properties ?? node.members ?? node.body;

            for (let index = 1; index < members.length; index += 1) {
                const current = sourceCode.getFirstToken(members[index]);
                const previous = sourceCode.getTokenBefore(current, {includeComments: true});

                if (previous.loc.end.line < current.loc.start.line) {
                    continue;
                }

                context.report({
                    node: members[index],
                    messageId: 'newline',
                    fix: fixer => fixer.replaceTextRange([previous.range[1], current.range[0]], newline),
                });
            }
        }

        return {
            ObjectExpression: checkMembers,
            TSTypeLiteral: checkMembers,
            TSInterfaceBody: checkMembers,
        };
    },
};
