// The "Show osmChange" and "Check for conflicts" commands: what an upload of
// the document would do, computed against the current server state.

import * as vscode from 'vscode';
import { OsmClient } from './osm/client';
import { conflictReplacements, refreshReplacements } from './osm/conflicts';
import { Plan, historyKeys, plan, serverKeys, settleConflicts } from './osm/diff';
import { createOsc } from './osm/osc';
import { fetchState, fetchVersions } from './osm/state';
import { parse } from './parser';

export interface ChangesOptions {
  apiBase: string;
  generator: string;
}

export function activeLevel0Editor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId !== 'level0l') {
    vscode.window.showInformationMessage('Open a Level0L document first');
    return undefined;
  }
  return editor;
}

export async function computePlan(editor: vscode.TextEditor, client: OsmClient, opts: ChangesOptions, log: vscode.OutputChannel): Promise<Plan | undefined> {
  const { entities } = parse(editor.document.getText());
  try {
    return await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Comparing with the server', cancellable: false },
      async (progress) => {
        const state = await fetchState(client, opts.apiBase, serverKeys(entities), (done, total) => progress.report({ message: `${done} of ${total} objects` }));
        const p = plan(entities, state);
        const wanted = historyKeys(p);
        if (wanted.length) {
          progress.report({ message: `${wanted.length} changed on the server, reading history` });
          settleConflicts(p, await fetchVersions(client, opts.apiBase, wanted));
        }
        return p;
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.appendLine(`server state failed: ${message}`);
    vscode.window.showErrorMessage(`Could not read the server state: ${message}`);
    return undefined;
  }
}

// Conflicts are written into the document as Level0 writes them; the ones
// without a server object (deleted there) are only reported. Untouched
// objects the server changed are replaced by the server version.
export async function writeConflicts(editor: vscode.TextEditor, p: Plan): Promise<void> {
  const replacements = [...conflictReplacements(p.conflicts), ...refreshReplacements(p.refreshed)].sort((a, b) => b.startLine - a.startLine);
  if (replacements.length === 0) {
    return;
  }
  await editor.edit((b) => {
    for (const r of replacements) {
      const end = editor.document.lineAt(r.endLine).range.end;
      b.replace(new vscode.Range(r.startLine, 0, end.line, end.character), r.text);
    }
  });
}

function count(p: Plan, action: string): number {
  return p.changes.filter((c) => c.action === action).length;
}

export function summary(p: Plan): string {
  const parts = [`${count(p, 'create')} to create`, `${count(p, 'modify')} to modify`, `${count(p, 'delete')} to delete`, `${p.unchanged.length} unchanged`];
  const written = p.conflicts.filter((c) => c.theirs).length;
  const gone = p.conflicts.filter((c) => !c.theirs);
  if (p.refreshed.length) {
    parts.push(`${p.refreshed.length} updated from the server`);
  }
  if (written) {
    parts.push(`${written} ${written === 1 ? 'conflict' : 'conflicts'} written into the document`);
  }
  for (const c of gone) {
    parts.push(`${c.entity.type} ${c.entity.id} was deleted on the server`);
  }
  for (const pr of p.problems) {
    parts.push(pr.message);
  }
  return parts.join(', ');
}

export function report(p: Plan, log: vscode.OutputChannel): void {
  const text = summary(p);
  log.appendLine(text);
  if (p.conflicts.length || p.problems.length) {
    vscode.window.showWarningMessage(text);
  } else {
    vscode.window.showInformationMessage(text);
  }
}

export async function checkConflictsCommand(client: OsmClient, opts: ChangesOptions, log: vscode.OutputChannel): Promise<void> {
  const editor = activeLevel0Editor();
  if (!editor) {
    return;
  }
  const p = await computePlan(editor, client, opts, log);
  if (!p) {
    return;
  }
  await writeConflicts(editor, p);
  report(p, log);
}

// Opens the osmChange an upload would send, as an unsaved XML document that
// can be saved as .osc and opened in JOSM.
export async function showOscCommand(client: OsmClient, opts: ChangesOptions, log: vscode.OutputChannel): Promise<void> {
  const editor = activeLevel0Editor();
  if (!editor) {
    return;
  }
  const errors = parse(editor.document.getText()).diagnostics.filter((d) => d.severity === 'error').length;
  if (errors) {
    vscode.window.showErrorMessage(`The document has ${errors} ${errors === 1 ? 'error' : 'errors'} Level0 would refuse to upload; fix them first`);
    return;
  }
  const p = await computePlan(editor, client, opts, log);
  if (!p) {
    return;
  }
  await writeConflicts(editor, p);
  if (p.conflicts.length || p.problems.length || p.changes.length === 0) {
    report(p, log);
    if (p.changes.length === 0) {
      return;
    }
  }
  const doc = await vscode.workspace.openTextDocument({ language: 'xml', content: createOsc(p.changes, opts.generator) });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  vscode.window.setStatusBarMessage(summary(p), 8000);
}
