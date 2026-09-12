# Level0L for Visual Studio Code

Editor support for [Level0L](https://wiki.openstreetmap.org/wiki/Level0L), the text format used by the [Level0](https://wiki.openstreetmap.org/wiki/Level0) OpenStreetMap editor.

## Features

- Syntax highlighting for entity headers (`node`, `way`, `relation`, `changeset`), IDs and versions, coordinates, tags, way nodes and relation members, comments. Negative (new) IDs, the delete prefix `-` and the conflict marker `!` get their own scopes so themes can make them stand out. Lines the Level0 parser would reject are marked as invalid.
- Clickable links (Ctrl/Cmd+click):
  - object IDs in entity headers and in `nd` / `wy` / `rel` members open the object on openstreetmap.org;
  - node coordinates open the map at that location;
  - tag keys open `Key:*` wiki pages, simple enumerated values open `Tag:*=*` pages.
- Line comments with `#`, indentation-based folding of entities.

Files are recognized by the `.l0l` and `.level0` extensions, or by a first line that starts with an entity header.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `level0l.osmBaseUrl` | `https://www.openstreetmap.org` | Website used for object and map links. Set to `https://www.openhistoricalmap.org` for OHM data. |
| `level0l.wikiBaseUrl` | `https://wiki.openstreetmap.org/wiki` | Wiki used for tag links. |
| `level0l.tagLinks` | `true` | Turn tag keys and values into wiki links. |

## Development

```bash
npm install
npm run compile
```

Then press F5 in VS Code to launch an Extension Development Host with the `samples/` folder opened.

To package a `.vsix`: `npx @vscode/vsce package`.

## License

MIT
