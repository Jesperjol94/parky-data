// Lists regulations the parser can't fully read (their register data is kept unverified), with the most common unread sentence shapes.
//   node cities/rdt-unread-scan.mjs   (run from the repo root)
import fs from 'node:fs'; import zlib from 'node:zlib';
import { parseRegulation } from '../engine/regulation.js';
const idx = JSON.parse(fs.readFileSync('cities/rdt/index.json'));
let segs = 0, segText = 0, segUnread = 0, segNoText = 0, segU = 0; const pat = new Map(); const citU = new Set();
for (const r of idx.cities) {
  const c = JSON.parse(fs.readFileSync(`cities/rdt/${r.id}.json`)); const tf = `rdt/texts/${r.kommunkod}.jsonl.gz`;
  const texts = new Map(); if (fs.existsSync(tf)) try { for (const l of zlib.gunzipSync(fs.readFileSync(tf)).toString().split('\n')) if (l) { const x = JSON.parse(l); texts.set(x.c, x); } } catch {}
  const cache = new Map();
  for (const s of c.segments) { segs++; if (s.u) segU++; const t = texts.get(s.c); if (!t || !t.body) { segNoText++; continue; } segText++;
    if (!cache.has(s.c)) cache.set(s.c, parseRegulation(t.body)); const p = cache.get(s.c);
    if (p.unread.length) { segUnread++; citU.add(s.c); for (const u of p.unread) { const k = u.toLowerCase().replace(/\d+/g, '#').replace(/[^a-zåäö# ]/g, '').split(' ').slice(0, 6).join(' '); pat.set(k, (pat.get(k) || 0) + 1); } } }
}
console.log({ segs, segNoText, segText, segUnread, citationsUnread: citU.size, segU });
console.log([...pat].sort((a, b) => b[1] - a[1]).slice(0, 30).map((x) => x[1] + '  ' + x[0]).join('\n'));
