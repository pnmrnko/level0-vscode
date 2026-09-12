// The map panel: a webview with Leaflet showing the objects of the Level0L
// document that is active, following the cursor, and taking an area or a
// point from the user.
//
// Messages to the webview: init (tiles), data (objects), focus (object under
// the cursor), fit. From it: ready, select (object clicked), bbox (area drawn
// or cleared), download (area to fetch), point (coordinates picked), view.

import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { Bounds, mapData, objectAtLine } from './geometry';
import { Entity, parse } from './parser';
import { TileCache } from './tiles';

export interface MapOptions {
  tileUrl: string;
  attribution: string;
  maxZoom: number;
}

export interface MapEvents {
  downloadArea(bbox: Bounds): Promise<void>;
  tiles: TileCache;
}

const BBOX_KEY = 'level0l.mapBbox';

export class MapPanel {
  private static current: MapPanel | undefined;
  private panel: vscode.WebviewPanel;
  private document: vscode.TextDocument | undefined;
  private timer: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];
  private ready = false;

  static show(context: vscode.ExtensionContext, options: () => MapOptions, events: MapEvents, log: vscode.OutputChannel): MapPanel {
    if (MapPanel.current) {
      MapPanel.current.panel.reveal(undefined, true);
      return MapPanel.current;
    }
    MapPanel.current = new MapPanel(context, options, events, log);
    return MapPanel.current;
  }

  // The area drawn on the map, kept for {{bbox}} even after the panel closes.
  static bbox(context: vscode.ExtensionContext): Bounds | undefined {
    return context.workspaceState.get<Bounds>(BBOX_KEY);
  }

  private constructor(
    private context: vscode.ExtensionContext,
    private options: () => MapOptions,
    private events: MapEvents,
    private log: vscode.OutputChannel
  ) {
    this.panel = vscode.window.createWebviewPanel('level0l.map', 'Level0L map', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    });
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'images', 'icon.png');
    this.panel.webview.html = this.html();
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m)),
      vscode.window.onDidChangeActiveTextEditor((e) => this.follow(e)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === this.document) {
          this.scheduleData();
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor.document === this.document) {
          this.sendFocus(e.textEditor);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('level0l.map')) {
          this.sendInit();
        }
      })
    );
    this.follow(vscode.window.activeTextEditor ?? vscode.window.visibleTextEditors.find((e) => e.document.languageId === 'level0l'));
  }

  private dispose(): void {
    MapPanel.current = undefined;
    clearTimeout(this.timer);
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private follow(editor: vscode.TextEditor | undefined): void {
    if (editor?.document.languageId !== 'level0l') {
      return;
    }
    const changed = editor.document !== this.document;
    this.document = editor.document;
    if (changed) {
      this.sendData();
    }
    this.sendFocus(editor);
  }

  private entities(): Entity[] {
    return this.document ? parse(this.document.getText()).entities : [];
  }

  private post(message: unknown): void {
    if (this.ready) {
      this.panel.webview.postMessage(message);
    }
  }

  private sendInit(): void {
    this.events.tiles.clear();
    this.post({ type: 'init', ...this.options() });
  }

  private scheduleData(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sendData(), 300);
  }

  private sendData(): void {
    this.post({ type: 'data', data: mapData(this.entities()) });
  }

  private sendFocus(editor: vscode.TextEditor): void {
    const at = objectAtLine(this.entities(), editor.selection.active.line);
    this.post({ type: 'focus', line: at?.line });
  }

  private async onMessage(m: { type: string; [k: string]: unknown }): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.ready = true;
        this.sendInit();
        this.sendData();
        break;
      case 'select':
        this.reveal(m.line as number);
        break;
      case 'bbox':
        await this.context.workspaceState.update(BBOX_KEY, m.bbox as Bounds | undefined);
        break;
      case 'download':
        await this.events.downloadArea(m.bbox as Bounds);
        break;
      case 'point':
        await this.insertPoint(m.lat as number, m.lon as number);
        break;
      case 'tile': {
        const t = m as unknown as { key: string; z: number; x: number; y: number };
        const src = await this.events.tiles.get(this.options().tileUrl, t);
        this.post({ type: 'tile', key: t.key, src });
        break;
      }
    }
  }

  private async reveal(line: number): Promise<void> {
    if (!this.document || line >= this.document.lineCount) {
      return;
    }
    const editor = await vscode.window.showTextDocument(this.document, { viewColumn: vscode.window.visibleTextEditors.find((v) => v.document === this.document)?.viewColumn, preserveFocus: false });
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  // A picked point goes into the node header under the cursor, replacing its
  // coordinates, or becomes a new node line after the cursor line.
  private async insertPoint(lat: number, lon: number): Promise<void> {
    const editor = vscode.window.visibleTextEditors.find((v) => v.document === this.document);
    if (!editor || !this.document) {
      return;
    }
    const line = editor.selection.active.line;
    const text = this.document.lineAt(line).text;
    const coords = `${lat}, ${lon}`;
    const h = /^([!-]*node(?:\s+-?[0-9]+(?:\.[0-9]+)?)?)\s*(?::\s*-?[0-9.]+\s*,\s*-?[0-9.]+)?\s*(#.*)?$/.exec(text);
    if (h) {
      await editor.edit((b) => b.replace(this.document!.lineAt(line).range, `${h[1]}: ${coords}${h[2] ? `  ${h[2]}` : ''}`));
    } else {
      const at = this.document.lineAt(line).range.end;
      await editor.edit((b) => b.insert(at, `\nnode: ${coords}\n  `));
      const pos = new vscode.Position(line + 2, 2);
      editor.selection = new vscode.Selection(pos, pos);
    }
    await vscode.window.showTextDocument(this.document, { viewColumn: editor.viewColumn, preserveFocus: false });
  }

  private html(): string {
    const w = this.panel.webview;
    const media = (...p: string[]) => w.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', ...p));
    const nonce = randomBytes(16).toString('hex');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} https: data:; style-src ${w.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('leaflet', 'leaflet.css')}">
<link rel="stylesheet" href="${media('map.css')}">
<title>Level0L map</title>
</head>
<body>
<div id="bar">
  <button id="select" class="secondary" title="Drag a rectangle; it is used by Download area and by {{bbox}} in Overpass queries">Select area</button>
  <button id="clear" class="secondary" disabled title="Remove the selected area">Clear</button>
  <button id="download" title="Download the selected area, or the visible map when none is selected">Download area</button>
  <button id="pick" class="secondary" title="Click the map to put coordinates into the node under the cursor, or to add a node">Pick point</button>
  <button id="fit" class="secondary" title="Zoom to the objects of the document">Fit</button>
  <span id="status"></span>
</div>
<div id="map"></div>
<script nonce="${nonce}" src="${media('leaflet', 'leaflet.js')}"></script>
<script nonce="${nonce}" src="${media('map.js')}"></script>
</body>
</html>`;
  }
}
