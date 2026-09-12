// The "Revert object" command: the object under the cursor, or every object
// the selection touches, is replaced by its current server version.

import * as vscode from 'vscode';
import { activeLevel0Editor } from './changes';
import { OsmClient } from './osm/client';
import { formatObject } from './osm/format';
import { fetchState } from './osm/state';
import { Entity, parse } from './parser';
import { bodyEnd } from './symbols';

// The conflict comment Level0 writes right above a "!" header goes with the
// object when it is reverted.
function blockStart(lines: string[], e: Entity): number {
  let start = e.line;
  if (e.conflict) {
    let i = e.line - 1;
    while (i >= 0 && lines[i].startsWith('#')) {
      if (lines[i].startsWith('# Conflict!')) {
        start = i;
        break;
      }
      i--;
    }
  }
  return start;
}

export async function revertCommand(client: OsmClient, apiBase: string, log: vscode.OutputChannel): Promise<void> {
  const editor = activeLevel0Editor();
  if (!editor) {
    return;
  }
  const text = editor.document.getText();
  const lines = text.split(/\r?\n/);
  const { entities } = parse(text);
  const { start, end } = editor.selection;
  const chosen = entities.filter((e) => e.type !== 'changeset' && e.line <= end.line && bodyEnd(e) >= start.line);
  if (chosen.length === 0) {
    vscode.window.showInformationMessage('Put the cursor on an object to revert');
    return;
  }
  const fresh = chosen.filter((e) => Number(e.id) <= 0);
  const wanted = chosen.filter((e) => Number(e.id) > 0).map((e) => ({ type: e.type, id: Number(e.id) }));

  let state;
  try {
    state = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Reading the server version' }, () =>
      fetchState(client, apiBase, wanted)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.appendLine(`revert failed: ${message}`);
    vscode.window.showErrorMessage(`Revert failed: ${message}`);
    return;
  }

  const notes: string[] = [];
  const replacements: { startLine: number; endLine: number; text: string }[] = [];
  for (const e of chosen) {
    if (Number(e.id) <= 0) {
      continue;
    }
    const theirs = state.get(`${e.type}${e.id}`);
    if (!theirs) {
      notes.push(`${e.type} ${e.id} does not exist on the server`);
    } else if (theirs.deleted) {
      notes.push(`${e.type} ${e.id} is deleted on the server, remove it by hand`);
    } else {
      replacements.push({ startLine: blockStart(lines, e), endLine: bodyEnd(e), text: formatObject(theirs).replace(/\n$/, '') });
    }
  }
  if (fresh.length) {
    notes.push(`${fresh.length} new ${fresh.length === 1 ? 'object has' : 'objects have'} no server version`);
  }
  if (replacements.length) {
    await editor.edit((b) => {
      for (const r of replacements.sort((a, b) => b.startLine - a.startLine)) {
        const last = editor.document.lineAt(r.endLine).range.end;
        b.replace(new vscode.Range(r.startLine, 0, last.line, last.character), r.text);
      }
    });
  }
  const summary = `${replacements.length} ${replacements.length === 1 ? 'object' : 'objects'} reverted${notes.length ? ` (${notes.join(', ')})` : ''}`;
  log.appendLine(summary);
  if (notes.length) {
    vscode.window.showWarningMessage(summary);
  } else {
    vscode.window.setStatusBarMessage(summary, 8000);
  }
}
