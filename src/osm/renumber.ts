// Negative ids of downloaded objects (an osmChange file with new objects)
// that the document already uses get fresh ones, references included, as
// renumber_created() in osmapi.php does. Pure module, no vscode API.

import { OsmObject, key } from './model';

export function renumber(objects: OsmObject[], taken: Set<number>): OsmObject[] {
  let next = Math.min(-1, ...taken, ...objects.map((o) => o.id)) - 1;
  const table = new Map<string, number>();
  for (const o of objects) {
    if (o.id < 0 && taken.has(o.id)) {
      table.set(key(o), next--);
    }
  }
  if (table.size === 0) {
    return objects;
  }
  return objects.map((o) => ({
    ...o,
    id: table.get(key(o)) ?? o.id,
    nodes: o.nodes?.map((n) => table.get(`node${n}`) ?? n),
    members: o.members?.map((m) => ({ ...m, id: table.get(`${m.type}${m.id}`) ?? m.id })),
  }));
}
