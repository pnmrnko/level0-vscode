// The "Download from OSM" command: fetches objects and appends them to the
// active Level0L document, or opens a new one.

import * as vscode from 'vscode';
import { OsmClient } from './osm/client';
import { formatObjects } from './osm/format';
import { resolveInput } from './osm/input';
import { OsmObject, key } from './osm/model';
import { readOsmXml } from './osm/xml';
import { parse } from './parser';

export interface DownloadOptions {
  apiBase: string;
  maxObjects: number;
}

const PLACEHOLDER = 'osm.org or API URL, map URL, or objects: n123, w45!, r7';

export async function downloadCommand(client: OsmClient, opts: DownloadOptions, log: vscode.OutputChannel): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: 'Download from OSM',
    placeHolder: PLACEHOLDER,
    prompt: 'Objects are added to the active Level0L document, or to a new one.',
    validateInput: (s) => (s.trim() && !resolveInput(s, opts.apiBase) ? 'Not an OSM URL or object list' : undefined),
  });
  if (!input) {
    return;
  }
  const urls = resolveInput(input, opts.apiBase);
  if (!urls) {
    return;
  }

  let fetched: OsmObject[];
  let truncated = false;
  try {
    fetched = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Downloading from OSM', cancellable: false },
      async (progress) => {
        const found = new Map<string, OsmObject>();
        for (const url of urls) {
          progress.report({ message: url });
          log.appendLine(`GET ${url}`);
          const xml = await client.getXml(url);
          const result = readOsmXml(xml, opts.maxObjects - found.size);
          truncated ||= result.truncated;
          for (const o of result.objects) {
            const k = key(o);
            const seen = found.get(k);
            if (!seen || (o.version ?? 0) >= (seen.version ?? 0)) {
              found.set(k, o);
            }
          }
          if (truncated) {
            break;
          }
        }
        return [...found.values()];
      }
    );
  } catch (err) {
    log.appendLine(`download failed: ${err}`);
    vscode.window.showErrorMessage(`Download failed: ${err instanceof Error ? err.message : err}`);
    return;
  }

  // Objects the document already has are left alone, whether edited or not.
  let editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId !== 'level0l') {
    editor = undefined;
  }
  const present = new Set<string>();
  if (editor) {
    for (const e of parse(editor.document.getText()).entities) {
      if (Number(e.id) > 0) {
        present.add(`${e.type}${e.id}`);
      }
    }
  }
  const deleted = fetched.filter((o) => o.deleted).length;
  const skipped = fetched.filter((o) => !o.deleted && present.has(key(o))).length;
  const objects = fetched.filter((o) => !o.deleted && !present.has(key(o)));

  const notes: string[] = [];
  if (skipped) {
    notes.push(`${skipped} already in the document`);
  }
  if (deleted) {
    notes.push(`${deleted} deleted on the server`);
  }
  if (truncated) {
    notes.push(`stopped at the limit of ${opts.maxObjects} objects`);
  }
  const summary = `${objects.length} ${objects.length === 1 ? 'object' : 'objects'} added${notes.length ? ` (${notes.join(', ')})` : ''}`;
  if (objects.length === 0) {
    vscode.window.showInformationMessage(`Nothing to add${notes.length ? `: ${notes.join(', ')}` : ''}`);
    return;
  }

  const text = formatObjects(objects).replace(/^\n+/, '');
  if (editor) {
    const doc = editor.document;
    const last = doc.lineAt(doc.lineCount - 1);
    const end = last.range.end;
    const separator = doc.getText().trim() === '' ? '' : last.text.trim() === '' ? '\n' : '\n\n';
    const ok = await editor.edit((b) => b.insert(end, separator + text));
    if (ok) {
      const start = doc.positionAt(doc.offsetAt(end) + separator.length);
      editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.AtTop);
      editor.selection = new vscode.Selection(start, start);
    }
  } else {
    const doc = await vscode.workspace.openTextDocument({ language: 'level0l', content: text });
    await vscode.window.showTextDocument(doc);
  }
  vscode.window.setStatusBarMessage(summary, 8000);
  log.appendLine(summary);
}
