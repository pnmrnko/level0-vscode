import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyDiffResult, parseDiffResult } from '../osm/apply';
import { codeChallenge, beginLogin, siteUrl } from '../osm/oauth';

const RESULT = `<?xml version="1.0" encoding="UTF-8"?>
<diffResult version="0.6" generator="OpenStreetMap server" copyright="OpenStreetMap and contributors">
  <node old_id="-1" new_id="9001" new_version="1"/>
  <node old_id="-2" new_id="9002" new_version="1"/>
  <way old_id="-3" new_id="9003" new_version="1"/>
  <node old_id="7" new_id="7" new_version="3"/>
  <relation old_id="8" new_id="8" new_version="2"/>
  <node old_id="5"/>
  <way old_id="6"/>
</diffResult>`;

test('diffResult rows', () => {
  const r = parseDiffResult(RESULT);
  assert.deepEqual(r.get('node-1'), { newId: 9001, newVersion: 1 });
  assert.deepEqual(r.get('node7'), { newId: 7, newVersion: 3 });
  assert.equal(r.has('node5'), true);
  assert.equal(r.get('node5'), undefined);
  assert.equal(r.has('node99'), false);
});

test('ids, versions and members are rewritten, deleted blocks removed, the rest kept', () => {
  const doc = `# header comment
changeset
  comment = c

node -1: 1, 2  # new
  amenity = cafe

node: 3, 4
  natural = tree

node 7.2: 5, 6
  amenity = bench

-node 5.1: 1, 1
  amenity = old

way -3
  highway = path
  nd -1
  nd -2
  nd 7

-way 6.4
  nd 1
  nd 2

relation 8.1
  type = route
  wy -3 forward
  nd 7
  nd 11

node 11.1: 1, 1
`;
  const zero = new Map([[7, -2]]);
  assert.equal(
    applyDiffResult(doc, parseDiffResult(RESULT), zero),
    `# header comment
changeset
  comment = c

node 9001.1: 1, 2  # new
  amenity = cafe

node 9002.1: 3, 4
  natural = tree

node 7.3: 5, 6
  amenity = bench

way 9003.1
  highway = path
  nd 9001
  nd 9002
  nd 7

relation 8.2
  type = route
  wy 9003 forward
  nd 7
  nd 11

node 11.1: 1, 1
`
  );
});

test('a deleted block at the end and one before a comment', () => {
  const r = parseDiffResult('<diffResult><node old_id="1"/><node old_id="2"/></diffResult>');
  assert.equal(applyDiffResult('node 3.1: 1, 1\n\n-node 1.1: 1, 1\n', r), 'node 3.1: 1, 1\n');
  assert.equal(applyDiffResult('-node 2.1: 1, 1\n  a = b\n# note\nnode 3.1: 1, 1\n', r), '# note\nnode 3.1: 1, 1\n');
});

test('PKCE challenge from RFC 7636 and the authorization URL', () => {
  assert.equal(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const p = beginLogin('https://master.apis.dev.openstreetmap.org', 'abc', 'vscode://pnmrnko.level0l/oauth');
  const u = new URL(p.url);
  assert.equal(u.origin + u.pathname, 'https://master.apis.dev.openstreetmap.org/oauth2/authorize');
  assert.equal(u.searchParams.get('client_id'), 'abc');
  assert.equal(u.searchParams.get('redirect_uri'), 'vscode://pnmrnko.level0l/oauth');
  assert.equal(u.searchParams.get('scope'), 'read_prefs write_api');
  assert.equal(u.searchParams.get('state'), p.state);
  assert.equal(u.searchParams.get('code_challenge'), codeChallenge(p.verifier));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
});

test('site for an API base', () => {
  assert.equal(siteUrl('https://api.openstreetmap.org/api/0.6/'), 'https://www.openstreetmap.org');
  assert.equal(siteUrl('https://api06.dev.openstreetmap.org/api/0.6/'), 'https://master.apis.dev.openstreetmap.org');
  assert.equal(siteUrl('https://osm.example.org/api/0.6/'), 'https://osm.example.org');
});
