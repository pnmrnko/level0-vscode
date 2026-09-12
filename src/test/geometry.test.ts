import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { bounds, mapData, objectAtLine } from '../geometry';
import { parse } from '../parser';

const text = `changeset
  comment = c

node 1.1: 50.1, 30.1
  amenity = cafe
  name = A
node 2: 50.2, 30.2
node -3: 50.3, 30.3
-node 4.2: 50.4, 30.4

way 10.1
  highway = path
  nd 1
  nd 2
  nd 99

way 11
  building = yes
  nd 1
  nd 2
  nd -3
  nd 1

relation 20
  type = route
  wy 10
  nd 2
  rel 5

!node 30.2: 1, 1
`;

test('nodes, ways and relations for the map', () => {
  const d = mapData(parse(text).entities);
  assert.deepEqual(
    d.nodes.map((n) => [n.id, n.line, n.latlon, n.tagged, n.deleted, n.label]),
    [
      ['1', 3, [50.1, 30.1], true, false, 'node 1: amenity=cafe · A'],
      ['2', 6, [50.2, 30.2], false, false, 'node 2'],
      ['-3', 7, [50.3, 30.3], false, false, 'node -3'],
      ['4', 8, [50.4, 30.4], false, true, '-node 4'],
    ]
  );
  assert.deepEqual(
    d.ways.map((w) => [w.id, w.points.length, w.complete, w.closed, w.label]),
    [
      ['10', 2, false, false, 'way 10: highway=path'],
      ['11', 4, true, true, 'way 11: building=yes'],
    ]
  );
  assert.deepEqual(d.relations, [{ id: '20', line: 23, ways: ['10'], nodes: ['2'], label: 'relation 20: type=route' }]);
});

test('bounds and the object at a line', () => {
  const entities = parse(text).entities;
  assert.deepEqual(bounds(mapData(entities)), { south: 50.1, west: 30.1, north: 50.4, east: 30.4 });
  assert.equal(bounds({ nodes: [], ways: [], relations: [] }), undefined);
  assert.equal(objectAtLine(entities, 4)!.line, 3);
  assert.equal(objectAtLine(entities, 14)!.id, '10');
  assert.deepEqual(objectAtLine(entities, 1), undefined);
  assert.deepEqual(objectAtLine(entities, 0), undefined);
});
