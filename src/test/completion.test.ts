import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { completionContext } from '../completion';

function at(text: string, line: number, character: number) {
  return completionContext(text.split('\n'), line, character);
}

test('tag key on an indented line', () => {
  assert.deepEqual(at('node 1: 50, 30\n  amen', 1, 6), { kind: 'key', partial: 'amen', start: 2, entity: 'node' });
  assert.deepEqual(at('changeset\n  com', 1, 5), { kind: 'key', partial: 'com', start: 2, entity: 'changeset' });
});

test('tag value after the equals sign, last part of a semicolon list', () => {
  assert.deepEqual(at('node 1: 50, 30\n  amenity = ca', 1, 14), { kind: 'value', key: 'amenity', partial: 'ca', start: 12, entity: 'node' });
  assert.deepEqual(at('node 1: 50, 30\n  cuisine = a;b; c', 1, 18), { kind: 'value', key: 'cuisine', partial: 'c', start: 17, entity: 'node' });
  assert.deepEqual(at('node 1: 50, 30\n  key\\=x = v', 1, 12), { kind: 'value', key: 'key=x', partial: 'v', start: 11, entity: 'node' });
});

test('member id after nd, wy, rel', () => {
  assert.deepEqual(at('way 1\n  nd -', 1, 6), { kind: 'member-id', memberType: 'node', partial: '-', start: 5, entity: 'way' });
  assert.deepEqual(at('relation 1\n  wy 5', 1, 6), { kind: 'member-id', memberType: 'way', partial: '5', start: 5, entity: 'relation' });
  // A member line under a node is invalid; nothing is offered there.
  assert.equal(at('node 1: 1, 1\n  nd 2', 1, 6), undefined);
});

test('role after a member id in a relation, with the relation type', () => {
  assert.deepEqual(at('relation 1\n  type = multipolygon\n  wy 5 ou', 2, 9), {
    kind: 'role',
    memberType: 'way',
    partial: 'ou',
    start: 7,
    relationType: 'multipolygon',
  });
  assert.equal(at('relation 1\n  wy 5 ', 1, 7)?.kind, 'role');
  assert.equal(at('way 1\n  nd 5 ', 1, 7), undefined);
});

test('header keywords at column 0, after prefixes too', () => {
  assert.deepEqual(at('no', 0, 2), { kind: 'header', partial: 'no', start: 0 });
  assert.deepEqual(at('-no', 0, 3), { kind: 'header', partial: 'no', start: 1 });
  assert.equal(at('-way 987654322.1', 0, 1), undefined);
  assert.equal(at('!node 1: 50, 30', 0, 1), undefined);
  assert.deepEqual(at('node 1: 50, 30\n  amenity = cafe\n', 2, 0), { kind: 'header', partial: '', start: 0 });
});

test('nothing in comments or inside a complete header', () => {
  assert.equal(at('# comm', 0, 6), undefined);
  assert.equal(at('node 1: 50, 30', 0, 14), undefined);
});
