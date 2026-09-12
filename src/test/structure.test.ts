import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { conflictSpans, versionSpans } from '../lines';
import { parse } from '../parser';
import { Index } from '../refs';
import { bodyEnd, foldingRanges, summarize } from '../symbols';

const text = [
  '# intro',
  '# more',
  'changeset',
  '  comment = Fix things',
  '',
  'node 1.2: 50, 30',
  '  amenity = cafe',
  '  name = Kyiv Coffee',
  '',
  'way -2',
  '  nd 1',
  '  nd -3',
  'relation 4',
  '  type = multipolygon',
  '  landuse = grass',
  '  wy -2 outer',
  '-node 5.1: 1, 1',
  '# Conflict! saved edits',
  '#   amenity = bench',
  '!node 6.3: 1, 1',
  '  amenity = bench',
  '',
  '# tail',
].join('\n');

test('summaries', () => {
  const s = parse(text).entities.map(summarize);
  assert.deepEqual(
    s.map((x) => [x.name, x.detail]),
    [
      ['changeset', 'Fix things'],
      ['node 1', 'amenity=cafe · Kyiv Coffee'],
      ['way -2', ''],
      ['relation 4', 'type=multipolygon · landuse=grass'],
      ['-node 5', ''],
      ['!node 6', 'amenity=bench'],
    ]
  );
});

test('entity bodies and folds', () => {
  const parsed = parse(text);
  assert.deepEqual(parsed.entities.map(bodyEnd), [3, 7, 11, 15, 16, 20]);
  assert.deepEqual(foldingRanges(text, parsed), [
    { startLine: 2, endLine: 3, kind: 'entity' },
    { startLine: 5, endLine: 7, kind: 'entity' },
    { startLine: 9, endLine: 11, kind: 'entity' },
    { startLine: 12, endLine: 15, kind: 'entity' },
    { startLine: 19, endLine: 20, kind: 'entity' },
    { startLine: 0, endLine: 1, kind: 'comment' },
    { startLine: 17, endLine: 18, kind: 'comment' },
  ]);
});

test('version and conflict spans', () => {
  assert.deepEqual(versionSpans(text), [
    { line: 5, start: 6, end: 8 },
    { line: 16, start: 7, end: 9 },
    { line: 19, start: 7, end: 9 },
  ]);
  assert.deepEqual(conflictSpans(text), [
    { current: { startLine: 17, endLine: 18 }, incoming: { startLine: 19, endLine: 20 } },
  ]);
  assert.deepEqual(conflictSpans('!way 1.1\n  nd 2\n  nd 3\nnode 4: 1, 1\n'), [
    { current: undefined, incoming: { startLine: 0, endLine: 2 } },
  ]);
});

test('cross references', () => {
  const index = new Index(parse(text));
  assert.deepEqual(index.definition('node', '1'), { line: 5, start: 5, end: 6 });
  assert.deepEqual(index.referencesTo('node', '1'), [{ line: 10, start: 5, end: 6 }]);
  assert.deepEqual(index.occurrences('way', '-2').map((l) => l.line), [9, 15]);
  assert.equal(index.definition('node', '-3'), undefined);
  assert.equal(index.symbolAt(15, 6)?.id, '-2');
  assert.equal(index.symbolAt(15, 9), undefined);
  assert.equal(index.symbolAt(5, 5)?.isDefinition, true);
});
