// osmChange and changeset XML for the API, a port of create_osc() and
// create_changeset() from osmapi.php. Pure module, no vscode API.

import { Change } from './diff';
import { OsmObject } from './model';

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function tagsXml(o: OsmObject, indent: string): string {
  let s = '';
  for (const [k, v] of o.tags) {
    s += `${indent}<tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>\n`;
  }
  return s;
}

function objectXml(o: OsmObject, changeset: number | undefined, indent: string, action?: string): string {
  let s = `${indent}<${o.type} id="${o.id}" version="${o.version ?? 1}"`;
  if (o.type === 'node' && o.lat !== undefined && o.lon !== undefined) {
    s += ` lat="${o.lat}" lon="${o.lon}"`;
  }
  if (changeset !== undefined) {
    s += ` changeset="${changeset}"`;
  }
  if (action) {
    s += ` action="${action}"`;
  }
  if (!o.nodes?.length && !o.members?.length && o.tags.size === 0) {
    return `${s}/>\n`;
  }
  s += '>\n';
  for (const nd of o.nodes ?? []) {
    s += `${indent}  <nd ref="${nd}"/>\n`;
  }
  for (const m of o.members ?? []) {
    s += `${indent}  <member type="${m.type}" ref="${m.id}" role="${escapeXml(m.role)}"/>\n`;
  }
  s += tagsXml(o, `${indent}  `);
  return `${s}${indent}</${o.type}>\n`;
}

// OSM XML of the whole document for JOSM and other editors, a port of
// create_osm(): changed objects carry an action attribute, untouched ones
// none. Objects come in document order.
export function createOsm(objects: { object: OsmObject; action?: string }[], generator: string): string {
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" upload="true" generator="${escapeXml(generator)}">\n`;
  for (const { object: o, action } of objects) {
    s += objectXml(o, undefined, '  ', action);
  }
  return `${s}</osm>\n`;
}

// Changes must already be in upload order (see compareChanges); consecutive
// changes with the same action share one block.
export function createOsc(changes: Change[], generator: string, changeset?: number): string {
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<osmChange version="0.6" generator="${escapeXml(generator)}">\n`;
  let last = '';
  for (const c of changes) {
    if (c.action !== last) {
      if (last) {
        s += `  </${last}>\n`;
      }
      s += `  <${c.action}>\n`;
      last = c.action;
    }
    s += objectXml(c.object, changeset, '    ');
  }
  if (last) {
    s += `  </${last}>\n`;
  }
  return `${s}</osmChange>\n`;
}

// Tags of the changeset block plus comment and created_by; empty values are
// dropped as Level0 does.
export function createChangesetXml(tags: Map<string, string>, comment: string, generator: string): string {
  const all = new Map(tags);
  if (comment.trim()) {
    all.set('comment', comment.trim());
  }
  all.set('created_by', generator);
  let s = '<?xml version="1.0" encoding="UTF-8"?>\n<osm>\n  <changeset>\n';
  for (const [k, v] of all) {
    if (v.trim()) {
      s += `    <tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>\n`;
    }
  }
  return `${s}  </changeset>\n</osm>\n`;
}
