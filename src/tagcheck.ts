// Taginfo-backed checks of the tags in a document. Pure module, no vscode API.
//
// What is checked and why:
// - Every key: a key with zero uses in OSM is almost certainly a typo, keys
//   are a small vocabulary. A key whose wiki page marks it deprecated or
//   obsolete gets a warning with the wiki's advice.
// - Values only when two conditions hold. The value must look like an
//   enumerated value (lowercase identifier), so names, numbers, URLs and
//   opening hours are never checked. And the key must be an enumerated key,
//   judged by how many distinct values taginfo knows for it: amenity has
//   about 10 thousand, surface 9 thousand, while name, ref, addr:street or
//   website have millions. Values of free-text keys cannot be validated.
// - A value that is among the key's prevalent values is known and needs no
//   further request. Others cost one request; a value with zero uses is
//   reported, a deprecated or obsolete tag gets the wiki's advice.
//
// Tags of deleted objects and of the changeset block are skipped, and so are
// values of identifier keys such as contact:* whose values are account names.

import { isEnumValue } from './links';
import { isIdentifierKey } from './valuelinks';
import { Diagnostic, Entity } from './parser';
import { KeyOverview, TaginfoClient, WikiPage } from './taginfo';

// Keys with more distinct values than this are treated as free text.
const ENUMERATED_KEY_MAX_VALUES = 20000;

const BAD_STATUS = /^(deprecated|obsolete|discardable)$/i;

export interface TagCheckOptions {
  lang: string;
}

interface Target {
  key: string;
  value?: string;
  line: number;
  start: number;
  end: number;
}

function total(o: KeyOverview): number {
  return o.counts.find((c) => c.type === 'all')?.count ?? 0;
}

function distinctValues(o: KeyOverview): number {
  return o.counts.find((c) => c.type === 'all')?.values ?? 0;
}

function badStatus(pages: WikiPage[], lang: string): string | undefined {
  const en = pages.find((p) => p.lang === 'en');
  if (!en || !en.status || !BAD_STATUS.test(en.status)) {
    return undefined;
  }
  const local = pages.find((p) => p.lang === lang && p.description);
  const description = local?.description || en.description;
  return `${en.status}${description ? `: ${description}` : ''}`;
}

export async function checkTags(
  entities: Entity[],
  client: TaginfoClient,
  opts: TagCheckOptions
): Promise<Diagnostic[]> {
  const keys = new Map<string, Target[]>();
  const tags = new Map<string, Target[]>();

  for (const e of entities) {
    if (e.type === 'changeset' || e.deleted) {
      continue;
    }
    for (const t of e.tags) {
      push(keys, t.key, { key: t.key, line: t.line, start: t.keyStart, end: t.keyEnd });
      if (isEnumValue(t.value) && !isIdentifierKey(t.key)) {
        push(tags, `${t.key}=${t.value}`, { key: t.key, value: t.value, line: t.line, start: t.valueStart, end: t.valueEnd });
      }
    }
  }

  const diagnostics: Diagnostic[] = [];
  const overviews = new Map<string, KeyOverview>();

  await Promise.all(
    [...keys].map(async ([key, targets]) => {
      const [overview, pages] = await Promise.all([client.keyOverview(key), client.keyWikiPages(key)]);
      overviews.set(key, overview);
      const status = badStatus(pages, opts.lang);
      if (status) {
        warn(diagnostics, targets, `Key "${key}" is ${status}`);
      } else if (total(overview) === 0) {
        warn(diagnostics, targets, `Key "${key}" is not used in OSM, possibly a typo`);
      }
    })
  );

  await Promise.all(
    [...tags].map(async ([label, targets]) => {
      const { key, value } = targets[0];
      const overview = overviews.get(key);
      if (!overview || total(overview) === 0 || distinctValues(overview) > ENUMERATED_KEY_MAX_VALUES) {
        return;
      }
      if (overview.prevalent_values.some((v) => v.value === value)) {
        return;
      }
      // A fully retagged obsolete value also has zero uses, so the wiki status
      // is checked before calling it a typo.
      const [tag, pages] = await Promise.all([client.tagOverview(key, value!), client.tagWikiPages(key, value!)]);
      const status = badStatus(pages, opts.lang);
      if (status) {
        warn(diagnostics, targets, `Tag ${label} is ${status}`);
      } else if ((tag.counts.find((c) => c.type === 'all')?.count ?? 0) === 0) {
        warn(diagnostics, targets, `Value "${value}" is not used with key "${key}" in OSM, possibly a typo`);
      }
    })
  );

  return diagnostics;
}

function push(map: Map<string, Target[]>, k: string, t: Target): void {
  const list = map.get(k);
  if (list) {
    list.push(t);
  } else {
    map.set(k, [t]);
  }
}

function warn(out: Diagnostic[], targets: Target[], message: string): void {
  for (const t of targets) {
    out.push({ line: t.line, start: t.start, end: t.end, severity: 'warning', message });
  }
}
