// Transplants the given top-level keys from municipality files in <src> onto the same files in <dir>, then recomputes
// hash and built. Used by parallel CI jobs to land their part (e.g. junctions) on whatever the branch has now, instead of
// overwriting files that another job or a rule fix changed meanwhile.
//   node cities/rdt-merge.mjs <src dir> <dir> key1,key2,...
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [src, dir, keyArg] = process.argv.slice(2);
const keys = (keyArg || '').split(',').filter(Boolean);
if (!src || !dir || !keys.length) { console.error('usage: node cities/rdt-merge.mjs <src> <dir> key1,key2'); process.exit(1); }
let n = 0;
for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
  const mine = JSON.parse(fs.readFileSync(path.join(src, f), 'utf8'));
  const target = path.join(dir, f);
  const c = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : mine;
  for (const k of keys) { if (k in mine) c[k] = mine[k]; else delete c[k]; }
  if (mine.attribution) c.attribution = mine.attribution;
  c.built = new Date().toISOString();
  delete c.hash;
  const text = JSON.stringify(c);
  c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
  fs.writeFileSync(target, JSON.stringify(c));
  n++;
}
console.log(`merged ${keys.join(',')} into ${n} files`);
