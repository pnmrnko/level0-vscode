// Cross references between entities of one document: a way's "nd 123" refers
// to the "node 123" header, a relation's "wy 456" to "way 456". Pure module.

import { ParseResult } from './parser';

export type ObjectType = 'node' | 'way' | 'relation';

export interface Location {
  line: number;
  start: number;
  end: number;
}

export interface Symbol {
  type: ObjectType;
  id: string;
  // The header of the entity itself rather than a member line.
  isDefinition: boolean;
  location: Location;
}

function key(type: ObjectType, id: string): string {
  return `${type}/${id}`;
}

export class Index {
  private definitions = new Map<string, Location>();
  private references = new Map<string, Location[]>();
  private symbols: Symbol[] = [];

  constructor(parsed: ParseResult) {
    for (const e of parsed.entities) {
      if (e.type === 'changeset' || e.idStart === undefined || e.id === '0') {
        continue;
      }
      const loc = { line: e.line, start: e.idStart, end: e.idEnd! };
      this.definitions.set(key(e.type, e.id), loc);
      this.symbols.push({ type: e.type, id: e.id, isDefinition: true, location: loc });
      for (const m of e.members) {
        this.addReference(m.type, m.id, { line: m.line, start: m.start, end: m.end });
      }
    }
    for (const e of parsed.entities) {
      if (e.type === 'changeset' || e.idStart !== undefined) {
        continue;
      }
      // Entities without an id still have members that refer to others.
      for (const m of e.members) {
        this.addReference(m.type, m.id, { line: m.line, start: m.start, end: m.end });
      }
    }
  }

  private addReference(type: ObjectType, id: string, loc: Location): void {
    const k = key(type, id);
    const list = this.references.get(k);
    if (list) {
      list.push(loc);
    } else {
      this.references.set(k, [loc]);
    }
    this.symbols.push({ type, id, isDefinition: false, location: loc });
  }

  // The id under the cursor, on a header or a member line.
  symbolAt(line: number, character: number): Symbol | undefined {
    return this.symbols.find(
      (s) => s.location.line === line && character >= s.location.start && character <= s.location.end
    );
  }

  definition(type: ObjectType, id: string): Location | undefined {
    return this.definitions.get(key(type, id));
  }

  referencesTo(type: ObjectType, id: string): Location[] {
    return this.references.get(key(type, id)) ?? [];
  }

  // Every place the id is written: the header and all member lines.
  occurrences(type: ObjectType, id: string): Location[] {
    const def = this.definition(type, id);
    return def ? [def, ...this.referencesTo(type, id)] : this.referencesTo(type, id);
  }
}

export function isNewId(id: string): boolean {
  return Number(id) < 0;
}

