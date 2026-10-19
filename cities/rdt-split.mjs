// Pelle's converter sometimes stitches the pieces of one regulation into a single line, hopping from the end of one street
// piece straight to the start of the next ("Danderyds kommun" 0162 2016-00023 zigzags across Sturevägen, Vasavägen and
// Kyrkvägen). Drawn as one segment the hops cross gardens and the tapped street is a strange pattern. This splits such
// lines at the hops. A leg is a candidate hop when it is over 80 m, more than four times the line's median leg, and the
// line turns sharply (over 50°) at both of its ends; a real road can look the same (a straight 130 m jog of Kyrkvägen),
// so a candidate is only cut when no OpenStreetMap road runs along it (cities/rdt-roads.mjs fetches the roads around
// every candidate into cities/rdt/check/roads.json; without that file nothing is cut). Pieces shorter than 15 m are dropped.
// A line is also cut where it turns sharply at an OSM junction (splitAtJunctions). New pieces get fresh ids after the file's highest. Idempotent (a split line has no hop left).
//   node cities/rdt-split.mjs cities/rdt            → prints what would split
//   node cities/rdt-split.mjs cities/rdt --apply    → writes the files (hash/built recomputed; run rdt-index.mjs after)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [dir, flag] = process.argv.slice(2);
const APPLY = flag === '--apply';
export const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110574);
const bearing = (a, b) => Math.atan2((b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), b[1] - a[1]);
const turn = (a, b, c) => { let t = Math.abs(bearing(b, c) - bearing(a, b)) * 180 / Math.PI; return t > 180 ? 360 - t : t; };

// Indexes i (1..) of the legs g[i-1]→g[i] that look like hops.
export function candidateHops(g) {
  if (g.length < 3) return [];
  const d = []; for (let i = 1; i < g.length; i++) d.push(metres(g[i - 1], g[i]));
  const med = [...d].sort((a, b) => a - b)[d.length >> 1];
  const out = [];
  for (let i = 1; i < g.length; i++) {
    if (!(d[i - 1] > 80 && d[i - 1] > 4 * med)) continue;
    // the turn is measured against the nearest neighbours at least 10 m away, so a tiny stub next to the hop does not hide it
    let b = i - 2; while (b >= 0 && metres(g[b], g[i - 1]) < 10) b--;
    let a = i + 1; while (a < g.length && metres(g[a], g[i]) < 10) a++;
    const before = b >= 0 ? turn(g[b], g[i - 1], g[i]) : null, after = a < g.length ? turn(g[i - 1], g[i], g[a]) : null;
    if ((before === null || before > 50) && (after === null || after > 50)) out.push(i); // a gap along the same street continues straight: left alone
  }
  return out;
}

// Distance from a point to a polyline, in metres (flat approximation, fine at 200 m).
function distToLine(p, line) {
  const k = Math.cos(p[1] * Math.PI / 180);
  const X = (q) => [(q[0] - p[0]) * 111320 * k, (q[1] - p[1]) * 110574];
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = X(line[i - 1]), [bx, by] = X(line[i]);
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
// A road runs along the leg when its quarter points and midpoint all lie within 20 m of some road.
const onRoad = (a, b, roads) => [0.25, 0.5, 0.75].every((t) => { const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]; return roads.some((r) => distToLine(p, r) < 20); });

export function splitHops(g, roads) {
  const cuts = new Set(candidateHops(g).filter((i) => !onRoad(g[i - 1], g[i], roads)));
  if (!cuts.size) return [g];
  const pieces = []; let cur = [g[0]];
  for (let i = 1; i < g.length; i++) { if (cuts.has(i)) { pieces.push(cur); cur = [g[i]]; } else cur.push(g[i]); }
  pieces.push(cur);
  return pieces.filter((p) => p.length >= 2 && p.reduce((s, q, i) => s + (i ? metres(p[i - 1], q) : 0), 0) >= 15);
}

// Second cut: a line that turns sharply (over 60°) at a junction has turned into another street (an area regulation
// drawn as one route through Stocksund Norra: tapping one street highlighted the whole loop). Cuts there, when the
// municipality has OSM junctions; a bend in the same street with no junction stays.
// Without junctions (the junction job has not reached the municipality yet) only a near right angle (over 75°) cuts:
// in a street grid that is a corner onto another street; a bend in one street is gentler at any single vertex.
export function splitAtJunctions(g, junctions) {
  if (g.length < 3) return [g];
  const withJ = junctions && junctions.length;
  const cuts = new Set();
  for (let i = 1; i < g.length - 1; i++) {
    let b = i - 1; while (b > 0 && metres(g[b], g[i]) < 10) b--;
    let a = i + 1; while (a < g.length - 1 && metres(g[a], g[i]) < 10) a++;
    const t = turn(g[b], g[i], g[a]);
    if (withJ ? t > 60 && junctions.some((j) => metres(j, g[i]) < 20) : t > 75) cuts.add(i);
  }
  if (!cuts.size) return [g];
  const pieces = []; let cur = [g[0]];
  for (let i = 1; i < g.length; i++) { cur.push(g[i]); if (cuts.has(i) && i < g.length - 1) { pieces.push(cur); cur = [g[i]]; } }
  pieces.push(cur);
  return pieces.filter((p) => p.length >= 2 && p.reduce((s, q, i) => s + (i ? metres(p[i - 1], q) : 0), 0) >= 15);
}

const asScript = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (asScript) main();
function main() {
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const roadsFile = path.join(dir, 'check', 'roads.json');
  const roadsAll = fs.existsSync(roadsFile) ? JSON.parse(fs.readFileSync(roadsFile, 'utf8')) : null;
  if (!roadsAll) { console.log('no cities/rdt/check/roads.json: run cities/rdt-roads.mjs first (needs the network); nothing cut'); return; }
  let split = 0, files = 0, pieces = 0, shown = 0, candidates = 0;
  for (const row of idx.cities) {
    const file = path.join(dir, `${row.id}.json`);
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    const roads = roadsAll[row.id] || [];
    let next = Math.max(0, ...c.segments.map((s) => s.i)) + 1;
    const out = []; let changed = false;
    for (const s of c.segments) {
      candidates += candidateHops(s.g).length;
      const parts = splitHops(s.g, roads).flatMap((g) => splitAtJunctions(g, c.junctions));
      if (parts.length === 1 && parts[0].length === s.g.length) { out.push(s); continue; }
      changed = true; split++; pieces += parts.length;
      if (!APPLY && shown++ < 25) console.log(`${row.id}: ${s.n} ${s.c} ${s.g.length} pts → ${parts.map((p) => p.length).join('+')}`);
      const { p: _p, x: _x, ...base } = s; // trimmed parts belong to the old line: cities/rdt-trim.mjs redraws them
      parts.forEach((g, k) => out.push({ ...base, g, i: k === 0 ? s.i : next++ }));
    }
    if (!changed) continue;
    files++;
    if (!APPLY) continue;
    c.segments = out;
    c.built = new Date().toISOString(); delete c.hash;
    const text = JSON.stringify(c); c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
    fs.writeFileSync(file, JSON.stringify(c));
  }
  console.log(`${candidates} candidate hops; ${split} lines ${APPLY ? 'split' : 'would split'} into ${pieces} pieces in ${files} municipalities`);
}
