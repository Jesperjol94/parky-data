// Turns raw Stockholm LTF "P_TILLATEN" records into one compact rule object per curb segment.
// Runs in the nightly data pipeline (Node), not in the app.
//
// How the city encodes things (verified against the data and the Servicetid texts):
//  * Each record is a period when parking IS allowed on that curb. A segment is split into several
//    records by season, week parity and day type.
//  * A record with a weekday and END <= START (e.g. "fredag 600-0", "måndag 1600-800") means
//    "allowed from <weekday> START until the next <weekday> END", i.e. forbidden on that weekday
//    between END and START. That gap is the street-cleaning window (Servicetid).
//  * DAY_TYPE on such a record limits which days the window applies to (cleaning on a Wednesday that
//    is a public holiday does not happen if no record covers 'helgdag').
//  * Records for other vehicles (rörelsehindrade, motorcykel, buss …) mean the spot is reserved.
//    'fordon' records on the same curb are then the only times an ordinary car may park there.
//  * Numeric VF_PLATS_TYP ('7' loading, …) are purpose spots: the record is when the purpose applies.
//  * MAX_DAYS/HOURS/MINUTES on a 'fordon' record is a time limit during that record's day type and hours.
// Anything we cannot interpret with confidence sets `u` (uncertain): the app shows it grey, never green.
import { taxaOf } from './taxa.js';
import { parseServiceText } from './service.js';

const DAYTYPES = {
  'vardag utom vardag före sön- och helgdag': ['vardag'],
  'vardag före sön- och helgdag': ['fore'],
  'sön- och helgdag': ['helgdag'],
  vardag: ['vardag', 'fore'],
};
const WEEKDAYS = { måndag: 1, tisdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lördag: 6, söndag: 7 };
const CAR = new Set(['fordon', 'personbil']);
const VEHICLE_LABEL = {
  rörelsehindrade: 'rörelsehindrade', motorcykel: 'motorcykel', cykel: 'cykel', beskickningsfordon: 'beskickningsfordon',
  buss: 'buss', utryckningsfordon: 'utryckningsfordon', 'moped-klass1': 'moped', 'moped-klass2': 'moped', 'tung lastbil': 'lastbil',
};

const hhmm = (v) => (v == null ? null : Math.floor(+v / 100) * 60 + (+v % 100));
const maxMinutes = (p) => {
  const m = (+p.MAX_DAYS || 0) * 1440 + (+p.MAX_HOURS || 0) * 60 + (+p.MAX_MINUTES || 0);
  return m || null;
};
const season = (p) => {
  if (p.START_MONTH == null && p.END_MONTH == null) return null;
  const sm = +p.START_MONTH || 1, em = +p.END_MONTH || 12;
  return [[sm, +p.START_DAY || 1], [em, +p.END_DAY || 31]];
};
const parity = (p) => (p.ODD_EVEN === 'jämna veckor' ? 'even' : p.ODD_EVEN === 'udda veckor' ? 'odd' : null);
const dayTypes = (p) => (p.DAY_TYPE ? DAYTYPES[p.DAY_TYPE] || 'bad' : null);

const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] == null) delete o[k]; return o; };

// Merge windows that differ only in day types; drop dt when all three are covered.
function mergeDayTypes(list) {
  const out = [];
  for (const w of list) {
    const { dt, ...rest } = w;
    const hit = out.find((o) => { const { dt: _, ...r } = o; return sameJSON(r, rest); });
    if (!hit) { out.push({ ...w, dt: dt ? [...dt] : null }); continue; }
    if (!hit.dt || !dt) hit.dt = null; else hit.dt = [...new Set([...hit.dt, ...dt])];
  }
  for (const o of out) { if (o.dt && o.dt.length === 3) o.dt = null; clean(o); }
  return out;
}

export function isValidAt(p, t) {
  const from = p.VALID_FROM ? Date.parse(p.VALID_FROM) : -Infinity;
  const to = p.VALID_TO ? Date.parse(p.VALID_TO) : Infinity;
  return from <= t && t < to;
}

