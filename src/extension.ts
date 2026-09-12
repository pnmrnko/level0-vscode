import * as vscode from 'vscode';
import { buildKeyHover, buildTagHover, buildUnknownHover, totalCount, HoverOptions } from './hover';
import { MEMBER_RE, conflictSpans, deletedSpans, enclosingEntity, parseTagLine } from './lines';
import { extractLinks, isEnumValue, wikiTitle, LinkOptions } from './links';
import { Diagnostic, parse } from './parser';
import { Index } from './refs';
import { bodyEnd, foldingRanges, summarize } from './symbols';
import { completionContext, MemberType } from './completion';
import { checkTags } from './tagcheck';
import { pickWikiPage, TaginfoClient } from './taginfo';
import { isIdentifierKey } from './valuelinks';
import { downloadCommand, overpassCommand } from './download';
import { OsmClient } from './osm/client';
import { checkConflictsCommand, showOscCommand } from './changes';
import { AccountStatus, Auth, accountCommand, loginCommand, logoutCommand } from './auth';
import { uploadCommand } from './upload';

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
    descriptionInDiagnostics: cfg.get<boolean>('taginfo.diagnostics', true),
  };
}

// The editor's link opener hands only http, https and mailto to the system;
// tel: or viber: would be opened as an editor resource and fail. Such links go
// through a command that calls env.openExternal, which passes any scheme on.
const OPEN_EXTERNAL = 'level0l.openExternal';

