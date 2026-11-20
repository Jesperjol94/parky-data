// One parking strip, one line (owner, 19 Nov: Södra Rådmansgatan in Gävle showed three parallel lines for one row of
// bays, one of them in the park; Pelle and Niklas, Oct: "double lines").
// The register describes a row of parking bays as a thin polygon. In Pelle's files it arrives as a ring, or as an
// out-and-back line that rdt-split cuts into two parallel lines 2–6 m apart, and the road's own line is often there too.
//   1. ring    a thin ring (at most 12 m wide, at least 2.5 times as long) becomes its centre line
//   2. pair    two lines of one regulation with the same rules whose ends meet, at most 9 m apart, become the line
//              between them
//   3. beside  the part of another line of the same regulation and rule that runs beside such a strip (within 14 m, the
//              same way) is cut away: the same rule on the same stretch, drawn twice. What is left of the road line
//              stays (a 477 m street with one 19 m polygon keeps its line), unless it is under 8 m. Lines that only
//              ban are left whole: they are not drawn, and cutting them could only lose a ban.
//   4. twin    the same for a shorter line within 8 m of a longer one of the same regulation and rule: the two edges of
//              one strip, cut up differently so they never paired.
// A line made here is marked sp: 1 and is never paired again, so a second run changes nothing. Fat rings (parking lots)
// stay as outlines.
//   node cities/rdt-strips.mjs cities/rdt [--apply] [--list]     after rdt-split; then overlay, temp, trim, tiny, index
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const RING_MAX_W = 12, RING_MIN_RATIO = 2.5, PAIR_MAX_LAT = 9, PAIR_MAX_ANY = 14, BESIDE = 14, SAME = 8, STEP = 2, GAP = 6, MIN_PIECE = 8;
const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// a line that only bans (own windows, no limit, fee, allowed hours or date parking): not drawn, and never cut here
const onlyBans = (s) => (s.f || []).some((w) => !w.ov) && !(s.l || s.aw || s.t > 0 || s.fu || s.dp || s.o || s.v);
// the rules of a line, without where it is and what was laid on it from other regulations
export const sig = (s) => { const { g, i, n, c, pc, p, an, rx, sp, tb, ...r } = s; if (r.f) { r.f = r.f.filter((w) => !w.ov); if (!r.f.length) delete r.f; } return JSON.stringify(r); };
const lengthOf = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += D(pts[i - 1], pts[i]); return L; };
const sample = (pts, step) => { const out = []; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], d = D(a, b), n = Math.max(1, Math.round(d / step)); for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } out.push(pts[pts.length - 1]); return out; };
// the closest point of a line to p, and its distance
// (`over`: how far p lies beyond the line's first or last point, measured along the line; 0 when it is beside the line)
function closest(p, pts) {
  let best = Infinity, at = pts[0], dir = [1, 0], over = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const raw = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0, t = Math.max(0, Math.min(1, raw));
    const q = [a[0] + dx * t, a[1] + dy * t], d = D(p, q);
    if (d < best) { best = d; at = q; const l = Math.sqrt(l2); dir = l ? [dx / l, dy / l] : dir; over = raw < 0 && i === 1 ? -raw * l : raw > 1 && i === pts.length - 1 ? (raw - 1) * l : 0; }
  }
  return { d: best, at, dir, over };
}
// Douglas–Peucker
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true; const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let worst = 0, at = -1;
    for (let i = a + 1; i < b; i++) { const d = closest(pts[i], [pts[a], pts[b]]).d; if (d > worst) { worst = d; at = i; } }
    if (worst > tol) { keep[at] = true; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// 1. A thin ring's centre line in metres, or null when the ring is not a thin strip.
export function ringAxis(pts) {
  const n = pts.length; if (n < 4 || D(pts[0], pts[n - 1]) > 2) return null;
  const P = lengthOf(pts); if (P < 12 || P > 800) return null;
  let A2 = 0; for (let i = 1; i < n; i++) A2 += pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1];
  const A = Math.abs(A2) / 2, disc = P * P / 4 - 4 * A; if (disc < 0) return null; // rounder than any rectangle
  const W = (P / 2 - Math.sqrt(disc)) / 2, L = (P / 2 + Math.sqrt(disc)) / 2;
  if (W > RING_MAX_W || L < RING_MIN_RATIO * W) return null;
  // main direction of the outline (points along it weigh equally), then the middle of the outline slice by slice
  const sm = sample(pts, 1); const mx = sm.reduce((a, p) => a + p[0], 0) / sm.length, my = sm.reduce((a, p) => a + p[1], 0) / sm.length;
  let sxx = 0, sxy = 0, syy = 0; for (const p of sm) { const x = p[0] - mx, y = p[1] - my; sxx += x * x; sxy += x * y; syy += y * y; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(th), uy = Math.sin(th);
  const st = sm.map((p) => [(p[0] - mx) * ux + (p[1] - my) * uy, -(p[0] - mx) * uy + (p[1] - my) * ux]);
  const smin = Math.min(...st.map((q) => q[0])), smax = Math.max(...st.map((q) => q[0]));
  const bins = Math.max(2, Math.min(60, Math.round((smax - smin) / 4))), bw = (smax - smin) / bins;
  const lo = new Array(bins).fill(Infinity), hi = new Array(bins).fill(-Infinity);
  for (const [s, w] of st) { const k = Math.min(bins - 1, Math.floor((s - smin) / bw)); lo[k] = Math.min(lo[k], w); hi[k] = Math.max(hi[k], w); }
  const mid = []; for (let k = 0; k < bins; k++) if (lo[k] <= hi[k]) mid.push([smin + (k + 0.5) * bw, (lo[k] + hi[k]) / 2, hi[k] - lo[k]]);
  if (mid.length < 2) return null;
  const widths = mid.map((m) => m[2]).sort((a, b) => a - b); if (widths[Math.floor(widths.length / 2)] > RING_MAX_W + 2) return null; // folded back on itself: not a strip along this axis
  const line = [[smin, mid[0][1]], ...mid.map((m) => [m[0], m[1]]), [smax, mid[mid.length - 1][1]]].map(([s, w]) => [mx + s * ux - w * uy, my + s * uy + w * ux]);
  // every point of the centre line must lie inside the strip
  for (const p of line) if (closest(p, pts).d > W / 2 + 3) return null;
  return simplify(line, 0.4);
}

// 2. Do two lines form one strip? Returns the mean distance between them, or null.
export function pairDistance(A, B) {
  const La = lengthOf(A), Lb = lengthOf(B); if (La < 10 || Lb < 10 || Math.min(La, Lb) / Math.max(La, Lb) < 0.7) return null;
  const a0 = A[0], a1 = A[A.length - 1], b0 = B[0], b1 = B[B.length - 1], tol = Math.max(10, 0.12 * Math.max(La, Lb));
  if (!((D(a0, b1) < tol && D(a1, b0) < tol) || (D(a0, b0) < tol && D(a1, b1) < tol))) return null;
  const ds = sample(A, 3).map((p) => closest(p, B).d); const mean = ds.reduce((x, y) => x + y, 0) / ds.length;
  return mean <= PAIR_MAX_LAT && Math.max(...ds) <= PAIR_MAX_ANY ? mean : null;
}
// The line between two lines that form a strip.
export function midLine(A, B) {
  return simplify(sample(A, 8).map((p) => { const q = closest(p, B).at; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; }), 0.4);
}

// 3. The parts of a line (metric `pts`) that do NOT run beside any of the strips: [[from, to], …] in metres along it.
export function freeParts(pts, stripLines, within = BESIDE) {
  const sm = []; let L = 0; // [distance, covered]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = D(a, b); if (!d) continue; const ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d, n = Math.max(1, Math.round(d / STEP));
    for (let j = sm.length ? 1 : 0; j <= n; j++) { const p = [a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]; sm.push([L + d * j / n, stripLines.some((S) => { const c = closest(p, S); return c.d < within && c.over <= 2 && Math.abs(c.dir[0] * ux + c.dir[1] * uy) > 0.87; })]); }
    L += d;
  }
  if (sm.length < 2) return [[0, L]];
  const runs = []; sm.forEach(([, c], i) => { const last = runs[runs.length - 1]; if (last && last.c === c) last.b = i; else runs.push({ c, a: i, b: i }); });
  const len = (r) => sm[Math.min(r.b + 1, sm.length - 1)][0] - sm[r.a][0];
  const merge = (pred, to) => { for (let again = true; again;) { again = false; for (let i = 0; i < runs.length; i++) { if (runs.length > 1 && pred(runs[i], i)) { runs[i].c = to; again = true; } } for (let i = runs.length - 1; i > 0; i--) if (runs[i].c === runs[i - 1].c) { runs[i - 1].b = runs[i].b; runs.splice(i, 1); } } };
  merge((r, i) => !r.c && i > 0 && i < runs.length - 1 && len(r) < GAP, true); // a short gap between two strips
  merge((r) => r.c && len(r) < MIN_PIECE, false);                               // a strip that only touches the line
  merge((r) => !r.c && len(r) < MIN_PIECE, true);                               // a leftover too short to draw
  return runs.filter((r) => !r.c).map((r) => [sm[r.a][0], sm[Math.min(r.b + 1, sm.length - 1)][0]]);
}
// A piece of a line between two distances along it, as metric points.
function between(pts, from, to) {
  const out = []; let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = D(a, b); if (!d) continue; const at = (x) => [a[0] + (b[0] - a[0]) * (x - L) / d, a[1] + (b[1] - a[1]) * (x - L) / d];
    if (from >= L && from <= L + d && !out.length) out.push(at(from));
    if (out.length && L + d < to && L + d > from) out.push(b);
    if (to >= L && to <= L + d && out.length) { out.push(at(to)); break; }
    L += d;
  }
  return out;
}

