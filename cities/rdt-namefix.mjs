// Fixes street names of area-regulation lines (an: "Norrköpings innerstad") that took the name of a cross street.
// A short line between two junctions has both ends on the cross streets, so the nearest-road vote in rdt-names.mjs
// can pick the wrong one (owner 24 Oct: Generalsgatan in Norrköping was called Knäppingsborgsgatan).
// A line whose name's other pieces run across it (> 50°) takes the name that most lines running along it carry
// (same direction within 20°, on the same straight line within 12 m, within 400 m); with none, it keeps the area name.
//   node cities/rdt-namefix.mjs cities/rdt [--apply]   (from the repo root, after rdt-names.mjs --apply)
import fs from 'node:fs';

const dir = process.argv[2] || 'cities/rdt', APPLY = process.argv.includes('--apply');
const idx = JSON.parse(fs.readFileSync(`${dir}/index.json`, 'utf8'));
const xy = (p, lat0) => [p[0] * 111320 * Math.cos(lat0 * Math.PI / 180), p[1] * 110574];
let fixed = 0, toArea = 0; const ex = [];
for (const row of idx.cities) {
  const file = `${dir}/${row.id}.json`; const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!c.segments.some((s) => s.an)) continue;
  const lat0 = c.segments[0].g[0][1];
  const L = c.segments.map((s) => {
    const a = xy(s.g[0], lat0), b = xy(s.g[s.g.length - 1], lat0), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { s, a, b, len, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ang: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 180) % 180 };
  }).filter((x) => x.len >= 15);
  const diff = (p, q) => { const d = Math.abs(p - q) % 180; return Math.min(d, 180 - d); };
  const toLine = (p, x) => Math.abs((x.b[0] - x.a[0]) * (x.a[1] - p[1]) - (x.a[0] - p[0]) * (x.b[1] - x.a[1])) / x.len;
  const near = (x, y, r) => Math.hypot(x.m[0] - y.m[0], x.m[1] - y.m[1]) < r;
  let changed = false;
  const per = new Map(); for (const s of c.segments) if (s.an) per.set(s.c, (per.get(s.c) || 0) + 1);
  const areaReg = (s) => s.an && per.get(s.c) >= 20; // an area regulation drawn on many roads ("samtliga vägar inom …")
  const STREET = /^[A-ZÅÄÖ][\wåäöéü -]*(?:vägen|gatan|gränd|gränden|stigen|leden|backen|allén|torget|plan|väg|gata)$/;
  const crossed = new Set(L.filter((x) => {
    if (!areaReg(x.s) || x.s.n === x.s.an || x.s.g.length > 3 || x.len > 300) return false; // short straight pieces between junctions
    const same = L.filter((y) => y !== x && y.s.n === x.s.n && near(x, y, 400) && Math.hypot(x.m[0] - y.m[0], x.m[1] - y.m[1]) > 5); // the named street's other pieces (not a copy of this one)
    const tot = same.reduce((a, y) => a + y.len, 0), off = same.filter((y) => diff(x.ang, y.ang) > 50).reduce((a, y) => a + y.len, 0);
    return tot >= 60 && off / tot > 0.75; // the street with that name mostly runs across this line: a cross street's name
  }));
  for (const x of crossed) {
    const along = L.filter((y) => y !== x && !crossed.has(y) && y.s.n !== x.s.n && y.s.n !== y.s.an && STREET.test(y.s.n) && near(x, y, 400) && diff(x.ang, y.ang) < 20 && toLine(x.m, y) < 12 && toLine(y.m, x) < 12);
    const votes = new Map(); for (const y of along) votes.set(y.s.n, (votes.get(y.s.n) || 0) + (y.s.an ? 1 : 3)); // a street regulation's own name counts more
    const best = [...votes].sort((p, q) => q[1] - p[1])[0]?.[0] ?? x.s.an;
    if (ex.length < 6 || process.env.CITY === row.id) ex.push(`${row.id}: ${x.s.n} → ${best} [${x.s.g[0].map((v) => v.toFixed(5))}]`);
    if (best === x.s.an) toArea++; else fixed++;
    x.s.n = best; changed = true;
  }
  if (APPLY && changed) fs.writeFileSync(file, JSON.stringify(c));
}
console.log(`${APPLY ? '' : '(dry run) '}area lines renamed after the street they run along: ${fixed}; back to the area name: ${toArea}`);
console.log(ex.join('\n'));
