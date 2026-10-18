// Removes the segments of regulations listed in DROP_CITATIONS (cities/rdt-lib.mjs) from the PUBLISHED files, for
// when the files are not rebuilt from Pelle's export. Idempotent. Run rdt-index.mjs after.
//   node cities/rdt-drop.mjs cities/rdt [--apply]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DROP_CITATIONS } from './rdt-lib.mjs';

const [dir, flag] = process.argv.slice(2);
const APPLY = flag === '--apply';
const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
let dropped = 0;
for (const row of idx.cities) {
  const file = path.join(dir, `${row.id}.json`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keep = c.segments.filter((s) => !DROP_CITATIONS[s.c]);
  if (keep.length === c.segments.length) continue;
  console.log(`${row.id}: ${c.segments.length - keep.length} segments dropped`);
  dropped += c.segments.length - keep.length;
  if (!APPLY) continue;
  c.segments = keep;
  c.built = new Date().toISOString(); delete c.hash;
  const text = JSON.stringify(c); c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
  fs.writeFileSync(file, JSON.stringify(c));
}
console.log(`${dropped} segments ${APPLY ? 'dropped' : 'would be dropped'}`);
