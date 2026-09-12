// Map tiles fetched by the extension on behalf of the webview: tile servers
// expect an identifiable User-Agent or Referer, and the browser inside VS
// Code sends neither. Tiles are cached in memory. Pure module, no vscode
// API.

import { request } from './osm/http';

export interface Tile {
  z: number;
  x: number;
  y: number;
}

const CACHE_MAX = 600;

export class TileCache {
  private cache = new Map<string, Promise<string>>();

  constructor(private userAgent: string) {}

  clear(): void {
    this.cache.clear();
  }

  // Returns a data: URI, or an empty string when the tile could not be read.
  get(template: string, t: Tile): Promise<string> {
    const url = template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y)).replace('{s}', 'abc'[(t.x + t.y) % 3]);
    const hit = this.cache.get(url);
    if (hit) {
      return hit;
    }
    const value = this.fetch(url).catch(() => {
      this.cache.delete(url);
      return '';
    });
    this.cache.set(url, value);
    if (this.cache.size > CACHE_MAX) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return value;
  }

  private async fetch(url: string): Promise<string> {
    const res = await request(url, { headers: { 'User-Agent': this.userAgent, Accept: 'image/*' }, timeoutMs: 30000, binary: true });
    const type = String(res.headers['content-type'] ?? 'image/png').split(';')[0];
    if (res.status !== 200 || !type.startsWith('image/')) {
      throw new Error(`HTTP ${res.status}`);
    }
    return `data:${type};base64,${res.raw!.toString('base64')}`;
  }
}
