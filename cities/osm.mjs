// OpenStreetMap data for a new city (Overpass API, ODbL "© OpenStreetMap contributors"), same method as
// pipeline/fetch-osm.mjs for Stockholm: road junctions and marked pedestrian crossings for the 10-metre rule,
// plus named street centre lines so curbs without a name in the city data (Malmö) can be named.
//   node cities/osm.mjs <city>  →  cities/raw/<city>-osm.json.gz = { junctions, crossings, streets: [{ n, g }] }
import fs from 'node:fs';
import zlib from 'node:zlib';

export const BBOX = { goteborg: '57.55,11.69,57.87,12.18', malmo: '55.52,12.89,55.63,13.11' };
const city = process.argv[2];
if (!BBOX[city]) { console.error('usage: node cities/osm.mjs <' + Object.keys(BBOX).join('|') + '>'); process.exit(1); }
const ROADS = '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street)$';
const [S, W, N, E] = BBOX[city].split(',').map(Number);
const tiles = [];
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tiles.push([S + (N - S) * i / 3, W + (E - W) * j / 3, S + (N - S) * (i + 1) / 3, W + (E - W) * (j + 1) / 3].map((v) => v.toFixed(5)).join(','));
const query = (bb) => `[out:json][timeout:180];(way["highway"~"${ROADS}"](${bb});way["highway"~"^(service|pedestrian)$"]["name"](${bb}););out body geom;node["highway"="crossing"](${bb});out body;`;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

async function fetchTile(bb) {
  for (let attempt = 0; attempt < 3; attempt++) for (const url of ENDPOINTS) {
    if (attempt) await new Promise((res) => setTimeout(res, 15000 * attempt)); // Overpass is often busy: back off
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query(bb)), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Parky/2.0 (https://parky.se)' }, signal: AbortSignal.timeout(200000) });
      if (!r.ok) { console.log(bb, url, 'status', r.status); await new Promise((res) => setTimeout(res, 5000)); continue; }
      const j = await r.json();
      console.log(bb, 'ok', j.elements.length);
      return j.elements;
    } catch (e) { console.log(bb, url, 'failed', e.message); }
  }
  throw new Error('tile failed ' + bb);
}
const elements = [];
for (const bb of tiles) { elements.push(...await fetchTile(bb)); await new Promise((res) => setTimeout(res, 3000)); }

const roadRe = new RegExp(ROADS);
const nodes = new Map(), degree = new Map(), crossings = [], streets = [];
const seenCross = new Set(), seenWay = new Set();
const r6 = (v) => Math.round(v * 1e6) / 1e6;
for (const el of elements) {
  if (el.type === 'node' && el.tags?.highway === 'crossing' && !seenCross.has(el.id)) {
    seenCross.add(el.id);
    const c = el.tags.crossing;
    if (c === 'no' || c === 'unmarked' || el.tags['crossing:markings'] === 'no') continue;
    crossings.push([r6(el.lon), r6(el.lat)]);
  }
}
for (const el of elements) {
  if (el.type !== 'way' || !el.nodes || !el.geometry || seenWay.has(el.id)) continue;
  seenWay.add(el.id);
  if (el.tags?.name) streets.push({ n: el.tags.name, g: el.geometry.map((p) => [r6(p.lon), r6(p.lat)]) });
  if (!roadRe.test(el.tags?.highway || '')) continue; // named service/pedestrian ways: names only, not junctions
  el.nodes.forEach((id, i) => {
    if (el.geometry[i]) nodes.set(id, [r6(el.geometry[i].lon), r6(el.geometry[i].lat)]);
    degree.set(id, (degree.get(id) || 0) + (i === 0 || i === el.nodes.length - 1 ? 1 : 2));
  });
}
const junctions = [];
for (const [id, d] of degree) if (d >= 3 && nodes.has(id)) junctions.push(nodes.get(id));
fs.mkdirSync('cities/raw', { recursive: true });
fs.writeFileSync(`cities/raw/${city}-osm.json.gz`, zlib.gzipSync(JSON.stringify({ source: '© OpenStreetMap contributors (ODbL)', fetched: new Date().toISOString(), junctions, crossings, streets }), { level: 9 }));
console.log(city, 'junctions', junctions.length, 'crossings', crossings.length, 'named ways', streets.length);
