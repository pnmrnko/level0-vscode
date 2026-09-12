// Line-level syntax of Level0L, mirroring the three regexes in level0l.php of
// the reference implementation. Kept free of the vscode API.

export const HEADER_RE =
  /^(!)?(-)?(node|way|relation|changeset)(?:\s+(-?[0-9]+)(?:\.([0-9]+))?)?(?:\s*:\s*(-?[0-9]{1,2}(?:\.[0-9]+)?)\s*,\s*(-?[0-9]{1,3}(?:\.[0-9]+)?))?\s*(?:#.*)?$/;
// The reference parser takes everything after the id as the role. The JOSM
// comfort0 plugin writes " #<name>" after each member instead; that trailing
// comment is split off here so both dialects read correctly.
export const MEMBER_RE = /^\s*(nd|wy|rel)\s+(-?[0-9]+)(?:\s+([^#\s].*?))?(?:\s+(#.*))?\s*$/;
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

// Last line of the entity whose header is at line i: the tag and member
// lines that follow, up to the first blank line, comment or header.
function blockEnd(lines: string[], i: number): number {
  let end = i;
  while (end + 1 < lines.length && !isBlankOrComment(lines[end + 1]) && !HEADER_RE.test(lines[end + 1])) {
    end++;
  }
  return end;
}

// Bodies of entities marked for deletion with "-", for dimming: Level0
// ignores their tags and members, only the header counts.
export function deletedSpans(text: string): LineRange[] {
  const lines = text.split(/\r?\n/);
  const out: LineRange[] = [];
  lines.forEach((line, i) => {
    const m = HEADER_RE.exec(line);
    const end = m && m[2] === '-' ? blockEnd(lines, i) : i;
    if (end > i) {
      out.push({ startLine: i + 1, endLine: end });
    }
  });
  return out;
}

export function conflictSpans(text: string): Conflict[] {
  const lines = text.split(/\r?\n/);
  const out: Conflict[] = [];
  lines.forEach((line, i) => {
    if (!line.startsWith('!') || !HEADER_RE.test(line)) {
      return;
    }
    const end = blockEnd(lines, i);
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
