// Objects a document refers to but does not contain, offered for download
// from the line or lines under the cursor. Pure module, no vscode API.

import { Entity, ParseResult } from './parser';
import { Index, ObjectType } from './refs';
import { bodyEnd } from './symbols';

export interface Ref {
  type: ObjectType;
  id: string;
}

export interface DownloadAction {
  title: string;
  // API paths relative to the base URL.
  paths: string[];
}

const PLURAL: Record<ObjectType, string> = { node: 'nodes', way: 'ways', relation: 'relations' };
const CHILDREN: Record<ObjectType, string> = { node: '', way: 'its nodes', relation: 'its members' };

function missingMembers(e: Entity, index: Index): Ref[] {
  const out: Ref[] = [];
  const seen = new Set<string>();
  for (const m of e.members) {
    const k = `${m.type}/${m.id}`;
    if (Number(m.id) > 0 && !index.definition(m.type, m.id) && !seen.has(k)) {
      seen.add(k);
      out.push({ type: m.type, id: m.id });
    }
  }
  return out;
}

// One multi-fetch per type, or the object with its children.
export function pathsFor(refs: Ref[], full = false): string[] {
  if (full && refs.length === 1) {
    return [`${refs[0].type}/${refs[0].id}/full`];
  }
  const byType = new Map<ObjectType, string[]>();
  for (const r of refs) {
    byType.set(r.type, [...(byType.get(r.type) ?? []), r.id]);
  }
  return [...byType].map(([type, ids]) => `${PLURAL[type]}?${PLURAL[type]}=${ids.join(',')}`);
}

function count(refs: Ref[]): string {
  const n = refs.length;
  const types = new Set(refs.map((r) => r.type));
  const what = types.size === 1 ? (n === 1 ? [...types][0] : PLURAL[[...types][0]]) : 'objects';
  return `${n} ${what}`;
}

export function missingActions(parsed: ParseResult, index: Index, startLine: number, endLine: number): DownloadAction[] {
  const single = startLine === endLine;
  const entities = parsed.entities.filter((e) => e.type !== 'changeset');

  // A member line: that object, with its children when it has any.
  if (single) {
    const member = entities.flatMap((e) => e.members).find((m) => m.line === startLine);
    if (member && Number(member.id) > 0 && !index.definition(member.type, member.id)) {
      const ref = { type: member.type, id: member.id };
      const out = [{ title: `Download ${ref.type} ${ref.id}`, paths: pathsFor([ref]) }];
      if (ref.type !== 'node') {
        out.push({ title: `Download ${ref.type} ${ref.id} with ${CHILDREN[ref.type]}`, paths: pathsFor([ref], true) });
      }
      return out;
    }
  }

  // Header lines in the range, or the entity the range lies in: their
  // missing members together.
  const refs: Ref[] = [];
  const seen = new Set<string>();
  const inRange = entities.filter((e) => e.line <= endLine && bodyEnd(e) >= startLine);
  for (const e of inRange) {
    for (const r of missingMembers(e, index)) {
      const k = `${r.type}/${r.id}`;
      if (!seen.has(k)) {
        seen.add(k);
        refs.push(r);
      }
    }
  }
  if (refs.length === 0) {
    return [];
  }
  const owner = inRange.length === 1 ? ` of this ${inRange[0].type}` : '';
  return [{ title: `Download ${count(refs)} missing${owner}`, paths: pathsFor(refs) }];
}
