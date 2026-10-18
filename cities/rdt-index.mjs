// Rebuilds cities/rdt/index.json from the municipality files (hash, built, bytes, area, junctions), so parallel jobs that
// change different files can each commit their files and let the index follow, instead of fighting over index.json.
//   node cities/rdt-index.mjs cities/rdt
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || 'cities/rdt';
const idxFile = path.join(dir, 'index.json');
const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
let built = idx.built || '';
for (const row of idx.cities) {
  const text = fs.readFileSync(path.join(dir, `${row.id}.json`), 'utf8');
  const c = JSON.parse(text);
  Object.assign(row, { hash: c.hash, built: c.built, bytes: text.length, segments: c.segments.length, area: !!c.area, junctions: Array.isArray(c.junctions) && c.junctions.length > 0 });
  if (c.built > built) built = c.built;
}
idx.built = built;
fs.writeFileSync(idxFile, JSON.stringify(idx));
console.log(`index: ${idx.cities.length} municipalities, ${idx.cities.filter((r) => r.area).length} with area, ${idx.cities.filter((r) => r.junctions).length} with junctions`);
