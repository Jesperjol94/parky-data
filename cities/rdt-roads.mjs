// Fetches the OpenStreetMap roads around every candidate hop (see cities/rdt-split.mjs) into cities/rdt/check/roads.json:
// { <municipality id>: [ [ [lon,lat], ... ], ... ] }. One Overpass query per municipality, a small box (~150 m) around
// each candidate leg. Resumable: municipalities already in the file are skipped unless --refresh.
//   node cities/rdt-roads.mjs cities/rdt [--refresh]
// Sources: © OpenStreetMap contributors (ODbL), Overpass API.
import fs from 'node:fs';
import path from 'node:path';
import { candidateHops } from './rdt-split.mjs';

const [dir, flag] = process.argv.slice(2);
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const UA = 'Parky/2.0 (https://parky.se; info@parky.se) roads around stitched regulation lines';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const PAD = 0.0015; // ≈ 80–170 m around the leg's box
const ROADS = '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|track|pedestrian|cycleway|footway|path)$';

let ep = 0;
async function overpass(q) {
  for (let attempt = 0; attempt < 4; attempt++) for (let k = 0; k < ENDPOINTS.length; k++) {
    const url = ENDPOINTS[(ep + k) % ENDPOINTS.length];
    if (attempt) await sleep(10000 * attempt);
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      ep = (ep + k) % ENDPOINTS.length;
      return (await r.json()).elements || [];
    } catch (e) { console.log(`  ${url}: ${e.message}`); }
  }
  throw new Error('overpass failed');
}

const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const outFile = path.join(dir, 'check', 'roads.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const out = fs.existsSync(outFile) && flag !== '--refresh' ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
let queries = 0;
for (const row of idx.cities) {
  if (out[row.id]) continue;
  const c = JSON.parse(fs.readFileSync(path.join(dir, `${row.id}.json`), 'utf8'));
  const boxes = [];
  for (const s of c.segments) for (const i of candidateHops(s.g)) {
    const [a, b] = [s.g[i - 1], s.g[i]];
    boxes.push(`(${r6(Math.min(a[1], b[1]) - PAD)},${r6(Math.min(a[0], b[0]) - PAD)},${r6(Math.max(a[1], b[1]) + PAD)},${r6(Math.max(a[0], b[0]) + PAD)})`);
  }
  if (!boxes.length) { out[row.id] = []; continue; }
  const roads = [];
  for (let k = 0; k < boxes.length; k += 60) { // keep each query modest
    const q = `[out:json][timeout:120];(${boxes.slice(k, k + 60).map((bb) => `way["highway"~"${ROADS}"]${bb};`).join('')});out geom;`;
    const els = await overpass(q); queries++;
    for (const w of els) if (w.geometry) roads.push(w.geometry.map((p) => [r6(p.lon), r6(p.lat)]));
    await sleep(1500);
  }
  out[row.id] = roads;
  console.log(`${row.id}: ${boxes.length} candidate hops, ${roads.length} roads`);
  fs.writeFileSync(outFile, JSON.stringify(out));
}
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`${queries} queries; ${Object.keys(out).length} municipalities in ${outFile}`);
