// Adds municipality boundaries (`area`) to the PUBLISHED files in cities/rdt/ that still lack one (the first pass ran 5 chunks in
// parallel and Overpass rate-limited most of them). Sequential, polite, resumable: municipalities that already have an area are skipped.
//   node cities/rdt-bounds.mjs cities/rdt [max]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [dir, maxArg] = process.argv.slice(2);
const MAX = maxArg ? +maxArg : Infinity;
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

const idxFile = path.join(dir, 'index.json');
const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
let done = 0, failed = 0;
for (const row of idx.cities) {
  if (row.area || done + failed >= MAX) continue;
  const file = path.join(dir, `${row.id}.json`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const area = await boundary(c.kommunkod, c.name).catch((e) => { console.log(row.id, 'boundary failed', e.message); return null; });
  await sleep(6000);
  if (!area) { failed++; console.log(row.id, 'no boundary'); continue; }
  c.area = area; delete c.hash;
  const text = JSON.stringify(c);
  c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
  const final = JSON.stringify(c);
  fs.writeFileSync(file, final);
  Object.assign(row, { hash: c.hash, bytes: final.length, area: true });
  done++; console.log(row.id, 'area', area.type, JSON.stringify(area).length, 'bytes');
  if (done % 10 === 0) fs.writeFileSync(idxFile, JSON.stringify(idx)); // keep progress if the run is cut off
}
fs.writeFileSync(idxFile, JSON.stringify(idx));
console.log(`boundaries added ${done}, missing ${failed}, with area now ${idx.cities.filter((r) => r.area).length}/${idx.cities.length}`);
