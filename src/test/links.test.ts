import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { extractLinks, LinkOptions } from '../links';

const opts: LinkOptions = {
  osmBaseUrl: 'https://osm.example',
  wikiBaseUrl: 'https://wiki.example/wiki',
  tagLinks: true,
};

function urls(text: string, o: Partial<LinkOptions> = {}): [string, string][] {
  const lines = text.split('\n');
  return extractLinks(text, { ...opts, ...o }).map((l) => [lines[l.line].slice(l.start, l.end), l.url]);
}

test('header: id, version and coordinates', () => {
  assert.deepEqual(urls('way 12.3\n'), [
    ['12', 'https://osm.example/way/12'],
    ['.3', 'https://osm.example/way/12/history/3'],
  ]);
  assert.deepEqual(urls('node 5: 50.1, 30.2\n'), [
    ['5', 'https://osm.example/node/5'],
    ['50.1, 30.2', 'https://osm.example/#map=18/50.1/30.2'],
  ]);
});

test('no object link for new objects, only the map', () => {
  assert.deepEqual(urls('node -1: 1, 2\nnode: 3, 4\n'), [
    ['1, 2', 'https://osm.example/#map=18/1/2'],
    ['3, 4', 'https://osm.example/#map=18/3/4'],
  ]);
});

test('changeset id links without a version link', () => {
  assert.deepEqual(urls('changeset 7.1\n'), [['7', 'https://osm.example/changeset/7']]);
});

test('members link unless the object is defined in the document', () => {
  const text = 'relation 1\n  nd 2\n  wy 3 outer\n  rel 4\n  nd -5\n';
  assert.deepEqual(urls(text), [
    ['1', 'https://osm.example/relation/1'],
    ['2', 'https://osm.example/node/2'],
    ['3', 'https://osm.example/way/3'],
    ['4', 'https://osm.example/relation/4'],
  ]);
  assert.deepEqual(urls(text, { definedIds: new Set(['node/2', 'way/3']) }), [
    ['1', 'https://osm.example/relation/1'],
    ['4', 'https://osm.example/relation/4'],
  ]);
});

test('tag keys link to Key pages, enumerated values to Tag pages', () => {
  assert.deepEqual(urls('node -1: 1, 1\n  amenity = cafe\n  name = Kyiv Coffee\n  addr:street = Main\n').slice(1), [
    ['amenity', 'https://wiki.example/wiki/Key:amenity'],
    ['cafe', 'https://wiki.example/wiki/Tag:amenity=cafe'],
    ['name', 'https://wiki.example/wiki/Key:name'],
    ['addr:street', 'https://wiki.example/wiki/Key:addr:street'],
  ]);
});

test('tag links carry the key and value for lazy resolution', () => {
  const links = extractLinks('node -1: 1, 1\n  amenity = cafe\n', opts);
  assert.deepEqual(links[1].wiki, { key: 'amenity' });
  assert.deepEqual(links[2].wiki, { key: 'amenity', value: 'cafe' });
});

test('no tag links inside the changeset block or when disabled', () => {
  assert.deepEqual(urls('changeset\n  comment = x\n  source = survey\n'), []);
  assert.deepEqual(urls('node -1: 1, 1\n  amenity = cafe\n', { tagLinks: false }).length, 1);
});

test('identifier keys get value links, never Tag pages', () => {
  assert.deepEqual(urls('node -1: 1, 1\n  wikidata = Q5\n  contact:line = someid\n').slice(1), [
    ['wikidata', 'https://wiki.example/wiki/Key:wikidata'],
    ['Q5', 'https://www.wikidata.org/wiki/Q5'],
    ['contact:line', 'https://wiki.example/wiki/Key:contact:line'],
  ]);
});
