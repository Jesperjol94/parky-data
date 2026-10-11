// Malmö: builds the app's segment file from Malmö stad's open data (cities/raw/malmo-*.geojson.gz):
//   miljoparkering     curbs with the monthly street-cleaning ban ("miljöparkering"), plus the curb's base rule
//   parkeringsavgifter paid curbs with fee zone (Taxa A–F) and residents' area
//   node cities/malmo/build.mjs  →  cities/out/malmo.json (+ .gz) and cities/out/malmo-meta.json
//
// Malmö only publishes these two layers, so coverage is the paid and cleaned streets (most of the inner city);
// free streets without miljöparkering are not in the data and stay off the map.
// Monthly cleaning ("den 7:e i månaden 12–16") cannot be a weekday window `s`, so it becomes ban windows `f`
// limited to that date in every month (m: [[k, d], [k, d]] for k = 1..12), which today's engine already reads
// correctly; `cl: 1` marks them as cleaning for the app's wording.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { applyOsm, rehash, MONTHS, hm, cleanLine, validate, clean, parseDayTimes } from '../lib.mjs';

const RAW = 'cities/raw/';
export const BOUNDS = { w: 12.8, e: 13.3, s: 55.45, n: 55.7 };
const read = (n) => JSON.parse(zlib.gunzipSync(fs.readFileSync(`${RAW}malmo-${n}.geojson.gz`))).features;

// "Taxa A 30 kr/tim 8–22 (8–22), övrig tid 5 kr/tim": black hours = weekdays, (brackets) = day before a Sunday/
// holiday, nothing in red = Sundays/holidays pay the "övrig tid" rate. Codes 3001+ (A = 3001 … F = 3006).
export function malmoTaxa(text) {
  const s = (text || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const m = /^Taxa ([A-F]) (\d+(?:[.,]\d+)?) kr\/tim (\d{1,2})-(\d{1,2})(?: \((\d{1,2})-(\d{1,2})\))?,? övrig tid (\d+(?:[.,]\d+)?) kr\/tim$/i.exec(s);
  if (!m) return null;
  const price = parseFloat(m[2].replace(',', '.'));
  const periods = [{ days: ['vardag'], start: +m[3] * 60, end: +m[4] * 60, price }];
  if (m[5]) periods.push({ days: ['fore'], start: +m[5] * 60, end: +m[6] * 60, price });
  return { code: 3000 + m[1].toUpperCase().charCodeAt(0) - 64, zone: { periods, otherTime: parseFloat(m[7].replace(',', '.')), label: `Taxa ${m[1].toUpperCase()}` } };
}

const T = /(\d{1,2})\.(\d{2})\s*-\s*(\d{1,2})\.(\d{2})/g;
// A miljöparkering text → ban windows f, or null when not understood. Cross-checked with the day/tid fields.
export function cleaningBans(p) {
  const text = (p.copy_value || '').replace(/\s+/g, ' ').trim();
  const times = [...text.matchAll(T)].map((x) => [hm(x[1], x[2]), hm(x[3], x[4])]);
  const monthly = [...text.matchAll(/(\d{1,2}):[ae] (?:dagen )?i månaden/gi)].map((x) => +x[1]);
  const yearly = [...text.matchAll(new RegExp(`den (\\d{1,2}):[ae] (${Object.keys(MONTHS).join('|')})`, 'gi'))].map((x) => [MONTHS[x[2].toLowerCase()], +x[1]]);
  const fieldDay = +p.day, ft = /^(\d{2})(\d{2}) - (\d{2})(\d{2})$/.exec(p.tid || '');
  const fieldTime = ft ? [hm(ft[1], ft[2]), hm(ft[3], ft[4])] : null;
  const isBan = /förbjuden|inte parkeras/i.test(text);
  if (!isBan || !times.length) return null;
  if (new Set(times.map(String)).size !== 1) return null; // different hours per side: not seen, keep honest
  const [a, b] = times[0];
  if (!(b > a)) return null;
  if (fieldTime && (fieldTime[0] !== a || fieldTime[1] !== b)) return null;
  const out = [];
  if (monthly.length) {
    if (fieldDay && !monthly.includes(fieldDay)) return null;
    for (const d of new Set(monthly)) for (let k = 1; k <= 12; k++) out.push({ a, b, m: [[k, d], [k, d]], cl: 1 });
    return out; // text naming several days (one per side of the street): all of them, stricter, never looser
  }
  if (yearly.length) { for (const md of yearly) out.push({ a, b, m: [md, md], cl: 1 }); return out; }
  // Weekly bans written differently ("vardag före sön- helgdag klockan 08.00 - 15.00")
  const w = parseDayTimes(text.replace(/^Parkering förbjuden /i, '').replace('sön- helgdag', 'sön- och helgdag'));
  return w && w.length ? w : null;
}

// --- geometry: does a line run along another line (same curb)? Metres in a local projection.
const KX = Math.cos(55.6 * Math.PI / 180) * 111320, KY = 110574;
const P = ([x, y]) => [x * KX, y * KY];
function distToLine(p, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
  }
  return best;
}
function samples(line, step = 4) {
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  return out;
}
// Share of line A's length that lies within `tol` metres of line B.
export const overlap = (A, B, tol = 3) => { const s = samples(A); return s.filter((p) => distToLine(p, B) <= tol).length / s.length; };