// records: properties of all valid records sharing one geometry
export function normalizeSegment(records) {
  const first = records[0];
  const seg = { n: records.find((p) => p.STREET_NAME)?.STREET_NAME || null, d: records.find((p) => p.CITY_DISTRICT)?.CITY_DISTRICT || null, c: first.CITATION || null };
  const others = records.filter((p) => !CAR.has(p.VEHICLE));
  const cars = records.filter((p) => CAR.has(p.VEHICLE));
  let uncertain = false;

  // Price and residents
  const rates = [...new Set(records.map((p) => p.PARKING_RATE).filter(Boolean))];
  const taxas = [...new Set(rates.map(taxaOf))];
  seg.t = taxas.length === 1 ? taxas[0] : null; // null = unknown price
  if (taxas.length > 1) uncertain = true;
  const types = new Set(records.map((p) => p.VF_PLATS_TYP));
  if (types.has('P Avgift, boende')) seg.r = 1;
  else if (types.has('P-avgift endast besök')) seg.r = 0;
  if (first.PARKING_DISTRICT) seg.z = first.PARKING_DISTRICT;

  // Purpose spots (ändamålsplats, VF_PLATS_TYP is a number, '7' = loading). The records give the hours
  // when the spot is reserved for its purpose; what applies at other times is only on the sign/regulation
  // (often a fee, sometimes a ban). So: reserved during those hours, uncertain (grey) the rest of the time.
  if (records.length && records.every((p) => /^\d+$/.test(p.VF_PLATS_TYP || ''))) {
    seg.v = records.some((p) => p.VF_PLATS_TYP === '7') ? 'lastning' : 'särskilt ändamål';
    const k = [];
    let ok = true;
    for (const p of records) {
      const dt = dayTypes(p);
      const a = hhmm(p.START_TIME), b = hhmm(p.END_TIME);
      const w = p.START_WEEKDAY ? WEEKDAYS[p.START_WEEKDAY] : null;
      if (dt === 'bad' || a == null || b == null || b <= a || (p.START_WEEKDAY && !w) || (p.END_WEEKDAY && p.END_WEEKDAY !== p.START_WEEKDAY)) { ok = false; break; }
      k.push(clean({ w, dt, a, b, m: season(p), p: parity(p) }));
    }
    if (ok && k.length) seg.k = mergeDayTypes(k); // without k the spot counts as reserved at all times (safe)
    return clean(seg);
  }

  if (others.length) {
    // Reserved for another vehicle type. Cars only during 'fordon' records.
    const v = others.map((p) => VEHICLE_LABEL[p.VEHICLE] || p.VEHICLE);
    seg.v = [...new Set(v)].join(', ');
    const allow = [];
    for (const p of cars) {
      const dt = dayTypes(p);
      if (dt === 'bad' || p.START_WEEKDAY) { uncertain = true; continue; }
      allow.push(clean({ dt, a: hhmm(p.START_TIME) ?? 0, b: hhmm(p.END_TIME) ?? 1440, max: maxMinutes(p), m: season(p), p: parity(p) }));
    }
    if (allow.length) seg.o = mergeDayTypes(allow);
  } else {
    const service = [], limits = [];
    let hasWeekdayRecords = false;
    for (const p of cars) {
      const dt = dayTypes(p);
      if (dt === 'bad') { uncertain = true; continue; }
      const m = season(p), par = parity(p);
      const s = hhmm(p.START_TIME), e = hhmm(p.END_TIME);
      const w = WEEKDAYS[p.START_WEEKDAY];
      const forbudType = p.VF_PLATS_TYP === 'Tidsreglerat parkerings-/stoppförbud';
      if (w) {
        hasWeekdayRecords = true;
        if (p.END_WEEKDAY && WEEKDAYS[p.END_WEEKDAY] !== w) { uncertain = true; continue; }
        if (s == null || e == null) { uncertain = true; continue; }
        if (forbudType) service.push(clean({ w, a: s, b: e || 1440, dt, m, p: par }));
        else if (e <= s) service.push(clean({ w, a: e, b: s, dt, m, p: par }));
        else uncertain = true; // e.g. "onsdag 600-1600": meaning not confirmed
      }
      const max = maxMinutes(p);
      // On a weekday (cleaning) record START/END are the ban's edges, not the limit's hours; those hours are not in the
      // data, so the limit applies all day on that day type (stricter, never more permissive – QA: Abrahamsbergsvägen).
      if (max) limits.push(w ? clean({ dt, a: 0, b: 1440, max, m, p: par }) : clean({ dt, a: s ?? 0, b: e ?? 1440, max, m, p: par }));
    }
    // Servicetid text as a safety net: if the records carry no cleaning window, or the segment is a
    // time-regulated ban (records and text sometimes disagree there), also apply the text's window.
    const texts = [...new Set(cars.map((p) => p.OTHER_INFO).filter((x) => x && /^Servicetid/i.test(x)))];
    const forbudSeg = cars.some((p) => p.VF_PLATS_TYP === 'Tidsreglerat parkerings-/stoppförbud');
    if (texts.length && (!hasWeekdayRecords || forbudSeg)) {
      for (const tx of texts) {
        const sv = parseServiceText(tx);
        if (!sv) { uncertain = true; continue; }
        service.push(...serviceFromText(sv));
      }
    }
    if (service.length) seg.s = mergeDayTypes(service);
    if (limits.length) seg.l = mergeDayTypes(limits);
  }
  if (uncertain) seg.u = 1;
  return clean(seg);
}

// A parsed Servicetid text → forbidden windows. "utom" exceptions become the complement:
// a season exception splits the year; a week-parity exception (within a season) keeps the other parity there.
export function serviceFromText(sv) {
  const base = { w: sv.weekday, a: sv.start, b: sv.end };
  const seasonM = sv.season ? [sv.season.from, sv.season.to] : null;
  const out = [];
  if (!sv.except) { out.push(clean({ ...base, m: seasonM })); return out; }
  const ex = sv.except;
  const other = ex.weeks === 'even' ? 'odd' : ex.weeks === 'odd' ? 'even' : null;
  if (ex.from) {
    // outside the exception period: always; inside: only the other parity (if parity given), else never
    out.push(clean({ ...base, m: [nextDay(ex.to), prevDay(ex.from)] }));
    if (other) out.push(clean({ ...base, m: [ex.from, ex.to], p: other }));
  } else if (other) {
    out.push(clean({ ...base, p: other, m: seasonM }));
  }
  return out;
}
const DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const nextDay = ([m, d]) => (d >= DIM[m - 1] ? [m % 12 + 1, 1] : [m, d + 1]);
const prevDay = ([m, d]) => (d <= 1 ? [m === 1 ? 12 : m - 1, DIM[(m + 10) % 12]] : [m, d - 1]);
