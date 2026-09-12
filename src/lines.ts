// Line-level syntax of Level0L, mirroring the three regexes in level0l.php of
// the reference implementation. Kept free of the vscode API.

export const HEADER_RE =
  /^(!)?(-)?(node|way|relation|changeset)(?:\s+(-?[0-9]+)(?:\.([0-9]+))?)?(?:\s*:\s*(-?[0-9]{1,2}(?:\.[0-9]+)?)\s*,\s*(-?[0-9]{1,3}(?:\.[0-9]+)?))?\s*(?:#.*)?$/;
export const MEMBER_RE = /^\s*(nd|wy|rel)\s+(-?[0-9]+)(?:\s+(.+?))?\s*$/;
export const TAG_RE = /^\s*((?:[^=\\]|\\.)*?)\s*=\s*(.*?)\s*$/;

export type EntityType = 'node' | 'way' | 'relation' | 'changeset';

export interface TagLine {
  key: string;
  rawKey: string;
  keyStart: number;
  keyEnd: number;
  value: string;
  valueStart: number;
  valueEnd: number;
}

export function isBlankOrComment(line: string): boolean {
  const t = line.trimStart();
  return t === '' || t.startsWith('#');
}

export function headerType(line: string): EntityType | undefined {
  const m = HEADER_RE.exec(line);
  return m ? (m[3] as EntityType) : undefined;
}

export function parseTagLine(line: string): TagLine | undefined {
  const m = TAG_RE.exec(line);
  if (!m || !m[1]) {
    return undefined;
  }
  const [, rawKey, value] = m;
  const keyStart = line.indexOf(rawKey);
  const keyEnd = keyStart + rawKey.length;
  const valueStart = value ? line.indexOf(value, keyEnd + 1) : keyEnd + 1;
  return {
    key: rawKey.replace(/\\=/g, '='),
    rawKey,
    keyStart,
    keyEnd,
    value,
    valueStart,
    valueEnd: valueStart + value.length,
  };
}

// Type of the entity a given line belongs to, found by scanning upwards for
// the nearest header. Undefined for lines before the first header.
export function enclosingEntity(lines: string[], lineNo: number): EntityType | undefined {
  for (let i = lineNo; i >= 0; i--) {
    const t = headerType(lines[i]);
    if (t) {
      return t;
    }
  }
  return undefined;
}
