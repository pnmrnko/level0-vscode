// From parsed Level0L entities to objects. Pure module, no vscode API.

import { Entity } from '../parser';
import { OsmObject } from './model';

export function entityToObject(e: Entity): OsmObject {
  const o: OsmObject = {
    type: e.type,
    id: Number(e.id),
    tags: new Map(e.tags.map((t) => [t.key, t.value])),
  };
  if (e.version !== undefined) {
    o.version = Number(e.version);
  }
  if (e.deleted) {
    o.action = 'delete';
  }
  if (e.type === 'node') {
    o.lat = e.lat;
    o.lon = e.lon;
  } else if (e.type === 'way') {
    o.nodes = e.members.map((m) => Number(m.id));
  } else if (e.type === 'relation') {
    o.members = e.members.map((m) => ({ type: m.type, id: Number(m.id), role: m.role }));
  }
  return o;
}
