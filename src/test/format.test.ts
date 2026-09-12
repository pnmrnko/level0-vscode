import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatObject, formatObjects } from '../osm/format';
import { OsmObject } from '../osm/model';

function obj(o: Partial<OsmObject> & { type: OsmObject['type']; id: number }, tags: [string, string][] = []): OsmObject {
  return { tags: new Map(tags), ...o };
}

test('upstream case from Level0lTest.php', () => {
  const data = [obj({ type: 'node', id: 123, lat: '51.12', lon: '21.34' }, [['building', 'yes'], ['key', 'value']])];
  assert.equal(formatObjects(data), 'node 123: 51.12, 21.34\n  building = yes\n  key = value\n');
});

test('header: version, delete, no id, escaped key', () => {
  assert.equal(formatObject(obj({ type: 'way', id: 5, version: 3, action: 'delete', nodes: [1, 2] })), '-way 5.3\n  nd 1\n  nd 2\n');
  assert.equal(formatObject(obj({ type: 'node', id: 0, lat: '1', lon: '2' }, [['a=b', 'c=d']])), 'node: 1, 2\n  a\\=b = c=d\n');
  assert.equal(formatObject(obj({ type: 'changeset', id: 0 }, [['comment', 'x']])), 'changeset\n  comment = x\n');
});

test('relation members with and without roles', () => {
  const r = obj({ type: 'relation', id: 7, version: 1, members: [
    { type: 'way', id: 1, role: 'outer' },
    { type: 'node', id: 2, role: '' },
    { type: 'relation', id: 3, role: 'sub area' },
  ] }, [['type', 'multipolygon']]);
  assert.equal(formatObject(r), 'relation 7.1\n  type = multipolygon\n  wy 1 outer\n  nd 2\n  rel 3 sub area\n');
});

test('order: changeset, tagged nodes, ways, relations, untagged nodes; blank lines between', () => {
  const data = [
    obj({ type: 'node', id: 2, lat: '1', lon: '1' }),
    obj({ type: 'relation', id: 1, members: [{ type: 'way', id: 3, role: '' }] }),
    obj({ type: 'node', id: 1, lat: '1', lon: '1' }),
    obj({ type: 'way', id: 3, nodes: [1, 2] }),
    obj({ type: 'node', id: 9, lat: '1', lon: '1' }, [['amenity', 'bench']]),
    obj({ type: 'changeset', id: 0 }, [['comment', 'c']]),
  ];
  assert.equal(
    formatObjects(data),
    '\nchangeset\n  comment = c\n' +
      '\nnode 9: 1, 1\n  amenity = bench\n' +
      '\nway 3\n  nd 1\n  nd 2\n' +
      '\nrelation 1\n  wy 3\n' +
      '\nnode 1: 1, 1\nnode 2: 1, 1\n'
  );
});

test('conflict block above the header', () => {
  const mine = obj({ type: 'node', id: 111, lat: '50.1', lon: '30.1' }, [['amenity', 'bench'], ['backrest', 'no']]);
  const theirs = obj({ type: 'node', id: 111, version: 6, lat: '50.1', lon: '30.1', conflict: mine }, [['amenity', 'bench'], ['backrest', 'yes']]);
  assert.equal(
    formatObject(theirs),
    '# Conflict! Your edits to the old version are saved in this comment.\n' +
      "# Please make appropriate changes and remove '!' character from the entity header.\n" +
      '# node 111: 50.1, 30.1\n#   amenity = bench\n#   backrest = no\n' +
      '!node 111.6: 50.1, 30.1\n  amenity = bench\n  backrest = yes\n'
  );
});
