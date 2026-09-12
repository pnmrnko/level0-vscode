# Contributing

- The repository language is English: code, comments, commit messages, documentation.
- No emoji anywhere: source, user-facing strings, docs, commit messages.
- Markdown paragraphs are single lines; do not hard-wrap prose.
- Keep the parser modules (`lines.ts`, `links.ts`, `hover.ts`, `taginfo.ts`) free of the `vscode` API so they can be tested with plain Node and reused outside VS Code.
- Modules that do not import `vscode` have unit tests in `src/test/`, run with `npm test`. Add a case there when changing parsing or link rules; the sample in `samples/` is for trying the extension by hand and is not a test fixture, so do not commit experiments made in it.
