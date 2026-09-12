# Contributing

- The repository language is English: code, comments, commit messages, documentation.
- No emoji anywhere: source, user-facing strings, docs, commit messages.
- Markdown paragraphs are single lines; do not hard-wrap prose.
- Keep the parser modules (`lines.ts`, `links.ts`, `hover.ts`, `taginfo.ts`) free of the `vscode` API so they can be tested with plain Node and reused outside VS Code.
