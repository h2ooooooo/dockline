import {stripTypeScriptTypes} from 'node:module';
import ts from 'typescript';

export function javascript(source) {
    const stripped = stripTypeScriptTypes(source, {mode: 'strip'});
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, stripped);
    let result = '';

    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
        let value = scanner.getTokenText();

        if (
            kind === ts.SyntaxKind.WhitespaceTrivia &&
            source.slice(scanner.getTokenPos(), scanner.getTextPos()) !== value &&
            !/(^|\n)[ \t]*$/.test(result)
        ) {
            const following = stripped.slice(scanner.getTextPos());

            value = /^[,;)]/.test(following) ? '' : ' ';
        }

        result += value;
    }

    result = result.replace(/[ \t]+$/gm, '');
    result = result.replace(/^import \{([^\n]+)\} from/gm, (_, names) => {
        const items = names.split(',').map(name => name.trim()).filter(Boolean);

        return 'import {' + items.join(', ') + '} from';
    });

    return result.trim();
}

export function commonJs(javascript, complete) {
    const parsed = ts.createSourceFile('example.js', javascript, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const imports = [];
    const edits = [];

    for (const statement of parsed.statements) {
        if (!ts.isImportDeclaration(statement)) {
            continue;
        }

        const name = statement.moduleSpecifier.text;
        const clause = statement.importClause;

        if (!clause) {
            imports.push("require('" + name + "');");
        } else {
            if (clause.name) {
                imports.push('const ' + clause.name.text + " = require('" + name + "');");
            }

            const bindings = clause.namedBindings;

            if (bindings && ts.isNamespaceImport(bindings)) {
                imports.push('const ' + bindings.name.text + " = require('" + name + "');");
            } else if (bindings) {
                const names = bindings.elements.map(element => element.propertyName ? element.propertyName.text + ': ' + element.name.text : element.name.text);

                if (names.length) {
                    imports.push('const {' + names.join(', ') + "} = require('" + name + "');");
                }
            }
        }

        edits.push([statement.getStart(parsed), statement.end]);
    }

    let body = javascript;

    for (const [start, end] of edits.reverse()) {
        body = body.slice(0, start) + body.slice(end);
    }

    body = body.replace(/\bexport (?=(async )?function|const |let |class )/g, '').trim();

    if (!complete) {
        return [...imports, '', body].join('\n').trim();
    }

    return imports.join('\n') + '\n\nasync function main() {\n' + body.split('\n').map(line => line ? '    ' + line : '').join('\n') + '\n}\n\nmain().catch(error => {\n    console.error(error);\n    process.exitCode = 1;\n});\n';
}

/** Catch bare package names, CLI flags and writer APIs outside code, links and captured output. */
export function unformattedTechnicalText(markdown) {
    const prose = markdown
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replace(/^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm, '')
        .replace(/<pre\b[\s\S]*?<\/pre>/g, '')
        .replace(/`+[^`\n]*`+/g, '')
        .replace(/https?:\/\/[^\s)<>]+/g, '')
        .replace(/\]\([^)]+\)/g, '')
        .replace(/<[^>\n]+>/g, '')
        .replace(/^#{1,6} .*$/gm, '');

    return [...prose.matchAll(/@jalsoedesign\/[A-Za-z0-9_-]+|(?<![\w-])--[a-z][\w-]*|\b(?:createFileZillaWriter|FileZillaProfileSource|NativeWritePreview)\b/g)].map(match => match[0]);
}
