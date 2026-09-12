import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parse } from '../parser';

function messages(text: string): string[] {
  return parse(text).diagnostics.map((d) => `${d.severity}:${d.line + 1}:${d.message}`);
}

test('upstream case from Level0lTest.php', () => {
  const { entities, diagnostics } = parse('node 123: 51.12, 21.34\n  building = yes\n  key = value\n');
  assert.equal(diagnostics.length, 0);
  assert.equal(entities.length, 1);
  const n = entities[0];
  assert.equal(n.type, 'node');
  assert.equal(n.id, '123');
  assert.equal(n.lat, '51.12');
  assert.equal(n.lon, '21.34');
  assert.deepEqual(
    n.tags.map((t) => [t.key, t.value]),
    [
      ['building', 'yes'],
      ['key', 'value'],
    ]
  );
});

test('header parts: prefixes, id, version, coordinates, trailing comment', () => {
  const { entities } = parse('!-node 12.7: -1.5, 100.25  # note\n');
  const n = entities[0];
  assert.equal(n.conflict, true);
  assert.equal(n.deleted, true);
  assert.equal(n.id, '12');
  assert.equal(n.version, '7');
  assert.equal(n.lat, '-1.5');
  assert.equal(n.lon, '100.25');
  assert.equal(n.idStart, 7);
  assert.equal(n.idEnd, 9);
});

test('header without id is a new object with id 0', () => {
  const { entities, diagnostics } = parse('node: 50, 30\n  a = b\nway\n  nd 1\n  nd 2\n');
  assert.equal(entities[0].id, '0');
  assert.equal(entities[0].idStart, undefined);
  assert.equal(entities[1].id, '0');
  assert.equal(diagnostics.length, 0);
});

test('comment only when # is in the first column', () => {
  assert.deepEqual(messages('# ok\nnode 1: 1, 1\n# ok\n  # not a comment\n'), [
    'warning:4:Unknown content while parsing node 1',
  ]);
});

test('# inside a tag line belongs to the value', () => {
  const { entities } = parse('node 1: 1, 1\n  note = see #12\n');
  assert.equal(entities[0].tags[0].value, 'see #12');
});

test('escaped equals sign in a key, further equals in the value', () => {
  const { entities } = parse('node 1: 1, 1\n  a\\=b = c=d\n');
  assert.deepEqual(entities[0].tags.map((t) => [t.key, t.value]), [['a=b', 'c=d']]);
});

test('tag and member positions', () => {
  const { entities } = parse('way 1\n  highway = footway\n  nd 42 role\n');
  const w = entities[0];
  assert.deepEqual([w.tags[0].keyStart, w.tags[0].keyEnd, w.tags[0].valueStart, w.tags[0].valueEnd], [2, 9, 12, 19]);
  assert.deepEqual([w.members[0].start, w.members[0].end], [5, 7]);
});

test('severe errors, as in level0l.php', () => {
  assert.deepEqual(messages('!node 1.2: 1, 1\n'), ['error:1:Please resolve conflict of node 1']);
  assert.deepEqual(messages('-node -1: 1, 1\n'), ['error:1:Deleting an unsaved object']);
  assert.deepEqual(messages('node 1\n'), ['error:1:Node without coordinates']);
  assert.deepEqual(messages('node 1: 1, 1\n  nd 2\n'), ['error:2:A node cannot have member objects']);
  assert.deepEqual(messages('way 1\n  wy 2\n  nd 3\n  nd 4\n'), ['error:2:Ways cannot have members besides nodes']);
  assert.deepEqual(messages('node 1: 1, 1\n  a = b\n  a = c\n'), ['error:3:Duplicated tag']);
  assert.deepEqual(messages('way 1\n  nd 2\n'), ['error:1:Way 1 has less than two nodes']);
  assert.deepEqual(messages('relation 1\n  type = x\n'), ['error:1:Relation 1 has no members']);
  assert.deepEqual(messages('changeset\n  comment = a\nchangeset\n  comment = b\n'), [
    'error:3:There can be only one changeset metadata',
  ]);
});

test('warnings, as in level0l.php', () => {
  assert.deepEqual(messages('way 1: 1, 1\n  nd 1\n  nd 2\n'), ['warning:1:Coordinates specified for way 1']);
  assert.deepEqual(messages('way 1\n  nd 1 outer\n  nd 2\n'), ['warning:2:Role name specified for a way node']);
  assert.deepEqual(messages('stray\nnode 1: 1, 1\n'), ['warning:1:Unknown and unparsed content found']);
  assert.deepEqual(messages('node 1: 1, 1\n  no equals here\n'), ['warning:2:Unknown content while parsing node 1']);
});

test('deleted existing objects skip the member count checks; deleted nodes need no coordinates', () => {
  assert.deepEqual(messages('-way 1.2\n  nd 5\n-relation 3.1\n-node 4.1\n'), []);
});

test('coordinates outside the header pattern make the line unparsable', () => {
  assert.deepEqual(messages('node 1: 123.4, 30\n'), ['warning:1:Unknown and unparsed content found']);
});

test('relation members carry type and role', () => {
  const { entities } = parse('relation 1\n  nd 2\n  wy 3 outer\n  rel 4 sub area\n');
  assert.deepEqual(
    entities[0].members.map((m) => [m.type, m.id, m.role]),
    [
      ['node', '2', ''],
      ['way', '3', 'outer'],
      ['relation', '4', 'sub area'],
    ]
  );
});

test('JOSM comfort0 dialect: trailing comments on members are not roles', () => {
  const text = 'way 1 #Назва (2 точки)\n  nd 2 #2\n  nd 3 #Ім\'я ноди\nrelation 4 #r\n  wy 1 outer #Назва\n  nd 2 #2\n';
  const { entities, diagnostics } = parse(text);
  assert.deepEqual(entities[0].members.map((m) => m.role), ['', '']);
  assert.deepEqual(entities[1].members.map((m) => m.role), ['outer', '']);
  assert.deepEqual(diagnostics.map((d) => [d.severity, d.line + 1]), [
    ['information', 5],
    ['information', 6],
  ]);
});

test('the sample file parses with only the intended conflict error', () => {
  const text = require('fs').readFileSync(`${__dirname}/../../samples/example.l0l`, 'utf8');
  const { diagnostics } = parse(text);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /Please resolve conflict of node 111/);
});
