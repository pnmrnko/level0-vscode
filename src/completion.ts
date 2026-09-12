// What can be completed at a cursor position. Pure module, no vscode API.
//
//   node -1: 50.45, 30.52      column 0: entity header snippets
//     amen|                    tag key (taginfo keys, keys used in the file)
//     amenity = ca|            tag value (taginfo values of the key)
//     nd 12|                   member id (objects of that type in the file)
//     wy 123 out|              member role (taginfo roles of the relation type)

import { EntityType, HEADER_RE, enclosingEntity } from './lines';

export type MemberType = 'node' | 'way' | 'relation';

export type Context =
  | { kind: 'header'; partial: string; start: number }
  | { kind: 'key'; partial: string; start: number; entity: EntityType }
  | { kind: 'value'; key: string; partial: string; start: number; entity: EntityType }
  | { kind: 'member-id'; memberType: MemberType; partial: string; start: number; entity: EntityType }
  | { kind: 'role'; memberType: MemberType; partial: string; start: number; relationType?: string };

const MEMBER_TYPES: Record<string, MemberType> = { nd: 'node', wy: 'way', rel: 'relation' };

// Value of the "type" tag of the entity that contains `line`.
function relationType(lines: string[], line: number): string | undefined {
  for (let i = line; i >= 0; i--) {
    if (HEADER_RE.test(lines[i])) {
      return undefined;
    }
    const m = /^\s*type\s*=\s*(.+?)\s*$/.exec(lines[i]);
    if (m) {
      return m[1];
    }
  }
  return undefined;
}

export function completionContext(lines: string[], line: number, character: number): Context | undefined {
  const before = lines[line].slice(0, character);
  if (before.startsWith('#')) {
    return undefined;
  }

  const entity = enclosingEntity(lines, line);

  let m = /^\s*(nd|wy|rel)\s+(-?\d+)\s+(.*)$/.exec(before);
  if (m && entity === 'relation') {
    return {
      kind: 'role',
      memberType: MEMBER_TYPES[m[1]],
      partial: m[3],
      start: before.length - m[3].length,
      relationType: relationType(lines, line),
    };
  }

  m = /^\s*(nd|wy|rel)\s+(-?\d*)$/.exec(before);
  if (m && (entity === 'way' || entity === 'relation')) {
    return { kind: 'member-id', memberType: MEMBER_TYPES[m[1]], partial: m[2], start: before.length - m[2].length, entity };
  }

  m = /^\s*((?:[^=\\]|\\.)*?)\s*=\s*(.*)$/.exec(before);
  if (m && entity && !HEADER_RE.test(lines[line])) {
    // Complete the part after the last ";" so lists of values work too.
    const all = m[2];
    const semi = all.lastIndexOf(';');
    const partial = semi >= 0 ? all.slice(semi + 1).replace(/^\s+/, '') : all;
    return { kind: 'value', key: m[1].replace(/\\=/g, '='), partial, start: before.length - partial.length, entity };
  }

  m = /^([!-]*)(\w*)$/.exec(before);
  if (m && before.length === m[2].length + m[1].length && lines[line].slice(character).trim() === '') {
    // Column 0, no indentation: a header keyword. Not when the line already
    // goes on after the cursor, as when "-" or "!" is put before a header.
    return { kind: 'header', partial: m[2], start: m[1].length };
  }

  m = /^\s+([^\s=]*)$/.exec(before);
  if (m && entity) {
    return { kind: 'key', partial: m[1], start: before.length - m[1].length, entity };
  }
  return undefined;
}
