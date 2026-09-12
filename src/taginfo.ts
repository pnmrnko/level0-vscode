// Minimal client for the taginfo API v4 (https://taginfo.openstreetmap.org/taginfo/apidoc).
// Only the endpoints and fields the extension uses are typed. Responses are
// cached in memory for a day since taginfo itself updates once a day.

export interface TaginfoOptions {
  baseUrl: string;
  userAgent: string;
  timeoutMs?: number;
  // Maximum requests in flight at once; the rest wait in a queue.
  concurrency?: number;
}

export interface Counts {
  type: 'all' | 'nodes' | 'ways' | 'relations';
  count: number;
  count_fraction: number;
  values?: number;
}

export interface PrevalentValue {
  value: string;
  count: number;
  fraction: number;
}

export interface KeyOverview {
  key: string;
  counts: Counts[];
  projects: number;
  users: number;
  prevalent_values: PrevalentValue[];
}

export interface TagOverview {
  key: string;
  value: string;
  counts: Counts[];
  projects: number;
  description: Record<string, { text: string; dir: string }>;
}

export interface WikiPage {
  lang: string;
  title: string;
  description: string;
  status: string | null;
  on_node: boolean;
  on_way: boolean;
  on_area: boolean;
  on_relation: boolean;
  tags_implies: string[];
  tags_combination: string[];
  tags_linked: string[];
}

interface Envelope<T> {
  url: string;
  data_until: string;
  total: number;
  data: T;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class TaginfoClient {
  private cache = new Map<string, { expires: number; value: Promise<unknown> }>();
  private inFlight = 0;
  private queue: (() => void)[] = [];

  constructor(private opts: TaginfoOptions) {}

  keyOverview(key: string): Promise<KeyOverview> {
    return this.get<KeyOverview>('key/overview', { key });
  }

  keyWikiPages(key: string): Promise<WikiPage[]> {
    return this.get<WikiPage[]>('key/wiki_pages', { key });
  }

  tagOverview(key: string, value: string): Promise<TagOverview> {
    return this.get<TagOverview>('tag/overview', { key, value });
  }

  tagWikiPages(key: string, value: string): Promise<WikiPage[]> {
    return this.get<WikiPage[]>('tag/wiki_pages', { key, value });
  }

  private get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${this.opts.baseUrl.replace(/\/+$/, '')}/api/4/${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    const cacheKey = url.toString();

    const hit = this.cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) {
      return hit.value as Promise<T>;
    }

    const value = this.fetchJson<T>(url).catch((err) => {
      // Do not cache failures so the next hover retries.
      this.cache.delete(cacheKey);
      throw err;
    });
    this.cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
    return value;
  }

  private async fetchJson<T>(url: URL): Promise<T> {
    await this.acquire();
    try {
      return await this.fetchJsonNow<T>(url);
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    const limit = this.opts.concurrency ?? 4;
    if (this.inFlight < limit) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(() => { this.inFlight++; resolve(); }));
  }

  private release(): void {
    this.inFlight--;
    this.queue.shift()?.();
  }

  private async fetchJsonNow<T>(url: URL): Promise<T> {
    const res = await fetch(url, {
      headers: { 'User-Agent': this.opts.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
    });
    if (!res.ok) {
      throw new Error(`taginfo ${url.pathname}: HTTP ${res.status}`);
    }
    const body = (await res.json()) as Envelope<T> | { error: string };
    if ('error' in body) {
      throw new Error(`taginfo ${url.pathname}: ${body.error}`);
    }
    return body.data;
  }
}

// Picks the wiki page in the preferred language, falling back to English and
// then to whatever is first. Status and on_* flags are taken from the English
// page when present since it is the one the community maintains.
export function pickWikiPage(pages: WikiPage[], lang: string): { page?: WikiPage; en?: WikiPage } {
  const en = pages.find((p) => p.lang === 'en');
  const page = pages.find((p) => p.lang === lang) ?? en ?? pages[0];
  return { page, en };
}
