# Coding style

Use vertical readability: separate logical steps with one blank line, keep related declarations together, use explicit guard blocks, and expand long conditions and lists. Keep imports compact. Optimize for scanning and debugging, not the fewest lines.

## Formatting contract

- Use four spaces for indentation, single quotes and semicolons. Double quotes are allowed when they avoid escaping an apostrophe.
- Keep opening braces on the same line. Put control-flow bodies on separate lines and always use braces.
- Put one blank line between setup and the next operation, between guard clauses, around control-flow blocks, and before a final return.
- Keep related adjacent declarations together. Preserve an intentional blank line between unrelated declaration groups.
- Do not insert empty lines immediately inside every block or between every expression. A short guard remains `if (...) {` followed directly by its indented return and closing brace.
- Expand long logical conditions across lines, with one logical operand per line, `&&` or `||` at the end of the previous line, and the closing condition parenthesis aligned with the statement.
- Expand arrays containing five or more elements to one element per line. Short arrays may stay on one line. Multiline arrays keep a trailing comma.
- Expand objects with four or more properties, and keep multiline object properties on separate lines. Small objects may stay compact. Keep small named imports compact; existing long import lists may span multiple lines.
- Keep named imports compact, for example `import {Readable} from 'node:stream';`. Preserve existing line endings.
- Use 120 columns as the working limit for ordinary code. Imports, comments, URLs, strings, templates and regular expressions are exempt so formatting does not rewrite their contents.

The five-element, four-property and 120-column limits make the approved example reproducible. Change those values in the preset if the preferred threshold changes.

## Commands

From the repository root, check or format all authored JavaScript and TypeScript:

```sh
npm run style:check
npm run style:fix
```

The regular lint command checks authored JavaScript/TypeScript and SCSS; the existing code-correctness rules remain enabled:

```sh
npm run lint
```

Format all code and styles, or target a specific code file:

```sh
npm run format
npm run style:check -- packages/abstract/src/operation-options.ts
npm run style:fix -- packages/abstract/src/operation-options.ts
```

The configuration covers package source, tests, examples, scripts, configuration files, and the VitePress configuration/theme TypeScript. Generated output, dependencies and frozen audit evidence/reports are excluded. `eslint.style.config.mjs` remains a compatible alias for `eslint.config.mjs`; editors can use the default ESLint configuration for fix-on-save. A second formatter with different rules can undo the chosen spacing.

## What the tools can decide

[ESLint Stylistic](https://eslint.style/rules) supplies the standard whitespace rules. Local whitespace-only rules separate members in expanded objects/interfaces and expand logical `if`, `while` and `do...while` conditions. It preserves parentheses and comments. Negated root expressions and `for` headers remain manual layout choices; the rule does not descend into callback bodies or logical function arguments. `style:fix` applies available fixes; remaining line-length or comment-sensitive diagnostics may need a deliberate edit.

ESLint recognizes statement boundaries, not the meaning of a logical step. When several transformations belong to one thought, keep them together. When responsibility changes, add a blank line. Do not force unrelated code into one block simply because a formatter accepts it.

Other preferences, such as descriptive names, useful intermediate variables, small functions, early validation and avoiding unnecessary abstraction, remain code-review guidance. Formatting is not permission to change runtime behavior.


## Stylesheets

Stylelint checks SCSS with the same four-space indentation, expanded declarations and blank lines between rule blocks. Run `npm run styles:check` or `npm run styles:fix` for styles alone. Property order and selectors are preserved; formatting does not change the theme.
