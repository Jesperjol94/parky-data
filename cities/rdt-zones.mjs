// Area regulations drawn as rings are not streets: Pelle's converter gives municipality-wide rules (the general 24 h rule,
// "parkering förbjuden inom Danderyds kommun") the municipality outline as geometry, and zone rules ("förbud att parkera
// inom område Vallby", a town's 24 h limit) the zone outline. Drawn as segments they become a green or red ring around the
// town. This moves them out of `segments` into `zones` (same records), which the app ignores until zones are a feature.
//   node cities/rdt-zones.mjs cities/rdt            → prints what would move
//   node cities/rdt-zones.mjs cities/rdt --apply    → writes the files (hash/built recomputed; run rdt-index.mjs after)
// A record moves when its geometry is a closed ring wider or taller than 500 m, or an open line of 60+ points spanning
// more than 40 % of the municipality in both directions (an outline). Small rings (parking bays, turning areas) stay, and
// so does a ring under 1.5 km whose name is a single street (a loop road: "Finkmossvägen"). Idempotent: segments and
// zones are classified afresh each run.
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
  const bw = row.bounds.e - row.bounds.w, bh = row.bounds.n - row.bounds.s;
  const zones = [], keep = [], wides = [];
  const before = (c.zones || []).length, beforeWide = (c.wide || []).length;
  for (const s of [...c.segments, ...(c.zones || []), ...(c.wide || [])]) {
    const g = s.g;
    const closed = g.length >= 4 && Math.abs(g[0][0] - g[g.length - 1][0]) < 1e-6 && Math.abs(g[0][1] - g[g.length - 1][1]) < 1e-6;
    let w = 180, e = -180, so = 90, n = -90;
    for (const [x, y] of g) { w = Math.min(w, x); e = Math.max(e, x); so = Math.min(so, y); n = Math.max(n, y); }
    const km = Math.max((e - w) * 60, (n - so) * 111);
    const outline = !closed && g.length >= 60 && (e - w) > 0.4 * bw && (n - so) > 0.4 * bh;
    const streetName = /(?:vägen|gatan|gränd|stigen|leden|backen|slingan|plan|torg|torget|allén)$/i.test(s.n.trim()) && !/zon|område|inom|kommun|centrala|centrum|tätort|del av/i.test(s.n);
    // A ring named after the municipality, a fee-table regulation, or one spanning most of the municipality is a
    // rulebook ("ordningsregler för all parkering", "parkeringstaxor"), not an area: kept aside in `wide`, which the app ignores.
    const wide = /kommun\b|parkeringstaxor|\btaxa\b/i.test(s.n) || ((e - w) > 0.8 * bw && (n - so) > 0.6 * bh) || ((n - so) > 0.8 * bh && (e - w) > 0.6 * bw);
    if (wide && (closed || outline)) { wides.push(s); moved++; if (!APPLY) console.log(`${row.id}: ${s.n} ${s.c} → wide (ignored)`); continue; }
    if ((closed && km > 0.5 && !(streetName && km < 1.5)) || outline) { zones.push(s); moved++; if (!APPLY && moved <= 40) console.log(`${row.id}: ${s.n} ${s.c} ${km.toFixed(1)} km, ${g.length} pts${closed ? '' : ' (outline)'}`); }
    else keep.push(s);
  }
  if (zones.length === before && wides.length === beforeWide) continue;
  files++;
  if (!APPLY) continue;
  c.segments = keep; if (zones.length) c.zones = zones; else delete c.zones; if (wides.length) c.wide = wides; else delete c.wide;
  c.built = new Date().toISOString(); delete c.hash;
  const text = JSON.stringify(c); c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
  fs.writeFileSync(file, JSON.stringify(c));
}
console.log(`${moved} area records ${APPLY ? 'moved' : 'would move'} to zones in ${files} municipalities`);
