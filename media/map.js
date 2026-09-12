// Map panel of the Level0L extension: draws what the document has, follows
// the cursor, and lets the user pick an area or a point. Talks to the
// extension with postMessage; see mapview.ts for the messages.
(function () {
  const vscode = acquireVsCodeApi();
  const state = vscode.getState() || {};

  const map = L.map('map', { zoomControl: true, attributionControl: true });
  map.attributionControl.setPrefix('');
  let tiles;
  // Tiles come through the extension, which sends the User-Agent tile
  // servers require; the webview asks for each and gets a data: URI back.
  const pendingTiles = new Map();
  const ProxiedTiles = L.TileLayer.extend({
    createTile(coords, done) {
      const img = document.createElement('img');
      img.alt = '';
      const key = `${coords.z}/${coords.x}/${coords.y}`;
      pendingTiles.set(key, { img, done });
      post({ type: 'tile', key, z: coords.z, x: coords.x, y: coords.y });
      return img;
    },
  });
  let box; // L.Rectangle of the selected area
  let mode = ''; // '', 'select', 'pick'
  const ways = L.layerGroup().addTo(map);
  const nodes = L.layerGroup().addTo(map);
  const layers = new Map(); // "way10" -> layer
  let data = { nodes: [], ways: [], relations: [] };
  let focused = -1; // header line of the object under the cursor
  let hasView = Boolean(state.center);

  if (state.center) {
    map.setView(state.center, state.zoom);
  } else {
    map.setView([30, 0], 2);
  }
  map.on('moveend', () => {
    vscode.setState({ ...vscode.getState(), center: map.getCenter(), zoom: map.getZoom() });
    post({ type: 'view', bbox: viewBbox() });
  });

  function post(message) {
    vscode.postMessage(message);
  }

  function viewBbox() {
    const b = map.getBounds();
    return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
  }

  const STYLE = {
    way: { color: '#1f6fd6', weight: 4, opacity: 0.85 },
    wayIncomplete: { color: '#1f6fd6', weight: 4, opacity: 0.85, dashArray: '6 6' },
    wayDeleted: { color: '#c0392b', weight: 4, opacity: 0.7, dashArray: '2 6' },
    node: { radius: 5, color: '#1f6fd6', fillColor: '#ffffff', fillOpacity: 1, weight: 2 },
    nodeTagged: { radius: 6, color: '#1f6fd6', fillColor: '#1f6fd6', fillOpacity: 0.9, weight: 2 },
    nodeNew: { radius: 6, color: '#1e8449', fillColor: '#1e8449', fillOpacity: 0.9, weight: 2 },
    nodeDeleted: { radius: 5, color: '#c0392b', fillColor: '#c0392b', fillOpacity: 0.6, weight: 2 },
    focus: { color: '#f39c12', fillColor: '#f39c12' },
  };

  function wayStyle(w) {
    return w.deleted ? STYLE.wayDeleted : w.complete ? STYLE.way : STYLE.wayIncomplete;
  }

  function nodeStyle(n) {
    return n.deleted ? STYLE.nodeDeleted : Number(n.id) < 0 ? STYLE.nodeNew : n.tagged ? STYLE.nodeTagged : STYLE.node;
  }

  function draw() {
    ways.clearLayers();
    nodes.clearLayers();
    layers.clear();
    for (const w of data.ways) {
      if (w.points.length < 2) {
        continue;
      }
      const layer = L.polyline(w.points, wayStyle(w)).addTo(ways);
      layer.bindTooltip(w.label, { sticky: true });
      layer.on('click', () => post({ type: 'select', line: w.line }));
      layers.set('way' + w.id, layer);
    }
    for (const n of data.nodes) {
      const layer = L.circleMarker(n.latlon, nodeStyle(n)).addTo(nodes);
      layer.bindTooltip(n.label);
      layer.on('click', () => post({ type: 'select', line: n.line }));
      layers.set('node' + n.id, layer);
    }
    applyFocus(false);
  }

  function focusLayers() {
    if (focused < 0) {
      return [];
    }
    const r = data.relations.find((x) => x.line === focused);
    if (r) {
      return [...r.ways.map((id) => layers.get('way' + id)), ...r.nodes.map((id) => layers.get('node' + id))].filter(Boolean);
    }
    const o = data.ways.find((x) => x.line === focused) || data.nodes.find((x) => x.line === focused);
    const l = o && layers.get((o.points ? 'way' : 'node') + o.id);
    return l ? [l] : [];
  }

  function applyFocus(pan) {
    for (const [key, layer] of layers) {
      const w = data.ways.find((x) => 'way' + x.id === key);
      const n = data.nodes.find((x) => 'node' + x.id === key);
      layer.setStyle(w ? wayStyle(w) : nodeStyle(n));
    }
    const chosen = focusLayers();
    for (const layer of chosen) {
      layer.setStyle(STYLE.focus);
      layer.bringToFront();
    }
    if (pan && chosen.length) {
      const group = L.featureGroup(chosen);
      const b = group.getBounds();
      if (!map.getBounds().contains(b)) {
        map.fitBounds(b, { maxZoom: 18, padding: [40, 40] });
      }
    }
  }

  function setMode(next) {
    mode = mode === next ? '' : next;
    document.getElementById('select').classList.toggle('active', mode === 'select');
    document.getElementById('pick').classList.toggle('active', mode === 'pick');
    document.getElementById('map').className = mode === 'select' ? 'selecting' : mode === 'pick' ? 'picking' : '';
    if (mode === 'select') {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }

  function setBox(bounds) {
    if (box) {
      box.remove();
      box = undefined;
    }
    if (bounds) {
      box = L.rectangle(bounds, { color: '#f39c12', weight: 2, fillOpacity: 0.08, interactive: false }).addTo(map);
    }
    document.getElementById('clear').disabled = !box;
    const b = box ? box.getBounds() : undefined;
    post({ type: 'bbox', bbox: b ? { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() } : undefined });
    document.getElementById('status').textContent = b ? `${b.getSouth().toFixed(5)},${b.getWest().toFixed(5)} to ${b.getNorth().toFixed(5)},${b.getEast().toFixed(5)}` : '';
    vscode.setState({ ...vscode.getState(), box: b ? [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]] : undefined });
  }

  // Rectangle drawing in select mode.
  let dragStart;
  map.on('mousedown', (e) => {
    if (mode !== 'select') {
      return;
    }
    dragStart = e.latlng;
    if (box) {
      box.remove();
    }
    box = L.rectangle([dragStart, dragStart], { color: '#f39c12', weight: 2, fillOpacity: 0.08, interactive: false }).addTo(map);
  });
  map.on('mousemove', (e) => {
    if (mode === 'select' && dragStart && box) {
      box.setBounds([dragStart, e.latlng]);
    }
  });
  map.on('mouseup', (e) => {
    if (mode === 'select' && dragStart) {
      const bounds = L.latLngBounds(dragStart, e.latlng);
      dragStart = undefined;
      setMode('');
      if (bounds.getSouth() === bounds.getNorth() || bounds.getWest() === bounds.getEast()) {
        setBox(undefined);
      } else {
        setBox(bounds);
      }
    }
  });
  map.on('click', (e) => {
    if (mode === 'pick') {
      setMode('');
      post({ type: 'point', lat: Number(e.latlng.lat.toFixed(7)), lon: Number(e.latlng.lng.toFixed(7)) });
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mode) {
      dragStart = undefined;
      setMode('');
    }
  });

  document.getElementById('select').addEventListener('click', () => setMode('select'));
  document.getElementById('pick').addEventListener('click', () => setMode('pick'));
  document.getElementById('clear').addEventListener('click', () => setBox(undefined));
  document.getElementById('download').addEventListener('click', () => {
    const b = box ? box.getBounds() : map.getBounds();
    post({ type: 'download', bbox: { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() }, drawn: Boolean(box) });
  });
  document.getElementById('fit').addEventListener('click', () => fitData());

  function fitData() {
    if (data.nodes.length) {
      map.fitBounds(L.latLngBounds(data.nodes.map((n) => n.latlon)), { maxZoom: 18, padding: [40, 40] });
    }
  }

  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.type === 'init') {
      if (tiles) {
        tiles.remove();
      }
      tiles = new ProxiedTiles('', { attribution: m.attribution, maxZoom: m.maxZoom || 19 }).addTo(map);
      if (state.box) {
        setBox(L.latLngBounds(state.box));
      }
    } else if (m.type === 'data') {
      const first = data.nodes.length === 0 && m.data.nodes.length > 0;
      data = m.data;
      draw();
      if (first && !hasView) {
        fitData();
        hasView = true;
      }
    } else if (m.type === 'focus') {
      const line = m.line === undefined ? -1 : m.line;
      const changed = line !== focused;
      focused = line;
      applyFocus(changed);
    } else if (m.type === 'fit') {
      fitData();
    } else if (m.type === 'tile') {
      const p = pendingTiles.get(m.key);
      pendingTiles.delete(m.key);
      if (!p) {
        return;
      }
      if (!m.src) {
        p.done(new Error('tile'), p.img);
        return;
      }
      p.img.onload = () => p.done(null, p.img);
      p.img.onerror = () => p.done(new Error('tile'), p.img);
      p.img.src = m.src;
    }
  });

  post({ type: 'ready' });
})();