function linkTarget(url: string): vscode.Uri {
  if (/^(https?|mailto):/i.test(url)) {
    return vscode.Uri.parse(url);
  }
  return vscode.Uri.parse(`command:${OPEN_EXTERNAL}?${encodeURIComponent(JSON.stringify([url]))}`);
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
    const definedIds = new Set(
      parse(document.getText())
        .entities.filter((e) => e.type !== 'changeset' && e.idStart !== undefined)
        .map((e) => `${e.type}/${e.id}`)
    );
    return extractLinks(document.getText(), { ...linkOptions(), definedIds }).map((l) => {
      const range = new vscode.Range(l.line, l.start, l.line, l.end);
      const link =
        lazy && l.wiki
          ? new WikiLink(range, document.uri, l.url, l.wiki.value !== undefined)
          : new vscode.DocumentLink(range, linkTarget(l.url));
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

// Definition and references for object ids: "nd 123" in a way points at the
// "node 123" header of the same document. The index is rebuilt per
// document version, which is cheap for files of this size.
class Level0References implements vscode.DefinitionProvider, vscode.ReferenceProvider {
  private cache?: { uri: string; version: number; index: Index };

  private index(document: vscode.TextDocument): Index {
    const uri = document.uri.toString();
    if (!this.cache || this.cache.uri !== uri || this.cache.version !== document.version) {
      this.cache = { uri, version: document.version, index: new Index(parse(document.getText())) };
    }
    return this.cache.index;
  }

  private toRange(l: { line: number; start: number; end: number }): vscode.Range {
    return new vscode.Range(l.line, l.start, l.line, l.end);
  }

  provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Definition | undefined {
    const index = this.index(document);
    const symbol = index.symbolAt(position.line, position.character);
    if (!symbol || symbol.isDefinition) {
      return undefined;
    }
    const def = index.definition(symbol.type, symbol.id);
    return def ? new vscode.Location(document.uri, this.toRange(def)) : undefined;
  }

  provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext
  ): vscode.Location[] | undefined {
    const index = this.index(document);
    const symbol = index.symbolAt(position.line, position.character);
    if (!symbol) {
      return undefined;
    }
    const locations = context.includeDeclaration
      ? index.occurrences(symbol.type, symbol.id)
      : index.referencesTo(symbol.type, symbol.id);
    return locations.map((l) => new vscode.Location(document.uri, this.toRange(l)));
  }

}

// Keys with more distinct values than this are free text; no value list.
const ENUMERATED_KEY_MAX_VALUES = 20000;

const CHANGESET_KEYS: [string, string][] = [
  ['comment', 'What was changed and why. Required by Level0.'],
  ['source', 'Where the information comes from: survey, local knowledge, an imagery name.'],
  ['created_by', 'Editor that made the changeset; Level0 fills it in.'],
  ['hashtags', 'Semicolon separated #hashtags for finding the changeset later.'],
  ['review_requested', 'yes: ask other mappers to review this changeset.'],
  ['bot', 'yes: the edit was made by an automated process.'],
  ['import', 'yes: the changeset is part of an import.'],
];

const HEADER_SNIPPETS: [string, string, string][] = [
  ['node', 'node -${1:1}: ${2:50.4501}, ${3:30.5234}\n  ${4:amenity} = ${5:cafe}', 'New node with coordinates and a tag'],
  ['way', 'way -${1:1}\n  ${2:highway} = ${3:footway}\n  nd ${4:-1}\n  nd ${5:-2}', 'New way with a tag and two nodes'],
  ['relation', 'relation -${1:1}\n  type = ${2:multipolygon}\n  wy ${3:-1} ${4:outer}', 'New relation with a type and a member'],
  ['changeset', 'changeset\n  comment = ${1}\n  source = ${2:survey}', 'Changeset metadata'],
];

function count(n: number, lang: string): string {
  return new Intl.NumberFormat(lang, { notation: 'compact' }).format(n);
}

// Completion of header keywords, tag keys, tag values, member ids and roles.
// Keys and values come from taginfo, member ids from the document itself.
class Level0Completion implements vscode.CompletionItemProvider {
  constructor(private taginfo: () => TaginfoClient, private log: vscode.OutputChannel) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionList | undefined> {
    const lines = document.getText().split(/\r?\n/);
    const ctx = completionContext(lines, position.line, position.character);
    if (!ctx) {
      return undefined;
    }
    const range = new vscode.Range(position.line, ctx.start, position.line, position.character);
    const online = config().get<boolean>('taginfo.enabled', true);
    try {
      switch (ctx.kind) {
        case 'header':
          return new vscode.CompletionList(this.headers(range));
        case 'key':
          return ctx.entity === 'changeset'
            ? new vscode.CompletionList(this.changesetKeys(range))
            : new vscode.CompletionList(await this.keys(document, ctx.partial, range, online), online);
        case 'value':
          return online && !isIdentifierKey(ctx.key)
            ? new vscode.CompletionList(await this.values(ctx.key, ctx.partial, range), true)
            : undefined;
        case 'member-id':
          return new vscode.CompletionList(this.memberIds(document, ctx.memberType, range));
        case 'role':
          return online && ctx.relationType
            ? new vscode.CompletionList(await this.roles(ctx.relationType, ctx.memberType, range))
            : undefined;
      }
    } catch (err) {
      this.log.appendLine(`completion failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  private headers(range: vscode.Range): vscode.CompletionItem[] {
    return HEADER_SNIPPETS.map(([label, snippet, doc], i) => {
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
      item.insertText = new vscode.SnippetString(snippet);
      item.documentation = doc;
      item.range = range;
      item.sortText = String(i);
      return item;
    });
  }

  private changesetKeys(range: vscode.Range): vscode.CompletionItem[] {
    return CHANGESET_KEYS.map(([key, doc], i) => this.keyItem(key, doc, range, String(i)));
  }

  private keyItem(key: string, doc: string, range: vscode.Range, sortText: string): vscode.CompletionItem {
    const item = new vscode.CompletionItem(key, vscode.CompletionItemKind.Property);
    item.insertText = `${key} = `;
    item.documentation = doc;
    item.range = range;
    item.sortText = sortText;
    // Go straight on to the value list.
    item.command = { command: 'editor.action.triggerSuggest', title: 'Suggest values' };
    return item;
  }

  private async keys(document: vscode.TextDocument, partial: string, range: vscode.Range, online: boolean) {
    const lang = taginfoLang();
    const items: vscode.CompletionItem[] = [];
    const seen = new Set<string>();

    // Keys already used in this file come first: they are the local vocabulary.
    const { entities } = parse(document.getText());
    for (const e of entities) {
      if (e.type === 'changeset') {
        continue;
      }
      for (const t of e.tags) {
        if (!seen.has(t.key)) {
          seen.add(t.key);
          items.push(this.keyItem(t.key, 'Used in this file', range, `0${String(items.length).padStart(4, '0')}`));
        }
      }
    }

    if (online) {
      const keys = await this.taginfo().keys(partial);
      keys.forEach((k, i) => {
        if (seen.has(k.key)) {
          return;
        }
        const item = this.keyItem(k.key, k.in_wiki ? 'Documented on the wiki' : 'Not documented on the wiki', range, `1${String(i).padStart(4, '0')}`);
        item.detail = `${count(k.count_all, lang)} uses`;
        items.push(item);
      });
    }
    return items;
  }

  private async values(key: string, partial: string, range: vscode.Range): Promise<vscode.CompletionItem[]> {
    const client = this.taginfo();
    const lang = taginfoLang();
    const overview = await client.keyOverview(key);
    const distinct = overview.counts.find((c) => c.type === 'all')?.values ?? 0;
    if (distinct === 0 || distinct > ENUMERATED_KEY_MAX_VALUES) {
      return [];
    }
    const lists = await Promise.all([
      client.keyValues(key, lang),
      partial.length >= 2 ? client.keyValues(key, lang, partial) : Promise.resolve([]),
    ]);
    const seen = new Set<string>();
    const items: vscode.CompletionItem[] = [];
    for (const v of [...lists[0], ...lists[1]]) {
      if (seen.has(v.value)) {
        continue;
      }
      seen.add(v.value);
      const item = new vscode.CompletionItem(v.value, vscode.CompletionItemKind.EnumMember);
      item.detail = `${Math.round(v.fraction * 100)}% · ${count(v.count, lang)}`;
      if (v.description) {
        item.documentation = v.description;
      }
      item.range = range;
      item.sortText = String(items.length).padStart(4, '0');
      items.push(item);
    }
    return items;
  }

  private memberIds(document: vscode.TextDocument, type: string, range: vscode.Range): vscode.CompletionItem[] {
    const { entities } = parse(document.getText());
    return entities
      .filter((e) => e.type === type && e.idStart !== undefined)
      .map((e, i) => {
        const item = new vscode.CompletionItem(e.id, vscode.CompletionItemKind.Reference);
        item.detail = summarize(e).detail;
        item.range = range;
        item.sortText = String(i).padStart(4, '0');
        return item;
      });
  }

  private async roles(rtype: string, memberType: MemberType, range: vscode.Range): Promise<vscode.CompletionItem[]> {
    const lang = taginfoLang();
    const roles = await this.taginfo().relationRoles(rtype);
    const field = `count_${memberType}_members` as const;
    return roles
      .filter((r) => r.role !== '' && r[field] > 0)
      .map((r, i) => {
        const item = new vscode.CompletionItem(r.role, vscode.CompletionItemKind.Value);
        item.detail = `${count(r[field], lang)} ${memberType} members`;
        item.range = range;
        item.sortText = String(i).padStart(4, '0');
        return item;
      });
  }
}

const SYMBOL_KIND: Record<string, vscode.SymbolKind> = {
  changeset: vscode.SymbolKind.Package,
  node: vscode.SymbolKind.Variable,
  way: vscode.SymbolKind.Array,
  relation: vscode.SymbolKind.Struct,
};

// Outline: one symbol per entity with tags and members as children; deleted
// objects are struck through. Folding: one range per entity body and per
// block of comment lines.
class Level0Structure implements vscode.DocumentSymbolProvider, vscode.FoldingRangeProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const { entities } = parse(document.getText());
    return entities.map((e) => {
      const { name, detail } = summarize(e);
      const header = document.lineAt(e.line);
      const range = new vscode.Range(e.line, 0, bodyEnd(e), document.lineAt(bodyEnd(e)).text.length);
      const selection = e.idStart !== undefined ? new vscode.Range(e.line, e.idStart, e.line, e.idEnd!) : header.range;
      const symbol = new vscode.DocumentSymbol(name, detail, SYMBOL_KIND[e.type], range, selection);
      if (e.deleted) {
        symbol.tags = [vscode.SymbolTag.Deprecated];
      }
      symbol.children = [
        ...e.tags.map((t) => {
          const r = new vscode.Range(t.line, t.keyStart, t.line, t.valueEnd);
          return new vscode.DocumentSymbol(`${t.key} = ${t.value}`, '', vscode.SymbolKind.Property, r, r);
        }),
        ...e.members.map((m) => {
          const line = document.lineAt(m.line);
          const r = new vscode.Range(m.line, m.start, m.line, line.text.length);
          const kind = m.type === 'node' ? 'nd' : m.type === 'way' ? 'wy' : 'rel';
          return new vscode.DocumentSymbol(`${kind} ${m.id}`, m.role, vscode.SymbolKind.Constant, r, r);
        }),
      ];
      return symbol;
    });
  }

  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const text = document.getText();
    return foldingRanges(text, parse(text)).map(
      (f) =>
        new vscode.FoldingRange(
          f.startLine,
          f.endLine,
          f.kind === 'comment' ? vscode.FoldingRangeKind.Comment : undefined
        )
    );
  }
}

const SEVERITY: Record<Diagnostic['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

// Removes the " #comment" JOSM comfort0 appends to member lines, which Level0
// would take as the role. Header comments are kept, Level0 accepts them.
async function stripMemberComments(editor: vscode.TextEditor): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  for (let i = 0; i < editor.document.lineCount; i++) {
    const line = editor.document.lineAt(i);
    const m = MEMBER_RE.exec(line.text);
    if (m && m[4]) {
      const start = line.text.lastIndexOf(m[4]);
      const cut = line.text.slice(0, start).replace(/\s+$/, '').length;
      edit.delete(editor.document.uri, new vscode.Range(i, cut, i, line.text.length));
    }
  }
  await vscode.workspace.applyEdit(edit);
}

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

// Bodies of objects marked for deletion are drawn at reduced opacity: Level0
// ignores their tags and members, only the header counts.
const deletedDecoration = vscode.window.createTextEditorDecorationType({ isWholeLine: true, opacity: '0.55' });

// A conflict written by Level0 looks like a merge conflict: the comment block
// with the user's edits and the "!" entity with the server version get the
// backgrounds VS Code uses for the current and incoming sides of a git
// conflict, so every theme has colors for them.
const currentDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('merge.currentContentBackground'),
});
const incomingDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('merge.incomingContentBackground'),
});

function decorate(editor: vscode.TextEditor | undefined): void {
  if (!editor || editor.document.languageId !== 'level0l') {
    return;
  }
  const text = editor.document.getText();
  const conflicts = conflictSpans(text);
  const lineRange = (r: { startLine: number; endLine: number }) => new vscode.Range(r.startLine, 0, r.endLine, 0);
  editor.setDecorations(deletedDecoration, deletedSpans(text).map(lineRange));
  editor.setDecorations(currentDecoration, conflicts.filter((c) => c.current).map((c) => lineRange(c.current!)));
  editor.setDecorations(incomingDecoration, conflicts.map((c) => lineRange(c.incoming)));
}

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Level0L');
  const version = context.extension.packageJSON.version as string;
  const repo = context.extension.packageJSON.repository?.url as string | undefined;
  const userAgent = `level0-vscode/${version}${repo ? ` (${repo})` : ''}`;

  // The client is recreated when the taginfo URL changes so the cache follows
  // the instance it was filled from.
  let client: TaginfoClient | undefined;
  let clientUrl = '';
  const taginfo = () => {
    const url = config().get<string>('taginfo.url', 'https://taginfo.openstreetmap.org');
    if (!client || url !== clientUrl) {
      clientUrl = url;
      client = new TaginfoClient({ baseUrl: url, userAgent });
    }
    return client;
  };

  const auth = new Auth(context, userAgent, log);
  const apiBase = () => config().get<string>('osmApiUrl', 'https://api.openstreetmap.org/api/0.6/').replace(/\/?$/, '/');
  const osm = new OsmClient({ userAgent, token: () => auth.token(apiBase()) });
  const status = new AccountStatus(auth, apiBase);
  const downloadOptions = () => ({
    apiBase: apiBase(),
    overpassUrl: config().get<string>('overpassUrl', 'https://overpass-api.de/api/interpreter'),
    maxObjects: config().get<number>('maxObjects', 500),
    state: context.globalState,
  });

  const changesOptions = () => ({
    apiBase: apiBase(),
    generator: `level0-vscode ${version}`,
    clientId: config().get<string>('oauth.clientId', ''),
  });

  const selector: vscode.DocumentSelector = { language: 'level0l' };
  const diagnostics = new Level0Diagnostics(taginfo, log);
  const references = new Level0References();
  const structure = new Level0Structure();
  context.subscriptions.push(
    log,
    diagnostics,
    vscode.commands.registerCommand(OPEN_EXTERNAL, (url: string) => vscode.env.openExternal(vscode.Uri.parse(url))),
    vscode.commands.registerTextEditorCommand('level0l.stripMemberComments', stripMemberComments),
    vscode.commands.registerCommand('level0l.download', () => downloadCommand(osm, downloadOptions(), log)),
    vscode.commands.registerCommand('level0l.runOverpass', () => overpassCommand(osm, downloadOptions(), log)),
    vscode.commands.registerCommand('level0l.checkConflicts', () => checkConflictsCommand(osm, changesOptions(), log)),
    vscode.commands.registerCommand('level0l.showOsc', () => showOscCommand(osm, changesOptions(), log)),
    vscode.commands.registerCommand('level0l.login', () => loginCommand(auth, apiBase(), changesOptions().clientId)),
    vscode.commands.registerCommand('level0l.logout', () => logoutCommand(auth, apiBase())),
    vscode.commands.registerCommand('level0l.upload', () => uploadCommand(osm, auth, changesOptions(), log)),
    vscode.commands.registerCommand('level0l.account', () => accountCommand(auth, apiBase(), changesOptions().clientId)),
    vscode.window.registerUriHandler(auth),
    status,
    auth.onDidChange(() => status.refresh()),
    vscode.window.onDidChangeActiveTextEditor(() => status.refresh()),
    vscode.languages.registerDocumentLinkProvider(selector, new Level0LinkProvider(taginfo, log)),
    vscode.languages.registerHoverProvider(selector, new Level0HoverProvider(taginfo, log)),
    vscode.languages.registerDefinitionProvider(selector, references),
    vscode.languages.registerReferenceProvider(selector, references),
    vscode.languages.registerDocumentSymbolProvider(selector, structure),
    vscode.languages.registerCompletionItemProvider(selector, new Level0Completion(taginfo, log), '=', ' ', ';'),
    vscode.languages.registerFoldingRangeProvider(selector, structure),
    deletedDecoration,
    currentDecoration,
    incomingDecoration,
    vscode.workspace.onDidOpenTextDocument((d) => diagnostics.refresh(d)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      diagnostics.refresh(e.document);
      vscode.window.visibleTextEditors.filter((ed) => ed.document === e.document).forEach(decorate);
    }),
    vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach(decorate)),
    vscode.workspace.onDidCloseTextDocument((d) => diagnostics.clear(d)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('level0l')) {
        vscode.workspace.textDocuments.forEach((d) => diagnostics.refresh(d));
        status.refresh();
      }
    })
  );
  vscode.workspace.textDocuments.forEach((d) => diagnostics.refresh(d));
  vscode.window.visibleTextEditors.forEach(decorate);
  status.refresh();
}

export function deactivate(): void {}
