// HTTP access to the OSM API and other sources of OSM XML. Pure module, no
// vscode API; the token comes from a callback so it can live in the
// editor's secret storage.

import { request } from './http';

export interface OsmClientOptions {
  userAgent: string;
  timeoutMs?: number;
  token?: () => Promise<string | undefined>;
}

export class OsmClient {
  constructor(private opts: OsmClientOptions) {}

  getXml(url: string): Promise<string> {
    return this.call('GET', url);
  }

  // Authenticated calls of the API: create, upload and close a changeset.
  put(url: string, body: string): Promise<string> {
    return this.call('PUT', url, body, true);
  }

  post(url: string, body: string): Promise<string> {
    return this.call('POST', url, body, true);
  }

  private async call(method: string, url: string, body?: string, auth = false): Promise<string> {
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
    const res = await request(url, { method, headers, body, timeoutMs: this.opts.timeoutMs });
    if (res.status < 200 || res.status >= 300) {
      // The API explains errors in the body or in this header, in plain text.
      const reason = (res.headers.error as string | undefined) ?? res.body.trim().split('\n')[0] ?? '';
      const where = url.replace(/^https?:\/\/[^/]+\/api\/0\.6\//, '');
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${where}${reason ? `: ${reason.slice(0, 300)}` : ''}`);
    }
    return res.body;
  }

  // Overpass takes the query as a form field and answers with OSM XML; the
  // caller inspects error status and body together since a failed query
  // is explained in the body.
  async postOverpass(url: string, query: string): Promise<{ status: number; body: string }> {
    const res = await request(url, {
      method: 'POST',
      headers: { 'User-Agent': this.opts.userAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      timeoutMs: this.opts.timeoutMs,
    });
    return { status: res.status, body: res.body };
  }
}
