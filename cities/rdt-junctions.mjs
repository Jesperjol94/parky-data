// Adds OpenStreetMap junctions and marked crossings (the 10-metre rule) to the PUBLISHED RDT municipality files in
// cities/rdt/. Unlike rdt-geo.mjs it does not query the whole bounding box (rural municipalities span huge areas):
// only the ~2 km tiles that contain a segment are queried, so sprawling municipalities work too.
//   node cities/rdt-junctions.mjs cities/rdt [group] [groups] [minutes]   e.g. group 0 of 3, stop after 300 minutes
// Resumable: municipalities with `junctionsBuilt` are skipped. Writes the file and index.json after each municipality.
// Sources: © OpenStreetMap contributors (ODbL), Overpass API.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [dir, gArg, nArg, minArg] = process.argv.slice(2);
const GROUP = +gArg || 0, GROUPS = +nArg || 1, BUDGET = (+minArg || 300) * 60000, t0 = Date.now();
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const UA = 'Parky/2.0 (https://parky.se; info@parky.se) junctions for the 10-metre rule';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const TW = 0.04, TH = 0.02, PAD = 0.0006; // tile ≈ 2.2 × 2.2 km; pad ≈ 40–60 m so junctions just outside a tile count too
const ROADS = '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street)$';

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

async function junctionsCrossings(segments) {
  const tiles = tilesOf(segments);
  const nodes = new Map(), degree = new Map(), crossings = [], seenC = new Set(), seenW = new Set();
  let n = 0;
  for (const bb of tiles) {
    const els = await overpass(`[out:json][timeout:90];(way["highway"~"${ROADS}"](${bb}););out body geom;node["highway"="crossing"](${bb});out body;`);
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
    if (++n % 10 === 0) console.log(`  ${n}/${tiles.length} tiles`);
    await sleep(2000);
  }
  const junctions = [];
  for (const [id, d] of degree) if (d >= 3 && nodes.has(id)) junctions.push(nodes.get(id));
  return { junctions, crossings, tiles: tiles.length };
}

const idxFile = path.join(dir, 'index.json');
const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
const byId = new Map(idx.cities.map((r) => [r.id, r]));
let done = 0;
for (const row of idx.cities.slice().sort((a, b) => a.id.localeCompare(b.id)).filter((_, i) => i % GROUPS === GROUP)) {
  if (Date.now() - t0 > BUDGET) break;
  const file = path.join(dir, `${row.id}.json`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (c.junctionsBuilt) continue;
  let jc;
  try { jc = await junctionsCrossings(c.segments); } catch (e) { console.log(row.id, 'failed:', e.message); continue; }
  c.junctions = jc.junctions; c.crossings = jc.crossings; c.junctionsBuilt = new Date().toISOString().slice(0, 10); delete c.junctionsMissing;
  c.attribution = (c.attribution || '').replace(/ ?· ?© OpenStreetMap contributors \(ODbL\)/, '') + ' · © OpenStreetMap contributors (ODbL)';
  c.built = new Date().toISOString();
  delete c.hash;
  const text = JSON.stringify(c);
  c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
  const final = JSON.stringify(c);
  fs.writeFileSync(file, final);
  Object.assign(byId.get(row.id), { hash: c.hash, built: c.built, bytes: final.length, junctions: jc.junctions.length > 0 });
  idx.built = c.built;
  fs.writeFileSync(idxFile, JSON.stringify(idx));
  done++;
  console.log(`${row.id}: ${jc.tiles} tiles, ${jc.junctions.length} junctions, ${jc.crossings.length} crossings, ${Math.round((Date.now() - t0) / 60000)} min`);
}
console.log(`junctions added for ${done} municipalities; without: ${idx.cities.filter((r) => !JSON.parse(fs.readFileSync(path.join(dir, r.id + '.json'), 'utf8')).junctionsBuilt).length}`);
