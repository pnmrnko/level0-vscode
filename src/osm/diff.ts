// Decides what an upload would do with each object of a document by
// comparing it with the current server state. Replaces the base data Level0
// keeps between requests: the document carries ids and versions, the server
// is asked for the rest at the moment of the action. Pure module, no vscode
// API.
//
// For an object with a positive id:
//   same version, same content        nothing
//   same version, different content   modify
//   server version newer              conflict, the server object is returned
//   deleted on the server             conflict as well
//   deleted in the document           delete
//   no version in the document        error, the server cannot be asked
//   unknown to the server             error
// Objects with id 0 or negative ids are created; ids of 0 get free negative
// numbers as in prepare_export().

import { Entity } from '../parser';
import { entityToObject } from './convert';
import { Action, OsmObject, key } from './model';

export interface Change {
  action: Action;
  object: OsmObject;
  entity: Entity;
}

export interface Conflict {
  entity: Entity;
  mine: OsmObject;
  // Absent when the object was deleted on the server.
  theirs?: OsmObject;
}

export interface Problem {
  entity: Entity;
  message: string;
}

export interface Plan {
  changeset?: OsmObject;
  changes: Change[];
  unchanged: Entity[];
  conflicts: Conflict[];
  problems: Problem[];
}

// Objects of the document that need the server state: positive ids only.
export function serverKeys(entities: Entity[]): { type: OsmObject['type']; id: number }[] {
  return entities.filter((e) => e.type !== 'changeset' && Number(e.id) > 0 && !e.conflict).map((e) => ({ type: e.type, id: Number(e.id) }));
}

function sameTags(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
}

export function isModified(mine: OsmObject, base: OsmObject): boolean {
  if (!sameTags(mine.tags, base.tags)) {
    return true;
  }
  if (mine.type === 'node') {
    return Number(mine.lat) !== Number(base.lat) || Number(mine.lon) !== Number(base.lon);
  }
  if (mine.type === 'way') {
    const a = mine.nodes ?? [];
    const b = base.nodes ?? [];
    return a.length !== b.length || a.some((n, i) => n !== b[i]);
  }
  const a = mine.members ?? [];
  const b = base.members ?? [];
  return a.length !== b.length || a.some((m, i) => m.type !== b[i].type || m.id !== b[i].id || m.role !== b[i].role);
}

// The lesser the grade, the higher in the osmChange: created nodes, ways,
// relations; then modified; then deleted in reverse order so that nothing is
// deleted while still referenced.
function grade(c: Change): number {
  const t = c.object.type === 'node' ? 0 : c.object.type === 'way' ? 1 : 2;
  return c.action === 'create' ? t : c.action === 'modify' ? 10 + t : 20 + (2 - t);
}

export function compareChanges(a: Change, b: Change): number {
  return grade(a) - grade(b) || a.object.id - b.object.id;
}

export function plan(entities: Entity[], server: Map<string, OsmObject | undefined>): Plan {
  const out: Plan = { changes: [], unchanged: [], conflicts: [], problems: [] };
  const used = new Set<number>();
  for (const e of entities) {
    if (e.type !== 'changeset' && Number(e.id) < 0) {
      if (used.has(Number(e.id))) {
        out.problems.push({ entity: e, message: `Duplicate id ${e.type} ${e.id}` });
      }
      used.add(Number(e.id));
    }
  }
  let next = -1;
  const freeId = () => {
    while (used.has(next)) {
      next--;
    }
    used.add(next);
    return next;
  };

  for (const e of entities) {
    const mine = entityToObject(e);
    if (e.type === 'changeset') {
      if (mine.id <= 0 && !out.changeset) {
        out.changeset = mine;
      }
      continue;
    }
    if (e.conflict) {
      out.problems.push({ entity: e, message: `Unresolved conflict of ${e.type} ${e.id}` });
      continue;
    }
    if (mine.id <= 0) {
      if (mine.id === 0) {
        mine.id = freeId();
      }
      mine.version = 1;
      out.changes.push({ action: 'create', object: mine, entity: e });
      continue;
    }
    if (mine.version === undefined) {
      out.problems.push({ entity: e, message: `No version for ${e.type} ${e.id}, download it again` });
      continue;
    }
    const theirs = server.get(key(mine));
    if (!theirs) {
      out.problems.push({ entity: e, message: `${e.type} ${e.id} does not exist on the server` });
      continue;
    }
    if (theirs.deleted) {
      if (mine.action === 'delete') {
        out.unchanged.push(e);
      } else {
        out.conflicts.push({ entity: e, mine });
      }
      continue;
    }
    if ((theirs.version ?? 0) > mine.version) {
      out.conflicts.push({ entity: e, mine, theirs });
      continue;
    }
    if ((theirs.version ?? 0) < mine.version) {
      out.problems.push({ entity: e, message: `${e.type} ${e.id} has version ${mine.version} in the document but ${theirs.version} on the server` });
      continue;
    }
    if (mine.action === 'delete') {
      out.changes.push({ action: 'delete', object: mine, entity: e });
    } else if (isModified(mine, theirs)) {
      out.changes.push({ action: 'modify', object: mine, entity: e });
    } else {
      out.unchanged.push(e);
    }
  }
  out.changes.sort(compareChanges);
  return out;
}
