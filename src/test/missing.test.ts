import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { missingActions } from '../missing';
import { parse } from '../parser';
import { Index } from '../refs';

const text = `node 1.1: 50.1, 30.1

way 10.1
  highway = path
  nd 1
  nd 2
  nd 3
  nd 2

relation 20
  type = route
  wy 10
  wy 11
  nd 1
  nd -5
  rel 30 subarea
`;
const parsed = parse(text);
const index = new Index(parsed);
const at = (from: number, to = from) => missingActions(parsed, index, from, to);

test('a member line offers that object, ways and relations also with children', () => {
  assert.deepEqual(at(5), [{ title: 'Download node 2', paths: ['nodes?nodes=2'] }]);
  assert.deepEqual(at(12), [
    { title: 'Download way 11', paths: ['ways?ways=11'] },
    { title: 'Download way 11 with its nodes', paths: ['way/11/full'] },
  ]);
  assert.deepEqual(at(15), [
    { title: 'Download relation 30', paths: ['relations?relations=30'] },
    { title: 'Download relation 30 with its members', paths: ['relation/30/full'] },
  ]);
});

test('present or new members fall back to the object; a complete object offers nothing', () => {
  assert.deepEqual(at(4), [{ title: 'Download 2 nodes missing of this way', paths: ['nodes?nodes=2,3'] }]);
  assert.deepEqual(at(11), [{ title: 'Download 2 objects missing of this relation', paths: ['ways?ways=11', 'relations?relations=30'] }]);
  assert.deepEqual(at(14), [{ title: 'Download 2 objects missing of this relation', paths: ['ways?ways=11', 'relations?relations=30'] }]);
  assert.deepEqual(at(0), []);
  assert.deepEqual(at(1), []);
});

test('a header or a tag line offers the missing members of the object', () => {
  assert.deepEqual(at(2), [{ title: 'Download 2 nodes missing of this way', paths: ['nodes?nodes=2,3'] }]);
  assert.deepEqual(at(3), at(2));
  assert.deepEqual(at(9), [{ title: 'Download 2 objects missing of this relation', paths: ['ways?ways=11', 'relations?relations=30'] }]);
});

test('a selection over several objects offers everything missing in it', () => {
  assert.deepEqual(at(2, 15), [{ title: 'Download 4 objects missing', paths: ['nodes?nodes=2,3', 'ways?ways=11', 'relations?relations=30'] }]);
  assert.deepEqual(at(4, 6), [{ title: 'Download 2 nodes missing of this way', paths: ['nodes?nodes=2,3'] }]);
});
