// Fetches road junctions and pedestrian crossings in Stockholm from OpenStreetMap (Overpass API, ODbL:
// "© OpenStreetMap contributors"). Output: raw/osm.json.gz = { junctions: [[lon,lat]...], crossings: [[lon,lat]...] }
// A junction is a node where at least three road arms meet (degree >= 3 over car roads). Driveways, parking aisles
// and paths are excluded, because exits from properties are not intersections in the traffic rules.
import fs from 'node:fs';
import zlib from 'node:zlib';
const BBOX = '59.22,17.75,59.45,18.21';
const ROADS = '^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street)$';
const [S, W, N, E] = BBOX.split(',').map(Number);
const tiles = [];
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tiles.push([S + (N - S) * i / 3, W + (E - W) * j / 3, S + (N - S) * (i + 1) / 3, W + (E - W) * (j + 1) / 3].map((v) => v.toFixed(5)).join(','));
const query = (bb) => `[out:json][timeout:180];way["highway"~"${ROADS}"](${bb});out body geom;node["highway"="crossing"](${bb});out body;`;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

const log = [];
const say = (...a) => { console.log(...a); log.push(a.join(' ')); };
fs.mkdirSync('raw', { recursive: true });
async function fetchTile(bb) {
  for (let attempt = 0; attempt < 2; attempt++) for (const url of ENDPOINTS) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query(bb)), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Parky/2.0 (https://parky.se)' }, signal: AbortSignal.timeout(200000) });
      if (!r.ok) { say(bb, url, 'status', r.status, (await r.text()).slice(0, 200)); await new Promise((res) => setTimeout(res, 5000)); continue; }
      const j = await r.json();
      say(bb, url, 'ok', j.elements.length);
      return j.elements;
    } catch (e) { say(bb, url, 'failed', e.message); }
  }
  throw new Error('tile failed ' + bb);
}
const data = { elements: [] };
try {
  for (const bb of tiles) data.elements.push(...await fetchTile(bb));
} catch (e) {
  fs.writeFileSync('raw/osm-summary.txt', log.join('\n') + '\n' + e.message + '\n');
  process.exit(1);
}

const nodes = new Map();
const degree = new Map();
const crossings = [];
const seenCross = new Set();
for (const el of data.elements) {
  if (el.type === 'way' && el.nodes && el.geometry) el.nodes.forEach((id, i) => el.geometry[i] && nodes.set(id, [el.geometry[i].lon, el.geometry[i].lat]));
  if (el.type === 'node') {
    if (el.tags && el.tags.highway === 'crossing') {
      if (seenCross.has(el.id)) continue; seenCross.add(el.id);
      const c = el.tags.crossing;
      if (c === 'no' || c === 'unmarked' || el.tags['crossing:markings'] === 'no') continue;
      crossings.push([el.lon, el.lat]);
    }
  }
}
const seenWay = new Set();
for (const el of data.elements) {
  if (el.type !== 'way' || !el.nodes || seenWay.has(el.id)) continue;
  seenWay.add(el.id);
  el.nodes.forEach((id, i) => {
    const d = i === 0 || i === el.nodes.length - 1 ? 1 : 2;
    degree.set(id, (degree.get(id) || 0) + d);
  });
}
const junctions = [];
for (const [id, d] of degree) if (d >= 3 && nodes.has(id)) junctions.push(nodes.get(id));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const out = { source: '© OpenStreetMap contributors (ODbL)', fetched: new Date().toISOString(), junctions: junctions.map((p) => p.map(r6)), crossings: crossings.map((p) => p.map(r6)) };
fs.writeFileSync('raw/osm.json.gz', zlib.gzipSync(JSON.stringify(out)));
fs.writeFileSync('raw/osm-summary.txt', `junctions ${junctions.length}\ncrossings ${crossings.length}\nfetched ${out.fetched}\n` + log.join('\n') + '\n');
console.log('junctions', junctions.length, 'crossings', crossings.length);
