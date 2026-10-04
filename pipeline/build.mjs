// Builds the app's data file from the raw city data.
//   node data-pipeline/build.mjs <raw/ptillaten.json.gz> <out-dir>
//   optional 3rd arg: raw/osm.json.gz (junctions and pedestrian crossings) for the 10-metre zones
// Output: <out>/segments.json (+ .gz) and <out>/meta.json
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeSegment, isValidAt } from '../engine/normalize.js';
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

const segments = [];
let i = 0;
for (const { coords, recs } of groups.values()) {
  const seg = normalizeSegment(recs);
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
