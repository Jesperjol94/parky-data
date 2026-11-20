// Draws a QA sample from Stockholm's LIVE data (branch main: segments.json, built every night from the city's own
// records and completed from the official regulation texts in rdt/rdt.jsonl.gz). Same idea as rdt-qa-sample.mjs:
// regulations not read before (cities/qa/reviewed-cities.txt), weighted by how many curb segments they cover, one
// random segment each, with the full official text. The three big cities are where most people use the app, and the
// national-register review never looks at them.
//   git show origin/main:segments.json > /tmp/sthlm-segments.json
//   git show origin/main:rdt/rdt.jsonl.gz > /tmp/sthlm-rdt.jsonl.gz
//   node cities/qa-city-sample.mjs <count> <out.json> [seed] --segments /tmp/sthlm-segments.json --texts /tmp/sthlm-rdt.jsonl.gz
// Segment fields are explained at the top of engine/normalize.js (the city's records) and in engine/regulation.js
// (what the text adds): s street-cleaning windows, f bans, l limits, aw allowed-only hours, t fee table number,
// z resident zone, v reserved for, rx completed from the text, ru text has an unread sentence, u grey.
// After judging, append the sampled citations to cities/qa/reviewed-cities.txt.
import fs from 'node:fs'; import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const take = (flag, d) => { const i = argv.indexOf(flag); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const segFile = take('--segments', null), textFile = take('--texts', null);
const [n = 40, out = 'city-sample.json', seed = Date.now() % 1e9] = argv;
if (!segFile || !textFile) { console.error('needs --segments <segments.json> and --texts <rdt.jsonl.gz> (both from branch main)'); process.exit(2); }
let s = +seed; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const DONE = 'cities/qa/reviewed-cities.txt';
const done = new Set(fs.existsSync(DONE) ? fs.readFileSync(DONE, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : []);
const data = JSON.parse(fs.readFileSync(segFile, 'utf8'));
const texts = new Map(zlib.gunzipSync(fs.readFileSync(textFile)).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.err && r.body).map((r) => [r.c, r]));
const strip = (x) => Object.fromEntries(Object.entries(x).filter(([k]) => !['g', 'p', 'x', 'i'].includes(k)));
const cit = new Map();
for (const g of data.segments) if (g.c && !done.has(g.c) && texts.has(g.c)) { if (!cit.has(g.c)) cit.set(g.c, []); cit.get(g.c).push(g); }
const pool = [...cit.keys()];
if (!pool.length) { fs.writeFileSync(out, '[]'); console.log(`0 regulations: nothing unread is left → ${out}`); process.exit(0); }
const w = pool.map((k) => cit.get(k).length); const tot = w.reduce((a, b) => a + b, 0);
const sel = []; const seen = new Set(); let tries = 0;
while (sel.length < +n && seen.size < pool.length && tries++ < 200000) {
  let r = rnd() * tot, j = 0; while (r > w[j]) r -= w[j++];
  const k = pool[j]; if (seen.has(k)) continue; seen.add(k);
  const tx = texts.get(k); const segs = cit.get(k); const g = segs[Math.floor(rnd() * segs.length)];
  sel.push({ c: k, city: 'stockholm', built: data.built, nseg: segs.length, n: g.n, d: g.d, rub: tx.rubrik, from: tx.from, to: tx.to, body: tx.body, seg: strip(g),
    others: segs.filter((q) => JSON.stringify(strip({ ...q, n: 0 })) !== JSON.stringify(strip({ ...g, n: 0 }))).slice(0, 2).map(strip) });
}
fs.writeFileSync(out, JSON.stringify(sel, null, 1));
console.log(`${sel.length} regulations (${sel.reduce((a, x) => a + x.nseg, 0)} segments) from ${pool.length} not yet reviewed, data built ${data.built} → ${out}`);
