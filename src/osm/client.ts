// HTTP access to the OSM API and other sources of OSM XML. Authentication is
// added later for uploads. Pure module, no vscode API.

export interface OsmClientOptions {
  userAgent: string;
  timeoutMs?: number;
}

export class OsmClient {
  constructor(private opts: OsmClientOptions) {}

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

  async getXml(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': this.opts.userAgent, Accept: 'application/xml, text/xml' },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 180000),
    });
    const body = await res.text();
    if (!res.ok) {
      // The API explains errors in the body or in this header, in plain text.
      const reason = res.headers.get('Error') ?? body.trim().split('\n')[0] ?? '';
      const where = url.replace(/^https?:\/\/[^/]+\/api\/0\.6\//, '');
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${where}${reason ? `: ${reason.slice(0, 200)}` : ''}`);
    }
    return body;
  }
}
