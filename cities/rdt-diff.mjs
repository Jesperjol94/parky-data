// Compares cities/rdt/*.json in the working tree with HEAD: counts of changed rule fields, and municipalities where bans were removed or added.
//   node cities/rdt-diff.mjs   (from the repo root, after a reparse, before committing)
import fs from 'node:fs'; import { execSync } from 'node:child_process';
const idx = JSON.parse(fs.readFileSync('cities/rdt/index.json')); const ex = {};
for (const r of idx.cities) { const f = `cities/rdt/${r.id}.json`; let old; try { old = JSON.parse(execSync(`git show HEAD:${f}`, { maxBuffer: 1e9 })); } catch { continue; }
  const now = JSON.parse(fs.readFileSync(f)); const om = new Map(old.segments.map((s) => [s.i, s]));
  for (const s of now.segments) { const o = om.get(s.i); if (!o) continue;
    for (const k of ['l', 'aw', 't', 'f']) { const a = k === 'f' ? (o.f || []).filter((w) => !w.ov) : o[k], b = k === 'f' ? (s.f || []).filter((w) => !w.ov) : s[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) { (ex[k] ||= []); if (ex[k].length < 4 && !ex[k].some((e) => e.startsWith(r.id + ' ' + s.c))) ex[k].push(`${r.id} ${s.c} ${JSON.stringify(a)} → ${JSON.stringify(b)}`); ex[k + '#'] = (ex[k + '#'] || 0) + 1; } } } }
for (const k of Object.keys(ex)) console.log(k, Array.isArray(ex[k]) ? '\n  ' + ex[k].join('\n  ') : ex[k]);


const idx = JSON.parse(fs.readFileSync('cities/rdt/index.json')); const by = {}; let lost = 0, gained = 0;
for (const r of idx.cities) { const f = `cities/rdt/${r.id}.json`; const old = JSON.parse(execSync(`git show HEAD:${f}`, { maxBuffer: 1e9 })); const now = JSON.parse(fs.readFileSync(f)); const om = new Map(old.segments.map((s) => [s.i, s]));
  for (const s of now.segments) { const o = om.get(s.i); if (!o) continue; const a = (o.f || []).filter((w) => !w.ov).length, b = (s.f || []).filter((w) => !w.ov).length;
    if (a && !b) { lost++; by[r.id + ' ' + s.c.split(' ')[1].slice(0, 4)] = (by[r.id + ' ' + s.c.split(' ')[1].slice(0, 4)] || 0) + 1; } if (!a && b) { gained++; const k = "+" + r.id; by[k] = (by[k] || 0) + 1; if (!by["ex" + r.id]) by["ex" + r.id] = s.c + " " + JSON.stringify(s.f); } } }
console.log({ lost, gained }); console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12));
