// Turns processed RDT city files (cities/rdt-out, optionally with boundary + junctions from rdt-geo.mjs) into the files the
// app loads on demand: cities/rdt/<id>.json and cities/rdt/index.json (one small row per municipality).
//   node cities/rdt-publish.mjs <processed dir> <out dir, e.g. cities/rdt>
// Fee numbers are per municipality in Pelle's files (1, 2, 3 ...). The app registers fee zones in one global table, so every
// municipality gets its own range here: code = kommunkod * 1000 + local number (Stockholm 1-15, Göteborg 2xxx, Malmö 3xxx never collide).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [inDir, outDir] = process.argv.slice(2);
if (!inDir || !outDir) { console.error('usage: node cities/rdt-publish.mjs <in> <out>'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const SKIP = new Set(['stockholm', 'goteborg', 'malmo']);
const index = [];
const built = new Date().toISOString();
for (const f of fs.readdirSync(inDir).filter((x) => x.endsWith('.json') && x !== 'spot-checks.json').sort()) {
  const c = JSON.parse(fs.readFileSync(path.join(inDir, f), 'utf8'));
  if (!c.city || SKIP.has(c.city) || !Array.isArray(c.segments) || !c.segments.length || !/^\d{4}$/.test(c.kommunkod || '')) { console.log('skip', f); continue; }
  const base = Number(c.kommunkod) * 1000;
  const map = (k) => (k === 0 || k === null || k === undefined ? k : base + Number(k));
  const taxa = {};
  for (const [k, z] of Object.entries(c.taxa || {})) { if (Number(k) < 1 || Number(k) > 999) throw new Error(`${c.city}: fee number ${k} out of range`); taxa[String(base + Number(k))] = z; }
  const segments = c.segments.map((s) => {
    if (s.t === undefined || s.t === null || s.t === 0) return s;
    if (!taxa[String(base + Number(s.t))]) { const { t, ...rest } = s; return { ...rest, t: null, u: 1 }; } // a fee number without a table: unknown, never a guess
    return { ...s, t: map(s.t) };
  });
  let w = 180, e = -180, s = 90, n = -90;
  for (const g of segments) for (const [x, y] of g.g) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const bounds = c.bounds || { w: +w.toFixed(4), e: +e.toFixed(4), s: +s.toFixed(4), n: +n.toFixed(4) };
  const out = { ...c, v: 1, built, taxa, segments, bounds };
  delete out.hash;
  const text = JSON.stringify(out);
  const hash = crypto.createHash('sha1').update(text.replace(built, '')).digest('hex').slice(0, 16);
  out.hash = hash;
  const final = JSON.stringify(out);
  fs.writeFileSync(path.join(outDir, `${c.city}.json`), final);
  index.push({ id: c.city, name: c.name, kommunkod: c.kommunkod, bounds, hash, built, segments: segments.length, bytes: final.length, area: !!c.area, junctions: Array.isArray(c.junctions) && c.junctions.length > 0 });
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({ v: 1, built, cities: index }));
console.log(`published ${index.length} municipalities, ${index.reduce((a, x) => a + x.segments, 0)} segments, ${(index.reduce((a, x) => a + x.bytes, 0) / 1e6).toFixed(1)} MB`);
