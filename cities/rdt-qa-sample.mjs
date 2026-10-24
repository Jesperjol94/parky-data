// Draws a fresh QA sample: regulations not read by hand before (cities/qa/reviewed.txt), weighted by
// how many map segments they cover, one random segment each, with the full official text.
//   node cities/rdt-qa-sample.mjs <count> <out.json> [seed]   (from the repo root)
// After judging, append the sampled citations to cities/qa/reviewed.txt so they are not drawn again.
import fs from 'node:fs'; import zlib from 'node:zlib';

const [n = 40, out = 'sample.json', seed = Date.now() % 1e9] = process.argv.slice(2);
let s = +seed; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const done = new Set(fs.readFileSync('cities/qa/reviewed.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
const idx = JSON.parse(fs.readFileSync('cities/rdt/index.json', 'utf8')).cities;
const strip = (x) => Object.fromEntries(Object.entries(x).filter(([k]) => !['g', 'pc', 'i'].includes(k)));
const cit = new Map(); const meta = {};
for (const c of idx) {
  const d = JSON.parse(fs.readFileSync(`cities/rdt/${c.id}.json`, 'utf8'));
  meta[c.id] = d;
  for (const g of d.segments) if (g.c && !done.has(g.c)) { if (!cit.has(g.c)) cit.set(g.c, []); cit.get(g.c).push([c.id, g]); }
}
const pool = [...cit.keys()]; const w = pool.map((k) => cit.get(k).length); const tot = w.reduce((a, b) => a + b, 0);
const texts = {};
const text = (c) => { const k = c.slice(0, 4); const p = `rdt/texts/${k}.jsonl.gz`;
  if (!(k in texts)) texts[k] = fs.existsSync(p) ? zlib.gunzipSync(fs.readFileSync(p)).toString().split('\n').filter(Boolean).map(JSON.parse) : [];
  return texts[k].find((x) => x.c === c); };
const sel = []; const seen = new Set(); let tries = 0;
while (sel.length < +n && tries++ < 100000) {
  let r = rnd() * tot, j = 0; while (r > w[j]) r -= w[j++];
  const k = pool[j]; if (seen.has(k)) continue; seen.add(k);
  const tx = text(k); if (!tx?.body) continue;
  const segs = cit.get(k); const [city, g] = segs[Math.floor(rnd() * segs.length)];
  const t = g.t ? meta[city].taxa?.[String(g.t)] : null;
  sel.push({ c: k, city, nseg: segs.length, n: g.n, rub: tx.rubrik, body: tx.body, seg: strip(g), taxa: t,
    others: segs.filter(([, q]) => JSON.stringify(strip({ ...q, n: 0 })) !== JSON.stringify(strip({ ...g, n: 0 }))).slice(0, 2).map(([, q]) => strip(q)) });
}
fs.writeFileSync(out, JSON.stringify(sel, null, 1));
console.log(`${sel.length} regulations (${sel.reduce((a, x) => a + x.nseg, 0)} segments) from ${pool.length} not yet reviewed → ${out}`);
