import * as vscode from 'vscode';
import { buildKeyHover, buildTagHover, buildUnknownHover, totalCount, HoverOptions } from './hover';
import { enclosingEntity, parseTagLine } from './lines';
import { extractLinks, isEnumValue, wikiTitle, LinkOptions } from './links';
import { Diagnostic, parse } from './parser';
import { checkTags } from './tagcheck';
import { pickWikiPage, TaginfoClient } from './taginfo';
import { isIdentifierKey } from './valuelinks';

function config() {
  return vscode.workspace.getConfiguration('level0l');
}

function linkOptions(): LinkOptions {
  const cfg = config();
  return {
    osmBaseUrl: cfg.get<string>('osmBaseUrl', 'https://www.openstreetmap.org'),
    wikiBaseUrl: cfg.get<string>('wikiBaseUrl', 'https://wiki.openstreetmap.org/wiki'),
    tagLinks: cfg.get<boolean>('tagLinks', true),
  };
}

// Language for taginfo descriptions: the setting if set, else the VS Code UI
// language ("uk", "en-us" -> "en").
function taginfoLang(): string {
  const configured = config().get<string>('taginfo.lang', '');
  return (configured || vscode.env.language).split('-')[0].toLowerCase();
}

function hoverOptions(): HoverOptions {
  const cfg = config();
  return {
    lang: taginfoLang(),
    wikiBaseUrl: cfg.get<string>('wikiBaseUrl', 'https://wiki.openstreetmap.org/wiki'),
    taginfoBaseUrl: cfg.get<string>('taginfo.url', 'https://taginfo.openstreetmap.org'),
  };
}

// Wiki links are returned without a target and resolved on click: taginfo
// tells whether a wiki page exists (and in which languages), so the click can
// go to the localized page, or to the taginfo page when there is none. Object
// and map links have static targets.
//
// VS Code recomputes links a moment after each edit, so a click right after
// typing can hit a link computed for the previous text. The link therefore
// remembers only where it is; the key and value are re-read from the document
// at click time.
class WikiLink extends vscode.DocumentLink {
  constructor(range: vscode.Range, public uri: vscode.Uri, public fallback: string, public onValue: boolean) {
    super(range);
  }
}

class Level0LinkProvider implements vscode.DocumentLinkProvider {
  constructor(private taginfo: () => TaginfoClient, private log: vscode.OutputChannel) {}

  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const lazy = config().get<boolean>('taginfo.enabled', true);
    return extractLinks(document.getText(), linkOptions()).map((l) => {
      const range = new vscode.Range(l.line, l.start, l.line, l.end);
      const link =
        lazy && l.wiki
          ? new WikiLink(range, document.uri, l.url, l.wiki.value !== undefined)
          : new vscode.DocumentLink(range, vscode.Uri.parse(l.url));
      link.tooltip = l.tooltip;
      return link;
    });
  }

  async resolveDocumentLink(link: vscode.DocumentLink): Promise<vscode.DocumentLink> {
    if (!(link instanceof WikiLink)) {
      return link;
    }
    try {
      const current = this.currentTag(link);
      link.target = vscode.Uri.parse(
        current ? await this.resolveTarget(current.key, current.value) : link.fallback
      );
    } catch (err) {
      this.log.appendLine(`link resolve failed: ${err instanceof Error ? err.message : String(err)}`);
      link.target = vscode.Uri.parse(link.fallback);
    }
    return link;
  }

  // Key and value as they are in the document now, not as they were when the
  // link was computed. A value link whose value is no longer an enumerated
  // value degrades to a key link.
  private currentTag(link: WikiLink): { key: string; value?: string } | undefined {
    const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === link.uri.toString());
    if (!document || link.range.start.line >= document.lineCount) {
      return undefined;
    }
    const tag = parseTagLine(document.lineAt(link.range.start.line).text);
    if (!tag) {
      return undefined;
    }
    return link.onValue && isEnumValue(tag.value) ? { key: tag.key, value: tag.value } : { key: tag.key };
  }

  private async resolveTarget(key: string, value?: string): Promise<string> {
    const client = this.taginfo();
    const opts = hoverOptions();
    const pages = value === undefined ? await client.keyWikiPages(key) : await client.tagWikiPages(key, value);
    const { page } = pickWikiPage(pages, opts.lang);
    if (page) {
      return `${opts.wikiBaseUrl.replace(/\/+$/, '')}/${wikiTitle(page.title)}`;
    }
    const taginfo = opts.taginfoBaseUrl.replace(/\/+$/, '');
    return value === undefined
      ? `${taginfo}/keys/${encodeURIComponent(key)}`
      : `${taginfo}/tags/${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

class Level0HoverProvider implements vscode.HoverProvider {
  constructor(private taginfo: () => TaginfoClient, private log: vscode.OutputChannel) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    if (!config().get<boolean>('taginfo.enabled', true)) {
      return undefined;
    }
    const line = document.lineAt(position.line).text;
    const tag = parseTagLine(line);
    if (!tag) {
      return undefined;
    }
    const lines = document.getText().split(/\r?\n/);
    const entity = enclosingEntity(lines, position.line);
    if (!entity || entity === 'changeset') {
      return undefined;
    }

    const col = position.character;
    const onKey = col >= tag.keyStart && col <= tag.keyEnd;
    const onValue = tag.value !== '' && col >= tag.valueStart && col <= tag.valueEnd;
    if (!onKey && !onValue) {
      return undefined;
    }

    const asTag = onValue && isEnumValue(tag.value) && !isIdentifierKey(tag.key);
    const range = asTag
      ? new vscode.Range(position.line, tag.valueStart, position.line, tag.valueEnd)
      : new vscode.Range(position.line, tag.keyStart, position.line, tag.keyEnd);

    try {
      const markdown = asTag ? await this.tagHover(tag.key, tag.value) : await this.keyHover(tag.key);
      const md = new vscode.MarkdownString(markdown);
      md.supportThemeIcons = false;
      return new vscode.Hover(md, range);
    } catch (err) {
      this.log.appendLine(`hover failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  private async keyHover(key: string): Promise<string> {
    const client = this.taginfo();
    const opts = hoverOptions();
    const [overview, pages] = await Promise.all([client.keyOverview(key), client.keyWikiPages(key)]);
    if (totalCount(overview.counts) === 0 && pages.length === 0) {
      return buildUnknownHover(key, undefined, opts);
    }
    return buildKeyHover(overview, pages, opts);
  }

  private async tagHover(key: string, value: string): Promise<string> {
    const client = this.taginfo();
    const opts = hoverOptions();
    const [overview, pages] = await Promise.all([client.tagOverview(key, value), client.tagWikiPages(key, value)]);
    if (totalCount(overview.counts) === 0 && pages.length === 0) {
      return buildUnknownHover(key, value, opts);
    }
    return buildTagHover(overview, pages, opts);
  }
}

