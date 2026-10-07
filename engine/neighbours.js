// Purpose spots (loading zones etc.) where ordinary cars may park outside the purpose hours ("Övrig tid får fordon
// parkeras") often carry no fee in the city data, although the street around them is paid. Outside the purpose hours
// the street's fee applies, so such a spot takes the fee (and fee zone) of the nearest ordinary curb on the same street.
// Runs in the nightly data pipeline.
export function inheritFees(segments, maxMetres = 40) {
  const cell = (p) => `${Math.floor(p[0] / 0.001)}:${Math.floor(p[1] / 0.0005)}`;
  const grid = new Map();
  for (const s of segments) {
    if (s.v || !s.n || !(s.t > 0)) continue;
    for (const q of s.g) { const k = cell(q); if (!grid.has(k)) grid.set(k, new Set()); grid.get(k).add(s); }
  }
  let changed = 0;
  for (const s of segments) {
    if (!s.k || !s.ko || s.t !== 0 || !s.n) continue;
    let best = null, bd = Infinity;
    for (const p of s.g) {
      const [cx, cy] = cell(p).split(':').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const o of grid.get(`${cx + dx}:${cy + dy}`) || []) {
        if (o.n !== s.n) continue;
        for (const q of o.g) { const d = Math.hypot((q[0] - p[0]) * 56000, (q[1] - p[1]) * 111000); if (d < bd) { bd = d; best = o; } }
      }
    }
    if (best && bd <= maxMetres) { s.t = best.t; if (best.z && !s.z) s.z = best.z; changed++; }
  }
  return changed;
}
