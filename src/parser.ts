// Port of l0l_to_data() and validate_entity() from level0l.php in the Level0
// repository. Produces the entities of a document together with the same
// validation messages Level0 shows, with positions the editor can underline.
// "error" corresponds to Level0's severe flag: the upload is refused. A
// "warning" is reported but the upload goes ahead. Pure module, no vscode API.

import { HEADER_RE, MEMBER_RE, EntityType, TagLine, isBlankOrComment, parseTagLine } from './lines';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  line: number;
  start: number;
  end: number;
  severity: Severity;
  message: string;
}

export interface Tag extends TagLine {
  line: number;
}

export interface Member {
  line: number;
  type: 'node' | 'way' | 'relation';
  id: string;
  role: string;
}

export interface Entity {
  type: EntityType;
  id: string;
  version?: string;
  line: number;
  deleted: boolean;
  conflict: boolean;
  lat?: string;
  lon?: string;
  tags: Tag[];
  members: Member[];
}

export interface ParseResult {
  entities: Entity[];
  diagnostics: Diagnostic[];
}

const MEMBER_TYPES: Record<string, Member['type']> = { nd: 'node', wy: 'way', rel: 'relation' };

function isNew(entity: Entity): boolean {
  return Number(entity.id) <= 0;
}

export function parse(text: string): ParseResult {
  const lines = text.split(/\r?\n/);
  const entities: Entity[] = [];
  const diagnostics: Diagnostic[] = [];
  let cur: Entity | undefined;
  let changesetFound = false;

  const report = (line: number, severity: Severity, message: string, start = 0, end = lines[line].length) => {
    diagnostics.push({ line, start, end, severity, message });
  };

  const finish = (entity: Entity) => {
    const skip = !isNew(entity) && entity.deleted;
    if (!skip) {
      const headerEnd = lines[entity.line].length;
      if (entity.type === 'way' && entity.members.length < 2) {
        report(entity.line, 'error', `Way ${entity.id} has less than two nodes`, 0, headerEnd);
      } else if (entity.type === 'relation' && entity.members.length === 0) {
        report(entity.line, 'error', `Relation ${entity.id} has no members`, 0, headerEnd);
      }
    }
    entities.push(entity);
  };

  lines.forEach((line, ln) => {
    if (isBlankOrComment(line)) {
      return;
    }

    const h = HEADER_RE.exec(line);
    if (h) {
      if (cur) {
        finish(cur);
      }
      const [, conflict, minus, type, id, version, lat, lon] = h;
      cur = {
        type: type as EntityType,
        id: id ?? '0',
        version,
        line: ln,
        deleted: minus === '-',
        conflict: conflict === '!',
        tags: [],
        members: [],
      };
      const typeStart = line.indexOf(type);
      if (cur.conflict) {
        report(ln, 'error', `Please resolve conflict of ${type} ${cur.id}`);
      }
      if (cur.deleted && Number(cur.id) <= 0) {
        report(ln, 'error', 'Deleting an unsaved object', typeStart - 1, typeStart);
      }
      if (type === 'changeset' && Number(cur.id) <= 0) {
        if (changesetFound) {
          report(ln, 'error', 'There can be only one changeset metadata');
        }
        changesetFound = true;
      }
      if (lat && lon) {
        if (type === 'node') {
          cur.lat = lat;
          cur.lon = lon;
        } else {
          report(ln, 'warning', `Coordinates specified for ${type} ${cur.id}`, line.indexOf(':'), line.length);
        }
      } else if (type === 'node' && !cur.deleted) {
        report(ln, 'error', 'Node without coordinates');
      }
      return;
    }

    if (!cur) {
      report(ln, 'warning', 'Unknown and unparsed content found');
      return;
    }

    const m = MEMBER_RE.exec(line);
    if (m) {
      const [, kind, id, role] = m;
      const kindStart = line.indexOf(kind);
      if (cur.type === 'node') {
        report(ln, 'error', 'A node cannot have member objects');
      } else if (cur.type === 'way') {
        if (kind === 'nd') {
          cur.members.push({ line: ln, type: 'node', id, role: '' });
          if (role) {
            report(ln, 'warning', 'Role name specified for a way node', line.indexOf(role, kindStart), line.length);
          }
        } else {
          report(ln, 'error', 'Ways cannot have members besides nodes', kindStart, kindStart + kind.length);
        }
      } else if (cur.type === 'relation') {
        cur.members.push({ line: ln, type: MEMBER_TYPES[kind], id, role: role ?? '' });
      }
      return;
    }

    const tag = parseTagLine(line);
    if (tag) {
      if (cur.tags.some((t) => t.key === tag.key)) {
        report(ln, 'error', 'Duplicated tag', tag.keyStart, tag.keyEnd);
      } else {
        cur.tags.push({ ...tag, line: ln });
      }
      return;
    }

    report(ln, 'warning', `Unknown content while parsing ${cur.type} ${cur.id}`);
  });

  if (cur) {
    finish(cur);
  }
  return { entities, diagnostics };
}
