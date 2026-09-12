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

// A query rather than a URL or object list: has an "out" statement.
export function isOverpassQuery(s: string): boolean {
  return !/^https?:\/\//i.test(s.trim()) && /\bout\b[^;]*;/.test(s);
}

export function formatBbox(b: Bbox): string {
  return [b.south, b.west, b.north, b.east].map((n) => n.toFixed(7).replace(/\.?0+$/, '')).join(',');
}

// Prepares a query for the server. The only turbo shortcut understood is
// {{bbox}}, which becomes "south,west,north,east" as in overpass turbo. The
// output format must be XML since that is what the reader parses.
export function prepareQuery(query: string, bbox?: Bbox): { query: string } | { error: string } {
  const q = query.trim();
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
      return { error: 'No bounding box for {{bbox}}: open a Level0L document with nodes next to the query, or write the coordinates' };
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
    return unescapeXml(remark[1].trim());
  }
  if (status >= 400) {
    const lines = [...body.matchAll(/<p><strong[^>]*>Error<\/strong>:([\s\S]*?)<\/p>/g)].map((m) => unescapeXml(m[1].replace(/<[^>]+>/g, '').trim()));
    if (lines.length) {
      return lines.join('; ');
    }
    if (status === 429) {
      return 'Too many requests: the server asks to wait before the next query';
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