const SEVERITY: Record<Diagnostic['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
};

function toVscode(d: Diagnostic, source: string): vscode.Diagnostic {
  const out = new vscode.Diagnostic(new vscode.Range(d.line, d.start, d.line, d.end), d.message, SEVERITY[d.severity]);
  out.source = source;
  return out;
}

// Parser diagnostics are published immediately on every change; taginfo
// checks follow after a pause in typing and are dropped if the document
// changed meanwhile.
class Level0Diagnostics {
  private collection = vscode.languages.createDiagnosticCollection('level0l');
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private taginfo: () => TaginfoClient, private log: vscode.OutputChannel) {}

  dispose(): void {
    this.collection.dispose();
    this.timers.forEach(clearTimeout);
  }

  clear(document: vscode.TextDocument): void {
    this.collection.delete(document.uri);
  }

  refresh(document: vscode.TextDocument): void {
    if (document.languageId !== 'level0l') {
      return;
    }
    const { entities, diagnostics } = parse(document.getText());
    const base = diagnostics.map((d) => toVscode(d, 'level0'));
    this.collection.set(document.uri, base);

    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    if (!config().get<boolean>('taginfo.enabled', true) || !config().get<boolean>('taginfo.diagnostics', true)) {
      return;
    }
    const version = document.version;
    this.timers.set(
      key,
      setTimeout(async () => {
        try {
          const found = await checkTags(entities, this.taginfo(), { lang: taginfoLang() });
          if (document.version === version) {
            this.collection.set(document.uri, [...base, ...found.map((d) => toVscode(d, 'taginfo'))]);
          }
        } catch (err) {
          this.log.appendLine(`tag check failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }, 700)
    );
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Level0L');
  const version = context.extension.packageJSON.version as string;
  const repo = context.extension.packageJSON.repository?.url as string | undefined;

  // The client is recreated when the taginfo URL changes so the cache follows
  // the instance it was filled from.
  let client: TaginfoClient | undefined;
  let clientUrl = '';
  const taginfo = () => {
    const url = config().get<string>('taginfo.url', 'https://taginfo.openstreetmap.org');
    if (!client || url !== clientUrl) {
      clientUrl = url;
      client = new TaginfoClient({
        baseUrl: url,
        userAgent: `level0-vscode/${version}${repo ? ` (${repo})` : ''}`,
      });
    }
    return client;
  };

  const selector: vscode.DocumentSelector = { language: 'level0l' };
  const diagnostics = new Level0Diagnostics(taginfo, log);
  context.subscriptions.push(
    log,
    diagnostics,
    vscode.languages.registerDocumentLinkProvider(selector, new Level0LinkProvider(taginfo, log)),
    vscode.languages.registerHoverProvider(selector, new Level0HoverProvider(taginfo, log)),
    vscode.workspace.onDidOpenTextDocument((d) => diagnostics.refresh(d)),
    vscode.workspace.onDidChangeTextDocument((e) => diagnostics.refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => diagnostics.clear(d)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('level0l')) {
        vscode.workspace.textDocuments.forEach((d) => diagnostics.refresh(d));
      }
    })
  );
  vscode.workspace.textDocuments.forEach((d) => diagnostics.refresh(d));
}

export function deactivate(): void {}
