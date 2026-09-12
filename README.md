# Level0L for Visual Studio Code

Editing OpenStreetMap as text in VS Code: language support for [Level0L](https://wiki.openstreetmap.org/wiki/Level0L), the format of the [Level0](https://wiki.openstreetmap.org/wiki/Level0) editor, plus the editor's own workflow, download from the OSM API or Overpass, check against the server, upload as a changeset, without leaving VS Code.

## Features

### Editing

- Syntax highlighting for entity headers (`node`, `way`, `relation`, `changeset`), IDs and versions, coordinates, tags, way nodes and relation members, comments. Negative (new) IDs, the delete prefix `-` and the conflict marker `!` get their own scopes so themes can make them stand out. The tags and members of objects marked for deletion with `-` are drawn at reduced opacity, since Level0 ignores them; the header stays as it is. A conflict written by Level0 is shown like a git merge conflict: the comment block holding your edits gets the theme's "current" background, the `!` entity with the server version the "incoming" background. Lines the Level0 parser would reject are marked as invalid.
- Clickable links (Ctrl/Cmd+click):
  - object IDs in entity headers and in `nd` / `wy` / `rel` members open the object on openstreetmap.org; the version number after the dot opens that exact version (`way 123.4` links `4` to `/way/123/history/4`), useful when the server has moved on since the download;
  - node coordinates open the map at that location;
  - values that point somewhere open the target: Wikidata items (`wikidata`, `brand:wikidata`, `name:etymology:wikidata`, any `*:wikidata`), Wikipedia articles (`wikipedia = lang:Title`, `*:wikipedia`, the old `wikipedia:lang` form), Commons files and categories (`wikimedia_commons`, `image = File:*`), websites (`website`, `url`, `image`, `contact:website`, `source:url`, bare domains included), phone numbers as `tel:` links (`phone`, `mobile`, `fax`, `contact:phone`, `phone:*`), e-mail as `mailto:`, Mapillary and Panoramax picture ids, and social accounts under `contact:*` (Facebook, Instagram, Twitter/X, YouTube, TikTok, Telegram, WhatsApp, Viber, LinkedIn, VK, Mastodon, Matrix, Bluesky and others) given either as a URL or a bare user name. Values separated by `;` get one link each;
  - tag keys and simple enumerated values open their wiki page. The target is resolved on click through taginfo: the page in your language when it exists, the English page otherwise, and the taginfo key or tag page when there is no wiki page at all, so a click never lands on a missing page. Without taginfo (setting off, offline) the link goes to the English wiki page.
- Hovers backed by [taginfo](https://taginfo.openstreetmap.org/): hover a tag key or value to see its wiki description in your language, approval status (obsolete and deprecated tags are flagged), usage counts by object type, top values for a key, what object types the tag applies to and commonly combined tags. Keys and tags taginfo has never seen are flagged as possible typos. Responses are cached for a day; tags inside the `changeset` block are ignored.
- Navigation between objects of one file. Go to Definition (F12, Cmd/Ctrl+click) on `nd 123`, `wy 456` or `rel 789` jumps to the header of that node, way or relation when it is in the document; Peek Definition (Alt+F12) shows it inline. Find All References (Shift+F12) on an id, in a header or a member line, lists every way and relation that uses it. Members whose object is in the document have no web link, so Cmd/Ctrl+click goes to the local definition; members of objects not in the document open osm.org.
- Completion. At the start of a line: snippets for `node`, `way`, `relation` and `changeset`. On an indented line: tag keys, first those already used in the file, then the most used keys from taginfo matching what you typed; picking one inserts `key = ` and opens the value list. After `=`: the key's most used values from taginfo with their share, count and wiki description in your language, narrowed to values containing what you typed once there are two characters; free-text keys such as `name` and identifier keys such as `wikidata` get no list. After `nd`, `wy` or `rel`: ids of the matching objects in the file with their summary. After a member id in a relation: roles used with that relation's `type`, most used first, limited to the member's object type. In the `changeset` block: the standard changeset keys with a short explanation.
- Outline and folding. The outline view, breadcrumbs, sticky scroll and Go to Symbol (Cmd/Ctrl+Shift+O) list every object with a one-line summary (`amenity=cafe · Kyiv Coffee`, `type=multipolygon · landuse=grass`), its tags and members as children, deleted objects struck through. Each object folds as a block, as does every run of comment lines.
- Diagnostics. The validation rules of the Level0 parser are ported one to one: conflicts, deleting unsaved objects, nodes without coordinates, ways with fewer than two nodes, relations without members, members on the wrong entity type, duplicated tags, unparsable lines. Errors are the ones Level0 refuses to upload; warnings are reported but uploaded. Taginfo adds warnings for keys unused in OSM, values unused with their key, and keys or tags the wiki marks deprecated or obsolete. Values are checked only when they look like an enumerated value and the key is enumerated (a few thousand distinct values at most, like `amenity`, not millions like `name`). Checks run 700 ms after the last edit; one request per distinct key and per distinct unusual tag, cached for a day, at most four in flight.
- JOSM interoperability. Text copied with the JOSM comfort0 plugin carries a `#comment` after every header and member line. Members with such comments are read correctly, and the command "Level0L: Strip member comments (JOSM comfort0)" removes them, which is needed before pasting into Level0 itself: its parser takes a comment after a relation member as part of the role, so those lines are marked with an information diagnostic.
Files are recognized by the `.l0l` and `.level0` extensions, or by a first line that starts with an entity header. Line comments start with `#` in the first column.

### Working with OSM

- Download from OSM. The command "Level0L: Download from OSM" takes what the input field of Level0 takes: an osm.org object, changeset or map URL (`#map=17/50.45/30.52` downloads a small box around that point), an API 0.6 URL, an Overpass `interpreter?data=` URL, a pair of coordinates, or a list of objects such as `n123, w45, r7`, where `w45!` adds the way with its nodes (osm.org way URLs do that too), `n12*` the ways and relations using the node, `node 123.4` that exact version and `c99` the contents of a changeset. Any other http(s) URL is read as OSM XML or osmChange; new objects in it with negative ids the document already uses are renumbered, references included. Objects are appended to the Level0L document that is active or visible, skipping those already in it, or opened in a new one. Objects deleted on the server are left out.
- Overpass queries. "Level0L: Run Overpass query" sends the selected text, or the whole file when it is an `.overpassql` file, or a query typed into the input box (the download command accepts a query too) to the Overpass API and adds the result the same way. `{{bbox}}` is replaced with the extent of the nodes in the Level0L document that is active or visible next to the query, in the `south,west,north,east` order of overpass turbo, or asked for when there is no such document; other turbo shortcuts such as `{{geocodeArea:...}}` are not available outside turbo and are reported. Use `out meta` to get object versions, otherwise the objects cannot be uploaded later. Only XML output is read, so leave out `[out:json]`. Files with the `.overpassql` extension are recognized as "Overpass QL"; for syntax highlighting install the [Overpass QL syntax](https://marketplace.visualstudio.com/items?itemName=tqdv.overpassql-syntax) extension.
- Check for conflicts and preview the upload. "Level0L: Check for conflicts with the server" fetches the current state of every object with a positive id and compares it with the document: objects with an unchanged version and identical tags, coordinates and members count as untouched, differing ones as modified, the `-` prefix as a deletion, negative or missing ids as creations. An object whose version moved on the server is compared with the version it was downloaded from, read from the history: if the document had not touched it, the block is simply replaced by the current server version; if it had, it is a conflict and is written into the document the way Level0 writes it, your version in a comment block above the `!` header of the server version; objects deleted on the server, objects without a version and objects unknown to the server are reported. Nothing is stored between runs, the document is the only state, so a file can be checked or uploaded from any machine. "Level0L: Show osmChange" runs the same comparison and opens the osmChange an upload would send, as an unsaved XML document that can be saved as `.osc` and loaded into JOSM; it refuses when the document has errors Level0 would refuse too.
- Upload. "Level0L: Upload changeset" logs you in when needed, compares the document with the server as above, shows what will be created, modified and deleted together with the changeset comment (taken from the `comment` tag of the `changeset` block, or asked for) and, once confirmed, creates the changeset, uploads the osmChange and closes it. The server's answer is written back into the document: new objects get their real ids, changed objects their new versions, member lines follow, deleted objects disappear. Comments and everything else stay as written, so the file keeps matching the server and can be edited further. A conflict the server reports at upload time (409) is shown with a hint to run the conflict check.
- Login. "Level0L: Log in to OSM" opens the OSM authorization page in the browser; after approval the browser returns to VS Code and the token is kept in the editor's secret storage (the system keychain), one per server, until "Level0L: Log out of OSM". No password ever goes through the extension. The return link is `vscode://pnmrnko.level0l/oauth`, which is what is registered with OSM, so the login works in VS Code proper; other editors built on VS Code use their own URL scheme and would need their own registration, settable with `level0l.oauth.clientId`. In this version the built-in application exists for the development server only; to upload to openstreetmap.org, register a public OAuth 2 application there (redirect URI as above, permissions "read user preferences" and "modify the map") and put its client id into `level0l.oauth.clientId`.
- Revert. "Level0L: Revert object to the server version" replaces the object under the cursor, or every object the selection touches, with its current server version; a conflict block above it goes too. New objects have nothing to revert to and are reported, as are objects deleted on the server.
- Export. "Level0L: Export as OSM XML" saves the document as a `.osm` file for JOSM and other editors, with `action` attributes on the objects an upload would create, modify or delete, after the same comparison with the server as the conflict check.
- Map. "Level0L: Show map" (also the map icon in the editor title) opens a Leaflet map beside the editor with the objects of the document: nodes as dots (filled when tagged, green when new, red when marked for deletion), ways as lines through the nodes the document has (dashed when some are missing), relations as their member ways and nodes. The map follows the cursor and highlights the object under it; clicking an object on the map jumps to its line. "Select area" takes a rectangle by dragging; "Download area" fetches it, or the visible map when nothing is selected, through the API `map` call (at most 0.25 square degrees); the same rectangle is what `{{bbox}}` in Overpass queries expands to while it exists. "Pick point" puts the clicked coordinates into the node header under the cursor, or adds a new node after the cursor line. The map keeps its position between openings.
- Account in the status bar. While a Level0L document is active the status bar shows who is logged in, with "(dev)" when the development server is configured, or "Log in to OSM"; clicking it logs in, or offers to log out.

## Trying it safely

OSM runs a development server with its own database and accounts where uploads do no harm. Set `level0l.osmApiUrl` to `https://api06.dev.openstreetmap.org/api/0.6/`, register an account at https://master.apis.dev.openstreetmap.org/user/new (the osm.org account does not work there), log in from the editor and upload a test node. The status bar shows "(dev)" while that setting is active. Logins are kept per server, so switching the setting back does not log you out of either.

Limits: a download stops at `level0l.maxObjects` (500 by default, the limit Level0 has for its own reasons; the editor copes with more, but every object costs a request when checking or uploading), and an upload refuses more than the 10 000 changes the API accepts in one changeset.

## Installation

From the VS Code Marketplace or Open VSX, search for "Level0L". To install a downloaded `.vsix` instead: Extensions view, the "..." menu, "Install from VSIX...", or `code --install-extension level0l-<version>.vsix`.

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
| `level0l.osmApiUrl` | `https://api.openstreetmap.org/api/0.6/` | OSM API used for downloads and uploads. Set to `https://api06.dev.openstreetmap.org/api/0.6/` for the development server. |
| `level0l.oauth.clientId` | `""` | Client id of an OAuth 2 application registered on the OSM site in use; empty uses the built-in ids for openstreetmap.org and the development server. |
| `level0l.overpassUrl` | `https://overpass-api.de/api/interpreter` | Overpass API endpoint, see below. |
| `level0l.map.tileUrl` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Tiles of the map panel. See below for alternatives. |
| `level0l.map.attribution` | OpenStreetMap contributors | Attribution shown on the map, HTML allowed. |
| `level0l.map.maxZoom` | `19` | Highest zoom the tile server offers. |
| `level0l.maxObjects` | `500` | Most objects a single download adds, the same limit Level0 has. |

Public Overpass instances with global coverage, from the [OSM wiki](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances):

| Endpoint | Usage policy |
| --- | --- |
| `https://overpass-api.de/api/interpreter` | The main instance, run by FOSSGIS and the default here. Applications get about 100 queries and 10 MB a day in total across all their users, one query at a time, with an identifying User-Agent; after a 429 or 406 wait 30 seconds. It is often overloaded. |
| `https://overpass.private.coffee/api/interpreter` | No rate limit; large projects should notify support@private.coffee. Formerly overpass.kumi.systems. |
| `https://maps.mail.ru/osm/tools/overpass/api/interpreter` | No request limitations, run by VK Maps. |

Tile servers for the map panel. The default is the standard OSM map, whose [usage policy](https://operations.osmfoundation.org/policies/tiles/) allows light use by applications like this; the browser inside VS Code identifies itself. Alternatives, each with its own attribution to put into `level0l.map.attribution`:

| Tile URL | Notes |
| --- | --- |
| `https://tile.openstreetmap.org.ua/styles/osm-bright/{z}/{x}/{y}.png` | Ukrainian OSM community, OSM Bright style, borders of Ukraine as by its law; `positron-gl-style` and `dark-matter-gl-style` in place of `osm-bright` give a light and a dark style. Rendered from a periodically updated extract, so recent edits take days to appear. |
| `https://tile.openstreetmap.de/{z}/{x}/{y}.png` | German style, FOSSGIS. |
| `https://tile.openstreetmap.fr/hot/{z}/{x}/{y}.png` | Humanitarian style. |

Taginfo, OSM API and Overpass requests go out with a `level0-vscode/<version>` User-Agent, as the [taginfo](https://wiki.openstreetmap.org/wiki/Taginfo/API) and Overpass usage policies ask. Every request and failure is logged to the "Level0L" output channel; failures of hovers and diagnostics never block the editor.

## Development

```bash
npm install
npm test
```

`npm test` compiles and runs the unit tests with Node's built-in test runner: the parser, links, completion and outline modules, and the OSM modules in `src/osm/` (XML reading and writing, Level0L formatting, input parsing, the change plan, the diffResult application, OAuth helpers). They need no VS Code and no network; the server is faked where one is needed. Then press F5 in VS Code to launch an Extension Development Host with the `samples/` folder opened.

To build a `.vsix`: `npx @vscode/vsce package`. Releases are published with `npx @vscode/vsce publish` (Marketplace) and `npx ovsx publish` (Open VSX).

## License

MIT
