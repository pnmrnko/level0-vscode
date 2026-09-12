import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatBbox, hasBboxPlaceholder, hasMeta, isOverpassQuery, overpassError, parseBbox, prepareQuery, stripComments } from '../osm/overpass';

const BOX = { south: 50.44, west: 30.51, north: 50.46, east: 30.54 };

test('a query is told apart from URLs and object lists', () => {
  assert.equal(isOverpassQuery('nwr[amenity=cafe](50.44,30.51,50.46,30.54); out meta;'), true);
  assert.equal(isOverpassQuery('[out:xml][timeout:25];\nnode(1);\nout;'), true);
  assert.equal(isOverpassQuery('n123, w45'), false);
  assert.equal(isOverpassQuery('https://overpass-api.de/api/interpreter?data=node(1);out;'), false);
  assert.equal(isOverpassQuery('https://www.openstreetmap.org/way/1'), false);
});

test('{{bbox}} is expanded in turbo order south,west,north,east', () => {
  assert.equal(formatBbox(BOX), '50.44,30.51,50.46,30.54');
  assert.deepEqual(prepareQuery('nwr[shop]({{bbox}}); out meta;', BOX), { query: 'nwr[shop](50.44,30.51,50.46,30.54); out meta;' });
  assert.deepEqual(prepareQuery('node({{ bbox }}); way({{bbox}}); out;', BOX), { query: 'node(50.44,30.51,50.46,30.54); way(50.44,30.51,50.46,30.54); out;' });
  assert.match((prepareQuery('node({{bbox}}); out;') as { error: string }).error, /No bounding box/);
});

test('other turbo shortcuts and non-XML output are refused', () => {
  assert.match((prepareQuery('{{geocodeArea:Kyiv}}->.a; nwr[shop](area.a); out;', BOX) as { error: string }).error, /geocodeArea:Kyiv/);
  assert.match((prepareQuery('[out:json]; node(1); out;', BOX) as { error: string }).error, /\[out:json\]/);
  assert.deepEqual(prepareQuery('[out:xml][timeout:25]; node(1); out;'), { query: '[out:xml][timeout:25]; node(1); out;' });
});

test('server errors: remark, HTML error page, status codes', () => {
  assert.equal(overpassError(200, '<osm><remark> runtime error: Query timed out in "query" at line 1 after 26 seconds. </remark></osm>'), 'runtime error: Query timed out in "query" at line 1 after 26 seconds.');
  const html = '<html><body><p><strong style="color:#FF0000">Error</strong>: line 1: parse error: Unknown type "nodee" </p>\n<p><strong style="color:#FF0000">Error</strong>: line 1: parse error: Unknown token "(" </p></body></html>';
  assert.equal(overpassError(400, html), 'line 1: parse error: Unknown type "nodee"; line 1: parse error: Unknown token "("');
  assert.match(overpassError(429, '')!, /Too many requests/);
  assert.equal(overpassError(200, '<osm><node id="1" lat="1" lon="1"/></osm>'), undefined);
});

test('out meta detection', () => {
  assert.equal(hasMeta('node(1); out meta;'), true);
  assert.equal(hasMeta('node(1); out meta qt;'), true);
  assert.equal(hasMeta('node(1); out body; out skel qt;'), false);
});

test('typed bounding boxes', () => {
  assert.deepEqual(parseBbox('50.44, 30.51, 50.46,30.54', 0.001), BOX);
  assert.equal(formatBbox(parseBbox('50.45, 30.52', 0.001)!), '50.449,30.519,50.451,30.521');
  assert.equal(parseBbox('50.46,30.51,50.44,30.54', 0.001), undefined);
  assert.equal(parseBbox('abc', 0.001), undefined);
  assert.equal(parseBbox('1,2,3', 0.001), undefined);
});

test('comments do not take part in the query', () => {
  const q = '// {{bbox}} in a comment\n/* [out:json] {{geocodeArea:x}} */\nnwr["website"~"https://"](1,2,3,4); out meta; // trailing';
  assert.equal(stripComments(q), '\n\nnwr["website"~"https://"](1,2,3,4); out meta; ');
  assert.equal(hasBboxPlaceholder(q), false);
  assert.deepEqual(prepareQuery(q), { query: 'nwr["website"~"https://"](1,2,3,4); out meta;' });
});
