// Turns what the user types into the download box into API requests, a port
// of url_to_api() from osmapi.php. Accepted forms:
//
//   osm.org object, changeset and map URLs, including #map=z/lat/lon
//   API 0.6 URLs, relative or absolute
//   Overpass "interpreter?data=" URLs
//   a list of objects: "n123, w45, r7" or "node 123.4" (version), "w45!"
//     (way or relation with its members), "n12*" (parents of a node)
//   any other http(s) URL, taken as a source of OSM XML
//
// Pure module, no vscode API.

// Half the side of the box downloaded around a map position, in degrees.
export const BBOX_RADIUS = 0.0003;

const TYPES: Record<string, string> = { n: 'node', w: 'way', r: 'relation', c: 'changeset' };
const OBJECT_RE = /^(n|nd|node|w|wy|way|r|rel|relation|c|changeset)[\s/]*([0-9]+)(?:\.([0-9]+))?([!*]?)$/;
const LIST_RE = /^!?\s*[a-y]+[/\s]*[0-9.]+[!*]?(?:\s*,\s*[a-y]+[/\s]*[0-9.]+[!*]?)*$/;

function bbox(lat: number, lon: number, apiBase: string): string {
  const f = (n: number) => n.toFixed(5);
  return `${apiBase}map?bbox=${f(lon - BBOX_RADIUS)},${f(lat - BBOX_RADIUS)},${f(lon + BBOX_RADIUS)},${f(lat + BBOX_RADIUS)}`;
}

// Returns the URLs to fetch, or undefined when the input is not understood.
export function resolveInput(input: string, apiBase: string): string[] | undefined {
  const s = input.trim().replace(/,+/g, ',').replace(/^,|,$/g, '').trim();
  if (!s) {
    return undefined;
  }
  let m: RegExpExecArray | null;

  if ((m = /\/api\/0\.6\/((?:node|way|relation|changeset)\/[0-9]+(?:\/[0-9a-z]+)?)$/.exec(s))) {
    return [apiBase + m[1]];
  }
  if ((m = /\/api\/0\.6\/((nodes|ways|relations)\?\2=[0-9]+.*)$/.exec(s))) {
    return [apiBase + m[1]];
  }
  if ((m = /\/api\/0\.6\/(map\?bbox=.*)$/.exec(s))) {
    return [apiBase + m[1]];
  }
  if ((m = /\.org\/(?:browse\/)?((node|way|relation)\/[0-9]+)(?:\/[a-z]+)?(?:#.*)?$/.exec(s))) {
    return [apiBase + m[1] + (m[2] === 'way' ? '/full' : '')];
  }
  if ((m = /\.org\/(?:browse\/)?(changeset\/[0-9]+)(?:#.*)?$/.exec(s))) {
    return [`${apiBase}${m[1]}/download`];
  }
  if (/\/interpreter\?data=.+$/.test(s)) {
    return [/^https?:\/\//.test(s) ? s : `https://${s}`];
  }

  if (LIST_RE.test(s)) {
    const fullAll = s.startsWith('!');
    const urls: string[] = [];
    for (const part of s.replace(/^!\s*/, '').split(',')) {
      const o = OBJECT_RE.exec(part.trim());
      if (!o) {
        continue;
      }
      const [, word, id, version, flag] = o;
      const type = TYPES[word[0]];
      if (type === 'changeset') {
        urls.push(`${apiBase}changeset/${id}/download`);
        continue;
      }
      let u = `${apiBase}${type}/${id}`;
      if (version) {
        u += `/${version}`;
      } else if (flag === '*') {
        if (type === 'node') {
          urls.push(`${u}/ways`);
        }
        u += '/relations';
      } else if (type !== 'node' && (flag === '!' || fullAll)) {
        u += '/full';
      }
      urls.push(u);
    }
    return urls.length ? urls : undefined;
  }

  // A web map URL: a small box around its center.
  let lat: string | undefined;
  let lon: string | undefined;
  if ((m = /[0-9]{1,2}\/(-?[0-9]{1,2}\.[0-9]+)\/(-?[0-9]{1,3}\.[0-9]+)/.exec(s))) {
    [, lat, lon] = m;
  }
  if ((m = /lat=(-?[0-9]{1,2}\.[0-9]+)/i.exec(s))) {
    lat = m[1];
  }
  if ((m = /lon=(-?[0-9]{1,3}\.[0-9]+)/i.exec(s))) {
    lon = m[1];
  }
  if (lat !== undefined && lon !== undefined) {
    return [bbox(Number(lat), Number(lon), apiBase)];
  }
  // A pair of coordinates, as copied from a node header or a GPS app.
  if ((m = /^(-?[0-9]{1,2}\.[0-9]+)\s*,\s*(-?[0-9]{1,3}\.[0-9]+)$/.exec(s))) {
    return [bbox(Number(m[1]), Number(m[2]), apiBase)];
  }

  if (/^https?:\/\/\S+$/.test(s)) {
    return [s];
  }
  return undefined;
}
