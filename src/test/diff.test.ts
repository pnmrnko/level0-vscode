import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isModified, plan, serverKeys } from '../osm/diff';
import { conflictReplacements } from '../osm/conflicts';
import { createChangesetXml, createOsc } from '../osm/osc';
import { OsmObject } from '../osm/model';
import { parse } from '../parser';

function obj(o: Partial<OsmObject> & { type: OsmObject['type']; id: number }, tags: [string, string][] = []): OsmObject {
  return { tags: new Map(tags), ...o };
}

function state(...objects: OsmObject[]): Map<string, OsmObject | undefined> {
  return new Map(objects.map((o) => [`${o.type}${o.id}`, o]));
}

const DOC = `changeset
  comment = test

node 1.3: 50.1, 30.1
  amenity = cafe

node 2.1: 50.2, 30.2
  amenity = bench

-node 3.2: 50.3, 30.3

node 4.5: 50.4, 30.4
  shop = bakery

node -1: 50.5, 30.5
  natural = tree

node: 50.6, 30.6
  natural = tree

way 10.2
  highway = path
  nd 1
  nd 2

way 11
  highway = path
  nd 1
  nd 2
`;

test('server keys are the positive ids', () => {
  assert.deepEqual(serverKeys(parse(DOC).entities), [
    { type: 'node', id: 1 },
    { type: 'node', id: 2 },
    { type: 'node', id: 3 },
    { type: 'node', id: 4 },
    { type: 'way', id: 10 },
    { type: 'way', id: 11 },
  ]);
});

test('plan: create, modify, delete, unchanged, conflict, problems', () => {
  const server = state(
    obj({ type: 'node', id: 1, version: 3, lat: '50.1', lon: '30.1' }, [['amenity', 'cafe']]),
    obj({ type: 'node', id: 2, version: 1, lat: '50.2', lon: '30.2' }, [['amenity', 'bench'], ['backrest', 'yes']]),
    obj({ type: 'node', id: 3, version: 2, lat: '50.3', lon: '30.3' }),
    obj({ type: 'node', id: 4, version: 6, lat: '50.4', lon: '30.4' }, [['shop', 'bakery'], ['name', 'X']]),
    obj({ type: 'way', id: 10, version: 2, nodes: [1, 2, 3] }, [['highway', 'path']])
  );
  const p = plan(parse(DOC).entities, server);
  assert.deepEqual([...p.changeset!.tags], [['comment', 'test']]);
  assert.deepEqual(
    p.changes.map((c) => [c.action, c.object.type, c.object.id, c.object.version]),
    [
      ['create', 'node', -2, 1],
      ['create', 'node', -1, 1],
      ['modify', 'node', 2, 1],
      ['modify', 'way', 10, 2],
      ['delete', 'node', 3, 2],
    ]
  );
  assert.deepEqual(p.unchanged.map((e) => e.id), ['1']);
  assert.equal(p.conflicts.length, 1);
  assert.equal(p.conflicts[0].entity.id, '4');
  assert.equal(p.conflicts[0].theirs!.version, 6);
  assert.deepEqual(p.problems.map((x) => x.message), ['No version for way 11, download it again']);
});

test('plan: deleted on the server, unknown, newer in the document, duplicate ids', () => {
  const doc = parse('node 1.2: 1, 1\nnode 2.2: 1, 1\n-node 3.1: 1, 1\nnode 4.9: 1, 1\nnode -5: 1, 1\nnode -5: 1, 1\n').entities;
  const server = state(
    obj({ type: 'node', id: 1, version: 2, deleted: true }),
    obj({ type: 'node', id: 3, version: 1, deleted: true }),
    obj({ type: 'node', id: 4, version: 3, lat: '1', lon: '1' })
  );
  const p = plan(doc, server);
  assert.deepEqual(p.conflicts.map((c) => [c.entity.id, c.theirs]), [['1', undefined]]);
  assert.deepEqual(p.unchanged.map((e) => e.id), ['3']);
  assert.deepEqual(p.problems.map((x) => x.message), [
    'Duplicate id node -5',
    'node 2 does not exist on the server',
    'node 4 has version 9 in the document but 3 on the server',
  ]);
});

