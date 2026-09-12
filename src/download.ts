// The "Download from OSM" and "Run Overpass query" commands: fetch objects
// and append them to the active Level0L document, or open a new one.

import * as vscode from 'vscode';
import { OsmClient } from './osm/client';
import { formatObjects } from './osm/format';
import { resolveInput, BBOX_RADIUS } from './osm/input';
import { OsmObject, key } from './osm/model';
import { Bbox, hasMeta, isOverpassQuery, overpassError, prepareQuery } from './osm/overpass';
import { readOsmXml } from './osm/xml';
import { Entity, parse } from './parser';

export interface DownloadOptions {
  apiBase: string;
  overpassUrl: string;
  maxObjects: number;
}

const PLACEHOLDER = 'osm.org or API URL, map URL, objects: n123, w45!, r7, or an Overpass query';

interface Fetched {
  objects: OsmObject[];
  truncated: boolean;
}

function activeLevel0Editor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor?.document.languageId === 'level0l' ? editor : undefined;
}

// Extent of the nodes in the document, padded like a map download.
export function documentBbox(entities: Entity[]): Bbox | undefined {
  let box: Bbox | undefined;
  for (const e of entities) {
    if (e.lat === undefined || e.lon === undefined) {
      continue;
    }
    const lat = Number(e.lat);
    const lon = Number(e.lon);
    box = box
      ? { south: Math.min(box.south, lat), west: Math.min(box.west, lon), north: Math.max(box.north, lat), east: Math.max(box.east, lon) }
      : { south: lat, west: lon, north: lat, east: lon };
  }
  return box && { south: box.south - BBOX_RADIUS, west: box.west - BBOX_RADIUS, north: box.north + BBOX_RADIUS, east: box.east + BBOX_RADIUS };
}

function merge(found: Map<string, OsmObject>, objects: OsmObject[]): void {
  for (const o of objects) {
    const k = key(o);
    const seen = found.get(k);
    if (!seen || (o.version ?? 0) >= (seen.version ?? 0)) {
      found.set(k, o);
    }
  }
}

async function fetchUrls(client: OsmClient, urls: string[], opts: DownloadOptions, log: vscode.OutputChannel): Promise<Fetched> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Downloading from OSM', cancellable: false },
    async (progress) => {
      const found = new Map<string, OsmObject>();
      let truncated = false;
      for (const url of urls) {
        progress.report({ message: url });
        log.appendLine(`GET ${url}`);
        const result = readOsmXml(await client.getXml(url), opts.maxObjects - found.size);
        merge(found, result.objects);
        truncated ||= result.truncated;
        if (truncated) {
          break;
        }
      }
      return { objects: [...found.values()], truncated };
    }
  );
}

async function fetchOverpass(client: OsmClient, query: string, opts: DownloadOptions, log: vscode.OutputChannel): Promise<Fetched> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Running Overpass query', cancellable: false },
    async () => {
      log.appendLine(`POST ${opts.overpassUrl}\n${query}`);
      const { status, body } = await client.postOverpass(opts.overpassUrl, query);
      const error = overpassError(status, body);
      if (error) {
        throw new Error(error);
      }
      return readOsmXml(body, opts.maxObjects);
    }
  );
}

// Appends the objects to the active document or opens a new one. Objects the
// document already has are left alone, whether edited or not.
async function addObjects(fetched: Fetched, opts: DownloadOptions, log: vscode.OutputChannel, extraNotes: string[] = []): Promise<void> {
  const editor = activeLevel0Editor();
  const present = new Set<string>();
  if (editor) {
    for (const e of parse(editor.document.getText()).entities) {
      if (Number(e.id) > 0) {
        present.add(`${e.type}${e.id}`);
      }
    }
  }
  const deleted = fetched.objects.filter((o) => o.deleted).length;
  const skipped = fetched.objects.filter((o) => !o.deleted && present.has(key(o))).length;
  const objects = fetched.objects.filter((o) => !o.deleted && !present.has(key(o)));

  const notes = [...extraNotes];
  if (skipped) {
    notes.push(`${skipped} already in the document`);
  }
  if (deleted) {
    notes.push(`${deleted} deleted on the server`);
  }
  if (fetched.truncated) {
    notes.push(`stopped at the limit of ${opts.maxObjects} objects`);
  }
  if (objects.length === 0) {
    vscode.window.showInformationMessage(`Nothing to add${notes.length ? `: ${notes.join(', ')}` : ''}`);
    return;
  }
  const summary = `${objects.length} ${objects.length === 1 ? 'object' : 'objects'} added${notes.length ? ` (${notes.join(', ')})` : ''}`;

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

function showError(what: string, err: unknown, log: vscode.OutputChannel): void {
  const message = err instanceof Error ? err.message : String(err);
  log.appendLine(`${what} failed: ${message}`);
  vscode.window.showErrorMessage(`${what} failed: ${message}`);
}

async function runQuery(client: OsmClient, raw: string, opts: DownloadOptions, log: vscode.OutputChannel): Promise<void> {
  const editor = activeLevel0Editor();
  const bbox = editor ? documentBbox(parse(editor.document.getText()).entities) : undefined;
  const prepared = prepareQuery(raw, bbox);
  if ('error' in prepared) {
    vscode.window.showErrorMessage(prepared.error);
    return;
  }
  let fetched: Fetched;
  try {
    fetched = await fetchOverpass(client, prepared.query, opts, log);
  } catch (err) {
    showError('Overpass query', err, log);
    return;
  }
  const notes: string[] = [];
  const unversioned = fetched.objects.filter((o) => o.version === undefined).length;
  if (unversioned && !hasMeta(prepared.query)) {
    notes.push(`${unversioned} without a version, use "out meta" to be able to upload them`);
  }
  await addObjects(fetched, opts, log, notes);
}

export async function downloadCommand(client: OsmClient, opts: DownloadOptions, log: vscode.OutputChannel): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: 'Download from OSM',
    placeHolder: PLACEHOLDER,
    prompt: 'Objects are added to the active Level0L document, or to a new one.',
    validateInput: (s) => (s.trim() && !isOverpassQuery(s) && !resolveInput(s, opts.apiBase) ? 'Not an OSM URL, object list or Overpass query' : undefined),
  });
  if (!input?.trim()) {
    return;
  }
  if (isOverpassQuery(input)) {
    return runQuery(client, input, opts, log);
  }
  const urls = resolveInput(input, opts.apiBase);
  if (!urls) {
    return;
  }
  try {
    await addObjects(await fetchUrls(client, urls, opts, log), opts, log);
  } catch (err) {
    showError('Download', err, log);
  }
}

// The query is the selection when there is one, else the whole document when
// it is an Overpass QL file, else typed into the input box.
export async function overpassCommand(client: OsmClient, opts: DownloadOptions, log: vscode.OutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  let query = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
  if (!query.trim() && editor && (editor.document.languageId === 'overpassql' || editor.document.fileName.endsWith('.overpassql'))) {
    query = editor.document.getText();
  }
  if (!query.trim()) {
    query =
      (await vscode.window.showInputBox({
        title: 'Run Overpass query',
        placeHolder: 'nwr[amenity=cafe]({{bbox}}); out meta;',
        prompt: 'Or select a query in an editor first. {{bbox}} is the extent of the active Level0L document.',
      })) ?? '';
  }
  if (!query.trim()) {
    return;
  }
  await runQuery(client, query, opts, log);
}
