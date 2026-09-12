import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolveInput } from '../osm/input';

const API = 'https://api.openstreetmap.org/api/0.6/';
const r = (s: string) => resolveInput(s, API);

test('rejects what is not understood', () => {
  assert.equal(r(''), undefined);
  assert.equal(r('abc'), undefined);
  assert.equal(r(','), undefined);
  assert.equal(r('n'), undefined);
});

test('API URLs, relative and absolute', () => {
  assert.deepEqual(r('/api/0.6/node/123'), [`${API}node/123`]);
  assert.deepEqual(r('https://api.openstreetmap.org/api/0.6/way/5/full'), [`${API}way/5/full`]);
  assert.deepEqual(r('https://api.openstreetmap.org/api/0.6/nodes?nodes=1,2,3'), [`${API}nodes?nodes=1,2,3`]);
  assert.deepEqual(r('https://api.openstreetmap.org/api/0.6/map?bbox=30.5,50.4,30.6,50.5'), [`${API}map?bbox=30.5,50.4,30.6,50.5`]);
});

test('osm.org URLs: ways come with their nodes, changesets as osmChange', () => {
  assert.deepEqual(r('https://www.openstreetmap.org/node/123'), [`${API}node/123`]);
  assert.deepEqual(r('https://www.openstreetmap.org/way/123'), [`${API}way/123/full`]);
  assert.deepEqual(r('https://www.openstreetmap.org/relation/9/history#map=15/1/2'), [`${API}relation/9`]);
  assert.deepEqual(r('https://www.openstreetmap.org/browse/node/1'), [`${API}node/1`]);
  assert.deepEqual(r('https://www.openstreetmap.org/changeset/777#map=1/2/3'), [`${API}changeset/777/download`]);
});

test('Overpass interpreter URLs pass through', () => {
  assert.deepEqual(r('overpass-api.de/api/interpreter?data=a-long-query'), ['https://overpass-api.de/api/interpreter?data=a-long-query']);
  assert.deepEqual(r('https://overpass.private.coffee/api/interpreter?data=q'), ['https://overpass.private.coffee/api/interpreter?data=q']);
});

test('object lists', () => {
  assert.deepEqual(r('n12,w34,r56'), [`${API}node/12`, `${API}way/34`, `${API}relation/56`]);
  assert.deepEqual(r(',n12,,,n13,'), [`${API}node/12`, `${API}node/13`]);
  assert.deepEqual(r('node 12.4, way/7, rel 8'), [`${API}node/12/4`, `${API}way/7`, `${API}relation/8`]);
  assert.deepEqual(r('w34!, r56!, n1!'), [`${API}way/34/full`, `${API}relation/56/full`, `${API}node/1`]);
  assert.deepEqual(r('! w34, r56'), [`${API}way/34/full`, `${API}relation/56/full`]);
  assert.deepEqual(r('n1*, w2*'), [`${API}node/1/ways`, `${API}node/1/relations`, `${API}way/2/relations`]);
  assert.deepEqual(r('c42'), [`${API}changeset/42/download`]);
});

test('map positions become a small bbox', () => {
  const box = `${API}map?bbox=56.77970,12.33970,56.78030,12.34030`;
  assert.deepEqual(r('15/12.34/56.78'), [box]);
  assert.deepEqual(r('https://www.openstreetmap.org/#map=15/12.34/56.78&layers=N'), [box]);
  assert.deepEqual(r('https://www.openstreetmap.org/?lat=12.34&lon=56.78&zoom=15'), [box]);
  assert.deepEqual(r('12.34, 56.78'), [box]);
  assert.deepEqual(r('https://www.openstreetmap.org/#map=15/-12.34/-56.78'), [`${API}map?bbox=-56.78030,-12.34030,-56.77970,-12.33970`]);
});

test('any other http URL is fetched as OSM XML', () => {
  assert.deepEqual(r('https://example.com/export.osm'), ['https://example.com/export.osm']);
  assert.equal(r('ftp://example.com/x.osm'), undefined);
});
