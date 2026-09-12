# Changelog

## 0.1.0

First release.

- Syntax highlighting for Level0L, mirroring the reference parser of Level0; conflict markers, deletions and new (negative) ids have their own scopes; versions are dimmed; a Level0 conflict is shown with merge conflict backgrounds.
- Links: object ids and versions to openstreetmap.org, coordinates to the map, tag keys and values to the wiki (resolved on click through taginfo to the page in your language or to taginfo when no page exists), and values such as Wikidata items, Wikipedia articles, Commons files, websites, phone numbers, e-mail addresses, Mapillary and Panoramax pictures and contact:* accounts to their targets.
- Hovers with taginfo statistics and wiki descriptions for keys and tags.
- Diagnostics: every validation rule of the Level0 parser, and taginfo based warnings for unused and deprecated keys and values.
- Completion for headers, keys, values, member ids and relation roles.
- Go to definition and find references between objects of one file.
- Outline, breadcrumbs, folding.
