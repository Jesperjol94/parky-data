// Shared helpers for the RDT municipality pipeline.
export const ALL_DAYS = ['vardag', 'fore', 'helgdag'];

// Pelle's fee tables sometimes list several prices for the same hours (one municipality-wide table: "8 kr/tim,
// 10 kr/tim, 12 kr/tim"). The rules on those streets are still known; only the price is not. The table is flattened to
// the highest price wherever prices overlap (never cheaper than reality) and marked priceVaries, instead of making
// every street with that fee uncertain. `bad` lists the zones that were flattened.
export function fixTaxa(taxa) {
  const bad = new Set();
  const out = {};
  for (const [k, z] of Object.entries(taxa || {})) {
    const periods = (z.periods || []).map((p) => ({ ...p, days: p.days && p.days.length ? p.days : ALL_DAYS }));
    let overlap = false;
    for (let i = 0; i < periods.length; i++) for (let j = i + 1; j < periods.length; j++) {
      const p = periods[i], q = periods[j];
      if (p.days.some((d) => q.days.includes(d)) && p.start < q.end && q.start < p.end && p.price !== q.price) overlap = true;
    }
    if (!overlap) { out[k] = { ...z, periods }; continue; }
    bad.add(k);
    const flat = [];
    for (const day of ALL_DAYS) {
      const ps = periods.filter((p) => p.days.includes(day));
      const cuts = [...new Set(ps.flatMap((p) => [p.start, p.end]))].sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i], b = cuts[i + 1];
        const cover = ps.filter((p) => p.start <= a && p.end >= b);
        if (!cover.length) continue;
        const price = Math.max(...cover.map((p) => p.price));
        const last = flat[flat.length - 1];
        if (last && last.days[0] === day && last.days.length === 1 && last.end === a && last.price === price) last.end = b;
        else flat.push({ start: a, end: b, price, days: [day] });
      }
    }
    // merge day types with identical period lists
    const merged = [];
    for (const p of flat) {
      const twin = merged.find((q) => q.start === p.start && q.end === p.end && q.price === p.price);
      if (twin) twin.days.push(...p.days); else merged.push({ ...p, days: [...p.days] });
    }
    const prices = [...new Set(periods.map((p) => p.price))].sort((a, b) => a - b);
    out[k] = { ...z, periods: merged, priceVaries: true, label: `${prices[0]}–${prices[prices.length - 1]} kr/tim (varierar, se skylt)` };
  }
  return { taxa: out, bad };
}

// Regulations whose geometry in the export is wrong and cannot be repaired: dropped entirely (rdt-process.mjs at build,
// rdt-drop.mjs on the published files).
export const DROP_CITATIONS = {
  '0162 2016-00023': 'no parking at all turning areas (vändplaner) "enligt kartbild": the export maps it to 687 whole streets of Danderyd, 373 m on average',
};
