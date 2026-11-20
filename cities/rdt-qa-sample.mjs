// Draws a fresh QA sample: regulations not read by hand before (cities/qa/reviewed.txt), weighted by
// how many map segments they cover, one random segment each, with the full official text.
//   node cities/rdt-qa-sample.mjs <count> <out.json> [seed] [options]   (from the repo root)
// Options (each narrows the pool of unread regulations; they combine):
//   --boost a,b,c    municipalities weighted x4 (where the users are); does not narrow the pool
//   --only a,b,c     only regulations with a line in these municipalities (to read a town completely)
//   --check <name>   only regulations flagged by this check in cities/qa/audit.json (e.g. feeAllDay, limitMissing)
//   --unread         only regulations whose text has a sentence the parser does not read
// The last output line says how many unread regulations the pool holds, so a run can tell when a bucket is finished.
// After judging, append the sampled citations to cities/qa/reviewed.txt so they are not drawn again.
import fs from 'node:fs'; import zlib from 'node:zlib';
import { parseRegulation } from '../engine/regulation.js';

const argv = process.argv.slice(2);
const take = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const flag = (name) => { const i = argv.indexOf(name); if (i >= 0) argv.splice(i, 1); return i >= 0; };
const list = (v) => new Set((v || '').split(',').map((x) => x.trim()).filter(Boolean));
const boost = list(take('--boost'));
const only = list(take('--only'));
const check = take('--check');
const unreadOnly = flag('--unread');
let flagged = null;
if (check) {
  const a = JSON.parse(fs.readFileSync('cities/qa/audit.json', 'utf8')).checks?.[check];
  if (!a) { console.error(`no check "${check}" in cities/qa/audit.json (run node cities/rdt-audit.mjs first)`); process.exit(2); }
  flagged = new Set(a.rows.map((r) => r[2]));
}
const [n = 40, out = 'sample.json', seed = Date.now() % 1e9] = argv;
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
const texts = {};
const text = (c) => { const k = c.slice(0, 4); const p = `rdt/texts/${k}.jsonl.gz`;
  if (!(k in texts)) texts[k] = new Map(fs.existsSync(p) ? zlib.gunzipSync(fs.readFileSync(p)).toString().split('\n').filter(Boolean).map(JSON.parse).map((x) => [x.c, x]) : []);
  return texts[k].get(c); };
const hasUnread = (c) => { const b = text(c)?.body; if (!b) return false; try { return parseRegulation(b).unread.length > 0; } catch { return false; } };
const pool = [...cit.keys()].filter((k) => (!only.size || cit.get(k).some(([id]) => only.has(id))) && (!flagged || flagged.has(k)) && (!unreadOnly || hasUnread(k)));
if (!pool.length) { fs.writeFileSync(out, '[]'); console.log(`0 regulations: nothing unread is left in this pool → ${out}`); process.exit(0); }
const w = pool.map((k) => cit.get(k).length * (cit.get(k).some(([id]) => boost.has(id)) ? 4 : 1)); const tot = w.reduce((a, b) => a + b, 0);
const sel = []; const seen = new Set(); let tries = 0;
while (sel.length < +n && seen.size < pool.length && tries++ < 200000) {
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
