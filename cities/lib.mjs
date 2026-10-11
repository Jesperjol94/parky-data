// Shared helpers for new cities (expansion). Turns the Swedish rule texts that city open data uses into the
// segment format the app's engine reads (see engine/evaluate.js in parky-beta):
//   s cleaning bans {w weekday 1-7, a, b minutes, m season [[m,d],[m,d]], p 'even'|'odd'}
//   f other bans {w?, dt?, a, b, m?, p?}, aw allowed-only windows, l time limits {dt?, a, b, max, m?, p?}
// Policy (same as Stockholm): anything we cannot read with confidence makes the segment uncertain (u: grey
// in the app), never more permissive than the text.

export const MONTHS = { januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6, juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12 };
const WD = { mån: 1, tis: 2, ons: 3, tors: 4, fre: 5, lör: 6, sön: 7 };
const WDRE = '(mån|tis|ons|tors|fre|lör|sön)(?:dag|dagar)';
const MRE = `(${Object.keys(MONTHS).join('|')})`;
const T = '(\\d{1,2})[.:](\\d{2})';
export const hm = (h, m) => +h * 60 + +m;

// Day phrases on Swedish signs → engine day types (engine/holidays.js). null = every day.
const DAYS = [
  [/^vardag(?:ar)? utom (?:vardag|dag) före sön- och helgdag(?:ar)?/, ['vardag']],
  [/^vardag(?:ar)? före sön- och helgdag(?:ar)?/, ['fore']],
  [/^sön- och helgdag(?:ar)?/, ['helgdag']],
  [/^vardag(?:ar)?/, ['vardag', 'fore']],
  [/^alla dagar/, null],
];

const norm = (s) => s.replace(/\s+/g, ' ').trim().replace(/\.$/, '').trim();
const date = (d, m) => [MONTHS[m.toLowerCase()], +d];

