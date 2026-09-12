// Overpass QL support: detecting a query, expanding what can be expanded of
// the overpass turbo shortcuts, and reading the server's answer. Pure
// module, no vscode API.

import { unescapeXml } from './xml';

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

// Removes // and /* */ comments, leaving quoted strings alone. Comments are
// meaningless to the server and must not take part in shortcut detection.
export function stripComments(query: string): string {
  let out = '';
  let i = 0;
  while (i < query.length) {
    const c = query[i];
    const next = query[i + 1];
    if (c === '"' || c === "'") {
      const end = query.indexOf(c, i + 1);
      const stop = end < 0 ? query.length : end + 1;
      out += query.slice(i, stop);
      i = stop;
    } else if (c === '/' && next === '/') {
      const end = query.indexOf('\n', i);
      i = end < 0 ? query.length : end;
    } else if (c === '/' && next === '*') {
      const end = query.indexOf('*/', i + 2);
      i = end < 0 ? query.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// A query rather than a URL or object list: has an "out" statement.
export function isOverpassQuery(s: string): boolean {
  return !/^https?:\/\//i.test(s.trim()) && /\bout\b[^;]*;/.test(s);
}

// "south,west,north,east" as typed by the user, or "lat, lon" for a small
// box around a point.
export function parseBbox(s: string, radius: number): Bbox | undefined {
  const n = s.trim().split(/\s*,\s*/).map(Number);
  if (n.some((x) => isNaN(x))) {
    return undefined;
  }
  if (n.length === 4 && n[0] < n[2] && n[1] < n[3]) {
    return { south: n[0], west: n[1], north: n[2], east: n[3] };
  }
  if (n.length === 2 && Math.abs(n[0]) <= 90 && Math.abs(n[1]) <= 180) {
    return { south: n[0] - radius, west: n[1] - radius, north: n[0] + radius, east: n[1] + radius };
  }
  return undefined;
}

export function hasBboxPlaceholder(query: string): boolean {
  return /\{\{\s*bbox\s*\}\}/.test(stripComments(query));
}

export function formatBbox(b: Bbox): string {
  return [b.south, b.west, b.north, b.east].map((n) => n.toFixed(7).replace(/\.?0+$/, '')).join(',');
}

// Prepares a query for the server. The only turbo shortcut understood is
// {{bbox}}, which becomes "south,west,north,east" as in overpass turbo. The
// output format must be XML since that is what the reader parses.
export function prepareQuery(query: string, bbox?: Bbox): { query: string } | { error: string } {
  const q = stripComments(query).trim();
  const format = /\[\s*out\s*:\s*(\w+)/.exec(q);
  if (format && format[1] !== 'xml') {
    return { error: `Only XML output can be read; remove [out:${format[1]}] from the query` };
  }
  const shortcuts = new Set([...q.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]));
  for (const s of shortcuts) {
    if (s !== 'bbox') {
      return { error: `The overpass turbo shortcut {{${s}}} is not supported here; write its value into the query` };
    }
  }
  if (shortcuts.has('bbox')) {
    if (!bbox) {
      return { error: 'No bounding box for {{bbox}}' };
    }
    return { query: q.replace(/\{\{\s*bbox\s*\}\}/g, formatBbox(bbox)) };
  }
  return { query: q };
}

// A runtime error arrives with HTTP 200 inside a remark element, a syntax
// error as an HTML page with HTTP 400; both are turned into one line.
export function overpassError(status: number, body: string): string | undefined {
  const remark = /<remark>([\s\S]*?)<\/remark>/.exec(body);
  if (remark) {
    const text = unescapeXml(remark[1].trim());
    // The dispatcher found no free slot to read the database.
    if (/Dispatcher_Client::request_read_and_idx::timeout|too busy/.test(text)) {
      return 'The Overpass server is busy; try again in a minute or set level0l.overpassUrl to another instance';
    }
    return text;
  }
  if (status >= 400) {
    const lines = [...body.matchAll(/<p><strong[^>]*>Error<\/strong>:([\s\S]*?)<\/p>/g)].map((m) => unescapeXml(m[1].replace(/<[^>]+>/g, '').trim()));
    if (lines.length) {
      return lines.join('; ');
    }
    if (status === 429 || status === 406) {
      return `HTTP ${status}: the server asks to wait 30 seconds before the next query`;
    }
    if (status === 504) {
      return 'Gateway timeout: the server is overloaded, try again later';
    }
    return `HTTP ${status}`;
  }
  return undefined;
}

// Whether the query asks for metadata; without it objects come without
// versions and cannot be uploaded.
export function hasMeta(query: string): boolean {
  return /\bout\b[^;]*\bmeta\b[^;]*;/.test(query);
}
