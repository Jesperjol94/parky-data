// Adds the municipality boundary (`area`) and OSM junctions/crossings (10-metre rule) to processed RDT city files.
//   node cities/rdt-geo.mjs <dir with processed files, e.g. cities/rdt-out> <city> [<city> ...]
// Sources: © OpenStreetMap contributors (ODbL), Overpass API. Municipality = admin_level 7 with ref:se:scb = kommunkod.
// `area` is a GeoJSON Polygon/MultiPolygon (outer rings only), simplified to about 20 m. Junctions/crossings are
// queried only around the file's own segments (bbox of the segments + 300 m); a municipality whose segments span
// more than 0.3 square degrees is skipped for junctions and flagged `junctionsMissing: true` (never silently empty).
import fs from 'node:fs';
import path from 'node:path';

const [dir, ...cities] = process.argv.slice(2);
if (!dir || !cities.length) { console.error('usage: node cities/rdt-geo.mjs <dir> <city> [<city> ...]'); process.exit(1); }
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const UA = 'Parky/2.0 (https://parky.se; info@parky.se) municipality boundaries';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r6 = (v) => Math.round(v * 1e6) / 1e6;

async function overpass(q) {
  for (let attempt = 0; attempt < 4; attempt++) for (const url of ENDPOINTS) {
    if (attempt) await sleep(15000 * attempt);
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, signal: AbortSignal.timeout(200000) });
      if (!r.ok) { console.log('overpass', url, r.status); await sleep(5000); continue; }
      return (await r.json()).elements;
    } catch (e) { console.log('overpass', url, 'failed', e.message); }
  }
  throw new Error('overpass failed');
}

// Join the outer ways of a relation into closed rings.
function rings(rel) {
  const ways = (rel.members || []).filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry?.length > 1).map((m) => m.geometry.map((p) => [p.lon, p.lat]));
  const eq = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  const out = [];
  while (ways.length) {
    let ring = ways.pop();
    for (let guard = 0; guard < 100000 && !eq(ring[0], ring[ring.length - 1]); guard++) {
      const end = ring[ring.length - 1];
      const i = ways.findIndex((w) => eq(w[0], end) || eq(w[w.length - 1], end));
      if (i < 0) break;
      const [w] = ways.splice(i, 1);
      ring = ring.concat(eq(w[0], end) ? w.slice(1) : w.slice().reverse().slice(1));
    }
    if (ring.length > 3 && eq(ring[0], ring[ring.length - 1])) out.push(ring); // open rings (data errors) are dropped
  }
  return out;
}

// Douglas-Peucker, tolerance in degrees (0.0002 deg ≈ 22 m north-south).
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const d = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); let m = -1, mi = 0;
    for (let k = i + 1; k < j; k++) { const v = d(pts[k], pts[i], pts[j]); if (v > m) { m = v; mi = k; } }
    if (m > tol) { keep[mi] = 1; stack.push([i, mi], [mi, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

async function boundary(code, name) {
  // By SCB code first; many municipalities lack the tag, so fall back to the name ("Danderyds kommun").
  let els = await overpass(`[out:json][timeout:180];rel["boundary"="administrative"]["admin_level"="7"]["ref:se:scb"="${code}"];out geom;`);
  let rel = els.find((e) => e.type === 'relation');
  if (!rel) {
    await sleep(3000);
    els = await overpass(`[out:json][timeout:180];rel["boundary"="administrative"]["admin_level"="7"]["name"~"^${name}s? (kommun|Municipality)"];out geom;`);
    const all = els.filter((e) => e.type === 'relation');
    rel = all.length === 1 ? all[0] : null; // ambiguous or none: no area rather than a wrong one
  }
  if (!rel) return null;
  const polys = rings(rel).map((r) => simplify(r, 0.0002).map(([x, y]) => [r6(x), r6(y)]));
  if (!polys.length) return null;
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys } : { type: 'MultiPolygon', coordinates: polys.map((p) => [p]) };
}

const ROADS = '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street)$';
async function junctionsCrossings(segments) {
  let w = 180, e = -180, s = 90, n = -90;
  for (const seg of segments) for (const [x, y] of seg.g) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const pad = 0.003; w -= pad; s -= pad / 2; e += pad; n += pad / 2;
  if ((e - w) * (n - s) > 0.3) return null;
  const tiles = [], N = Math.max(1, Math.ceil(Math.sqrt(((e - w) * (n - s)) / 0.008)));
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) tiles.push([s + (n - s) * i / N, w + (e - w) * j / N, s + (n - s) * (i + 1) / N, w + (e - w) * (j + 1) / N].map((v) => v.toFixed(5)).join(','));
  const nodes = new Map(), degree = new Map(), crossings = [], seenC = new Set(), seenW = new Set();
  for (const bb of tiles) {
    const els = await overpass(`[out:json][timeout:180];(way["highway"~"${ROADS}"](${bb}););out body geom;node["highway"="crossing"](${bb});out body;`);
    for (const el of els) {
      if (el.type === 'node' && el.tags?.highway === 'crossing' && !seenC.has(el.id)) {
        seenC.add(el.id);
        if (el.tags.crossing === 'no' || el.tags.crossing === 'unmarked' || el.tags['crossing:markings'] === 'no') continue;
        crossings.push([r6(el.lon), r6(el.lat)]);
      } else if (el.type === 'way' && el.nodes && el.geometry && !seenW.has(el.id)) {
        seenW.add(el.id);
        el.nodes.forEach((id, i) => {
          if (el.geometry[i]) nodes.set(id, [r6(el.geometry[i].lon), r6(el.geometry[i].lat)]);
          degree.set(id, (degree.get(id) || 0) + (i === 0 || i === el.nodes.length - 1 ? 1 : 2));
        });
      }
    }
    await sleep(5000);
  }
  const junctions = [];
  for (const [id, d] of degree) if (d >= 3 && nodes.has(id)) junctions.push(nodes.get(id));
  return { junctions, crossings };
}

for (const city of cities) {
  const file = path.join(dir, `${city}.json`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const area = await boundary(c.kommunkod, c.name).catch((e) => { console.log(city, 'boundary failed', e.message); return null; });
  if (area) c.area = area; else console.log(city, 'no boundary found (kommunkod', c.kommunkod + ')');
  const jc = process.env.NO_JUNCTIONS ? null : await junctionsCrossings(c.segments).catch((e) => { console.log(city, 'junctions failed', e.message); return null; });
  if (jc) { c.junctions = jc.junctions; c.crossings = jc.crossings; delete c.junctionsMissing; } else c.junctionsMissing = true;
  c.attribution = (c.attribution || '').replace(/ ?· ?© OpenStreetMap contributors \(ODbL\)/, '') + ' · © OpenStreetMap contributors (ODbL)';
  fs.writeFileSync(file, JSON.stringify(c));
  console.log(city, 'area', area ? area.type + ' ' + JSON.stringify(area).length + ' bytes' : 'none', 'junctions', jc ? jc.junctions.length : 'missing', 'crossings', jc ? jc.crossings.length : 'missing');
}
