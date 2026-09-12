# Changelog

## Unreleased

- New command "Level0L: Download from OSM": objects, changesets, map areas and Overpass results are fetched from the API and appended to the document as Level0L text, with the same input forms Level0 accepts. Settings `level0l.osmApiUrl` and `level0l.maxObjects`.
- New command "Level0L: Run Overpass query": runs the selection, an `.overpassql` file or a typed query and adds the result to the document; `{{bbox}}` is the extent of the document. Files `.overpassql` are recognized as Overpass QL. Setting `level0l.overpassUrl`.
- New commands "Level0L: Check for conflicts with the server" and "Level0L: Show osmChange": the document is compared with the current server state, conflicts are written into it as Level0 does, and the osmChange an upload would send can be previewed and saved as `.osc`.
- Overpass: a busy server and 429/406 answers get plain messages, queries run one at a time.
- The tags and members of objects marked for deletion are dimmed instead of object versions.

## 0.1.1

- Text copied from JOSM with the comfort0 plugin is read correctly: the `#comment` after a member line is no longer taken as a role. Relation members with such a comment get an information marker, since Level0 itself would read the comment as part of the role.
- New command "Level0L: Strip member comments (JOSM comfort0)" removes those comments before pasting into Level0.

## 0.1.0

First release.

- Syntax highlighting for Level0L, mirroring the reference parser of Level0; conflict markers, deletions and new (negative) ids have their own scopes; versions are dimmed; a Level0 conflict is shown with merge conflict backgrounds.
- Links: object ids and versions to openstreetmap.org, coordinates to the map, tag keys and values to the wiki (resolved on click through taginfo to the page in your language or to taginfo when no page exists), and values such as Wikidata items, Wikipedia articles, Commons files, websites, phone numbers, e-mail addresses, Mapillary and Panoramax pictures and contact:* accounts to their targets.
- Hovers with taginfo statistics and wiki descriptions for keys and tags.
- Diagnostics: every validation rule of the Level0 parser, and taginfo based warnings for unused and deprecated keys and values.
- Completion for headers, keys, values, member ids and relation roles.
- Go to definition and find references between objects of one file.
- Outline, breadcrumbs, folding.
