// One HTTP request function on top of node:https, used for the OSM API,
// OAuth and Overpass. The built-in fetch gives up after 10 seconds of
// connecting, which the development server's slow TLS handshake exceeds,
// and reports nothing but "fetch failed". Pure module, no vscode API.

import * as http from 'node:http';
import * as https from 'node:https';

export interface Response {
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

const MAX_REDIRECTS = 3;
const RETRIES = 2;
const RETRY_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE']);

// GET requests are repeated after a network failure, since nothing happened
// on the server; other methods are not, a second PUT could create a second
// changeset.
export async function request(url: string, opts: RequestOptions = {}): Promise<Response> {
  const attempts = (opts.method ?? 'GET') === 'GET' ? RETRIES + 1 : 1;
  for (let i = 1; ; i++) {
    try {
      return await requestOnce(url, opts);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (i >= attempts || !code || !RETRY_CODES.has(code)) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

function requestOnce(url: string, opts: RequestOptions, redirects = 0): Promise<Response> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) {
      headers['Content-Length'] = String(Buffer.byteLength(opts.body));
    }
    const req = lib.request(u, { method: opts.method ?? 'GET', headers }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location && redirects < MAX_REDIRECTS && (opts.method ?? 'GET') === 'GET') {
        res.resume();
        resolve(requestOnce(new URL(location, u).toString(), opts, redirects + 1));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status, statusText: res.statusMessage ?? '', headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    const timeout = opts.timeoutMs ?? 180000;
    const timer = setTimeout(() => req.destroy(new Error(`no answer from ${u.host} in ${Math.round(timeout / 1000)} s`)), timeout);
    req.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(`${u.host}: ${err.code ?? err.message}`), { code: err.code }));
    });
    req.on('close', () => clearTimeout(timer));
    req.end(opts.body);
  });
}
