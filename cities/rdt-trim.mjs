// Trims the RDT lines the app draws (s.p) where the national rules forbid stopping or parking whatever the signs say
// (Trafikförordningen 3 kap. 53–55 §§; Transportstyrelsen "Stanna och parkera", 2024):
//   j  10 m from a junction, measured from the edge of the crossing road   → 14 m from the OSM node (centre line + ½ road)
//   c  10 m before a marked pedestrian or cycle crossing                     → 11 m both sides (direction not in the data)
//   b  20 m before and 5 m after a bus-stop sign (parking)                    → 20 m both sides
//   r  30 m before a level crossing                                           → 30 m both sides
// The curb side and direction of travel are not in the data, so each zone is a circle: a little stricter than the law,
// never looser. Same geometry code as Stockholm (pipeline/zones.mjs). Reservations (s.v) are left whole, as in
// cities/lib.mjs applyOsm. Idempotent: s.p is recomputed from s.g every run; run it after split/names, before rdt-index.
//   node cities/rdt-trim.mjs cities/rdt            → counts only
//   node cities/rdt-trim.mjs cities/rdt --apply    → writes the files (hash/built recomputed)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { index, zonePieces, visibleParts, R_JUNCTION, R_CROSSING, setLatitude } from '../pipeline/zones.mjs';

export const R_BUS = 20, R_LEVEL = 30;
const [dir, flag] = process.argv.slice(2);
const APPLY = flag === '--apply';

export function trim(c) {
  const lats = c.segments.flatMap((s) => s.g.map((p) => p[1]));
  if (!lats.length) return { trimmed: 0, hidden: 0 };
  setLatitude(lats.reduce((a, b) => a + b, 0) / lats.length);
  const grids = [index(c.junctions || [], R_JUNCTION, 'j'), index(c.crossings || [], R_CROSSING, 'c'), index(c.busStops || [], R_BUS, 'b'), index(c.levelCrossings || [], R_LEVEL, 'r')];
  let trimmed = 0, hidden = 0;
  for (const s of c.segments) {
    delete s.p; delete s.x;
    if (s.v) continue;
    const z = zonePieces(s.g, grids);
    if (!z.length) continue;
    s.p = visibleParts(s.g, z);
    trimmed++; if (!s.p.length) hidden++;
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
