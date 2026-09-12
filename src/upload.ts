// The "Upload changeset" command: the plan of the document goes to the
// server as one changeset, and the server's diffResult is written back so
// the document matches what is now on the server.

import * as vscode from 'vscode';
import { Auth } from './auth';
import { activeLevel0Editor, computePlan, report, summary, writeConflicts } from './changes';
import { applyDiffResult, parseDiffResult } from './osm/apply';
import { OsmClient } from './osm/client';
import { siteUrl } from './osm/oauth';
import { createChangesetXml, createOsc } from './osm/osc';
import { parse } from './parser';

export interface UploadOptions {
  apiBase: string;
  generator: string;
  clientId: string;
}

export async function uploadCommand(client: OsmClient, auth: Auth, opts: UploadOptions, log: vscode.OutputChannel): Promise<void> {
  const editor = activeLevel0Editor();
  if (!editor) {
    return;
  }
  const errors = parse(editor.document.getText()).diagnostics.filter((d) => d.severity === 'error').length;
  if (errors) {
    vscode.window.showErrorMessage(`The document has ${errors} ${errors === 1 ? 'error' : 'errors'}; fix them before uploading`);
    return;
  }
  let account = await auth.account(opts.apiBase);
  if (!account) {
    try {
      account = await auth.login(opts.apiBase, opts.clientId);
    } catch (err) {
      vscode.window.showErrorMessage(`Login failed: ${err instanceof Error ? err.message : err}`);
      return;
    }
    if (!account) {
      return;
    }
  }

  const p = await computePlan(editor, client, opts, log);
  if (!p) {
    return;
  }
  await writeConflicts(editor, p);
  if (p.conflicts.length || p.problems.length || p.changes.length === 0) {
    report(p, log);
    return;
  }

  let comment = p.changeset?.tags.get('comment') ?? '';
  if (!comment.trim()) {
    comment =
      (await vscode.window.showInputBox({
        title: 'Changeset comment',
        prompt: 'What was changed and why. Also settable as "comment" in a changeset block.',
        validateInput: (s) => (s.trim() ? undefined : 'A comment is required'),
      })) ?? '';
    if (!comment.trim()) {
      return;
    }
  }
  const site = siteUrl(opts.apiBase);
  const choice = await vscode.window.showWarningMessage(
    `Upload to ${site} as ${account.name}: ${summary(p)}. Comment: "${comment.trim()}"`,
    { modal: true },
    'Upload'
  );
  if (choice !== 'Upload') {
    return;
  }

  const changesetXml = createChangesetXml(p.changeset?.tags ?? new Map(), comment, opts.generator);
  let changesetId: number | undefined;
  let diff: string;
  try {
    diff = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Uploading changeset', cancellable: false }, async (progress) => {
      progress.report({ message: 'creating' });
      changesetId = Number((await client.put(`${opts.apiBase}changeset/create`, changesetXml)).trim());
      if (!Number.isInteger(changesetId)) {
        throw new Error('the server returned no changeset id');
      }
      log.appendLine(`changeset ${changesetId} created on ${site}`);
      progress.report({ message: `changeset ${changesetId}` });
      const osc = createOsc(p.changes, opts.generator, changesetId);
      log.appendLine(osc);
      try {
        return await client.post(`${opts.apiBase}changeset/${changesetId}/upload`, osc);
      } finally {
        progress.report({ message: 'closing' });
        await client.put(`${opts.apiBase}changeset/${changesetId}/close`, '').catch((err) => log.appendLine(`close failed: ${err}`));
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.appendLine(`upload failed: ${message}`);
    const hint = /HTTP 409/.test(message) ? ' Run "Level0L: Check for conflicts with the server" to see what changed.' : '';
    vscode.window.showErrorMessage(`Upload failed: ${message}.${hint}`);
    return;
  }

  log.appendLine(diff);
  const result = parseDiffResult(diff);
  const text = editor.document.getText();
  const updated = applyDiffResult(text, result, p.zeroIds);
  const whole = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(text.length));
  await editor.edit((b) => b.replace(whole, updated));

  const url = `${site}/changeset/${changesetId}`;
  const open = await vscode.window.showInformationMessage(`Changeset ${changesetId} uploaded: ${summary(p)}`, 'Open changeset');
  if (open) {
    vscode.env.openExternal(vscode.Uri.parse(url));
  }
}