// "under tiden 15:e mars - 30:e april" (also without "under tiden", and "30 april") → [[3,15],[4,30]]
const SEASON = new RegExp(`(?:under tiden )?(\\d{1,2})(?::[ae])? ${MRE} ?- ?(\\d{1,2})(?::[ae])? ${MRE}`, 'i');
function season(s) {
  const m = SEASON.exec(s);
  return m ? { m: [date(m[1], m[2]), date(m[3], m[4])], rest: (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim() } : { m: null, rest: s };
}

// Times and day phrases: "vardag klockan 09.00 - 18.00 och vardag före sön- och helgdag klockan 09.00 - 15.00"
// → [{dt, a, b}]. Returns null when anything is left over that we do not understand.
export function parseDayTimes(text) {
  let s = norm(text).toLowerCase();
  const out = [];
  let dt, haveDay = false, haveTime = false;
  const flushDay = () => { if (haveDay && !haveTime) out.push({ dt, a: 0, b: 1440 }); };
  while (s.length) {
    s = s.replace(/^(och|samt|,)\s*/, '');
    if (!s) break;
    const d = DAYS.find(([re]) => re.test(s));
    if (d) { flushDay(); dt = d[1]; haveDay = true; haveTime = false; s = s.replace(d[0], '').trim(); continue; }
    const t = new RegExp(`^(?:klockan |kl\\.? )?${T} ?- ?${T}`).exec(s);
    if (t) { const a = hm(t[1], t[2]), b = hm(t[3], t[4]); out.push({ dt, a, b: b === 0 ? 1440 : b }); haveTime = true; s = s.slice(t[0].length).trim(); continue; }
    return null;
  }
  flushDay();
  return out.map((w) => clean({ ...w, dt: w.dt ?? undefined }));
}

export const clean = (o) => { for (const k of Object.keys(o)) if (o[k] == null) delete o[k]; return o; };

// "30 min", "2 tim", "24 tim", "7 dygn" → minutes
export function maxMinutes(text) {
  const m = /^(\d+)\s*(min|tim|timmar|dygn|dag|dagar)\b/i.exec((text || '').trim());
  if (!m) return null;
  return +m[1] * ({ min: 1, tim: 60, timmar: 60, dygn: 1440, dag: 1440, dagar: 1440 }[m[2].toLowerCase()]);
}

// Göteborg-style limitation texts (MaxParkingTimeLimitation) together with the sign's max time.
// Returns { l?: limit windows, aw?: allowed-only windows, feeSeason?: season, u?: true }.
export function parseLimitation(text, maxText) {
  const max0 = maxMinutes(maxText);
  if (!text) return max0 ? { l: [{ a: 0, b: 1440, max: max0 }] } : {};
  let s = norm(text);
  let r;
  if ((r = /^Avgiftsplikten gäller (.*)$/i.exec(s))) { // fee only part of the year
    const se = season(r[1]);
    return { feeSeason: se.m, ...(max0 ? { l: [{ a: 0, b: 1440, max: max0 }] } : {}), ...(se.m && !se.rest ? {} : { u: true }) };
  }
  if ((r = /^Tillåtelsen gäller under högst (.+?) i ?följd$/i.exec(s))) {
    const max = maxMinutes(r[1]);
    return max ? { l: [{ a: 0, b: 1440, max }] } : { u: true };
  }
  if ((r = /^Tillåtelsen gäller (.*)$/i.exec(s))) { // parking allowed only then
    const ranges = r[1].split(/ och (?=\d)/).map(season);
    if (ranges.every((x) => x.m && !x.rest)) return { aw: ranges.map((x) => ({ a: 0, b: 1440, m: x.m })), ...(max0 ? { l: [{ a: 0, b: 1440, max: max0 }] } : {}) };
    const se = season(r[1]);
    const w = parseDayTimes(se.rest);
    return w && w.length ? { aw: w.map((x) => clean({ ...x, m: se.m })), ...(max0 ? { l: [{ a: 0, b: 1440, max: max0 }] } : {}) } : { u: true };
  }
  let max = max0, rest;
  if ((r = /^Tidsbegränsningen gäller (.*)$/i.exec(s))) rest = r[1];
  else if ((r = /^Parkering är dock tillåten under högst (.+?) i ?följd(?: mot avgift)?(?: under)?(?: tiden)?(.*)$/i.exec(s))) { max = maxMinutes(r[1]); rest = r[2]; }
  else return { u: true };
  if (!max) return { u: true };
  const se = season(rest);
  if (!se.rest) return { l: [clean({ a: 0, b: 1440, max, m: se.m })] };
  const w = parseDayTimes(se.rest);
  if (!w || !w.length) return { u: true };
  return { l: w.map((x) => clean({ ...x, max, m: se.m })) };
}

// Bans: "P-förbud tisdagar klockan 09.00 - 12.00 jämna veckor under tiden 15:e mars - 30:e april."
// and Göteborg cleaning texts "Tisdag klockan 09.00 - 12.00 udda veckor." → { s?: weekday windows, f?: daily windows } or null.
export function parseBan(text) {
  let s = norm(text).replace(/^P-förbud\s*/i, '');
  const se = season(s); s = se.rest;
  let p = null;
  s = s.replace(/\s*(?:och )?(jämna|udda) veckor\s*/i, (_, x) => { p = x.toLowerCase() === 'jämna' ? 'even' : 'odd'; return ' '; }).replace(/\s+/g, ' ').trim();
  if (/datum/i.test(s)) return null; // "udda datum": not expressible
  let days = null, r;
  if ((r = new RegExp(`^${WDRE} ?- ?${WDRE}\\b`, 'i').exec(s))) {
    const a = WD[r[1].toLowerCase()], b = WD[r[2].toLowerCase()];
    days = []; for (let d = a; d <= b; d++) days.push(d);
    s = s.slice(r[0].length).trim();
  } else if ((r = new RegExp(`^${WDRE}\\b`, 'i').exec(s))) { days = [WD[r[1].toLowerCase()]]; s = s.slice(r[0].length).trim(); }
  const t = new RegExp(`^klockan ${T} ?- ?${T}$`, 'i').exec(s);
  if (!t) return null;
  const a = hm(t[1], t[2]); let b = hm(t[3], t[4]); if (b === 0) b = 1440;
  if (b <= a) return null; // over midnight: not seen in the data, keep it honest
  const base = clean({ a, b, m: se.m, p });
  return days ? { s: days.map((w) => ({ w, ...base })) } : { f: [base] };
}

// "34 kr/tim 8-22 alla dagar. Övrig tid: 2 kr/tim" / "23 kr/30 min 8-22 alla dagar…" → fee zone for engine/taxa.js
export function parseCost(text) {
  const s = norm(text || '');
  const m = /^(\d+(?:[.,]\d+)?) kr\/(tim|30 min) (\d{1,2})(?:[.:]\d{2})?-(\d{1,2})(?:[.:]\d{2})? alla dagar/i.exec(s);
  if (!m) return null;
  const price = parseFloat(m[1].replace(',', '.')) * (m[2] === 'tim' ? 1 : 2);
  const other = /Övrig tid:? (\d+(?:[.,]\d+)?) kr\/tim/i.exec(s);
  const cap = /maxtaxa (\d+) kr\/dag/i.exec(s);
  const all = ['vardag', 'fore', 'helgdag'];
  return clean({ periods: [{ days: all, start: +m[3] * 60, end: +m[4] * 60, price }], otherTime: other ? parseFloat(other[1].replace(',', '.')) : undefined, residents: null, dayCap: cap ? +cap[1] : undefined });
}

// WKT (LINESTRING / MULTILINESTRING / GEOMETRYCOLLECTION of those) → array of lines [[lon,lat]...]; areas are skipped.
export function wktLines(wkt) {
  if (!wkt) return [];
  const out = [];
  const re = /LINESTRING\s*\(([^()]*)\)|MULTILINESTRING\s*\(((?:\([^()]*\)\s*,?\s*)+)\)/gi;
  let m;
  while ((m = re.exec(wkt))) {
    const parts = m[1] != null ? [m[1]] : m[2].match(/\(([^()]*)\)/g).map((x) => x.slice(1, -1));
    for (const p of parts) out.push(p.split(',').map((xy) => xy.trim().split(/\s+/).map(Number)));
  }
  return out;
}

const r5 = (v) => Math.round(v * 1e5) / 1e5;
// Round to ~1 m and drop repeated points; null if the line collapses (the app rejects single-point lines).
export function cleanLine(line) {
  const g = line.map(([x, y]) => [r5(x), r5(y)]).filter((pt, j, arr) => j === 0 || pt[0] !== arr[j - 1][0] || pt[1] !== arr[j - 1][1]);
  return g.length >= 2 && g.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) ? g : null;
}

