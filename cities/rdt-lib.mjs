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

// "Övrig tid är parkering tillåten utan avgift och tidsbegränsning": free outside the fee hours, so the words "utan avgift" there do not
// make the regulation free of charge (sweep wave 3: Danderyd Brovägen "högst 4 tim i följd mot avgift" was shown free at all hours)
export const dropOtherTimeFree = (body) => String(body).replace(/(?<![a-zåäö])övrig tid\b[^.]*?\b(?:utan avgift|avgiftsfri)[^.]*/gi, ' ');

// The register put a ban's season on the time limit as well ("får fordon parkeras högst 3 timmar i följd. Parkering är dock förbjuden torsdag
// klockan 02.00 - 05.00 1 november - 30 april": the line had the 3 h limit in winter only). True when the text's limits carry no season, the
// line's limits are the same windows with the season of one of the text's bans (sweep wave 2: Järfälla Kopparvägen)
export function limitSeasonFromBan(text, line) {
  const tl = text.l || [], ll = line.l || [];
  if (!tl.length || tl.length !== ll.length || tl.some((w) => w.m) || !ll.every((w) => w.m)) return false;
  const key = (w) => JSON.stringify([w.w || 0, w.dt || null, w.a, w.b, w.max, w.p || null]);
  const a = tl.map(key).sort(), b = ll.map(key).sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) return false;
  return (text.f || []).some((f) => f.m && ll.every((w) => JSON.stringify(w.m) === JSON.stringify(f.m)));
}

// Day types from the text for windows whose hours the register and the text agree on. The register often holds a window on the wrong day
// type: plain "vardagar" (Mon–Sat) as Mon–Fri, "vardagar och vardag före sön- och helgdag" or a list of all three day types as its last
// one only, "vardagar, dock ej dag före …" as Saturdays. A register window (bans or limits) gets the text's day types when the text has
// a window of the same weekday, hours, length, season and parity and either names more day types (the line gets stricter) or the register
// has only 'fore' where the text has only 'vardag'. Windows without a twin in the text are left alone. `uniqueOnly`: for texts with
// several places, only when the text has exactly one window of that shape. `explicitOnly`: for texts with an unread sentence, only text
// windows that name their day types count (a window without day words may have them in the unread sentence: Vimmerby Nybblevägen,
// "Tidsbegräsningen gäller vardag före sön- och helgdag"). Returns the new list, or null when nothing changes.
// (sweep findings batch 4: Kalmar Larmgatan, Burlöv Svenshögsvägen, Hagfors Uddeholmsvägen)
export function dayTypesFromText(reg, txt, uniqueOnly = false, explicitOnly = false) {
  if (!reg || !reg.length || !txt || !txt.length) return null;
  const shape = (w) => JSON.stringify([w.w || 0, w.nw || 0, w.dm || 0, w.a, w.b, w.max ?? null, w.m || null, w.p || null, w.dd || null, w.wk || null]);
  const T = new Map(); const seen = new Set();
  for (const w of txt) { if (explicitOnly && !w.dt) continue; const full = JSON.stringify(w); if (seen.has(full)) continue; seen.add(full); const k = shape(w); const e = T.get(k) || { n: 0, dt: new Set() }; e.n++; for (const d of w.dt || ALL_DAYS) e.dt.add(d); T.set(k, e); }
  let changed = false;
  const out = reg.map((w) => {
    if (w.ov || w.w || !w.dt) return w; // overlays, named weekdays and all-day-type windows are never touched
    const e = T.get(shape(w)); if (!e || (uniqueOnly && e.n !== 1)) return w;
    const have = new Set(w.dt), wider = w.dt.every((d) => e.dt.has(d)) && e.dt.size > have.size;
    const swap = w.dt.length === 1 && w.dt[0] === 'fore' && e.dt.size === 1 && e.dt.has('vardag');
    if (!wider && !swap) return w;
    changed = true; const dt = ALL_DAYS.filter((d) => e.dt.has(d)); const { dt: _dt, ...rest } = w;
    return dt.length === 3 ? rest : { ...w, dt };
  });
  if (!changed) return null;
  const uniq = new Set(); return out.filter((w) => { const k = JSON.stringify(w); if (uniq.has(k)) return false; uniq.add(k); return true; });
}

const seasonDays = (m) => { const s = new Set(); let [mo, d] = m[0]; for (let i = 0; i < 400; i++) { s.add(mo * 100 + d); if (mo === m[1][0] && d === m[1][1]) break; d++; if (d > 31) { d = 1; mo = mo % 12 + 1; } } return s; };
// The register put a season on the time limit that the text does not give it: the fee's season ("högst 24 tim i följd mot avgift.
// Avgiftsplikten gäller 1 juni - 31 augusti": Båstad, Orust), the season a weekday ban is lifted in ("Parkering är dock förbjuden tisdag
// 07–16, utom under tiden 30 juni – 1 oktober": Kiruna), or a season the text never mentions (Sotenäs Köpmansgatan). True when the text's
// limits carry no season and the line's limits are the same windows, all with one such season. The limit then holds all year (stricter).
export function limitSeasonNotInText(text, line, feeWindows, textNamesMonths) {
  const tl = text.l || [], ll = line.l || [];
  if (!tl.length || tl.length !== ll.length || tl.some((w) => w.m) || !ll.every((w) => w.m)) return false;
  const key = (w) => JSON.stringify([w.w || 0, w.dt || null, w.a, w.b, w.max, w.p || null]);
  if (JSON.stringify(tl.map(key).sort()) !== JSON.stringify(ll.map(key).sort())) return false;
  const m0 = JSON.stringify(ll[0].m); if (!ll.every((w) => JSON.stringify(w.m) === m0)) return false;
  if (!textNamesMonths) return true;
  if ((feeWindows || []).length && feeWindows.every((w) => w.m && JSON.stringify(w.m) === m0)) return true;
  const mine = seasonDays(ll[0].m);
  return (text.f || []).some((f) => { if (!f.m) return false; const s = seasonDays(f.m); return [...s].every((d) => !mine.has(d)) && s.size + mine.size >= 365; });
}
