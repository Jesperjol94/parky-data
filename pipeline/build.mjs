// Builds the app's data file from the raw city data.
//   node data-pipeline/build.mjs <raw/ptillaten.json.gz> <out-dir>
//   optional 3rd arg: raw/osm.json.gz (junctions and pedestrian crossings) for the 10-metre zones
// Output: <out>/segments.json (+ .gz) and <out>/meta.json
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeSegment, isValidAt } from '../engine/normalize.js';
import { applyRegulation } from '../engine/regulation.js';
import { inheritFees } from '../engine/neighbours.js';
import { toWGS84 } from './sweref.mjs';
import { index, zonePieces, visibleParts, R_JUNCTION, R_CROSSING } from './zones.mjs';

const [src, outDir, osmSrc] = process.argv.slice(2);
const osm = osmSrc && fs.existsSync(osmSrc) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(osmSrc))) : null;
const grids = osm ? [index(osm.junctions, R_JUNCTION, 'j'), index(osm.crossings, R_CROSSING, 'c')] : [];
const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(src)));
const now = Date.now();
const r5 = (v) => Math.round(v * 1e5) / 1e5;

const groups = new Map();
let skipped = 0;
for (const f of raw.features) {
  if (!f.geometry || f.geometry.type !== 'LineString') { skipped++; continue; }
  if (!isValidAt(f.properties, now)) { skipped++; continue; }
  const k = JSON.stringify(f.geometry.coordinates);
  if (!groups.has(k)) groups.set(k, { coords: f.geometry.coordinates, recs: [] });
  groups.get(k).recs.push(f.properties);
}

// Official regulation texts (pipeline/fetch-rdt.mjs), when available: complete the data from the text.
const rdt = new Map();
if (fs.existsSync('rdt/rdt.jsonl.gz')) for (const l of zlib.gunzipSync(fs.readFileSync('rdt/rdt.jsonl.gz')).toString().split('\n')) if (l) { const r = JSON.parse(l); rdt.set(r.c, r); }
const today = new Date(now).toISOString().slice(0, 10);
const rq = { withText: 0, expired: 0, completed: 0, unread: 0 };
const segments = [];
let i = 0;
for (const { coords, recs } of groups.values()) {
  let seg = normalizeSegment(recs);
  const rec = rdt.get(seg.c);
  if (rec && !rec.err) {
    rq.withText++;
    seg = applyRegulation(seg, rec, today);
    if (!seg) { rq.expired++; continue; }
    if (seg.rx) rq.completed++;
    if (seg.ru) rq.unread++;
  }
  seg.i = i++;
  seg.g = coords.map(([x, y]) => toWGS84(x, y).map(r5)).filter((pt, j, arr) => j === 0 || pt[0] !== arr[j - 1][0] || pt[1] !== arr[j - 1][1]);
  if (grids.length && !seg.v) {
    const z = zonePieces(seg.g, grids);
    if (z.length) {
      // p: the drawn parts of the curb, trimmed 10 m from junctions and before pedestrian crossings.
      seg.p = visibleParts(seg.g, z);
      seg.x = z.map(({ g, k }) => ({ g, k }));
    }
  }
  segments.push(seg);
}

// Curbs without a street name in the city data: borrow the name (and district) of the nearest named curb within ~30 m.
{
  const named = segments.filter((s) => s.n);
  const mid = (s) => s.g[Math.floor(s.g.length / 2)];
  const cell = (p) => `${Math.floor(p[0] / 0.001)}:${Math.floor(p[1] / 0.0005)}`;
  const grid = new Map();
  for (const s of named) { const k = cell(mid(s)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); }
  let filled = 0;
  for (const s of segments) {
    if (s.n) continue;
    const m = mid(s); let best = null, bd = Infinity;
    const [cx, cy] = cell(m).split(':').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const o of grid.get(`${cx + dx}:${cy + dy}`) || []) {
      for (const q of o.g) { const d = Math.hypot((q[0] - m[0]) * 56000, (q[1] - m[1]) * 111000); if (d < bd) { bd = d; best = o; } }
    }
    if (best && bd < 30) { s.n = best.n; if (!s.d && best.d) s.d = best.d; filled++; }
  }
  console.log('names filled from neighbours:', filled, 'still unnamed:', segments.filter((s) => !s.n).length);
}

console.log('purpose spots given the street fee:', inheritFees(segments));

fs.mkdirSync(outDir, { recursive: true });
const junctions = osm ? osm.junctions.map((p) => p.map((v) => Math.round(v * 1e5) / 1e5)) : [];
const crossings = osm ? osm.crossings.map((p) => p.map((v) => Math.round(v * 1e5) / 1e5)) : [];
const content = { attribution: osm ? 'Stockholms stad · © OpenStreetMap' : 'Stockholms stad', segments, junctions, crossings };
// hash of the rules themselves (not the build time): the app downloads segments.json only when this changes
const hash = crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 16);
const body = JSON.stringify({ v: 1, built: new Date(now).toISOString(), hash, ...content });
fs.writeFileSync(path.join(outDir, 'segments.json'), body);
fs.writeFileSync(path.join(outDir, 'segments.json.gz'), zlib.gzipSync(body, { level: 9 }));
const stats = {
  built: new Date(now).toISOString(), source: 'Stockholms stad, LTF-Tolken (öppna data)', records: raw.features.length, skipped,
  segments: segments.length,
  regulationTexts: rq,
  uncertain: segments.filter((s) => s.u).length,
  reserved: segments.filter((s) => s.v).length,
  withCleaning: segments.filter((s) => s.s).length,
  withTimeLimit: segments.filter((s) => s.l || (s.o || []).some((w) => w.max)).length,
  withZones: segments.filter((s) => s.x).length,
  junctions: junctions.length, crossings: crossings.length,
  hash,
  bytes: body.length,
};
fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(stats, null, 2));
console.log(stats);
