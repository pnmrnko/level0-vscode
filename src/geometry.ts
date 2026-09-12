// What the map can draw from a document: nodes with coordinates, ways as
// lines through the nodes the document has, relations as the ways and nodes
// they list. Pure module, no vscode API.

import { Entity } from './parser';
import { summarize } from './symbols';

export type LatLon = [number, number];

export interface MapNode {
  id: string;
  line: number;
  latlon: LatLon;
  tagged: boolean;
  deleted: boolean;
  label: string;
}

export interface MapWay {
  id: string;
  line: number;
  // Coordinates of the nodes found in the document, in order.
  points: LatLon[];
  // False when some nodes are missing from the document.
  complete: boolean;
  closed: boolean;
  deleted: boolean;
  label: string;
}

export interface MapRelation {
  id: string;
  line: number;
  ways: string[];
  nodes: string[];
  label: string;
}

export interface MapData {
  nodes: MapNode[];
  ways: MapWay[];
  relations: MapRelation[];
}

function label(e: Entity): string {
  const s = summarize(e);
  return s.detail ? `${s.name}: ${s.detail}` : s.name;
}

export function mapData(entities: Entity[]): MapData {
  const nodes: MapNode[] = [];
  const coords = new Map<string, LatLon>();
  for (const e of entities) {
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined && !e.conflict) {
      const latlon: LatLon = [Number(e.lat), Number(e.lon)];
      coords.set(e.id, latlon);
      nodes.push({ id: e.id, line: e.line, latlon, tagged: e.tags.length > 0, deleted: e.deleted, label: label(e) });
    }
  }
  const ways: MapWay[] = [];
  const relations: MapRelation[] = [];
  for (const e of entities) {
    if (e.conflict) {
      continue;
    }
    if (e.type === 'way') {
      const points = e.members.map((m) => coords.get(m.id)).filter((p): p is LatLon => p !== undefined);
      const closed = e.members.length > 2 && e.members[0].id === e.members[e.members.length - 1].id;
      ways.push({ id: e.id, line: e.line, points, complete: points.length === e.members.length, closed, deleted: e.deleted, label: label(e) });
    } else if (e.type === 'relation') {
      relations.push({
        id: e.id,
        line: e.line,
        ways: e.members.filter((m) => m.type === 'way').map((m) => m.id),
        nodes: e.members.filter((m) => m.type === 'node').map((m) => m.id),
        label: label(e),
      });
    }
  }
  return { nodes, ways, relations };
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function bounds(data: MapData): Bounds | undefined {
  let b: Bounds | undefined;
  for (const n of data.nodes) {
    const [lat, lon] = n.latlon;
    b = b ? { south: Math.min(b.south, lat), west: Math.min(b.west, lon), north: Math.max(b.north, lat), east: Math.max(b.east, lon) } : { south: lat, west: lon, north: lat, east: lon };
  }
  return b;
}

// The object whose block contains the line, for following the cursor.
export function objectAtLine(entities: Entity[], line: number): Entity | undefined {
  let found: Entity | undefined;
  for (const e of entities) {
    if (e.line <= line) {
      found = e;
    } else {
      break;
    }
  }
  return found && found.type !== 'changeset' ? found : undefined;
}
