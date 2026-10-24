// Compares cities/rdt/*.json in the working tree with HEAD (after a reparse, before committing):
//   - how many segments changed per rule field (f bans, l limits, aw allowed hours, t fee table, v reserved, u uncertain)
//   - municipalities where bans disappeared or appeared (bans that disappear make the map more permissive: check a few!)
//   - a few examples per field
//   node cities/rdt-diff.mjs [examples per field, default 4]   (from the repo root)
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const N = +(process.argv[2] || 4);
const idx = JSON.parse(fs.readFileSync('cities/rdt/index.json', 'utf8'));
const own = (fs) => (fs || []).filter((w) => !w.ov);
const count = {}, ex = {}, lost = {}, gained = {};
for (const r of idx.cities) {
  const f = `cities/rdt/${r.id}.json`;
  let old; try { old = JSON.parse(execSync(`git show HEAD:${f}`, { maxBuffer: 1e9 })); } catch { continue; }
  const now = JSON.parse(fs.readFileSync(f, 'utf8'));
  const om = new Map(old.segments.map((s) => [s.i, s]));
  for (const s of now.segments) {
    const o = om.get(s.i); if (!o) continue;
    for (const k of ['f', 'l', 'aw', 't', 'v', 'u', 'dp']) {
      const a = k === 'f' ? own(o.f) : o[k], b = k === 'f' ? own(s.f) : s[k];
      if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
      count[k] = (count[k] || 0) + 1;
      (ex[k] ||= []); if (ex[k].length < N) ex[k].push(`${r.id} ${s.c} ${s.n}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
    }
    const a = own(o.f).length, b = own(s.f).length;
    if (a && !b) lost[r.id] = (lost[r.id] || 0) + 1;
    if (!a && b) gained[r.id] = (gained[r.id] || 0) + 1;
  }
}
const top = (o) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ') || '–';
console.log('changed segments per field:', JSON.stringify(count));
console.log('bans removed (more permissive):', top(lost));
console.log('bans added (stricter):', top(gained));
for (const k of Object.keys(ex)) console.log(`\n${k}:\n  ` + ex[k].join('\n  '));
