import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fetchState } from '../osm/state';

const API = 'https://api.example/api/0.6/';

function fake(responses: Record<string, string | number>) {
  const calls: string[] = [];
  return {
    calls,
    async getXml(url: string) {
      const path = url.slice(API.length);
      calls.push(path);
      const r = responses[path];
      if (r === undefined) {
        throw new Error(`no fake for ${path}`);
      }
      if (typeof r === 'number') {
        throw new Error(`HTTP ${r} X for ${path}`);
      }
      return r;
    },
  };
}

test('batches per type and reads deleted objects from the multi-fetch', async () => {
  const client = fake({
    'nodes?nodes=1,2': '<osm><node id="1" version="2" lat="1" lon="1"/><node id="2" version="1" visible="false"/></osm>',
    'ways?ways=5': '<osm><way id="5" version="1"><nd ref="1"/><nd ref="2"/></way></osm>',
  });
  const s = await fetchState(client, API, [{ type: 'node', id: 1 }, { type: 'way', id: 5 }, { type: 'node', id: 2 }, { type: 'node', id: 1 }]);
  assert.deepEqual(client.calls, ['nodes?nodes=1,2', 'ways?ways=5']);
  assert.equal(s.get('node1')!.version, 2);
  assert.equal(s.get('node2')!.deleted, true);
  assert.equal(s.get('way5')!.nodes!.length, 2);
});

test('a 404 batch is retried one by one; 410 means deleted', async () => {
  const client = fake({
    'nodes?nodes=1,2,3': 404,
    'node/1': '<osm><node id="1" version="2" lat="1" lon="1"/></osm>',
    'node/2': 404,
    'node/3': 410,
  });
  const s = await fetchState(client, API, [1, 2, 3].map((id) => ({ type: 'node' as const, id })));
  assert.equal(s.get('node1')!.version, 2);
  assert.equal(s.get('node2'), undefined);
  assert.equal(s.get('node3')!.deleted, true);
});

test('other errors propagate', async () => {
  const client = fake({ 'nodes?nodes=1': 500 });
  await assert.rejects(fetchState(client, API, [{ type: 'node', id: 1 }]), /HTTP 500/);
});
