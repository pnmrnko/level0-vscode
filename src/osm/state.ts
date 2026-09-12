// Current server state of the objects a document refers to, fetched in
// batches per type. Pure module, no vscode API; the client is injected.

import { OsmObject, ObjectType, key } from './model';
import { readOsmXml } from './xml';

export interface Fetcher {
  getXml(url: string): Promise<string>;
}

const BATCH = 200;

function status(err: unknown): number | undefined {
  const m = /^HTTP (\d{3})/.exec(err instanceof Error ? err.message : String(err));
  return m ? Number(m[1]) : undefined;
}

// A multi-fetch answers 404 when any id never existed, so such a batch is
// retried one object at a time; deleted objects come back with
// visible="false" from the multi-fetch and as 410 from a single fetch.
export async function fetchState(
  client: Fetcher,
  apiBase: string,
  wanted: { type: ObjectType; id: number }[],
  progress?: (done: number, total: number) => void
): Promise<Map<string, OsmObject | undefined>> {
  const out = new Map<string, OsmObject | undefined>();
  const byType = new Map<ObjectType, number[]>();
  for (const w of wanted) {
    if (!out.has(key(w))) {
      out.set(key(w), undefined);
      byType.set(w.type, [...(byType.get(w.type) ?? []), w.id]);
    }
  }
  let done = 0;
  for (const [type, ids] of byType) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      try {
        const { objects } = await readBatch(client, `${apiBase}${type}s?${type}s=${batch.join(',')}`);
        for (const o of objects) {
          out.set(key(o), o);
        }
      } catch (err) {
        if (status(err) !== 404) {
          throw err;
        }
        for (const id of batch) {
          try {
            const { objects } = await readBatch(client, `${apiBase}${type}/${id}`);
            for (const o of objects) {
              out.set(key(o), o);
            }
          } catch (single) {
            const s = status(single);
            if (s === 410) {
              out.set(`${type}${id}`, { type, id, deleted: true, tags: new Map() });
            } else if (s !== 404) {
              throw single;
            }
          }
        }
      }
      done += batch.length;
      progress?.(done, wanted.length);
    }
  }
  return out;
}

async function readBatch(client: Fetcher, url: string) {
  return readOsmXml(await client.getXml(url));
}
