# Contributing

- The repository language is English: code, comments, commit messages, documentation.
- No emoji anywhere: source, user-facing strings, docs, commit messages.
- Markdown paragraphs are single lines; do not hard-wrap prose.
- Keep the language modules (`lines.ts`, `parser.ts`, `links.ts`, `hover.ts`, `taginfo.ts` and the others without `vscode` imports) and everything under `src/osm/` free of the `vscode` API so they can be tested with plain Node and reused outside VS Code. Only the command modules (`extension.ts`, `download.ts`, `changes.ts`, `upload.ts`, `auth.ts`, `revert.ts`) touch the editor.
- Test uploads against the development server (`level0l.osmApiUrl` = `https://api06.dev.openstreetmap.org/api/0.6/`), never against openstreetmap.org.
- Modules that do not import `vscode` have unit tests in `src/test/`, run with `npm test`. Add a case there when changing parsing or link rules; the sample in `samples/` is for trying the extension by hand and is not a test fixture, so do not commit experiments made in it.
- `media/leaflet/` is Leaflet 1.9.4 as published on npm, unchanged, with its license; update it by copying `dist/` of a new release rather than editing it.
