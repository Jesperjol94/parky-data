// Göteborg: builds the app's segment file from Göteborgs Stad's open ParkingService v2.3 data
// (cities/raw/gbg-*.json.gz, downloaded by cities/probe.mjs).
//   node cities/goteborg/build.mjs  →  cities/out/goteborg.json (+ .gz) and cities/out/goteborg-meta.json
//
// How the city's layers fit together (checked against the data, Oct 2026):
//  * PublicTimeParkings (free, time-limited) and PublicTollParkings (paid) are the curbs; they never share a line.
//  * ResidentialParkings and CleaningZones repeat those curbs' exact WKT and add the residents' area / cleaning ban.
//  * Handicap/MC/Truck parkings are separate curbs reserved for those vehicles.
//  * Id is the official regulation number (RDT/STFS citation, e.g. "1480 2005-00518").
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { applyOsm, rehash, parseLimitation, parseBan, parseCost, wktLines, cleanLine, validate, clean } from '../lib.mjs';

const RAW = 'cities/raw/';
const read = (n) => JSON.parse(zlib.gunzipSync(fs.readFileSync(`${RAW}gbg-${n}.json.gz`)));
export const BOUNDS = { w: 11.5, e: 12.4, s: 57.5, n: 58.0 };

// Göteborg's fee zones get codes 2000+ so they never clash with Stockholm's (1–15) or other cities'.
export const taxaCode = (charge) => {
  const m = /^Taxa (\w+)$/i.exec((charge || '').trim());
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? 2000 + +m[1] : 2900 + (m[1].toUpperCase().charCodeAt(0) - 64);
};

export function build(layers, now = Date.now()) {
  const { time, toll, res, clean: cz, hc, mc, truck } = layers;
  const stats = { curbs: 0, segments: 0, uncertain: 0, areasSkipped: 0, cleaningFromZones: 0, cleaningFromText: 0, cleaningTextMismatch: 0, residentsOnly: 0, cleaningOnly: 0, feeSeason: 0, reasons: {} };
  const why = (r) => { stats.reasons[r] = (stats.reasons[r] || 0) + 1; };
  const resBy = new Map(res.map((r) => [r.WKT, r]));
  const czBy = new Map();
  for (const c of cz) { if (!czBy.has(c.WKT)) czBy.set(c.WKT, []); czBy.get(c.WKT).push(c); }
  const used = new Set();
  const taxa = {};
  const segments = [];

  const curb = (row, kind) => {
    const seg = { n: row.Name || null, c: row.Id || null };
    let u = false;
    if (kind === 'toll') {
      const code = taxaCode(row.ParkingCharge);
      const zone = parseCost(row.ParkingCost);
      if (code && zone) {
        if (taxa[code] && JSON.stringify(taxa[code].periods) !== JSON.stringify(zone.periods)) { u = true; why('taxa differs within zone'); }
        taxa[code] ||= { ...zone, label: row.ParkingCharge };
        seg.t = code;
      } else { seg.t = null; u = true; why('fee text not understood'); }
    } else if (kind === 'time') seg.t = 0;
    else { seg.v = { hc: 'rörelsehindrade', mc: 'motorcykel', truck: 'lastbil' }[kind]; }

    if (kind === 'time' || kind === 'toll') {
      const lim = parseLimitation(row.MaxParkingTimeLimitation, row.MaxParkingTime);
      if (lim.u) { u = true; why('limitation text not understood'); }
      if (lim.feeSeason) { u = true; stats.feeSeason++; why('fee only part of the year'); } // engine has no seasonal fees yet
      if (lim.l) seg.l = lim.l;
      if (lim.aw) seg.aw = lim.aw;
    }

    // Residents
    const r = resBy.get(row.WKT);
    if (r) { seg.r = 1; seg.z = r.ResidentialParkingArea; used.add('r' + row.WKT); }

    // Cleaning / bans: the structured cleaning zones first, the sign text (ExtraInfo) as a fallback.
    const zones = czBy.get(row.WKT);
    const fromText = row.ExtraInfo ? parseBan(row.ExtraInfo) : null;
    if (zones) {
      used.add('c' + row.WKT);
      const sc = [...new Set(zones.map((z) => z.Id).filter((x) => x && x !== row.Id))];
      if (sc.length) seg.sc = sc.join(','); // the cleaning ban is often its own regulation
      seg.s = [];
      for (const z of zones) {
        const w = cleaningWindows(z);
        if (!w) { u = true; why('cleaning zone not understood'); continue; }
        seg.s.push(...w);
      }
      stats.cleaningFromZones++;
      if (fromText && JSON.stringify(fromText.s || fromText.f) !== JSON.stringify(seg.s)) { stats.cleaningTextMismatch++; why('sign text and cleaning zone differ (zone used)'); }
      if (fromText?.f) seg.f = fromText.f; // a daily ban in the text is not a cleaning zone: keep it too
    } else if (row.ExtraInfo) {
      if (!fromText) { u = true; why('ban text not understood'); }
      else { if (fromText.s) seg.s = fromText.s; if (fromText.f) seg.f = fromText.f; stats.cleaningFromText++; }
    }
    if (seg.s && !seg.s.length) delete seg.s;
    if (u) seg.u = 1;
    return clean(seg);
  };

  const add = (row, kind) => {
    const lines = wktLines(row.WKT);
    if (!lines.length) { stats.areasSkipped++; return; }
    stats.curbs++;
    const rule = curb(row, kind);
    for (const line of lines) {
      const g = cleanLine(line);
      if (!g) continue;
      segments.push({ ...rule, g, i: segments.length });
    }
  };
  for (const r of time) add(r, 'time');
  for (const r of toll) add(r, 'toll');
  for (const r of hc) add(r, 'hc');
  for (const r of mc) add(r, 'mc');
  for (const r of truck) add(r, 'truck');
  stats.residentsOnly = res.filter((r) => !used.has('r' + r.WKT)).length; // resident lines on curbs we do not have: not shown
  stats.cleaningOnly = cz.filter((c) => !used.has('c' + c.WKT)).length;
  stats.segments = segments.length;
  stats.uncertain = segments.filter((s) => s.u).length;
  stats.withCleaning = segments.filter((s) => s.s).length;
  stats.withTimeLimit = segments.filter((s) => s.l).length;
  stats.paid = segments.filter((s) => s.t > 0).length;
  stats.free = segments.filter((s) => s.t === 0).length;
  stats.reserved = segments.filter((s) => s.v).length;
  stats.residents = segments.filter((s) => s.r === 1).length;

  const content = {
    city: 'goteborg', name: 'Göteborg', attribution: 'Göteborgs Stad (öppna data)', bounds: BOUNDS,
    // No local rule extends it, so the national rule applies (TrF 3 kap. 49 a §): at most 24 hours on
    // weekdays that are not the day before a Sunday/holiday. (Stockholm's ALTF allows 7 days.)
    general: { maxStay: { dt: ['vardag'], max: 1440 } },
    taxa, segments, junctions: [], crossings: [],
  };
  const hash = crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 16);
  return { file: { v: 1, built: new Date(now).toISOString(), hash, ...content }, stats };
}

