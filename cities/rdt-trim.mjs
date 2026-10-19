// Trims the RDT lines the app draws (s.pc: cuts along s.g, decoded by the app's data/Trim.ts) where the national rules forbid stopping or parking whatever the signs say
// (Trafikförordningen 3 kap. 53–55 §§; Transportstyrelsen "Stanna och parkera", 2024):
//   j  10 m from a junction, measured from the edge of the crossing road   → 14 m from the OSM node (centre line + ½ road)
//   c  10 m before a marked pedestrian or cycle crossing                     → 11 m both sides (direction not in the data)
//   b  20 m before and 5 m after a bus-stop sign, unless signed otherwise     → 20 m both sides
//   r  within 30 m of a level crossing (either side, as the brochure says)     → 30 m
// The curb side and direction of travel are not in the data, so each zone is a circle: a little stricter than the law,
// never looser. Same geometry code as Stockholm (pipeline/zones.mjs). Reservations (s.v) are left whole, as in
// cities/lib.mjs applyOsm. Idempotent: s.pc is recomputed from s.g every run; run it after split/names, before rdt-index.
//   node cities/rdt-trim.mjs cities/rdt            → counts only
//   node cities/rdt-trim.mjs cities/rdt --apply    → writes the files (hash/built recomputed)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { index, zonePieces, R_JUNCTION, R_CROSSING, setLatitude } from '../pipeline/zones.mjs';

export const R_BUS = 20, R_LEVEL = 30;
const [dir, flag] = process.argv.slice(2);
const APPLY = flag === '--apply';

export function trim(c) {
  const lats = c.segments.flatMap((s) => s.g.map((p) => p[1]));
  if (!lats.length) return { trimmed: 0, hidden: 0 };
  setLatitude(lats.reduce((a, b) => a + b, 0) / lats.length);
  const grids = [index(c.junctions || [], R_JUNCTION, 'j'), index(c.crossings || [], R_CROSSING, 'c'), index(c.busStops || [], R_BUS, 'b'), index(c.levelCrossings || [], R_LEVEL, 'r')];
  let trimmed = 0, hidden = 0;
  const KX = Math.cos(lats.reduce((a, b) => a + b, 0) / lats.length * Math.PI / 180) * 111320, KY = 110574; // same metric as zonePieces
  for (const s of c.segments) {
    delete s.p; delete s.pc; delete s.x;
    if (s.v) continue;
    const z = zonePieces(s.g, grids);
    if (!z.length) continue;
    // Visible stretches (outside every zone, at least 2 m, as visibleParts), written as cuts "vertex + fraction" (data/Trim.ts in the app)
    const P = s.g.map(([x, y]) => [x * KX, y * KY]), cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const total = cum[cum.length - 1];
    const pos = (d) => { let i = 0; while (i < cum.length - 2 && cum[i + 1] < d) i++; const L = cum[i + 1] - cum[i]; return Math.round((i + (L ? Math.min(1, Math.max(0, (d - cum[i]) / L)) : 0)) * 1000) / 1000; };
    const out = []; let from = 0;
    for (const q of [...z].sort((a, b) => a.s0 - b.s0)) { if (q.s0 - from >= 2) out.push([pos(from), pos(q.s0)]); from = Math.max(from, q.s1); }
    if (total - from >= 2) out.push([pos(from), pos(total)]);
    s.pc = out;
    trimmed++; if (!out.length) hidden++;
  }
  return { trimmed, hidden };
}

const asScript = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (asScript) {
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  let T = 0, H = 0, S = 0, files = 0, before = 0, after = 0;
  for (const row of idx.cities) {
    const file = path.join(dir, `${row.id}.json`);
    const raw = fs.readFileSync(file, 'utf8'); before += raw.length;
    const c = JSON.parse(raw);
    const { trimmed, hidden } = trim(c);
    T += trimmed; H += hidden; S += c.segments.length;
    const { built, hash, ...a } = JSON.parse(raw), { built: b2, hash: h2, ...b } = c;
    if (JSON.stringify(a) === JSON.stringify(b)) { after += raw.length; continue; }
    files++;
    c.built = new Date().toISOString(); delete c.hash;
    const text = JSON.stringify(c); c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
    const out = JSON.stringify(c); after += out.length;
    if (APPLY) fs.writeFileSync(file, out);
  }
  console.log(`${T} of ${S} lines trimmed (${H} wholly inside a zone, not drawn) in ${files} municipalities; ${(before / 1e6).toFixed(1)} → ${(after / 1e6).toFixed(1)} MB${APPLY ? '' : ' (dry run)'}`);
}
