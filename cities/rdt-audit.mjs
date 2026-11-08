// Fixed quality checks over every national-register municipality (cities/rdt/*.json), built from the error types found
// by hand so far (Oct–Nov 2026). Prints a count per check, the worst municipalities, and a few examples each, and
// writes the full lists to cities/qa/audit.json for the review to work through.
//   node cities/rdt-audit.mjs [--engine ../parky-beta] [--examples 5]   (from the repo root)
// With --engine, the app's own rule engine answers every line at six moments and impossible answers are flagged too.
// A check's count is never "the error rate": each is a lead to read against the official text.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
import { parseRegulation } from '../engine/regulation.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ENGINE = opt('--engine', null), N = +opt('--examples', 5);
const idx = JSON.parse(fs.readFileSync('cities/rdt/index.json', 'utf8')).cities;

// ---- official texts
const texts = new Map();
const text = (c) => { const k = c.slice(0, 4); if (!texts.has(k)) { const p = `rdt/texts/${k}.jsonl.gz`;
  texts.set(k, fs.existsSync(p) ? new Map(zlib.gunzipSync(fs.readFileSync(p)).toString().split('\n').filter(Boolean).map(JSON.parse).map((r) => [r.c, r])) : new Map()); }
  return texts.get(k).get(c); };
const body = (c) => (text(c)?.body || '').replace(/\s+/g, ' ');

// ---- geometry helpers (metres)
const xy = (p, lat0) => [p[0] * 111320 * Math.cos(lat0 * Math.PI / 180), p[1] * 110574];
const len = (g, lat0) => { let L = 0; for (let i = 1; i < g.length; i++) { const a = xy(g[i - 1], lat0), b = xy(g[i], lat0); L += Math.hypot(a[0] - b[0], a[1] - b[1]); } return L; };
const mid = (g) => g[Math.floor(g.length / 2)];
const ang = (g, lat0) => { const a = xy(g[0], lat0), b = xy(g[g.length - 1], lat0); return (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI + 180) % 180; };
const adiff = (p, q) => { const d = Math.abs(p - q) % 180; return Math.min(d, 180 - d); };

// ---- rule helpers
const DAYS = ['vardag', 'fore', 'helgdag'];
const allDay = (w) => (w.a ?? 0) <= 0 && (w.b ?? 1440) >= 1440;
const plain = (w) => !w.w && !w.nw && !w.dm && !w.dd && !w.wk && !w.m && !w.p && !w.ov;
const totalBan = (s) => { const own = (s.f || []).filter((w) => !w.ov && plain(w) && allDay(w)); const dts = new Set(own.flatMap((w) => w.dt || DAYS)); return DAYS.every((d) => dts.has(d)); };
const isPermission = (s) => !!(s.l || s.aw || s.t || s.fu || s.dp || s.v);
const feeAllDay = (taxa, id) => { const t = taxa?.[String(id)]; if (!t) return false; const ps = t.periods || []; if (!ps.length) return false; const d = new Set(); for (const p of ps) if (p.start <= 0 && p.end >= 1440 && p.price !== 0) (p.days || DAYS).forEach((x) => d.add(x)); return DAYS.every((x) => d.has(x)); };
const WEEKDAY = [[/\bmåndag/i, 1], [/\btisdag/i, 2], [/\bonsdag/i, 3], [/\btorsdag/i, 4], [/\bfredag/i, 5]];

// ---- checks: id → { title, why, rows: [city, name, citation, note] }
const C = {};
const add = (id, title, why, city, s, note) => { (C[id] ||= { title, why, rows: [] }).rows.push([city, s.n, s.c, note]); };

