// HTTP access to the OSM API and other sources of OSM XML. Pure module, no
// vscode API; the token comes from a callback so it can live in the
// editor's secret storage.

export interface OsmClientOptions {
  userAgent: string;
  timeoutMs?: number;
  token?: () => Promise<string | undefined>;
}

export class OsmClient {
  constructor(private opts: OsmClientOptions) {}

  getXml(url: string): Promise<string> {
    return this.request('GET', url);
  }

  // Authenticated calls of the API: create, upload and close a changeset.
  put(url: string, body: string): Promise<string> {
    return this.request('PUT', url, body, true);
  }

  post(url: string, body: string): Promise<string> {
    return this.request('POST', url, body, true);
  }

  private async request(method: string, url: string, body?: string, auth = false): Promise<string> {
    const headers: Record<string, string> = { 'User-Agent': this.opts.userAgent, Accept: 'application/xml, text/xml' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/xml';
    }
    if (auth) {
      const token = await this.opts.token?.();
      if (!token) {
        throw new Error('not logged in');
      }
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 180000) });
    const text = await res.text();
    if (!res.ok) {
      // The API explains errors in the body or in this header, in plain text.
      const reason = res.headers.get('Error') ?? text.trim().split('\n')[0] ?? '';
      const where = url.replace(/^https?:\/\/[^/]+\/api\/0\.6\//, '');
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${where}${reason ? `: ${reason.slice(0, 300)}` : ''}`);
    }
    return text;
  }

  // Overpass takes the query as a form field and answers with OSM XML; the
  // caller inspects error status and body together since a failed query
  // is explained in the body.
  async postOverpass(url: string, query: string): Promise<{ status: number; body: string }> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': this.opts.userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 180000),
    });
    return { status: res.status, body: await res.text() };
  }
}
