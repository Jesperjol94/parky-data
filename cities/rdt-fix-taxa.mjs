// One-off repair of the PUBLISHED files: flattens fee tables that list several prices for the same hours (rdt-lib.mjs)
// and clears `u` on segments that were made uncertain only because of such a table (Pelle's own file did not mark them,
// they have a rule or a fee, and no empty time window). Recomputes hash/built and the index.
//   node cities/rdt-fix-taxa.mjs cities/rdt pelle-output/output.json pelle-output/output-2.json pelle-output/output-3.json.zip
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fixTaxa } from './rdt-lib.mjs';

const [dir, ...inputs] = process.argv.slice(2);
const pelle = new Map(); // kommunkod -> Map(i -> segment) from Pelle's files (later files win)
for (const f of inputs) {
  const raw = f.endsWith('.zip') ? execFileSync('unzip', ['-p', f], { maxBuffer: 1 << 30 }).toString() : fs.readFileSync(f, 'utf8');
  const j = JSON.parse(raw);
  for (const c of Array.isArray(j) ? j : Object.values(j)) if (c && c.kommunkod && (c.segments || []).length) pelle.set(c.kommunkod, new Map(c.segments.map((s) => [s.i, s])));
}
const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
let cleared = 0, zones = 0, files = 0;
for (const row of idx.cities) {
  const file = path.join(dir, `${row.id}.json`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const base = Number(c.kommunkod) * 1000;
  const { taxa, bad } = fixTaxa(c.taxa);
  if (!bad.size) continue;
  const orig = pelle.get(c.kommunkod) || new Map();
  let n = 0;
  for (const s of c.segments) {
    if (!s.u || !s.t || !bad.has(String(s.t))) continue;
    const o = orig.get(s.i);
    if (!o || o.n !== s.n || o.c !== s.c || o.u) continue; // Pelle marked it, or we cannot match it: leave it uncertain
    if (['f', 'aw', 'l', 's'].some((k) => (s[k] || []).some((w) => w.a === w.b))) continue;
    delete s.u; s.pv = 1; n++; // pv: the price is a range, see the fee label
  }
  c.taxa = taxa;
  c.built = new Date().toISOString();
  delete c.hash;
  const text = JSON.stringify(c);
  c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
  fs.writeFileSync(file, JSON.stringify(c));
  cleared += n; zones += bad.size; files++;
  console.log(`${row.id}: ${bad.size} fee table(s) flattened, ${n} segments no longer uncertain; now ${c.segments.filter((s) => s.u).length} uncertain of ${c.segments.length}`);
}
console.log(`${files} files, ${zones} zones, ${cleared} segments cleared`);