let total = 0;
for (const row of idx) {
  const d = JSON.parse(fs.readFileSync(`cities/rdt/${row.id}.json`, 'utf8'));
  const lat0 = (d.bounds.s + d.bounds.n) / 2; const segs = d.segments; total += segs.length;
  const byCit = new Map(); for (const s of segs) { if (!byCit.has(s.c)) byCit.set(s.c, []); byCit.get(s.c).push(s); }
  const parsed = new Map();
  const P = (c) => { if (!parsed.has(c)) { const b = body(c); parsed.set(c, b ? parseRegulation(b) : null); } return parsed.get(c); };
  const L = segs.map((s) => ({ s, m: xy(mid(s.g), lat0), a: ang(s.g, lat0), len: len(s.g, lat0) }));
  const seenGeom = new Map();
  for (const x of L) {
    const s = x.s, b = body(s.c), p = P(s.c);
    // 1. geometry
    if (x.len < 3) add('tiny', 'Lines under 3 m', 'Too short to be a real stretch: a split or datum leftover.', row.id, s, `${x.len.toFixed(1)} m`);
    if (x.len > 3000) add('long', 'Lines over 3 km', 'One line for a whole road: the rule probably applies to a part only.', row.id, s, `${(x.len / 1000).toFixed(1)} km`);
    const m = mid(s.g); if (m[0] < d.bounds.w - 0.02 || m[0] > d.bounds.e + 0.02 || m[1] < d.bounds.s - 0.02 || m[1] > d.bounds.n + 0.02) add('outside', 'Lines outside the municipality', 'Wrong datum or a mis-typed coordinate.', row.id, s, `${m[1].toFixed(4)},${m[0].toFixed(4)}`);
    const gk = JSON.stringify(s.g.map((q) => [q[0].toFixed(5), q[1].toFixed(5)])); const prev = seenGeom.get(gk);
    if (prev && prev.c !== s.c) add('dup', 'Same line drawn twice from different regulations', 'An old and a new regulation for the same stretch both on the map (repeal not detected), or two rules for one curb.', row.id, s, `also ${prev.c}`); else seenGeom.set(gk, s);
    // 2. the text says something the line does not carry (looser = the worst kind)
    if (b && !s.u && !s.ux) {
      const own = (s.f || []).filter((w) => !w.ov);
      if (/\bhögst\s+(\d+|en|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|tolv)\s*(tim|min|dygn|dag)/i.test(b) && !s.l && !s.aw && !totalBan(s) && !(p?.permitted === false)) add('limitMissing', 'Text has a longest stay ("högst N tim"), line has none', 'Looser: the app would allow a longer stay than the sign.', row.id, s, b.match(/högst[^.]{0,40}/i)?.[0]);
      for (const [re, w] of WEEKDAY) if (re.test(b) && /parkeras|parkering/i.test(b) && !own.some((f) => f.w === w) && !totalBan(s) && !(s.dp)) { add('weekdayBanMissing', 'Text names a weekday, line has no ban that day', 'Looser: street-cleaning or market-day bans missing. Read the text: the weekday may be an exception, not a ban.', row.id, s, b.match(new RegExp(`[^.]{0,50}${re.source}[^.]{0,40}`, 'i'))?.[0]); break; }
      if (/\bavgift/i.test(b) && !/avgiftsfri|utan avgift|ingen avgift/i.test(b) && !s.t && !s.fu && isPermission(s) && !(p?.permitted === false)) add('feeMissing', 'Text says fee, line has none', 'Looser: shown as free.', row.id, s, b.match(/[^.]{0,40}avgift[^.]{0,40}/i)?.[0]);
      if (totalBan(s) && /\bfår\s+(fordon\s+)?parkeras\b/i.test(b) && !/får\s+(fordon\s+)?(inte|ej)\s+parkeras/i.test(b.slice(0, 400))) add('banButPermission', 'Total ban, but the text grants a permission', 'Stricter or a mis-read: a permission regulation drawn as a ban.', row.id, s, b.slice(b.search(/får\s+(fordon\s+)?parkeras/i), b.search(/får\s+(fordon\s+)?parkeras/i) + 60));
    }
    // 3. fees
    if (s.t && s.t > 0 && feeAllDay(d.taxa, s.t)) add('feeAllDay', 'Fee around the clock, all days', 'Usually wrong: most texts give fee hours. Confirm against the text.', row.id, s, `taxa ${s.t}`);
    if (s.fu && !s.t && b && /(?:klockan|kl\.?)\s*\d/i.test(b.match(/[^.]*avgift[^.]*/i)?.[0] || '')) add('feeHoursUnread', '"Fee – see the sign" although the text gives fee hours', 'The app charges around the clock.', row.id, s, b.match(/[^.]*avgift[^.]*/i)?.[0].slice(0, 80));
    // 4. names
    if (s.an && s.n === s.an) add('areaName', 'Line named after the area regulation, not a street', 'Harmless but ugly: "Norrköpings innerstad" as the street name.', row.id, s, s.an);
  }
  // 5. conflicting lines on the same stretch: a ban-only line and a permission line, different regulations, same place & direction
  const cell = new Map(); const key = (m) => `${Math.floor(m[0] / 60)}:${Math.floor(m[1] / 60)}`;
  for (const x of L) { const k = key(x.m); if (!cell.has(k)) cell.set(k, []); cell.get(k).push(x); }
  for (const x of L) {
    const s = x.s; if (isPermission(s) || !(s.f || []).some((w) => !w.ov) || s.an) continue; // ban-only street regulation
    const [cx, cy] = [Math.floor(x.m[0] / 60), Math.floor(x.m[1] / 60)];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const y of cell.get(`${cx + i}:${cy + j}`) || []) {
      if (y === x || y.s.c === s.c || !isPermission(y.s) || y.s.an) continue;
      if (Math.hypot(x.m[0] - y.m[0], x.m[1] - y.m[1]) < 12 && adiff(x.a, y.a) < 15) { add('conflict', 'A ban line and a permission line from different regulations on the same stretch', 'Which one answers a tap? One of them is often repealed or applies to the other side.', row.id, s, `vs ${y.s.c} (${y.s.n})`); break; }
    }
  }
}