test('isModified compares tags, coordinates, nodes, members', () => {
  const base = obj({ type: 'node', id: 1, lat: '50.1000000', lon: '30.1' }, [['a', 'b']]);
  assert.equal(isModified(obj({ type: 'node', id: 1, lat: '50.1', lon: '30.1' }, [['a', 'b']]), base), false);
  assert.equal(isModified(obj({ type: 'node', id: 1, lat: '50.1', lon: '30.1' }, [['a', 'c']]), base), true);
  assert.equal(isModified(obj({ type: 'node', id: 1, lat: '50.11', lon: '30.1' }, [['a', 'b']]), base), true);
  assert.equal(isModified(obj({ type: 'way', id: 1, nodes: [1, 2] }), obj({ type: 'way', id: 1, nodes: [2, 1] })), true);
  const r = obj({ type: 'relation', id: 1, members: [{ type: 'way', id: 1, role: 'outer' }] });
  assert.equal(isModified(r, obj({ type: 'relation', id: 1, members: [{ type: 'way', id: 1, role: 'outer' }] })), false);
  assert.equal(isModified(r, obj({ type: 'relation', id: 1, members: [{ type: 'way', id: 1, role: 'inner' }] })), true);
});

test('osmChange blocks in upload order with escaping', () => {
  const doc = parse('node -1: 1, 2\n  name = A & "B"\nway -2\n  nd -1\n  nd 5\n-way 7.3\n  nd 1\n  nd 2\nrelation 8.1\n  type = x\n  wy -2 out\'er\n').entities;
  const server = state(obj({ type: 'way', id: 7, version: 3, nodes: [1, 2] }), obj({ type: 'relation', id: 8, version: 1, members: [] }, [['type', 'x']]));
  const p = plan(doc, server);
  assert.equal(
    createOsc(p.changes, 'test 1.0', 99),
    `<?xml version="1.0" encoding="UTF-8"?>
<osmChange version="0.6" generator="test 1.0">
  <create>
    <node id="-1" version="1" lat="1" lon="2" changeset="99">
      <tag k="name" v="A &amp; &quot;B&quot;"/>
    </node>
    <way id="-2" version="1" changeset="99">
      <nd ref="-1"/>
      <nd ref="5"/>
    </way>
  </create>
  <modify>
    <relation id="8" version="1" changeset="99">
      <member type="way" ref="-2" role="out&apos;er"/>
      <tag k="type" v="x"/>
    </relation>
  </modify>
  <delete>
    <way id="7" version="3" changeset="99">
      <nd ref="1"/>
      <nd ref="2"/>
    </way>
  </delete>
</osmChange>
`
  );
});

test('changeset XML from the block, comment and generator', () => {
  const xml = createChangesetXml(new Map([['comment', 'old'], ['source', 'survey'], ['empty', ' ']]), 'new comment', 'gen 1');
  assert.equal(xml, '<?xml version="1.0" encoding="UTF-8"?>\n<osm>\n  <changeset>\n    <tag k="comment" v="new comment"/>\n    <tag k="source" v="survey"/>\n    <tag k="created_by" v="gen 1"/>\n  </changeset>\n</osm>\n');
});

test('conflict replacement covers the entity block and keeps the delete prefix', () => {
  const doc = parse('# top\n-node 4.5: 50.4, 30.4\n  shop = bakery\n\nnode 9: 1, 1\n').entities;
  const server = state(obj({ type: 'node', id: 4, version: 6, lat: '50.4', lon: '30.41' }, [['shop', 'bakery'], ['name', 'X']]));
  const p = plan(doc, server);
  assert.deepEqual(conflictReplacements(p.conflicts), [
    {
      startLine: 1,
      endLine: 2,
      text:
        '# Conflict! Your edits to the old version are saved in this comment.\n' +
        "# Please make appropriate changes and remove '!' character from the entity header.\n" +
        '# -node 4: 50.4, 30.4\n#   shop = bakery\n' +
        '!node 4.6: 50.4, 30.41\n  shop = bakery\n  name = X',
    },
  ]);
});
