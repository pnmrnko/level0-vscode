// Objects as the OSM API sees them, shared by the XML reader, the Level0L
// writer and later the diff. Pure module, no vscode API.

export type ObjectType = 'node' | 'way' | 'relation' | 'changeset';
export type MemberType = 'node' | 'way' | 'relation';
export type Action = 'create' | 'modify' | 'delete';

export interface OsmMember {
  type: MemberType;
  id: number;
  role: string;
}

export interface OsmObject {
  type: ObjectType;
  id: number;
  version?: number;
  action?: Action;
  // visible="false" in API output: the object is deleted on the server.
  deleted?: boolean;
  timestamp?: string;
  user?: string;
  uid?: number;
  changeset?: number;
  // Coordinates are kept as written so that no precision is lost in transit.
  lat?: string;
  lon?: string;
  // A Map keeps tag order; a plain object would move numeric-looking keys.
  tags: Map<string, string>;
  nodes?: number[];
  members?: OsmMember[];
  // The user's own version of the object, written above a "!" header.
  conflict?: OsmObject;
}

export function key(o: { type: string; id: number }): string {
  return `${o.type}${o.id}`;
}
