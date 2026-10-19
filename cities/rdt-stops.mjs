// Adds OpenStreetMap bus stops and level crossings to the published RDT municipality files in cities/rdt/, for the
// national rules the map draws without signs (Trafikförordningen 3 kap. 53–55 §§, Transportstyrelsen "Stanna och parkera"):
//   - no parking within 20 m before and 5 m after a bus-stop sign (highway=bus_stop)            → c.busStops
//   - no stopping or parking within 30 m before a level crossing (railway=level_crossing)       → c.levelCrossings
// Same tiles as cities/rdt-junctions.mjs (~2 km around the segments only). cities/rdt-trim.mjs turns them into the
// trimmed lines the app draws.
//   node cities/rdt-stops.mjs cities/rdt [group] [groups] [minutes]
// Resumable: municipalities with `stopsBuilt` are skipped. Sources: © OpenStreetMap contributors (ODbL), Overpass API.
import fs from 'node:fs';
import path from 'node:path';

const [dir, gArg, nArg, minArg] = process.argv.slice(2);
const GROUP = +gArg || 0, GROUPS = +nArg || 1, BUDGET = (+minArg || 300) * 60000, t0 = Date.now();
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const UA = 'Parky/2.0 (https://parky.se; info@parky.se) bus stops and level crossings for the parking rules';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const TW = 0.04, TH = 0.02, PAD = 0.0006;

let ep = 0;
async function overpass(q) {
  for (let attempt = 0; attempt < 4; attempt++) for (let k = 0; k < ENDPOINTS.length; k++) {
    const url = ENDPOINTS[(ep + k) % ENDPOINTS.length];
    if (attempt) await sleep(10000 * attempt);
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, signal: AbortSignal.timeout(120000) });
      if (!r.ok) { console.log('overpass', url, r.status); await sleep(r.status === 429 ? 20000 : 5000); continue; }
      ep = (ep + k) % ENDPOINTS.length;
      return (await r.json()).elements;
    } catch (e) { console.log('overpass', url, 'failed', e.message); }
  }
  throw new Error('overpass failed');
}

function tilesOf(segments) {
  const t = new Set();
  for (const s of segments) for (const [x, y] of s.g) t.add(`${Math.floor(x / TW)},${Math.floor(y / TH)}`);
  return [...t].map((k) => k.split(',').map(Number)).map(([i, j]) => [j * TH - PAD, i * TW - PAD, (j + 1) * TH + PAD, (i + 1) * TW + PAD].map((v) => v.toFixed(5)).join(','));
}

// Tiles are batched (20 boxes a query): bus stops and level crossings are few, so the answers stay small.
async function fetchStops(segments) {
  const tiles = tilesOf(segments);
  const bus = new Map(), lx = new Map();
  for (let k = 0; k < tiles.length; k += 20) {
    const q = `[out:json][timeout:120];(${tiles.slice(k, k + 20).map((bb) => `node["highway"="bus_stop"](${bb});node["railway"="level_crossing"](${bb});`).join('')});out body;`;
    for (const el of await overpass(q)) {
      if (el.type !== 'node') continue;
      const p = [r5(el.lon), r5(el.lat)];
      if (el.tags?.highway === 'bus_stop') bus.set(el.id, p);
      else if (el.tags?.railway === 'level_crossing') lx.set(el.id, p);
    }
    await sleep(2000);
  }
  return { busStops: [...bus.values()], levelCrossings: [...lx.values()], tiles: tiles.length };
}

const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
let done = 0;
for (const row of idx.cities.slice().sort((a, b) => a.id.localeCompare(b.id)).filter((_, i) => i % GROUPS === GROUP)) {
  if (Date.now() - t0 > BUDGET) break;
  const file = path.join(dir, `${row.id}.json`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (c.stopsBuilt) continue;
  let r;
  try { r = await fetchStops(c.segments); } catch (e) { console.log(row.id, 'failed:', e.message); continue; }
  c.busStops = r.busStops; c.levelCrossings = r.levelCrossings; c.stopsBuilt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(file, JSON.stringify(c)); // hash and index: cities/rdt-trim.mjs and rdt-index.mjs, run after merging
  done++;
  console.log(`${row.id}: ${r.tiles} tiles, ${r.busStops.length} bus stops, ${r.levelCrossings.length} level crossings, ${Math.round((Date.now() - t0) / 60000)} min`);
}
console.log(`stops added for ${done} municipalities`);
