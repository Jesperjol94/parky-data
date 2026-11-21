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
  '0162 2013-00361': 'no stopping or parking "i terräng" (off-road public land): the export maps it to 30 Danderyd streets',
};

// The line's last day. The register gives the end date as a day, and the app treats that day as already over. A regulation that
// "upphör att gälla den 27 november 2026 klockan 16:00" still holds for most of that day, so its end is the day after (the ban shows
// to midnight rather than ending at 00:00 with 16 hours to go: sweep wave 1, Uppsala Geijersgatan and three more roadworks bans).
const MONTH_NO = { januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6, juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12 };
export function endDay(rec) {
  const to = rec && rec.to && /^\d{4}-\d{2}-\d{2}$/.test(rec.to) ? rec.to : null;
  if (!to) return null;
  const m = String(rec.body || '').replace(/\s+/g, ' ').match(/upphör(?:a)? att gälla (?:den )?(\d{1,2}) (januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december) (20\d\d),? (?:klockan|kl\.?) ?(\d{1,2})[.:](\d{2})/i);
  if (!m || (+m[4] === 0 && +m[5] === 0)) return to;
  if (`${m[3]}-${String(MONTH_NO[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}` !== to) return to;
  const d = new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// A line whose whole rule, read from its regulation's text, is one plain all-day ban ("På vändplatsen … får fordon inte parkeras") or one
// plain reservation (a disabled bay): nothing about hours, days, seasons, limits or fees that a point-sized drawing could misplace.
// rdt-tiny.mjs keeps such a line as fact instead of greying it (sweep waves 1–5: about 330 turning-area bans in Nacka, Täby and
// Södertälje were read right but shown as "check the sign").
export function plainWholeRule(s) {
  if (!s.rx || s.ux || s.ex || s.l || s.aw || s.k || s.dp || s.o || s.t || s.fu || s.hv) return false;
  const own = (s.f || []).filter((w) => !w.ov);
  if (s.v) return !own.length;
  return own.length === 1 && own[0].a === 0 && own[0].b === 1440 && Object.keys(own[0]).every((k) => k === 'a' || k === 'b');
}
