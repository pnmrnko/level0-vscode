// Pure link extraction for Level0L text. No dependency on the vscode API so
// it can be unit-tested and reused (e.g. in a language server) later.

import { HEADER_RE, MEMBER_RE, isBlankOrComment, parseTagLine } from './lines';
import { isIdentifierKey, valueLinks } from './valuelinks';

export interface LinkOptions {
  osmBaseUrl: string;
  wikiBaseUrl: string;
  tagLinks: boolean;
}

export interface TextLink {
  line: number;
  start: number;
  end: number;
  // Static target. For wiki links it is the fallback used when the target
  // cannot be resolved (offline, taginfo error).
  url: string;
  tooltip: string;
  // Present on tag key/value links: the caller may resolve the final target
  // lazily, e.g. to a localized wiki page or to taginfo when no page exists.
  wiki?: { key: string; value?: string };
}

const MEMBER_TYPES: Record<string, string> = { nd: 'node', wy: 'way', rel: 'relation' };

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// Wiki page titles keep ':' and '=' readable; everything else that is unsafe
// in a URL path gets percent-encoded. Spaces become underscores as on the wiki.
export function wikiTitle(s: string): string {
  return encodeURIComponent(s.replace(/ /g, '_')).replace(/%3A/gi, ':').replace(/%3D/gi, '=');
}

// Values that look like a plain enumerated value (lowercase identifier), as
// opposed to free text such as names, addresses or numbers.
export function isEnumValue(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(value);
}

export function extractLinks(text: string, opts: LinkOptions): TextLink[] {
  const osm = trimSlash(opts.osmBaseUrl);
  const wiki = trimSlash(opts.wikiBaseUrl);
  const links: TextLink[] = [];
  const lines = text.split(/\r?\n/);

  let insideChangeset = false;

  lines.forEach((line, lineNo) => {
    if (isBlankOrComment(line)) {
      return;
    }

    let m = HEADER_RE.exec(line);
    if (m) {
      const [, , , type, id, version, lat, lon] = m;
      insideChangeset = type === 'changeset';

      if (id && !id.startsWith('-') && id !== '0') {
        const start = line.indexOf(id, type.length);
        links.push({
          line: lineNo,
          start,
          end: start + id.length,
          url: `${osm}/${type}/${id}`,
          tooltip: `Open ${type} ${id} on OSM`,
        });
        // The version number opens that exact version, which may differ
        // from the current one on the server.
        if (version && type !== 'changeset') {
          const vStart = start + id.length + 1;
          links.push({
            line: lineNo,
            start: vStart,
            end: vStart + version.length,
            url: `${osm}/${type}/${id}/history/${version}`,
            tooltip: `Open version ${version} of ${type} ${id}`,
          });
        }
      }

      if (lat && lon) {
        const start = line.indexOf(lat, line.indexOf(':'));
        const end = line.indexOf(lon, start + lat.length) + lon.length;
        links.push({
          line: lineNo,
          start,
          end,
          url: `${osm}/#map=18/${lat}/${lon}`,
          tooltip: 'Show location on the map',
        });
      }
      return;
    }

    m = MEMBER_RE.exec(line);
    if (m) {
      const [, kind, id] = m;
      if (id.startsWith('-') || id === '0') {
        return;
      }
      const type = MEMBER_TYPES[kind];
      const start = line.indexOf(id, line.indexOf(kind) + kind.length);
      links.push({
        line: lineNo,
        start,
        end: start + id.length,
        url: `${osm}/${type}/${id}`,
        tooltip: `Open ${type} ${id} on OSM`,
      });
      return;
    }

    if (!opts.tagLinks || insideChangeset) {
      return;
    }

    const tag = parseTagLine(line);
    if (tag) {
      links.push({
        line: lineNo,
        start: tag.keyStart,
        end: tag.keyEnd,
        url: `${wiki}/Key:${wikiTitle(tag.key)}`,
        tooltip: `Key:${tag.key} on the OSM wiki`,
        wiki: { key: tag.key },
      });

      // Values that point somewhere (Wikidata, websites, phones...) link
      // there; plain enumerated values link to their wiki page.
      const targets = valueLinks(tag.key, tag.value);
      for (const t of targets) {
        links.push({
          line: lineNo,
          start: tag.valueStart + t.start,
          end: tag.valueStart + t.end,
          url: t.url,
          tooltip: t.tooltip,
        });
      }

      if (!isIdentifierKey(tag.key) && isEnumValue(tag.value)) {
        links.push({
          line: lineNo,
          start: tag.valueStart,
          end: tag.valueEnd,
          url: `${wiki}/Tag:${wikiTitle(tag.key)}=${wikiTitle(tag.value)}`,
          tooltip: `Tag:${tag.key}=${tag.value} on the OSM wiki`,
          wiki: { key: tag.key, value: tag.value },
        });
      }
    }
  });

  return links;
}
