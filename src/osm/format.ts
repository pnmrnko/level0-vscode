// Writer of Level0L text from objects, a port of data_to_l0l() from
// level0l.php. The output is what Level0 itself prints: tagged nodes, ways,
// relations and finally untagged nodes without blank lines between them.
// Pure module, no vscode API.

import { OsmObject } from './model';

const MEMBER_WORD = { node: 'nd', way: 'wy', relation: 'rel' };

// Sort order of Level0: the changeset block first, then tagged nodes, ways,
// relations, untagged nodes; by id within each group.
function grade(o: OsmObject): number {
  switch (o.type) {
    case 'changeset':
      return -1;
    case 'node':
      return o.tags.size ? 0 : 4;
    case 'way':
      return 1;
    default:
      return 2;
  }
}

export function compareObjects(a: OsmObject, b: OsmObject): number {
  return grade(a) - grade(b) || a.id - b.id;
}

export function formatObject(o: OsmObject): string {
  let s = '';
  if (o.conflict) {
    s +=
      "# Conflict! Your edits to the old version are saved in this comment.\n# Please make appropriate changes and remove '!' character from the entity header.\n" +
      formatObject(o.conflict).replace(/^(?=.)/gm, '# ') +
      '!';
  }
  if (o.action === 'delete') {
    s += '-';
  }
  s += o.type;
  if (o.id !== 0) {
    s += ` ${o.id}`;
    if (o.version !== undefined) {
      s += `.${o.version}`;
    }
  }
  if (o.type === 'node' && o.lat !== undefined && o.lon !== undefined) {
    s += `: ${o.lat}, ${o.lon}`;
  }
  s += '\n';
  for (const [k, v] of o.tags) {
    s += `  ${k.replace(/=/g, '\\=')} = ${v}\n`;
  }
  for (const nd of o.nodes ?? []) {
    s += `  nd ${nd}\n`;
  }
  for (const m of o.members ?? []) {
    s += `  ${MEMBER_WORD[m.type]} ${m.id}${m.role ? ` ${m.role}` : ''}\n`;
  }
  return s;
}

export function formatObjects(objects: OsmObject[]): string {
  const sorted = [...objects].sort(compareObjects);
  let s = '';
  let needNewline = false;
  for (const o of sorted) {
    if (needNewline || o.type !== 'node') {
      s += '\n';
    }
    needNewline = o.type !== 'node' || o.tags.size > 0 || o.conflict !== undefined;
    s += formatObject(o);
  }
  return s;
}
