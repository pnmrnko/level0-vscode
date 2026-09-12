// Pure link extraction for Level0L text. No dependency on the vscode API so
// it can be unit-tested and reused (e.g. in a language server) later.

export interface LinkOptions {
  osmBaseUrl: string;
  wikiBaseUrl: string;
  tagLinks: boolean;
}

export interface TextLink {
  line: number;
  start: number;
  end: number;
  url: string;
  tooltip: string;
}

const HEADER_RE =
  /^(!)?(-)?(node|way|relation|changeset)(?:\s+(-?[0-9]+)(?:\.([0-9]+))?)?(?:\s*:\s*(-?[0-9]{1,2}(?:\.[0-9]+)?)\s*,\s*(-?[0-9]{1,3}(?:\.[0-9]+)?))?\s*(?:#.*)?$/;
const MEMBER_RE = /^\s*(nd|wy|rel)\s+(-?[0-9]+)(?:\s+(.+?))?\s*$/;
const TAG_RE = /^\s*((?:[^=\\]|\\.)*?)\s*=\s*(.*?)\s*$/;

const MEMBER_TYPES: Record<string, string> = { nd: 'node', wy: 'way', rel: 'relation' };

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

// Wiki page titles keep ':' readable; everything else that is unsafe in a URL
// path gets percent-encoded.
function wikiTitle(s: string): string {
  return encodeURIComponent(s).replace(/%3A/gi, ':');
}

function indexOfGroup(line: string, group: string, from: number): number {
  return line.indexOf(group, from);
}

export function extractLinks(text: string, opts: LinkOptions): TextLink[] {
  const osm = trimSlash(opts.osmBaseUrl);
  const wiki = trimSlash(opts.wikiBaseUrl);
  const links: TextLink[] = [];
  const lines = text.split(/\r?\n/);

  let insideChangeset = false;

  lines.forEach((line, lineNo) => {
    if (!line.trim() || line.trimStart().startsWith('#')) {
      return;
    }

    let m = HEADER_RE.exec(line);
    if (m) {
      const [, , , type, id, , lat, lon] = m;
      insideChangeset = type === 'changeset';

      if (id && !id.startsWith('-') && id !== '0') {
        const start = indexOfGroup(line, id, type.length);
        links.push({
          line: lineNo,
          start,
          end: start + id.length,
          url: `${osm}/${type}/${id}`,
          tooltip: `Open ${type} ${id} on OSM`,
        });
      }

      if (lat && lon) {
        const start = indexOfGroup(line, lat, line.indexOf(':'));
        const end = indexOfGroup(line, lon, start + lat.length) + lon.length;
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
      const start = indexOfGroup(line, id, line.indexOf(kind) + kind.length);
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

    m = TAG_RE.exec(line);
    if (m) {
      const [, rawKey, value] = m;
      if (!rawKey) {
        return;
      }
      const key = rawKey.replace(/\\=/g, '=');
      const keyStart = line.indexOf(rawKey);
      links.push({
        line: lineNo,
        start: keyStart,
        end: keyStart + rawKey.length,
        url: `${wiki}/Key:${wikiTitle(key)}`,
        tooltip: `Key:${key} on the OSM wiki`,
      });

      // Only link values that look like a plain enumerated value (lowercase
      // identifier), not free text such as names, addresses or numbers.
      if (value && /^[a-z][a-z0-9_]*$/.test(value)) {
        const valueStart = line.indexOf(value, keyStart + rawKey.length + 1);
        links.push({
          line: lineNo,
          start: valueStart,
          end: valueStart + value.length,
          url: `${wiki}/Tag:${wikiTitle(key)}=${wikiTitle(value)}`,
          tooltip: `Tag:${key}=${value} on the OSM wiki`,
        });
      }
    }
  });

  return links;
}
