// Applies the diffResult of a successful upload to the document text: new
// objects get their real ids, changed ones their new versions, deleted ones
// disappear, member references follow. Everything else, comments included,
// stays as written. Pure module, no vscode API.

import { HEADER_RE, MEMBER_RE, isBlankOrComment } from '../lines';
import { MemberType } from './model';
import { unescapeXml } from './xml';

export interface Renumbered {
  newId: number;
  newVersion: number;
}

// old key "node-1" -> new id and version; deleted objects map to undefined.
export type DiffResult = Map<string, Renumbered | undefined>;

const ROW_RE = /<(node|way|relation)\s+([^>]*?)\/?>/g;
const ATTR_RE = /([\w:]+)="([^"]*)"/g;

export function parseDiffResult(xml: string): DiffResult {
  const out: DiffResult = new Map();
  for (const m of xml.matchAll(ROW_RE)) {
    const attrs = new Map([...m[2].matchAll(ATTR_RE)].map((a) => [a[1], unescapeXml(a[2])]));
    const oldId = attrs.get('old_id');
    if (oldId === undefined) {
      continue;
    }
    const newId = attrs.get('new_id');
    const newVersion = attrs.get('new_version');
    out.set(`${m[1]}${oldId}`, newId !== undefined && newVersion !== undefined ? { newId: Number(newId), newVersion: Number(newVersion) } : undefined);
  }
  return out;
}

const MEMBER_TYPES: Record<string, MemberType> = { nd: 'node', wy: 'way', rel: 'relation' };

// Objects without an id in the document were numbered by the plan; the
// caller passes that numbering by header line so they can be matched.
export function applyDiffResult(text: string, result: DiffResult, zeroIds: Map<number, number> = new Map()): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  lines.forEach((line, i) => {
    const h = HEADER_RE.exec(line);
    if (h) {
      skipping = false;
      const [, , , type, id] = h;
      const key = type === 'changeset' ? '' : `${type}${id ? Number(id) : zeroIds.get(i) ?? 0}`;
      if (!result.has(key)) {
        out.push(line);
        return;
      }
      const r = result.get(key);
      if (!r) {
        // Deleted on the server: the block goes, and so does the blank line
        // after it when one precedes it too.
        skipping = true;
        return;
      }
      const typeEnd = line.indexOf(type) + type.length;
      const rest = line.slice(typeEnd).replace(/^\s+-?[0-9]+(?:\.[0-9]+)?/, '');
      out.push(`${line.slice(0, typeEnd)} ${r.newId}.${r.newVersion}${rest}`);
      return;
    }
    if (skipping) {
      if (!isBlankOrComment(line)) {
        return;
      }
      skipping = false;
      if (line.trim() === '' && (out.length === 0 || out[out.length - 1].trim() === '')) {
        return;
      }
    }
    const m = MEMBER_RE.exec(line);
    if (m) {
      const r = result.get(`${MEMBER_TYPES[m[1]]}${m[2]}`);
      if (r) {
        const at = line.indexOf(m[2], line.indexOf(m[1]) + m[1].length);
        out.push(line.slice(0, at) + r.newId + line.slice(at + m[2].length));
        return;
      }
    }
    out.push(line);
  });
  return out.join('\n');
}
