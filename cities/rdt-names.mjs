// Street names for segments whose name in the export is an area or the municipality ("Stocksund Norra", "Danderyds
// kommun", "Östermalm"): the card then shows the street. Two steps:
//   node cities/rdt-names.mjs cities/rdt --fetch [group groups]  (CI, network) named OpenStreetMap roads in the ~2 km tiles that hold
//                                                     such segments → cities/rdt/check/names.json, one name per segment,
//                                                     keyed by citation + first point + point count (ids change on splits).
//                                                     Resumable per municipality.
//   node cities/rdt-names.mjs cities/rdt --apply     sets n to the street name and keeps the area name in an. Idempotent.
// A segment takes the name of the road nearest to most of its vertices, when that road is within 25 m of at least
// two thirds of them; otherwise it keeps its name. Sources: © OpenStreetMap contributors (ODbL), Overpass API.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [dir, mode, gArg, nArg] = process.argv.slice(2);
const GROUP = +gArg || 0, GROUPS = +nArg || 1;
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const UA = 'Parky/2.0 (https://parky.se; info@parky.se) street names for area regulations';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const TW = 0.04, TH = 0.02, PAD = 0.0006;
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110574);
const STREET = /(väg|vägen|gata|gatan|gränd|gränden|stig|stigen|led|leden|backe|backen|plan|torg|torget|allé|allén|slingan|bryggan|kajen|promenaden|esplanaden|boulevarden|tået|gången|liden|brinken|hamnen|kroken|svängen|ringen|hagen|lunden|parken)$/i;
export const needsName = (s) => !!s.an || !STREET.test(s.n.trim()) || /kommun|område|zon|centrum|tätort/i.test(s.n);
export const keyOf = (s) => `${s.c}|${s.g[0][0]},${s.g[0][1]}|${s.g.length}`;

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

function distToLine(p, line) {
  const k = Math.cos(p[1] * Math.PI / 180);
  const X = (q) => [(q[0] - p[0]) * 111320 * k, (q[1] - p[1]) * 110574];
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = X(line[i - 1]), [bx, by] = X(line[i]);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
// The name of the road nearest to most vertices (within 25 m of at least two thirds of them), or null.
function nameFor(g, roads) {
  const votes = new Map(); let hits = 0;
  for (const p of g) {
    let best = null, bd = 25;
    for (const r of roads) { if (p[0] < r.w - 0.0005 || p[0] > r.e + 0.0005 || p[1] < r.s - 0.0003 || p[1] > r.n + 0.0003) continue; const d = distToLine(p, r.g); if (d < bd) { bd = d; best = r.name; } }
    if (best) { hits++; votes.set(best, (votes.get(best) || 0) + 1); }
  }
  if (hits < Math.ceil(g.length * 2 / 3)) return null;
  return [...votes].sort((a, b) => b[1] - a[1])[0][0];
}

const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const outFile = path.join(dir, 'check', 'names.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const names = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};

if (mode === '--fetch') {
  for (const [k, row] of idx.cities.entries()) {
    if (k % GROUPS !== GROUP || names[row.id]) continue;
    const c = JSON.parse(fs.readFileSync(path.join(dir, `${row.id}.json`), 'utf8'));
    const need = c.segments.filter(needsName);
    if (!need.length) { names[row.id] = {}; continue; }
    const tiles = new Set();
    for (const s of need) for (const [x, y] of s.g) tiles.add(`${Math.floor(x / TW)},${Math.floor(y / TH)}`);
    const roads = [];
    for (const t of tiles) {
      const [tx, ty] = t.split(',').map(Number);
      const bb = `${r6(ty * TH - PAD)},${r6(tx * TW - PAD)},${r6((ty + 1) * TH + PAD)},${r6((tx + 1) * TW + PAD)}`;
      const els = await overpass(`[out:json][timeout:120];way["highway"]["name"](${bb});out geom;`);
      for (const w of els) if (w.geometry && w.tags?.name) {
        const g = w.geometry.map((p) => [p.lon, p.lat]);
        roads.push({ name: w.tags.name, g, w: Math.min(...g.map((p) => p[0])), e: Math.max(...g.map((p) => p[0])), s: Math.min(...g.map((p) => p[1])), n: Math.max(...g.map((p) => p[1])) });
      }
      await sleep(1500);
    }
    const out = {}; let found = 0;
    for (const s of need) { const n = nameFor(s.g, roads); if (n) { out[keyOf(s)] = n; found++; } }
    names[row.id] = out;
    console.log(`${row.id}: ${need.length} segments without a street name, ${tiles.size} tiles, ${roads.length} named roads, ${found} named`);
    fs.writeFileSync(outFile, JSON.stringify(names));
  }
  fs.writeFileSync(outFile, JSON.stringify(names));
} else if (mode === '--apply') {
  let set = 0, files = 0;
  for (const row of idx.cities) {
    const m = names[row.id]; if (!m) continue;
    const file = path.join(dir, `${row.id}.json`);
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    let changed = false;
    for (const s of c.segments) {
      if (!needsName(s)) continue;
      const n = m[keyOf(s)]; if (!n || n === s.n) continue;
      s.an = s.an || s.n; s.n = n; set++; changed = true;
    }
    if (!changed) continue;
    files++;
    c.built = new Date().toISOString(); delete c.hash;
    const text = JSON.stringify(c); c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
    fs.writeFileSync(file, JSON.stringify(c));
  }
  console.log(`${set} segments renamed in ${files} municipalities`);
} else console.log('usage: node cities/rdt-names.mjs cities/rdt --fetch | --apply');