// All three rules on one municipality file.
export function strips(c) {
  const st = { rings: 0, pairs: 0, beside: 0, besideM: 0, examples: [] };
  const lat0 = (c.bounds.s + c.bounds.n) / 2, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
  const X = (p) => [p[0] * kx, p[1] * ky], G = (q) => [+(q[0] / kx).toFixed(6), +(q[1] / ky).toFixed(6)];
  const groups = new Map();
  for (const s of c.segments) { if (s.ar || !s.g || s.g.length < 2) continue; const k = `${s.c}|${sig(s)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const drop = new Set(), add = []; let next = Math.max(0, ...c.segments.map((s) => s.i), ...(c.parked || []).map((s) => s.i)) + 1;
  const made = (s, line) => { s.g = line.map(G); delete s.pc; delete s.p; s.sp = 1; };
  for (const xs of groups.values()) {
    const m = new Map(xs.map((s) => [s, s.g.map(X)]));
    // 1. thin rings
    for (const s of xs) { if (s.sp) continue; const axis = ringAxis(m.get(s)); if (!axis) continue; made(s, axis); m.set(s, axis); st.rings++; if (st.examples.length < 300) st.examples.push(`ring ${s.n}: ${s.c}`); }
    // 2 and 3, until nothing changes: what is left of two road lines can itself be the two edges of a strip
    for (let round = 0; round < 6; round++) {
      const was = st.pairs + st.beside;
      // 2. pairs, each line once. The two halves of an out-and-back line first: a road line 4 m from the near edge of a
      //    strip must not take that edge away from the far edge it belongs with. Then the closest.
      const free = xs.filter((s) => !s.sp && !drop.has(s)); const cand = [];
      for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) { const d = pairDistance(m.get(free[i]), m.get(free[j])); if (d != null) cand.push([d, free[i], free[j]]); }
      const loop = (a, b) => { const A = m.get(a), B = m.get(b), tol = Math.max(10, 0.12 * Math.max(lengthOf(A), lengthOf(B))); return D(A[0], B[B.length - 1]) < tol && D(A[A.length - 1], B[0]) < tol ? 0 : 1; };
      cand.sort((a, b) => loop(a[1], a[2]) - loop(b[1], b[2]) || a[0] - b[0]); const used = new Set();
      for (const [, a, b] of cand) {
        if (used.has(a) || used.has(b)) continue; used.add(a); used.add(b);
        const [keep, gone] = lengthOf(m.get(a)) >= lengthOf(m.get(b)) ? [a, b] : [b, a];
        const line = midLine(m.get(keep), m.get(gone)); made(keep, line); m.set(keep, line); drop.add(gone); st.pairs++;
        if (st.examples.length < 300) st.examples.push(`pair ${keep.n}: ${keep.c}`);
      }
      // 3. the same rule drawn again beside a strip: cut that part away
      const strip = xs.filter((s) => s.sp && !drop.has(s));
      if (strip.length && !onlyBans(xs[0])) {
        const stripLines = strip.map((s) => m.get(s)), fresh = [];
        for (const L of xs) {
          if (L.sp || drop.has(L)) continue; const lp = m.get(L), len = lengthOf(lp); if (len < MIN_PIECE || (lp.length >= 4 && D(lp[0], lp[lp.length - 1]) < 2)) continue; // rings (parking lots) stay
          const parts = freeParts(lp, stripLines); const left = parts.reduce((a, [f, t]) => a + t - f, 0);
          if (left >= len - 0.5) continue; // nothing beside a strip
          st.beside++; st.besideM += len - left;
          if (st.examples.length < 300) st.examples.push(`beside ${L.n}: ${L.c} (${Math.round(len)} m line, ${Math.round(len - left)} m beside a strip${parts.length ? '' : ': dropped'})`);
          const pieces = parts.map(([f, t]) => between(lp, f, t)).filter((q) => q.length >= 2);
          if (!pieces.length) { drop.add(L); continue; }
          const { pc, p, ...base } = L; L.g = pieces[0].map(G); delete L.pc; delete L.p; m.set(L, pieces[0]);
          for (const q of pieces.slice(1)) { const extra = { ...base, g: q.map(G), i: next++ }; if (base.f) extra.f = base.f.map((w) => ({ ...w })); add.push(extra); fresh.push([extra, q]); }
        }
        for (const [e, q] of fresh) { xs.push(e); m.set(e, q); }
      }
      // 4. the two edges of a strip cut up differently (one long line, three short ones) never pair: a shorter line that
      //    runs within 8 m of a longer one of the same regulation and rule is the same strip again, and is cut away there
      if (!onlyBans(xs[0])) {
        const open = xs.filter((s) => !s.sp && !drop.has(s) && !(m.get(s).length >= 4 && D(m.get(s)[0], m.get(s)[m.get(s).length - 1]) < 2)).sort((a, b) => lengthOf(m.get(b)) - lengthOf(m.get(a)));
        const fresh = [];
        for (let i = 1; i < open.length; i++) {
          const L = open[i]; const lp = m.get(L), len = lengthOf(lp); if (len < MIN_PIECE) continue;
          const longer = open.slice(0, i).filter((s) => !drop.has(s)).map((s) => m.get(s)); if (!longer.length) continue;
          const parts = freeParts(lp, longer, SAME); const left = parts.reduce((a, [f, t]) => a + t - f, 0);
          if (left >= len - 0.5) continue;
          st.beside++; st.besideM += len - left;
          if (st.examples.length < 300) st.examples.push(`twin ${L.n}: ${L.c} (${Math.round(len)} m line, ${Math.round(len - left)} m beside a longer one${parts.length ? '' : ': dropped'})`);
          const pieces = parts.map(([f, t]) => between(lp, f, t)).filter((q) => q.length >= 2);
          if (!pieces.length) { drop.add(L); continue; }
          const { pc, p, ...base } = L; L.g = pieces[0].map(G); delete L.pc; delete L.p; m.set(L, pieces[0]);
          for (const q of pieces.slice(1)) { const extra = { ...base, g: q.map(G), i: next++ }; if (base.f) extra.f = base.f.map((w) => ({ ...w })); add.push(extra); fresh.push([extra, q]); }
        }
        for (const [e, q] of fresh) { xs.push(e); m.set(e, q); }
      }
      if (st.pairs + st.beside === was) break;
    }
  }
  if (drop.size || add.length) c.segments = [...c.segments, ...add].filter((s) => !drop.has(s)); // a fresh piece can be paired away in a later round
  return st;
}

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
const asScript = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (asScript) {
  const dir = process.argv[2] || 'cities/rdt', APPLY = process.argv.includes('--apply'), LIST = process.argv.includes('--list');
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const T = { rings: 0, pairs: 0, beside: 0, besideM: 0 }; let files = 0, before = 0, after = 0; const ex = [];
  for (const row of idx.cities) {
    const file = path.join(dir, `${row.id}.json`); const raw = fs.readFileSync(file, 'utf8'); const c = JSON.parse(raw); before += c.segments.length;
    const st = strips(c); after += c.segments.length;
    for (const k of Object.keys(T)) T[k] += st[k]; for (const e of st.examples) ex.push(`${row.id} ${e}`);
    const { built, hash, ...a } = JSON.parse(raw), { built: b2, hash: h2, ...b } = c;
    if (canon(a) === canon(b)) continue;
    files++;
    c.built = new Date().toISOString(); delete c.hash;
    const text = JSON.stringify(c); c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
    if (APPLY) fs.writeFileSync(file, JSON.stringify(c));
  }
  console.log(`strips: ${T.rings} thin rings and ${T.pairs} pairs of lines became one line each; ${T.beside} lines cut where they ran beside a strip (${Math.round(T.besideM / 1000)} km); ${before} → ${after} lines in ${files} changed municipalities${APPLY ? '' : ' (dry run)'}`);
  if (LIST) console.log(ex.join('\n'));
}
