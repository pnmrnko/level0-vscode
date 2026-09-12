// Builds Markdown hover text from taginfo data. Pure functions, no vscode API.

import { wikiTitle } from './links';
import { Counts, KeyOverview, TagOverview, WikiPage, pickWikiPage } from './taginfo';

export interface HoverOptions {
  lang: string;
  wikiBaseUrl: string;
  taginfoBaseUrl: string;
}

function fmt(n: number, lang: string): string {
  return new Intl.NumberFormat(lang).format(n);
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function countsLine(counts: Counts[], lang: string): string {
  const by = (t: Counts['type']) => counts.find((c) => c.type === t)?.count ?? 0;
  return `Uses: **${fmt(by('all'), lang)}** (nodes ${fmt(by('nodes'), lang)} · ways ${fmt(by('ways'), lang)} · relations ${fmt(by('relations'), lang)})`;
}

function appliesTo(page: WikiPage | undefined): string | undefined {
  if (!page) {
    return undefined;
  }
  const types = [
    page.on_node && 'node',
    page.on_way && 'way',
    page.on_area && 'area',
    page.on_relation && 'relation',
  ].filter(Boolean);
  return types.length ? `Applies to: ${types.join(', ')}` : undefined;
}

function statusBadge(page: WikiPage | undefined): string {
  const s = page?.status;
  if (!s) {
    return '';
  }
  const bad = /obsolete|deprecated|discardable|abandoned|rejected/i.test(s);
  return bad ? ` · ⚠️ **${s}**` : ` · _${s}_`;
}

function footer(wikiPath: string, taginfoPath: string, o: HoverOptions): string {
  const wiki = `${o.wikiBaseUrl.replace(/\/+$/, '')}/${wikiPath}`;
  const taginfo = `${o.taginfoBaseUrl.replace(/\/+$/, '')}/${taginfoPath}`;
  return `[Wiki](${wiki}) · [Taginfo](${taginfo})`;
}

export function buildKeyHover(overview: KeyOverview, pages: WikiPage[], o: HoverOptions): string {
  const { page, en } = pickWikiPage(pages, o.lang);
  const lines: string[] = [];

  lines.push(`**${overview.key}**${statusBadge(en ?? page)}`);
  if (page?.description) {
    lines.push('', page.description);
  }
  lines.push('', countsLine(overview.counts, o.lang));

  const nValues = overview.counts.find((c) => c.type === 'all')?.values;
  if (overview.prevalent_values.length) {
    const top = overview.prevalent_values
      .slice(0, 6)
      .map((v) => `\`${v.value}\` ${pct(v.fraction)}`)
      .join(', ');
    lines.push('', `Top values${nValues ? ` of ${fmt(nValues, o.lang)}` : ''}: ${top}`);
  }

  const applies = appliesTo(en ?? page);
  if (applies) {
    lines.push('', applies);
  }

  lines.push('', footer(`Key:${wikiTitle(overview.key)}`, `keys/${encodeURIComponent(overview.key)}`, o));
  return lines.join('\n');
}

export function buildTagHover(overview: TagOverview, pages: WikiPage[], o: HoverOptions): string {
  const { page, en } = pickWikiPage(pages, o.lang);
  const lines: string[] = [];
  const label = `${overview.key}=${overview.value}`;

  lines.push(`**${label}**${statusBadge(en ?? page)}`);

  const description = overview.description[o.lang]?.text ?? overview.description['en']?.text ?? page?.description;
  if (description) {
    lines.push('', description);
  }
  lines.push('', countsLine(overview.counts, o.lang));

  const applies = appliesTo(en ?? page);
  if (applies) {
    lines.push('', applies);
  }

  const combos = (en ?? page)?.tags_combination ?? [];
  if (combos.length) {
    lines.push('', `Often combined with: ${combos.slice(0, 8).map((t) => `\`${t}\``).join(', ')}`);
  }

  lines.push(
    '',
    footer(
      `Tag:${wikiTitle(overview.key)}=${wikiTitle(overview.value)}`,
      `tags/${encodeURIComponent(overview.key)}=${encodeURIComponent(overview.value)}`,
      o
    )
  );
  return lines.join('\n');
}

// Hover for a key or tag taginfo has never seen: likely a typo.
export function buildUnknownHover(key: string, value: string | undefined, o: HoverOptions): string {
  const label = value === undefined ? key : `${key}=${value}`;
  const wikiPath = value === undefined ? `Key:${wikiTitle(key)}` : `Tag:${wikiTitle(key)}=${wikiTitle(value)}`;
  const taginfoPath =
    value === undefined
      ? `keys/${encodeURIComponent(key)}`
      : `tags/${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  return `**${label}**\n\n⚠️ Not used anywhere in OSM according to taginfo — possibly a typo.\n\n${footer(wikiPath, taginfoPath, o)}`;
}

export function totalCount(counts: Counts[]): number {
  return counts.find((c) => c.type === 'all')?.count ?? 0;
}
