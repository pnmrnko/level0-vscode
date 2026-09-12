// Outline and folding structure of a document. Pure module, no vscode API.

import { Entity, ParseResult } from './parser';

// Keys that say what an object is, in the order they are tried for the
// one-line summary shown next to the object in the outline.
const FEATURE_KEYS = [
  'type',
  'amenity',
  'shop',
  'highway',
  'railway',
  'public_transport',
  'building',
  'natural',
  'landuse',
  'leisure',
  'tourism',
  'historic',
  'man_made',
  'place',
  'waterway',
  'power',
  'barrier',
  'emergency',
  'office',
  'craft',
  'healthcare',
  'route',
  'boundary',
  'aeroway',
  'aerialway',
  'military',
  'entrance',
];

export interface Summary {
  name: string;
  detail: string;
}

export function summarize(e: Entity): Summary {
  const id = e.id === '0' ? 'new' : e.id;
  const name = `${e.conflict ? '!' : ''}${e.deleted ? '-' : ''}${e.type}${e.type === 'changeset' && e.id === '0' ? '' : ` ${id}`}`;
  const tags = new Map(e.tags.map((t) => [t.key, t.value]));
  const parts: string[] = [];
  // "type" alone says little about a relation, so the next feature key is
  // shown with it: type=multipolygon · landuse=grass.
  const features = FEATURE_KEYS.filter((k) => tags.has(k)).slice(0, tags.has('type') ? 2 : 1);
  for (const k of features) {
    parts.push(`${k}=${tags.get(k)}`);
  }
  if (tags.has('name')) {
    parts.push(tags.get('name')!);
  } else if (e.type === 'changeset' && tags.has('comment')) {
    parts.push(tags.get('comment')!);
  }
  if (parts.length === 0 && e.tags.length > 0) {
    parts.push(`${e.tags[0].key}=${e.tags[0].value}`);
  }
  return { name, detail: parts.join(' · ') };
}

// Last line of the entity body: its final tag or member, or the header when
// it has neither.
export function bodyEnd(e: Entity): number {
  return Math.max(e.line, ...e.tags.map((t) => t.line), ...e.members.map((m) => m.line));
}

export interface Fold {
  startLine: number;
  endLine: number;
  kind: 'entity' | 'comment';
}

export function foldingRanges(text: string, parsed: ParseResult): Fold[] {
  const out: Fold[] = [];
  for (const e of parsed.entities) {
    const end = bodyEnd(e);
    if (end > e.line) {
      out.push({ startLine: e.line, endLine: end, kind: 'entity' });
    }
  }
  const lines = text.split(/\r?\n/);
  let start = -1;
  lines.forEach((line, i) => {
    const isComment = line.startsWith('#');
    if (isComment && start < 0) {
      start = i;
    } else if (!isComment && start >= 0) {
      if (i - 1 > start) {
        out.push({ startLine: start, endLine: i - 1, kind: 'comment' });
      }
      start = -1;
    }
  });
  if (start >= 0 && lines.length - 1 > start) {
    out.push({ startLine: start, endLine: lines.length - 1, kind: 'comment' });
  }
  return out;
}
