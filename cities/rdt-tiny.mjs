// Point-sized lines (under 3 m) are invisible on the map but still the nearest line to a tap up to 60 m away, so a bay's
// or a lot's rule answered street taps with no visible line (QA 8 Nov: Ljungby had 1,583 copies of 111 disabled bays,
// Nacka 500 crumbs and collapsed lots). Rules:
//   1. a tiny line with a longer line of the same regulation within 30 m is a crumb: dropped
//   2. tiny reserved lines (v) of one regulation are thinned to one per 5 m cluster
//   3. a tiny line with no longer sibling keeps its rule but goes grey ("check the sign"): it may not answer a tap as fact
//   node cities/rdt-tiny.mjs cities/rdt [--apply]   (from the repo root, before rdt-index.mjs)
import fs from 'node:fs'; import path from 'node:path';

const [dir = 'cities/rdt', flag] = process.argv.slice(2); const APPLY = flag === '--apply';
const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const xy = (p, lat0) => [p[0] * 111320 * Math.cos(lat0 * Math.PI / 180), p[1] * 110574];
const len = (g, lat0) => { let L = 0; for (let i = 1; i < g.length; i++) { const a = xy(g[i - 1], lat0), b = xy(g[i], lat0); L += Math.hypot(a[0] - b[0], a[1] - b[1]); } return L; };
let crumbs = 0, thinned = 0, greyed = 0, leaks = 0;
for (const row of idx.cities) {
  const file = path.join(dir, `${row.id}.json`); const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const lat0 = (c.bounds.s + c.bounds.n) / 2;
  const L = c.segments.map((s) => ({ s, len: len(s.g, lat0), m: xy(s.g[Math.floor(s.g.length / 2)], lat0) }));
  const byC = new Map(); for (const x of L) { if (!byC.has(x.s.c)) byC.set(x.s.c, []); byC.get(x.s.c).push(x); }
  const drop = new Set(); let changed = false;
  for (const [, xs] of byC) {
    const tiny = xs.filter((x) => x.len < 3), long = xs.filter((x) => x.len >= 3);
    if (!tiny.length) continue;
    const kept = [];
    for (const x of tiny) {
      if (long.some((y) => Math.hypot(x.m[0] - y.m[0], x.m[1] - y.m[1]) < 30)) { drop.add(x.s); crumbs++; continue; }
      if (x.s.v && kept.some((k) => k.s.v && Math.hypot(x.m[0] - k.m[0], x.m[1] - k.m[1]) < 5)) { drop.add(x.s); thinned++; continue; }
      kept.push(x);
    }
    for (const x of kept) if (!x.s.u) { x.s.u = 1; x.s.ut = 1; greyed++; changed = true; }
  }
  // 4. a batch-export leak: one geometry shared by ≥5 regulations with ≥3 street names (Jönköping: 101 regulations each
  //    carried five pieces of Huskvarna centre besides their own street; a tap there answered with any of them)
  const byG = new Map();
  for (const s of c.segments) { const k = JSON.stringify(s.g.map((p) => [p[0].toFixed(5), p[1].toFixed(5)])); if (!byG.has(k)) byG.set(k, []); byG.get(k).push(s); }
  for (const [, ss] of byG) { if (new Set(ss.map((s) => s.c)).size >= 5 && new Set(ss.map((s) => s.n)).size >= 3) for (const s of ss) { drop.add(s); leaks++; } }
  if (drop.size) { c.segments = c.segments.filter((s) => !drop.has(s)); changed = true; }
  if (APPLY && changed) fs.writeFileSync(file, JSON.stringify(c));
}
console.log(`${APPLY ? '' : '(dry run) '}tiny lines: ${crumbs} crumbs dropped, ${thinned} duplicate bays thinned, ${greyed} lone ones greyed; ${leaks} batch-leak copies dropped`);
