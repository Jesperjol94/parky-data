// Parses Stockholm "Servicetid" texts (OTHER_INFO) into structured service windows, e.g.
//   "Servicetid onsdag 08:00–16:00 1 november–15 maj"
//   "Servicetid torsdag 00:00 - 06:00 utom under tiden jämna veckor  1 maj - 31 oktober"
//   "Servicetid fredag 00:00 - 06:00 utom under tiden 15 juni - 15 augusti"
// Result: { weekday: 1..7, start, end (minutes), season?: {from:[m,d], to:[m,d]},
//           except?: { weeks?: 'even'|'odd', from?:[m,d], to?:[m,d] } }  or null if not understood.
const WEEKDAYS = { måndag: 1, tisdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lördag: 6, söndag: 7 };
export const MONTHS = { januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6, juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12 };
const DASH = '\\s*[–—-]\\s*';
const RANGE = new RegExp(`(\\d{1,2})(?::e)?\\s+(${Object.keys(MONTHS).join('|')})${DASH}(\\d{1,2})(?::e)?\\s+(${Object.keys(MONTHS).join('|')})`, 'i');

export function parseServiceText(text) {
  if (!text) return null;
  const t = text.replace(/\s+/g, ' ').trim();
  const head = new RegExp(`^Servicetid (${Object.keys(WEEKDAYS).join('|')}) (\\d{1,2})[:.](\\d{2})${DASH}(\\d{1,2})[:.](\\d{2})(.*)$`, 'i').exec(t);
  if (!head) return null;
  const out = { weekday: WEEKDAYS[head[1].toLowerCase()], start: +head[2] * 60 + +head[3], end: +head[4] * 60 + +head[5] };
  if (out.end === 0) out.end = 1440;
  let rest = head[6] || '';
  const utom = /\butom\b(.*)$/i.exec(rest);
  const before = utom ? rest.slice(0, utom.index) : rest;
  const season = RANGE.exec(before);
  if (season) out.season = { from: [MONTHS[season[2].toLowerCase()], +season[1]], to: [MONTHS[season[4].toLowerCase()], +season[3]] };
  if (utom) {
    const ex = {};
    const wk = /(jämna|udda) veckor/i.exec(utom[1]);
    if (wk) ex.weeks = wk[1].toLowerCase() === 'jämna' ? 'even' : 'odd';
    const r = RANGE.exec(utom[1]);
    if (r) { ex.from = [MONTHS[r[2].toLowerCase()], +r[1]]; ex.to = [MONTHS[r[4].toLowerCase()], +r[3]]; }
    if (!ex.weeks && !ex.from) return null;
    out.except = ex;
  }
  return out;
}

// Is a calendar date ({m,d}) inside a month/day range that may wrap over new year?
export function inRange(date, from, to) {
  const v = date.m * 100 + date.d, a = from[0] * 100 + from[1], b = to[0] * 100 + to[1];
  return a <= b ? v >= a && v <= b : v >= a || v <= b;
}
