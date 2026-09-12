// Writes conflicts into the document the way Level0 does: the user's version
// becomes a comment block and the server version follows with a "!" header.
// Pure module, no vscode API.

import { bodyEnd } from '../symbols';
import { Conflict, Refresh } from './diff';
import { formatObject } from './format';

export interface LineReplacement {
  startLine: number;
  endLine: number;
  text: string;
}

export function conflictReplacements(conflicts: Conflict[]): LineReplacement[] {
  const out: LineReplacement[] = [];
  for (const c of conflicts) {
    if (!c.theirs) {
      continue;
    }
    // Level0 prints the user's copy without a version, the header line then
    // says nothing that could be mistaken for the current state.
    const { version: _version, ...mine } = c.mine;
    const text = formatObject({ ...c.theirs, conflict: mine }).replace(/\n$/, '');
    out.push({ startLine: c.entity.line, endLine: bodyEnd(c.entity), text });
  }
  return out.sort((a, b) => b.startLine - a.startLine);
}

// Untouched objects the server changed are simply replaced by the server
// version.
export function refreshReplacements(refreshed: Refresh[]): LineReplacement[] {
  return refreshed
    .map((r) => ({ startLine: r.entity.line, endLine: bodyEnd(r.entity), text: formatObject(r.theirs).replace(/\n$/, '') }))
    .sort((a, b) => b.startLine - a.startLine);
}
