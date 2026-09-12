import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { hardTrim, readOsmXml, unescapeXml } from '../osm/xml';

const API_NODE = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="openstreetmap-cgimap 2.0.1 (123 spike-06.openstreetmap.org)" copyright="OpenStreetMap and contributors" attribution="http://www.openstreetmap.org/copyright" license="http://opendatacommons.org/licenses/odbl/1-0/">
  <node id="123" visible="true" version="7" changeset="99" timestamp="2024-01-02T03:04:05Z" user="mapper" uid="42" lat="50.4501000" lon="30.5234000">
    <tag k="amenity" v="cafe"/>
    <tag k="name" v="Kyiv &amp; Coffee &quot;2&quot;"/>
  </node>
</osm>`;

test('node from the API with attributes and entities', () => {
  const { objects, truncated } = readOsmXml(API_NODE);
  assert.equal(truncated, false);
  assert.equal(objects.length, 1);
  const n = objects[0];
  assert.equal(n.type, 'node');
  assert.equal(n.id, 123);
  assert.equal(n.version, 7);
  assert.equal(n.changeset, 99);
  assert.equal(n.user, 'mapper');
  assert.equal(n.uid, 42);
  assert.equal(n.timestamp, '2024-01-02T03:04:05Z');
  assert.equal(n.lat, '50.4501000');
  assert.equal(n.lon, '30.5234000');
  assert.equal(n.deleted, undefined);
  assert.deepEqual([...n.tags], [
    ['amenity', 'cafe'],
    ['name', 'Kyiv & Coffee "2"'],
  ]);
});

test('way and relation with members', () => {
  const xml = `<osm>
  <way id="10" version="2"><nd ref="1"/><nd ref="2"/><nd ref="1"/><tag k="building" v="yes"/></way>
  <relation id='20' version='1'>
    <member type='way' ref='10' role='outer'/>
    <member type='node' ref='1'/>
    <member type='relation' ref='30' role='subarea'></member>
    <member type='area' ref='5' role=''/>
    <tag k='type' v='multipolygon'/>
  </relation>
</osm>`;
  const { objects } = readOsmXml(xml);
  assert.deepEqual(objects[0].nodes, [1, 2, 1]);
  assert.deepEqual(objects[1].members, [
    { type: 'way', id: 10, role: 'outer' },
    { type: 'node', id: 1, role: '' },
    { type: 'relation', id: 30, role: 'subarea' },
  ]);
  assert.deepEqual([...objects[1].tags], [['type', 'multipolygon']]);
});

test('osmChange: action from the enclosing block or the attribute', () => {
  const xml = `<osmChange version="0.6" generator="JOSM">
  <create><node id="-1" lat="1" lon="2"/></create>
  <modify><node id="5" version="3" lat="1" lon="2"><tag k="a" v="b"/></node></modify>
  <delete if-unused="true"><way id="6" version="1"><nd ref="1"/><nd ref="2"/></way></delete>
</osmChange>
<osm><node id="7" version="1" lat="1" lon="2" action="modify"/></osm>`;
  const { objects } = readOsmXml(xml);
  assert.deepEqual(
    objects.map((o) => [o.type, o.id, o.action]),
    [
      ['node', -1, 'create'],
      ['node', 5, 'modify'],
      ['way', 6, 'delete'],
      ['node', 7, 'modify'],
    ]
  );
});

test('visible="false" marks a deleted object and coordinates may be absent', () => {
  const { objects } = readOsmXml('<osm><node id="1" visible="false" version="2"/></osm>');
  assert.equal(objects[0].deleted, true);
  assert.equal(objects[0].lat, undefined);
});

test('only the newest version of an object is kept', () => {
  const xml = `<osm>
  <node id="1" version="1" lat="1" lon="1"/>
  <node id="1" version="3" lat="3" lon="3"/>
  <node id="1" version="2" lat="2" lon="2"/>
</osm>`;
  const { objects } = readOsmXml(xml);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].lat, '3');
});

test('object limit stops reading and reports truncation', () => {
  const xml = '<osm>' + [1, 2, 3, 4].map((i) => `<node id="${i}" lat="1" lon="1"/>`).join('') + '</osm>';
  const r = readOsmXml(xml, 2);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.objects.map((o) => o.id), [1, 2]);
  assert.equal(readOsmXml(xml, 4).truncated, true);
  assert.equal(readOsmXml(xml, 5).truncated, false);
});

test('unknown elements, comments and Overpass extras are skipped', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="Overpass API 0.7.62">
<note>The data included in this document is from www.openstreetmap.org.</note>
<meta osm_base="2024-01-01T00:00:00Z"/>
<bounds minlat="1" minlon="1" maxlat="2" maxlon="2"/>
<!-- <node id="99" lat="0" lon="0"/> -->
  <way id="10" version="2">
    <bounds minlat="1" minlon="1" maxlat="2" maxlon="2"/>
    <center lat="1.5" lon="1.5"/>
    <nd ref="1" lat="1" lon="1"/>
    <nd ref="2" lat="2" lon="2"/>
  </way>
  <area id="3600000001"><tag k="name" v="X"/></area>
</osm>`;
  const { objects } = readOsmXml(xml);
  assert.deepEqual(objects.map((o) => [o.type, o.id]), [['way', 10]]);
  assert.deepEqual(objects[0].nodes, [1, 2]);
});

test('tags are trimmed and empty ones dropped; bad ids are skipped', () => {
  const xml = `<osm>
  <node id="1" lat="1" lon="1"><tag k=" a " v=" b\tc "/><tag k="empty" v=" "/><tag k="" v="x"/></node>
  <node id="abc" lat="1" lon="1"/>
  <node id="2" lat="x" lon="1"/>
</osm>`;
  const { objects } = readOsmXml(xml);
  assert.deepEqual([...objects[0].tags], [['a', 'b c']]);
  assert.deepEqual(objects.map((o) => o.id), [1, 2]);
  assert.equal(objects[1].lat, undefined);
});

test('changeset element carries tags and no version', () => {
  const { objects } = readOsmXml('<osm><changeset id="5" user="u"><tag k="comment" v="c"/></changeset></osm>');
  assert.equal(objects[0].type, 'changeset');
  assert.equal(objects[0].version, undefined);
  assert.deepEqual([...objects[0].tags], [['comment', 'c']]);
});

test('helpers', () => {
  assert.equal(unescapeXml('&lt;a&gt; &amp; &apos;q&apos; &#x41;&#66;'), "<a> & 'q' AB");
  assert.equal(hardTrim(' abc  def '), 'abc  def');
  assert.equal(hardTrim(' \t abc  def \0 \r\n'), 'abc  def');
  assert.equal(hardTrim(' \n '), '');
});
