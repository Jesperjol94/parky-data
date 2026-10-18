// Date parking ("datumparkering"): on odd dates parking is banned on the side with odd house numbers, on even dates on
// the even side, between the hours in the regulation. Pelle's export encodes it as a plain ban for those hours, which
// would tell everyone "not right now" although one side is always allowed. This moves the ban windows of such records
// (streets and areas) from `f` to `dp`, which the app shows as "park on the even side today". Idempotent.
//   node cities/rdt-datum.mjs cities/rdt [--apply]       (run rdt-index.mjs after)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [dir, flag] = process.argv.slice(2);
const APPLY = flag === '--apply';
const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
let moved = 0, files = 0;
for (const row of idx.cities) {
  const file = path.join(dir, `${row.id}.json`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const s of [...c.segments, ...(c.zones || [])]) {
    if (!/datumparkering/i.test(s.n) || !s.f || !s.f.length) continue;
    s.dp = [...(s.dp || []), ...s.f]; delete s.f; n++;
  }
  if (!n) continue;
  moved += n; files++;
  console.log(`${row.id}: ${n} date-parking records`);
  if (!APPLY) continue;
  c.built = new Date().toISOString(); delete c.hash;
  const text = JSON.stringify(c); c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
  fs.writeFileSync(file, JSON.stringify(c));
}
console.log(`${moved} records ${APPLY ? 'converted' : 'would be converted'} in ${files} municipalities`);
