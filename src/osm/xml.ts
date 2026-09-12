// Reader for OSM XML and osmChange, a port of parse_osm_xml() from
// osmapi.php. The formats consist of elements and attributes only, so a
// small scanner is enough and no XML library is needed. Unknown elements
// (bounds, note, meta, center, area) are skipped. Pure module, no vscode API.

import { Action, MemberType, ObjectType, OsmMember, OsmObject, key } from './model';

export interface ReadResult {
  objects: OsmObject[];
  // True when reading stopped at the object limit.
  truncated: boolean;
}

const TOKEN_RE = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/)?([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>/g;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY_RE = /&(lt|gt|amp|quot|apos|#x[0-9a-fA-F]+|#[0-9]+);/g;
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function unescapeXml(s: string): string {
  return s.replace(ENTITY_RE, (_, e: string) =>
    e in NAMED ? NAMED[e] : String.fromCodePoint(parseInt(e.slice(e[1] === 'x' ? 2 : 1), e[1] === 'x' ? 16 : 10))
  );
}

function attributes(s: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of s.matchAll(ATTR_RE)) {
    out.set(m[1], unescapeXml(m[2] ?? m[3] ?? ''));
  }
  return out;
}

// Tag keys and values are trimmed and cleaned of control characters the API
// would reject, as Level0 does.
export function hardTrim(s: string): string {
  return s.replace(/[\0\r]/g, '').replace(/[\n\t]/g, ' ').trim();
}

const INT_RE = /^-?[0-9]+$/;
const UINT_RE = /^[0-9]+$/;
const OBJECT_TYPES = new Set(['node', 'way', 'relation', 'changeset']);
const MODES = new Set(['create', 'modify', 'delete']);

export function readOsmXml(text: string, maxObjects = Infinity): ReadResult {
  const objects: OsmObject[] = [];
  const index = new Map<string, number>();
  let mode: Action | undefined;
  let cur: OsmObject | undefined;
  let truncated = false;

  const finish = () => {
    if (!cur) {
      return;
    }
    // History and osmChange output can carry several versions of one object;
    // only the newest is kept.
    const k = key(cur);
    const at = index.get(k);
    if (at === undefined) {
      index.set(k, objects.length);
      objects.push(cur);
    } else if ((cur.version ?? 0) >= (objects[at].version ?? 0)) {
      objects[at] = cur;
    }
    cur = undefined;
    if (objects.length >= maxObjects) {
      truncated = true;
    }
  };

  for (const m of text.matchAll(TOKEN_RE)) {
    const [, closing, name, attrText, selfClosing] = m;
    if (!name) {
      continue;
    }
    if (closing) {
      if (name === mode) {
        mode = undefined;
      } else if (cur && name === cur.type) {
        finish();
      }
    } else if (MODES.has(name)) {
      mode = name as Action;
    } else if (OBJECT_TYPES.has(name)) {
      const a = attributes(attrText);
      const id = a.get('id') ?? '0';
      if (!INT_RE.test(id)) {
        continue;
      }
      cur = { type: name as ObjectType, id: Number(id), tags: new Map() };
      const action = mode ?? a.get('action');
      if (action && MODES.has(action)) {
        cur.action = action as Action;
      }
      const version = a.get('version');
      if (version && UINT_RE.test(version)) {
        cur.version = Number(version);
      }
      const user = a.get('user');
      if (user) {
        cur.user = user;
      }
      const uid = a.get('uid');
      if (uid && UINT_RE.test(uid)) {
        cur.uid = Number(uid);
      }
      const changeset = a.get('changeset');
      if (changeset && UINT_RE.test(changeset)) {
        cur.changeset = Number(changeset);
      }
      const timestamp = a.get('timestamp');
      if (timestamp && timestamp.length > 10) {
        cur.timestamp = timestamp;
      }
      if (a.get('visible') === 'false') {
        cur.deleted = true;
      }
      if (name === 'node') {
        const lat = a.get('lat');
        const lon = a.get('lon');
        if (lat && lon && !isNaN(Number(lat)) && !isNaN(Number(lon))) {
          cur.lat = lat;
          cur.lon = lon;
        }
      } else if (name === 'way') {
        cur.nodes = [];
      } else if (name === 'relation') {
        cur.members = [];
      }
      if (selfClosing) {
        finish();
      }
    } else if (cur && name === 'tag') {
      const a = attributes(attrText);
      const k = hardTrim(a.get('k') ?? '');
      const v = hardTrim(a.get('v') ?? '');
      if (k && v) {
        cur.tags.set(k, v);
      }
    } else if (cur && name === 'nd' && cur.nodes) {
      const ref = attributes(attrText).get('ref');
      if (ref && INT_RE.test(ref)) {
        cur.nodes.push(Number(ref));
      }
    } else if (cur && name === 'member' && cur.members) {
      const a = attributes(attrText);
      const type = a.get('type');
      const ref = a.get('ref');
      if (type && ref && (type === 'node' || type === 'way' || type === 'relation') && INT_RE.test(ref)) {
        const member: OsmMember = { type: type as MemberType, id: Number(ref), role: a.get('role') ?? '' };
        cur.members.push(member);
      }
    }
    if (truncated) {
      break;
    }
  }
  finish();
  return { objects, truncated };
}