// A CleaningZones row → cleaning windows [{w, a, b, m?, p?}]. The text and the structured fields must agree.
// The text wins when it says more (e.g. "Måndag - fredag": the fields only carry the first weekday) or has
// minutes; when the text cannot be read ("udda datum") the fields are used, which is stricter, never looser.
export function cleaningWindows(z) {
  const t = parseBan(z.ActivePeriodText);
  const allYear = z.StartMonth === 1 && z.StartDay === 1 && z.EndMonth === 12 && z.EndDay === 31;
  const w = clean({
    w: z.WeekDay, a: z.StartHour * 60, b: z.EndHour * 60 || 1440,
    m: allYear ? undefined : [[z.StartMonth, z.StartDay], [z.EndMonth, z.EndDay]],
    p: z.OnlyEvenWeeks ? 'even' : z.OnlyOddWeeks ? 'odd' : undefined,
  });
  if (!(w.w >= 1 && w.w <= 7) || !(w.b > w.a)) return null;
  if (t?.s?.length) {
    const x = t.s[0];
    if (x.w !== w.w || Math.floor(x.a / 60) !== Math.floor(w.a / 60) || (x.p || null) !== (w.p || null) || JSON.stringify(x.m || null) !== JSON.stringify(w.m || null)) return null;
    return t.s;
  }
  if (t?.f) return null; // text says every day, fields say one weekday: unclear
  return [w];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!fs.existsSync(`${RAW}gbg-PublicTimeParkings.json.gz`)) { console.log('goteborg: no raw data, skipped'); process.exit(0); }
  const layers = {
    time: read('PublicTimeParkings'), toll: read('PublicTollParkings'), res: read('ResidentialParkings'),
    clean: read('CleaningZones'), hc: read('HandicapParkings'), mc: read('MCParkings'), truck: read('TruckParkings'),
  };
  const { file, stats } = build(layers);
  const osmFile = `${RAW}goteborg-osm.json.gz`;
  if (fs.existsSync(osmFile)) Object.assign(stats, { osm: applyOsm(file, JSON.parse(zlib.gunzipSync(fs.readFileSync(osmFile))), 57.7) });
  else stats.osm = 'no OSM data: no street names from OSM, no 10-metre zones';
  rehash(file);
  const errs = validate(file, BOUNDS);
  fs.mkdirSync('cities/out', { recursive: true });
  const body = JSON.stringify(file);
  fs.writeFileSync('cities/out/goteborg.json', body);
  fs.writeFileSync('cities/out/goteborg.json.gz', zlib.gzipSync(body, { level: 9 }));
  fs.writeFileSync('cities/out/goteborg-meta.json', JSON.stringify({ built: file.built, hash: file.hash, bytes: body.length, errors: errs, ...stats }, null, 2));
  console.log('goteborg', { bytes: body.length, errors: errs, ...stats });
  if (errs.length) process.exit(1);
}
