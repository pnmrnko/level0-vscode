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

// A comment line starts with '#' in the first column; an indented '#' is not
// a comment and the reference parser rejects such a line.
export function isBlankOrComment(line: string): boolean {
  return line.trim() === '' || line.startsWith('#');
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

export interface Span {
  line: number;
  start: number;
  end: number;
}

// Positions of the ".version" part of entity headers, for dimming.
export function versionSpans(text: string): Span[] {
  const out: Span[] = [];
  text.split(/\r?\n/).forEach((line, lineNo) => {
    const m = HEADER_RE.exec(line);
    if (!m || !m[4] || !m[5]) {
      return;
    }
    const start = line.indexOf(m[4], m[3].length) + m[4].length;
    out.push({ line: lineNo, start, end: start + 1 + m[5].length });
  });
  return out;
}

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface Conflict {
  // Comment block Level0 wrote right above the header, holding the user's
  // edits to the previous version. Absent when the file was edited by hand.
  current?: LineRange;
  // The entity marked with "!": the server version, header to last member.
  incoming: LineRange;
}

export function conflictSpans(text: string): Conflict[] {
  const lines = text.split(/\r?\n/);
  const out: Conflict[] = [];
  lines.forEach((line, i) => {
    if (!line.startsWith('!') || !HEADER_RE.test(line)) {
      return;
    }
    // Body: the tag and member lines that follow, up to the first blank
    // line, comment or header.
    let end = i;
    while (end + 1 < lines.length && !isBlankOrComment(lines[end + 1]) && !HEADER_RE.test(lines[end + 1])) {
      end++;
    }
    let start = i;
    while (start > 0 && lines[start - 1].startsWith('#')) {
      start--;
    }
    out.push({
      current: start < i ? { startLine: start, endLine: i - 1 } : undefined,
      incoming: { startLine: i, endLine: end },
    });
  });
  return out;
}
