# Choose your example format

Examples start with **TypeScript**. Use the neighbouring JavaScript, MJS or CommonJS tab for the same operation in your project's module style. A filename comment identifies which file to save. Selecting a language updates the other language tabs and run instructions on the page, and keeps that choice while navigating the documentation. A fresh page load starts with TypeScript. Shell tabs such as PowerShell/macOS are independent.

| Tab | File | Setup and run |
| --- | --- | --- |
| TypeScript | `example.ts` | Set `"type": "module"`, install `typescript`, `tsx` and `@types/node` as dev dependencies; run `npx tsx example.ts` |
| JavaScript | `example.js` | Use `"type": "module"` in `package.json`; run `node example.js` |
| MJS | `example.mjs` | Explicit ES module filename; run `node example.mjs` |
| CommonJS | `example.cjs` | Uses `require` with asynchronous work inside a function; run `node example.cjs` |

JavaScript and MJS use the same ES module syntax. The extension/configuration tells Node how to load the file. CommonJS examples consume the same Dockline ESM packages on the supported Node runtimes; there is no separate CJS package to install.

The `.ts` programs use ESM and top-level `await`, so their run tabs include `npm pkg set type=module`. This matters in a fresh project created with `npm init -y`.

The TypeScript runner executes examples; it does not replace the type-checking/build workflow. Use Node-targeted module resolution and Node types in a TypeScript project. Exact API declarations remain TypeScript-only because they describe types rather than runnable alternatives.

Short operation recipes belong inside the connected callback shown in the complete example. They use the same calls in all four formats. File loading/saving is kept in [file recipes](/keys/files), rather than repeated around every key operation.

## Complete programs and recipes

A **complete program** shows a filename in every code tab, a matching run-command group, prerequisites and output. Downloadable versions contain the same code. Select a language once to update the code and run instructions together.

A **contextual recipe** replaces part of a complete program. Keep the connected callback or `try` block, the surrounding setup and cleanup, and rerun that same file. Import declarations belong at file scope, including CommonJS `require` declarations. Identifiers such as a vault, approval UI or fresh-stream factory are integration hooks that must be supplied; the page names them explicitly.

**Type declarations** describe contracts and have no JavaScript equivalent. **Terminal commands** run independently of the project's language; shell-specific commands have PowerShell and macOS/Linux tabs. Repository fixture commands invoke existing checked-in files and are labelled as development tools.

In path descriptions, **the host** is the machine running Node.js or Dockline CLI, and **the server** is the remote endpoint. `uploadFile` takes host source then server destination; `downloadFile` takes server source then host destination.
