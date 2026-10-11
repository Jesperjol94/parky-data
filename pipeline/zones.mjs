// 10-metre rule (TrF 3 kap. 53 §): no stopping or parking within 10 m of an intersection (measured from the
// nearest edge of the crossing road) or within 10 m before a pedestrian crossing.
// Junctions/crossings are OSM nodes on the road centre line, so the radius from the node adds half a typical
// road width: 10 m + 4 m for junctions. For pedestrian crossings we use 10 m + 1 m on both sides, because the
// direction of travel on a given curb is not in the data (a little stricter than the law, never looser).
export const R_JUNCTION = 14;
export const R_CROSSING = 11;

let KX = Math.cos(59.33 * Math.PI / 180) * 111320; // Stockholm by default
const KY = 110574;
// Other cities (cities/*): metres per degree of longitude depend on the latitude.
export function setLatitude(lat) { KX = Math.cos(lat * Math.PI / 180) * 111320; }
const xy = ([lon, lat]) => [lon * KX, lat * KY];
const ll = ([x, y]) => [x / KX, y / KY];
const CELL = 60;

export function index(points, radius, kind) {
  const grid = new Map();
  for (const p of points) {
    const [x, y] = xy(p);
    const k = `${Math.floor(x / CELL)}:${Math.floor(y / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ x, y, r: radius, kind });
  }
  return grid;
}

function near(grids, x, y) {
  const out = [];
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (const g of grids) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const list = g.get(`${cx + i}:${cy + j}`);
    if (list) out.push(...list);
  }
  return out;
}

// Returns the parts of a polyline (lon/lat) that fall inside any zone: [{ g: [[lon,lat]...], k: 'j'|'c' }]
export function zonePieces(line, grids) {
  const P = line.map(xy);
  const cand = new Set();
  for (const [x, y] of P) for (const z of near(grids, x, y)) cand.add(z);
  if (!cand.size) return [];
  // along-line intervals [s0, s1, kind]
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const ivals = [];
  for (const z of cand) {
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1], [bx, by] = P[i];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
      if (L === 0) continue;
      // solve |A + t*D - Z| = r for t in [0,1]
      const fx = ax - z.x, fy = ay - z.y;
      const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - z.r * z.r;
      const disc = b * b - 4 * a * c;
      if (disc <= 0) continue;
      const sq = Math.sqrt(disc);
      const t0 = Math.max(0, (-b - sq) / (2 * a)), t1 = Math.min(1, (-b + sq) / (2 * a));
      if (t1 <= t0) continue;
      ivals.push([cum[i - 1] + t0 * L, cum[i - 1] + t1 * L, z.kind]);
    }
  }
  if (!ivals.length) return [];
  ivals.sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const iv of ivals) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + 0.5) { last[1] = Math.max(last[1], iv[1]); if (iv[2] === 'j') last[2] = 'j'; }
    else merged.push([...iv]);
  }
  return merged.filter(([s0, s1]) => s1 - s0 >= 1).map(([s0, s1, k]) => ({ g: cut(P, cum, s0, s1).map(ll).map(r5), k, s0, s1 }));
}

// The parts of a polyline outside every zone (what the map draws), given zonePieces' output for that line.
// Parts shorter than 2 m are dropped.
export function visibleParts(line, pieces) {
  const P = line.map(xy);
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = cum[cum.length - 1];
  const out = [];
  let from = 0;
  for (const z of [...pieces].sort((a, b) => a.s0 - b.s0)) {
    if (z.s0 - from >= 2) out.push(cut(P, cum, from, z.s0).map(ll).map(r5));
    from = Math.max(from, z.s1);
  }
  if (total - from >= 2) out.push(cut(P, cum, from, total).map(ll).map(r5));
  return out;
}

const r5 = ([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5];
function at(P, cum, s) {
  for (let i = 1; i < P.length; i++) if (s <= cum[i] || i === P.length - 1) {
    const L = cum[i] - cum[i - 1] || 1, t = Math.min(1, Math.max(0, (s - cum[i - 1]) / L));
    return [P[i - 1][0] + t * (P[i][0] - P[i - 1][0]), P[i - 1][1] + t * (P[i][1] - P[i - 1][1])];
  }
  return P[0];
}
function cut(P, cum, s0, s1) {
  const pts = [at(P, cum, s0)];
  for (let i = 0; i < P.length; i++) if (cum[i] > s0 && cum[i] < s1) pts.push(P[i]);
  pts.push(at(P, cum, s1));
  return pts;
}