// 6. the app's answers (optional): impossible results from the real engine
if (ENGINE) {
  const ev = await import(path.resolve(ENGINE, 'engine/evaluate.js'));
  const tx = await import(path.resolve(ENGINE, 'engine/taxa.js'));
  const addTaxa = tx.registerTaxa;
  const MOMENTS = [['2026-11-10T10:00:00+01:00', 'Tue 10:00'], ['2026-11-11T03:00:00+01:00', 'Wed 03:00'], ['2026-11-13T14:00:00+01:00', 'Fri 14:00'], ['2026-11-14T13:00:00+01:00', 'Sat 13:00'], ['2026-11-15T11:00:00+01:00', 'Sun 11:00'], ['2026-11-16T22:00:00+01:00', 'Mon 22:00']];
  let checked = 0;
  for (const row of idx) {
    const d = JSON.parse(fs.readFileSync(`cities/rdt/${row.id}.json`, 'utf8'));
    try { addTaxa?.(d.taxa || {}); } catch { /* no taxa */ }
    for (const s of d.segments) {
      for (const [iso, label] of MOMENTS) {
        const t = Date.parse(iso); let a;
        try { a = ev.answer(s, t); checked++; } catch (e) { add('engineThrows', 'The app engine throws on this line', 'A crash in the card for this street.', row.id, s, `${label}: ${String(e).slice(0, 80)}`); break; }
        if (!a || !a.now) continue;
        if ((a.changes || []).some((c) => c.at < t)) add('engineChangeInPast', 'Engine reports a change before now', 'Wrong "until" on the card.', row.id, s, label);
        const until = a.mustLeave ?? a.until;
        if (['ok','paid','limit','free'].includes(a.now.state) && (until == null || until - t > 8 * 86400000) && (s.f || []).some((w) => !w.ov && w.w && !w.nw && !w.p && !w.m && !w.wk)) add('engineIgnoresWeeklyBan', 'Allowed for over 8 days on a street with a weekly ban', 'Looser: the weekly cleaning ban is not applied.', row.id, s, `${label}: ${new Date(until).toISOString().slice(0, 16)}`);
        if (a.now.state === 'paid' && s.t && !feeAllDay(d.taxa, s.t)) {
          const dt = new Date(t); const day = dt.getUTCDay(); const hour = (dt.getUTCHours() + 1) % 24;
          if (day === 0 && hour === 11) add('enginePaidSunday', 'Paid on a Sunday late morning although the fee table has hours', 'Check the fee days (vardag/fore/helgdag).', row.id, s, `taxa ${s.t}`);
        }
      }
    }
  }
  console.log(`engine: ${checked} answers checked`);
}

// ---- report
const out = { at: new Date().toISOString(), lines: total, checks: {} };
console.log(`audit of ${idx.length} municipalities, ${total} lines`);
for (const [id, c] of Object.entries(C).sort((a, b) => b[1].rows.length - a[1].rows.length)) {
  const per = {}; for (const r of c.rows) per[r[0]] = (per[r[0]] || 0) + 1;
  const top = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`\n${id}: ${c.rows.length}  — ${c.title}\n  why: ${c.why}\n  where: ${top}`);
  for (const r of c.rows.slice(0, N)) console.log(`  ${r[0]} ${r[1]} ${r[2]}: ${r[3] || ''}`);
  out.checks[id] = { title: c.title, why: c.why, count: c.rows.length, per, rows: c.rows };
}
fs.mkdirSync('cities/qa', { recursive: true });
fs.writeFileSync('cities/qa/audit.json', JSON.stringify(out));
console.log('\nfull lists: cities/qa/audit.json');