// Same checks as the app (data/ParkyData.ts valid()) plus a sanity check that all lines are inside the city.
export function validate(file, bounds) {
  const errs = [];
  if (file.v !== 1 || typeof file.built !== 'string' || !Array.isArray(file.segments)) errs.push('bad header');
  if (file.segments.length <= 1000) errs.push(`only ${file.segments.length} segments (app needs > 1000)`);
  let outside = 0;
  for (const s of file.segments) {
    if (!Array.isArray(s.g) || s.g.length < 2) errs.push(`segment ${s.i} has < 2 points`);
    if (s.g.some(([x, y]) => x < bounds.w || x > bounds.e || y < bounds.s || y > bounds.n)) outside++;
    if (s.t != null && s.t !== 0 && !file.taxa?.[s.t]) errs.push(`segment ${s.i} uses unknown taxa ${s.t}`);
  }
  if (outside) errs.push(`${outside} segments outside the city bounds`);
  return errs;
}

// ---- OpenStreetMap: street names for unnamed curbs, and the 10-metre rule (same as Stockholm's build.mjs)
import { index, zonePieces, visibleParts, R_JUNCTION, R_CROSSING, setLatitude } from '../pipeline/zones.mjs';

export function applyOsm(file, osm, lat) {
  setLatitude(lat);
  const KX = Math.cos(lat * Math.PI / 180) * 111320, KY = 110574;
  const P = ([x, y]) => [x * KX, y * KY];
  const out = { named: 0, unnamed: 0, withZones: 0 };
  // Street names: nearest named OSM way to the curb's midpoint, within 25 m
  const cell = 80, grid = new Map();
  osm.streets.forEach((s, k) => { s.p = s.g.map(P); for (const [x, y] of s.p) { const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`; if (!grid.has(key)) grid.set(key, new Set()); grid.get(key).add(k); } });
  const dist = (p, line) => { let b = Infinity; for (let i = 1; i < line.length; i++) { const [ax, ay] = line[i - 1], [bx, by] = line[i], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2)) : 0; b = Math.min(b, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy)); } return b; };
  for (const s of file.segments) {
    if (s.n) continue;
    const m = P(s.g[Math.floor(s.g.length / 2)] ), q = P(s.g[0]), r = P(s.g[s.g.length - 1]);
    const cand = new Set();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const k of grid.get(`${Math.floor(m[0] / cell) + i}:${Math.floor(m[1] / cell) + j}`) || []) cand.add(k);
    let best = null, bd = Infinity;
    for (const k of cand) { const d = (dist(m, osm.streets[k].p) * 2 + dist(q, osm.streets[k].p) + dist(r, osm.streets[k].p)) / 4; if (d < bd) { bd = d; best = osm.streets[k]; } }
    if (best && bd < 25) { s.n = best.n; out.named++; } else out.unnamed++;
  }
  for (const s of osm.streets) delete s.p;
  // 10-metre rule
  const grids = [index(osm.junctions, R_JUNCTION, 'j'), index(osm.crossings, R_CROSSING, 'c')];
  for (const s of file.segments) {
    if (s.v) continue;
    const z = zonePieces(s.g, grids);
    if (z.length) { s.p = visibleParts(s.g, z); s.x = z.map(({ g, k }) => ({ g, k })); out.withZones++; }
  }
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  file.junctions = osm.junctions.map((p) => p.map(r5));
  file.crossings = osm.crossings.map((p) => p.map(r5));
  file.attribution += ' · © OpenStreetMap';
  return out;
}

// Hash of the rules themselves (not the build time), like Stockholm's: the app downloads only when it changes.
import crypto from 'node:crypto';
export function rehash(file) {
  const { v, built, hash, ...content } = file;
  file.hash = crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 16);
  return file;
}
