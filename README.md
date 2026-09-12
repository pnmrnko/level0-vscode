# Level0L for Visual Studio Code

Editor support for [Level0L](https://wiki.openstreetmap.org/wiki/Level0L), the text format used by the [Level0](https://wiki.openstreetmap.org/wiki/Level0) OpenStreetMap editor.

## Features

- Syntax highlighting for entity headers (`node`, `way`, `relation`, `changeset`), IDs and versions, coordinates, tags, way nodes and relation members, comments. Negative (new) IDs, the delete prefix `-` and the conflict marker `!` get their own scopes so themes can make them stand out. Lines the Level0 parser would reject are marked as invalid.
- Clickable links (Ctrl/Cmd+click):
  - object IDs in entity headers and in `nd` / `wy` / `rel` members open the object on openstreetmap.org;
  - node coordinates open the map at that location;
  - values that point somewhere open the target: Wikidata items (`wikidata`, `brand:wikidata`, `name:etymology:wikidata`, any `*:wikidata`), Wikipedia articles (`wikipedia = lang:Title`, `*:wikipedia`, the old `wikipedia:lang` form), Commons files and categories (`wikimedia_commons`, `image = File:*`), websites (`website`, `url`, `image`, `contact:website`, `source:url`, bare domains included), phone numbers as `tel:` links (`phone`, `mobile`, `fax`, `contact:phone`, `phone:*`), e-mail as `mailto:`, Mapillary and Panoramax picture ids, and social accounts under `contact:*` (Facebook, Instagram, Twitter/X, YouTube, TikTok, Telegram, WhatsApp, Viber, LinkedIn, VK, Mastodon, Matrix, Bluesky and others) given either as a URL or a bare user name. Values separated by `;` get one link each;
  - tag keys and simple enumerated values open their wiki page. The target is resolved on click through taginfo: the page in your language when it exists, the English page otherwise, and the taginfo key or tag page when there is no wiki page at all, so a click never lands on a missing page. Without taginfo (setting off, offline) the link goes to the English wiki page.
- Hovers backed by [taginfo](https://taginfo.openstreetmap.org/): hover a tag key or value to see its wiki description in your language, approval status (obsolete and deprecated tags are flagged), usage counts by object type, top values for a key, what object types the tag applies to and commonly combined tags. Keys and tags taginfo has never seen are flagged as possible typos. Responses are cached for a day; tags inside the `changeset` block are ignored.
- Diagnostics. The validation rules of the Level0 parser are ported one to one: conflicts, deleting unsaved objects, nodes without coordinates, ways with fewer than two nodes, relations without members, members on the wrong entity type, duplicated tags, unparsable lines. Errors are the ones Level0 refuses to upload; warnings are reported but uploaded. Taginfo adds warnings for keys unused in OSM, values unused with their key, and keys or tags the wiki marks deprecated or obsolete. Values are checked only when they look like an enumerated value and the key is enumerated (a few thousand distinct values at most, like `amenity`, not millions like `name`). Checks run 700 ms after the last edit; one request per distinct key and per distinct unusual tag, cached for a day, at most four in flight.
- Line comments with `#`, indentation-based folding of entities.

Files are recognized by the `.l0l` and `.level0` extensions, or by a first line that starts with an entity header.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `level0l.osmBaseUrl` | `https://www.openstreetmap.org` | Website used for object and map links. Set to `https://www.openhistoricalmap.org` for OHM data. |
| `level0l.wikiBaseUrl` | `https://wiki.openstreetmap.org/wiki` | Wiki used for tag links. |
| `level0l.tagLinks` | `true` | Turn tag keys and values into wiki links. |
| `level0l.taginfo.enabled` | `true` | Show taginfo hovers. |
| `level0l.taginfo.url` | `https://taginfo.openstreetmap.org` | Taginfo instance to query. |
| `level0l.taginfo.lang` | `""` | Language for wiki descriptions; empty uses the VS Code display language. |
| `level0l.taginfo.diagnostics` | `true` | Underline unused and deprecated keys and values. |

Taginfo requests go out with a `level0-vscode/<version>` User-Agent as its [usage policy](https://wiki.openstreetmap.org/wiki/Taginfo/API) asks. Failures are logged to the "Level0L" output channel and never block the editor.

## Development

```bash
npm install
npm run compile
```

Then press F5 in VS Code to launch an Extension Development Host with the `samples/` folder opened.

To package a `.vsix`: `npx @vscode/vsce package`.

## License

MIT