function grid(items, cell = 60) {
  const g = new Map();
  items.forEach((it, idx) => {
    const keys = new Set(it.pts.map(([x, y]) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`));
    for (const k of keys) { if (!g.has(k)) g.set(k, []); g.get(k).push(idx); }
  });
  return (pts) => {
    const out = new Set();
    for (const [x, y] of pts) for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const idx of g.get(`${Math.floor(x / cell) + i}:${Math.floor(y / cell) + j}`) || []) out.add(idx);
    return [...out];
  };
}

export function build({ clean: cleanF, fees: feeF }, now = Date.now()) {
  const stats = { cleaningCurbs: 0, feeCurbs: 0, feeCoveredByCleaning: 0, segments: 0, reasons: {} };
  const why = (r) => { stats.reasons[r] = (stats.reasons[r] || 0) + 1; };
  const taxa = {};
  const lines = (f) => (f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : f.geometry?.type === 'LineString' ? [f.geometry.coordinates] : []);

  // Fee curbs, one entry per line
  const fees = [];
  for (const f of feeF) for (const l of lines(f)) {
    const g = cleanLine(l); if (!g) continue;
    const p = f.properties;
    const tx = malmoTaxa(p.taxa);
    if (tx) taxa[tx.code] ||= tx.zone;
    fees.push({ g, pts: g.map(P), t: tx ? tx.code : null, z: /^Boende/i.test(p.boendeomradekod || '') ? p.boendeomradekod.replace(/^Boende[\s-]*/i, '') : null, prh: /^PRH/i.test(p.typ_av_parkering || ''), raw: p });
  }
  const nearFees = grid(fees);

  const segments = [];
  const covered = new Set();
  for (const f of cleanF) for (const l of lines(f)) {
    const g = cleanLine(l); if (!g) continue;
    const p = f.properties;
    stats.cleaningCurbs++;
    const pts = g.map(P);
    const seg = { n: null, c: null };
    let u = false;
    const bans = cleaningBans(p);
    if (!bans) { u = true; why('cleaning text not understood'); } else seg.f = bans;
    // The fee curb(s) this line runs along
    const match = nearFees(pts).filter((i) => overlap(pts, fees[i].pts) >= 0.8);
    for (const i of nearFees(pts)) if (overlap(fees[i].pts, pts) >= 0.8) covered.add(i);
    const ts = [...new Set(match.map((i) => fees[i].t))];
    const zs = [...new Set(match.map((i) => fees[i].z).filter(Boolean))];
    const v = p.value;
    if (/motorcykel/i.test(v)) seg.v = 'motorcykel';
    else if (/tidsbegränsad/i.test(v)) { u = true; why('time limit not in the data'); }
    else if (/avgift/i.test(v)) {
      if (ts.length === 1 && ts[0] != null) seg.t = ts[0];
      else { seg.t = null; why(ts.length ? 'several or unknown fee zones' : 'paid curb without fee zone'); }
    } else if (/^Parkering, service$/i.test(v)) seg.t = 0;
    else seg.t = ts.length === 1 ? ts[0] : null; // "Förbud mot att parkera fordon" = the cleaning ban itself; the rest from the fee layer
    if (match.some((i) => fees[i].prh)) seg.v = 'rörelsehindrade';
    if (zs.length === 1) { seg.r = 1; seg.z = zs[0]; }
    if (u) seg.u = 1;
    segments.push({ ...clean(seg), g, i: segments.length });
  }
  // Paid curbs that no cleaning line covers
  fees.forEach((fe, i) => {
    stats.feeCurbs++;
    if (covered.has(i)) { stats.feeCoveredByCleaning++; return; }
    const seg = { n: null, c: null, t: fe.t };
    if (fe.t == null) { seg.u = 1; why('fee text not understood'); }
    if (fe.prh) seg.v = 'rörelsehindrade';
    if (fe.z) { seg.r = 1; seg.z = fe.z; }
    segments.push({ ...clean(seg), g: fe.g, i: segments.length });
  });

  stats.segments = segments.length;
  stats.uncertain = segments.filter((s) => s.u).length;
  stats.unknownPrice = segments.filter((s) => !s.u && s.t == null && !s.v).length;
  stats.withCleaning = segments.filter((s) => s.f).length;
  stats.paid = segments.filter((s) => s.t > 0).length;
  stats.free = segments.filter((s) => s.t === 0).length;
  stats.reserved = segments.filter((s) => s.v).length;
  stats.residents = segments.filter((s) => s.r === 1).length;

  const content = {
    city: 'malmo', name: 'Malmö', attribution: 'Malmö stad (öppna data)', bounds: BOUNDS,
    general: { maxStay: { dt: ['vardag'], max: 1440 } }, // national rule TrF 3 kap. 49 a §; malmo.se: 24 h on weekdays
    taxa, segments, junctions: [], crossings: [],
  };
  const hash = crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 16);
  return { file: { v: 1, built: new Date(now).toISOString(), hash, ...content }, stats };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!fs.existsSync(`${RAW}malmo-miljoparkering.geojson.gz`)) { console.log('malmo: no raw data, skipped'); process.exit(0); }
  const { file, stats } = build({ clean: read('miljoparkering'), fees: read('parkeringsavgifter') });
  const osmFile = `${RAW}malmo-osm.json.gz`;
  if (fs.existsSync(osmFile)) Object.assign(stats, { osm: applyOsm(file, JSON.parse(zlib.gunzipSync(fs.readFileSync(osmFile))), 55.6) });
  else stats.osm = 'no OSM data: no street names from OSM, no 10-metre zones';
  rehash(file);
  const errs = validate(file, BOUNDS);
  fs.mkdirSync('cities/out', { recursive: true });
  const body = JSON.stringify(file);
  fs.writeFileSync('cities/out/malmo.json', body);
  fs.writeFileSync('cities/out/malmo.json.gz', zlib.gzipSync(body, { level: 9 }));
  fs.writeFileSync('cities/out/malmo-meta.json', JSON.stringify({ built: file.built, hash: file.hash, bytes: body.length, errors: errs, ...stats }, null, 2));
  console.log('malmo', { bytes: body.length, errors: errs, ...stats });
  if (errs.length) process.exit(1);
}
