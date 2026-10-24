// Re-reads the official regulation texts (rdt/texts/<kommunkod>.jsonl.gz, fetched by rdt-texts.mjs) with the app's own
// parser (engine/regulation.js) and compares them with the published RDT segments (cities/rdt/<id>.json).
//   node cities/rdt-reparse.mjs cities/rdt [--apply] [--only id,id] [--unread N]
// Without --apply nothing is written; a report goes to cities/rdt/check/<id>-reparse.md and a summary is printed.
// With --apply, safe changes are written (hash/built recomputed; run rdt-index.mjs after):
//   - uncertain segment + text fully read + the text gives rules        → rules from the text, u cleared, rx: 1
//   - confident segment + text fully read + text stricter or equal      → rules from the text where they differ, rx: 1
//   - confident segment + text fully read + text more permissive        → the text wins too (owner's decision 18 Oct), counted as disputed
//   - regulation expired ("Upphör att gälla" in the past)              → u: 1, ex: 1 (the sign applies), reported
// Anything the parser could not read stays as it was; the unread sentences are counted (--unread N prints the top N
// patterns) so the parser can be taught the municipality's phrasing.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] == null) delete o[k]; return o; };
import { parseRegulation, expired, ruleText } from '../engine/regulation.js';

const args = process.argv.slice(2);
const dir = args[0] || 'cities/rdt';
const APPLY = args.includes('--apply');
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const UNREAD = args.includes('--unread') ? +args[args.indexOf('--unread') + 1] : 0;
const today = new Date().toISOString().slice(0, 10);

const canon = (ws) => (ws || []).map((w) => JSON.stringify({ w: w.w ?? null, dt: w.dt ? [...w.dt].sort() : null, a: w.a, b: w.b, m: w.m ?? null, p: w.p ?? null, max: w.max ?? null })).sort();
const same = (x, y) => JSON.stringify(canon(x)) === JSON.stringify(canon(y));
const minutesBanned = (ws) => (ws || []).reduce((s, w) => s + (w.b > w.a ? w.b - w.a : 1440 - w.a + w.b) * (w.w ? 1 : (w.dt || ['vardag', 'fore', 'helgdag']).length), 0);

// A text that describes several places (numbered paragraphs, several "På …" clauses, both sides) cannot be compared with
// one segment: the parser merges all its rules. Such texts are only counted, never applied.
function multiPart(body) {
  const t = ruleText(body) || '';
  const paras = (t.match(/\b\d{1,2}\s*§/g) || []).length;
  const places = (t.match(/(?:^|[.;]\s*)På\s/g) || []).length + (t.match(/(?:^|[.;]\s*)Inom\s/g) || []).length;
  const sides = new Set((t.match(/\b(östra|västra|norra|södra)\s+sidan?/gi) || []).map((x) => x.toLowerCase().split(/\s/)[0])).size;
  void paras; // "1 § place, 2 § hours, 3 § fee" is one place in several paragraphs: only several places or sides make a text multi-part (18 Oct review)
  // several sides in one sentence with one rule ("västra sida …, norra sida … samt östra sida … får fordon parkeras") are one rule set (QA 22 Oct)
  return places > 1 || (sides > 1 && (t.match(/får (?:fordon|endast|personbil)/g) || []).length > 1);
}

// Rules the text gives, in segment form
function fromText(r) {
  const o = {};
  if (r.bans.length) o.f = dedupe(r.bans);
  if (r.limits.length) o.l = dedupe(r.limits);
  if (r.allowOnly.length) o.aw = dedupe(r.allowOnly);
  if (r.dp && r.dp.length) o.dp = dedupe(r.dp);
  if (r.reserved) o.v = r.reservedFor || 'reserverad';
  if (r.purpose.length) { o.v = o.v || 'lastning'; o.k = r.purpose; if (r.otherAllowed) o.ko = 1; }
  return o;
}
const hasRules = (o) => !!(o.f || o.l || o.aw || o.v || o.k || o.dp);

// Compare two rule sets on a sampled week (weekday × day type × 15 min): at every instant the stricter set bans at least
// as much and allows at most as long. Seasons and week parity are ignored (a window with them counts as active).
const CTX = [[1, 'vardag'], [2, 'vardag'], [3, 'vardag'], [4, 'vardag'], [5, 'vardag'], [5, 'fore'], [6, 'fore'], [7, 'helgdag'], [1, 'helgdag']];
const active = (w, wd, dt, min) => (w.w ? w.w === wd : w.dt ? w.dt.includes(dt) : true) && (w.a <= w.b ? min >= w.a && min < w.b : min >= w.a || min < w.b);
function stateAt(r, wd, dt, min) {
  const banned = (r.f || []).some((w) => active(w, wd, dt, min)) || ((r.aw || []).length > 0 && !(r.aw || []).some((w) => active(w, wd, dt, min)));
  const max = Math.min(Infinity, ...(r.l || []).filter((w) => active(w, wd, dt, min)).map((w) => w.max));
  return { banned, max };
}
// 'equal' | 'stricter' (text at least as strict everywhere) | 'looser' | 'mixed'
function compare(t, s) {
  let ge = true, le = true;
  for (const [wd, dt] of CTX) for (let min = 0; min < 1440; min += 15) {
    const a = stateAt(t, wd, dt, min), b = stateAt(s, wd, dt, min);
    if (!a.banned && b.banned) ge = false; if (a.banned && !b.banned) le = false;
    if (!a.banned && !b.banned) { if (a.max > b.max) ge = false; if (a.max < b.max) le = false; }
  }
  return ge && le ? 'equal' : ge ? 'stricter' : le ? 'looser' : 'mixed';
}
const dedupe = (ws) => { const seen = new Set(); return ws.filter((w) => { const k = JSON.stringify(w); if (seen.has(k)) return false; seen.add(k); return true; }); };

const unread = new Map();
const dtTally = new Map();
const pattern = (s) => s.toLowerCase().replace(/\d{1,2}[.:]\d{2}/g, 'HH.MM').replace(/\b\d+\b/g, 'N').replace(/\b[A-ZÅÄÖ][a-zåäö]+(?:gatan|vägen|gränd|plan|torget|stigen|gången|leden|backen)\b/gi, 'GATAN').slice(0, 140);

const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const tot = { cities: 0, segs: 0, withText: 0, noText: 0, err: 0, expired: 0, fullyRead: 0, partlyRead: 0, uFilled: 0, verified: 0, strictened: 0, disputed: 0, uStill: 0, textNoRule: 0, multi: 0 };
fs.mkdirSync(path.join(dir, 'check'), { recursive: true });
for (const row of idx.cities) {
  if (only && !only.has(row.id)) continue;
  const cacheFile = path.join('rdt/texts', `${row.kommunkod}.jsonl.gz`);
  if (!fs.existsSync(cacheFile)) continue;
  const texts = new Map();
  for (const l of zlib.gunzipSync(fs.readFileSync(cacheFile)).toString().split('\n')) if (l) { const r = JSON.parse(l); texts.set(r.c, r); }
  const file = path.join(dir, `${row.id}.json`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const st = { segs: c.segments.length, withText: 0, noText: 0, err: 0, expired: 0, fullyRead: 0, partlyRead: 0, uFilled: 0, verified: 0, strictened: 0, disputed: 0, uStill: 0, textNoRule: 0, multi: 0 };
  const lines = [];
  let changed = 0;
  { // exact duplicates (same citation, geometry and rules): Pelle's converter repeats some (Ljungby: 7,419 copies of 50 disabled bays)
    const seen = new Set(); const keep = [];
    for (const s of c.segments) { const k = s.c + JSON.stringify(s.g) + JSON.stringify([s.f, s.l, s.v, s.aw, s.t, s.k]); if (seen.has(k)) { changed++; continue; } seen.add(k); keep.push(s); }
    st.dupes = c.segments.length - keep.length; if (APPLY) c.segments = keep;
  }
  const parsed = new Map();
  const ruleSets = new Map(); // citation -> number of distinct rule sets among its segments (Pelle split one text into parts)
  { const m = new Map(); for (const s of c.segments) { if (!m.has(s.c)) m.set(s.c, new Set()); m.get(s.c).add(JSON.stringify([canon(s.f), canon(s.l), canon(s.aw), s.v || null])); } for (const [k, v] of m) ruleSets.set(k, v.size); }
  for (const s of c.segments) {
    const rec = texts.get(s.c);
    if (!rec) { st.noText++; continue; }
    if (rec.err || !rec.body) { st.err++; continue; }
    st.withText++;
    if (expired(rec, today)) {
      st.expired++;
      lines.push(`| ${s.c} | ${s.n} | expired ${rec.to} | ${s.u ? 'already uncertain' : 'now uncertain'} |`);
      if (APPLY && !s.u) { s.u = 1; s.ex = 1; changed++; }
      continue;
    }
    // Facts read straight from the text, independent of how much of it the parser understands (18 Oct review):
    if (APPLY) {
      const body = rec.body.replace(/\s+/g, ' ').replace(/(?:ger|ge) (?:inte|ej) rätt att[^.]*/gi, '').replace(/där det (?:enligt [^.]*?)?är förbjudet att stanna (?:eller|och) parkera[^.]*/gi, ''); // boilerplate about other bans
      // validity: a regulation not yet in force, or one that ends later, is dated on the segment (the app honours fr/to)
      const fr = rec.from && /^\d{4}-\d{2}-\d{2}$/.test(rec.from) && rec.from > today ? rec.from : null;
      const to = rec.to && /^\d{4}-\d{2}-\d{2}$/.test(rec.to) ? rec.to : null;
      if ((s.fr || null) !== fr) { if (fr) s.fr = fr; else delete s.fr; changed++; }
      if ((s.to || null) !== to) { if (to) s.to = to; else delete s.to; changed++; }
      // fee: "mot avgift" in the text and no fee table known → unknown fee (orange "see sign"), never free
      if (!s.t && /avgift/i.test(body) && !/utan avgift|avgiftsfri|ingen avgift|avgift (?:ska|skall|behöver) (?:inte|ej)/i.test(body)) { if (s.t !== null) { s.t = null; changed++; } if (!s.fu) { s.fu = 1; changed++; } st.feeUnknown = (st.feeUnknown || 0) + 1; }
      // parking disc
      if (/parkeringsskiva|p-skiva/i.test(body) && !s.ps) { s.ps = 1; changed++; }
      // "personbil" is a vehicle class, not a reservation
      if (s.v === 'personbil') { delete s.v; changed++; }
      // "avgiften behöver inte erläggas av rörelsehindrad" is a fee exemption, not a reservation for disabled permit holders
      if (s.v === 'rörelsehindrade' && !/(?:endast|enbart)[^.]{0,60}rörelsehindr|reserverad/i.test(body) && /(?:behöver inte|ej|inte) (?:erläggas|betalas)[^.]{0,80}rörelsehindr|rörelsehindr[^.]{0,80}(?:behöver inte|utan avgift|avgiftsfri|inte betala)/i.test(body)) { delete s.v; changed++; st.notReserved = (st.notReserved || 0) + 1; }
      // a stopping ban ("får fordon inte stannas", "förbud att stanna") is stricter than a parking ban: the card says so
      if (/(?:inte|ej) stannas|förbud att stanna|stanna(?:s)? eller parkera/i.test(body) && s.f && s.f.length && !s.sb) { s.sb = 1; changed++; }
    }
    if (!parsed.has(s.c)) parsed.set(s.c, { r: parseRegulation(rec.body), multi: multiPart(rec.body) || ruleSets.get(s.c) > 1 });
    const { r, multi } = parsed.get(s.c);
    const full = r.unread.length === 0 && ruleText(rec.body);
    if (!full) { st.partlyRead++; for (const u of r.unread) { const p = pattern(u); const e = unread.get(p) || { n: 0, ex: u.slice(0, 200), c: s.c }; e.n++; unread.set(p, e); } if (s.u) st.uStill++; continue; }
    st.fullyRead++;
    // Fee hours from the text ("Avgift enligt Taxa Zon 2 … vardagar … 09.00 - 18.00") narrow a fee table that charges all day:
    // a derived fee entry <taxa>*100+n (8 digits, never a register code) with the same price in those hours only
    // (QA 19 Oct: Växjö showed fees at night and on Sundays)
    if (r.feeWindows && s.t && APPLY) {
      const b0 = s.t >= 1e7 ? Math.floor(s.t / 100) : s.t, base = c.taxa?.[b0];
      // the text's hours replace the table's when the table has one price (all day, or hours the text narrows / gives a season to)
      const allDay = base && base.periods.length && new Set(base.periods.map((p) => p.price)).size === 1;
      const periods = r.feeWindows.filter((w) => !w.w && !w.p && !w.dm && w.a < w.b).map((w) => clean({ days: w.dt || ['vardag', 'fore', 'helgdag'], start: w.a, end: w.b, price: base ? Math.max(...base.periods.map((p) => p.price)) : 0, m: w.m }));
      if (allDay && periods.length === r.feeWindows.length) {
        const sig = JSON.stringify(periods);
        let id = Object.keys(c.taxa).map(Number).find((k) => Math.floor(k / 100) === b0 && JSON.stringify(c.taxa[k].periods) === sig);
        if (!id) { let n = 1; while (c.taxa[b0 * 100 + n]) n++; id = b0 * 100 + n; c.taxa[id] = { periods, label: base.label }; }
        if (s.t !== id) { s.t = id; changed++; st.feeHours = (st.feeHours || 0) + 1; }
      }
    }
    if (r.heavyOnly && !hasRules(fromText(r))) { // the whole text only restricts heavy vehicles: no rule for cars, even when it names several places
      st.heavyOnly = (st.heavyOnly || 0) + 1;
      if (APPLY) { for (const k of ['f', 'l', 'aw', 'v', 'k', 'ko', 'u']) delete s[k]; s.hv = 1; s.rx = 1; changed++; }
      continue;
    }
    if (multi) {
      st.multi++;
      // A text with several stretches (different rules per part): the register's rules for this piece must at least appear
      // somewhere in the text. A ban hour or a time limit the text never mentions means the piece's rules can't be trusted:
      // grey "check the sign" (u, marked ux so a later run can lift it) rather than possibly wrong colours (owner, 24 Oct).
      const tt = fromText(r), win = (w) => `${w.a}-${w.b}`;
      const textBans = new Set((tt.f || []).map(win)), textMax = new Set((tt.l || []).map((l) => l.max)), anyText = hasRules(tt);
      const odd = anyText && (((s.f || []).filter((w) => !w.ov).some((w) => !textBans.has(win(w)) && !(w.a === 0 && w.b === 1440 && /(?:inte|ej) (?:stannas eller )?parkeras|förbjud/i.test(rec.body)))) || (s.l || []).some((l) => !textMax.has(l.max)));
      if (APPLY) { if (odd && !s.u) { s.u = 1; s.ux = 1; changed++; st.multiGrey = (st.multiGrey || 0) + 1; } else if (!odd && s.ux) { delete s.u; delete s.ux; changed++; } }
      if (s.u) st.uStill++; continue;
    }
    const t = fromText(r);
    // a text that permits parking with no further conditions, where the register has a ban or allowed hours: the text wins (QA 22 Oct:
    // Halmstad Brogatan, Huddinge Månvägen and Uppsala Granitvägen showed the fee hours or a whole day as a ban)
    if (!hasRules(t) && r.permitted && !r.heavyOnly && (s.f || s.aw) && !s.v) { st.permitOnly = (st.permitOnly || 0) + 1; if (APPLY) { for (const k of ['f', 'l', 'aw', 'dp', 'k', 'ko']) delete s[k]; delete s.u; s.rx = 1; changed++; } continue; }
    if (!hasRules(t)) { st.textNoRule++; if (s.u) st.uStill++; continue; } // e.g. a pure fee regulation: nothing to compare
    const cur = { f: s.f, l: s.l, aw: s.aw, v: s.v, k: s.k };
    // day-type convention check: when both sides have exactly one window of the same kind, tally (Pelle dt → text dt)
    for (const k of ['f', 'l']) if ((cur[k] || []).length === 1 && (t[k] || []).length === 1 && !cur[k][0].w && !t[k][0].w) {
      const key = `${k} ${JSON.stringify(cur[k][0].dt || 'all')} → ${JSON.stringify(t[k][0].dt || 'all')}`; dtTally.set(key, (dtTally.get(key) || 0) + 1);
    }
    const put = () => { for (const k of ['f', 'l', 'aw', 'dp', 'v', 'k', 'ko']) { if (t[k] !== undefined) s[k] = t[k]; else delete s[k]; } delete s.rd; s.rx = 1; changed++; };
    // Pelle's v: "personbil" is not a reservation (ordinary cars, or motorhomes "klass II"): the text decides
    const pelleV = cur.v === 'personbil' ? null : cur.v || null, textV = t.v || null;
    let verdict;
    if (pelleV && textV) verdict = pelleV === textV ? 'equal' : 'mixed'; // reserved either way; a different vehicle is a dispute
    else if (textV) verdict = 'stricter'; // the text reserves the curb; cars cannot park
    else if (pelleV) verdict = 'looser'; // the text does not reserve it; never relaxed automatically
    else verdict = compare(t, { ...cur, v: undefined });
    if (s.u) {
      st.uFilled++;
      lines.push(`| ${s.c} | ${s.n} | uncertain → ${JSON.stringify(t)} | filled from text |`);
      if (APPLY) { put(); delete s.u; if (!('t' in s) || s.t === null) { if (!/avgift/i.test(rec.body)) s.t = 0; } }
    } else if (verdict === 'equal') {
      st.verified++;
      // equal at every time of a week the comparison samples, but the text says more (even weeks, a season, odd dates, the
      // nth weekday): the text's windows are more precise (QA 22 Oct: Karlstad, Solna "jämna veckor" bans every week)
      const cond = (ws) => JSON.stringify((ws || []).map((w) => [w.p, w.m, w.dd, w.nw, w.dm]));
      if (APPLY && (cond(t.f) !== cond(cur.f) || cond(t.l) !== cond(cur.l)) && JSON.stringify([t.f, t.l]).match(/"(?:p|m|dd|nw|dm)":/)) { put(); st.precise = (st.precise || 0) + 1; }
      if (cur.v === 'personbil' && APPLY) { delete s.v; s.rx = 1; changed++; }
    } else if (verdict === 'stricter' || (cur.v === 'personbil' && !textV && verdict !== 'mixed')) {
      st.strictened++;
      lines.push(`| ${s.c} | ${s.n} | ${JSON.stringify(cur)} → ${JSON.stringify(t)} | ${cur.v === 'personbil' && !textV ? '"personbil" was not a reservation' : 'text stricter'}: applied |`);
      if (APPLY) put();
    } else {
      st.disputed++;
      lines.push(`| ${s.c} | ${s.n} | ${JSON.stringify(cur)} → ${JSON.stringify(t)} | text ${verdict === 'looser' ? 'more permissive' : 'differs'}: text wins (owner's decision 18 Oct) |`);
      if (APPLY) put();
    }
  }
  const md = [`# ${row.name}: published rules vs official regulation texts (re-read with the app's parser)`, '',
    `Run ${today}. ${st.segs} segments: ${st.withText} with a text, ${st.noText} without a cached text, ${st.err} fetch errors.`,
    `Fully read ${st.fullyRead}, partly read ${st.partlyRead}. Verified equal ${st.verified}, filled from text ${st.uFilled}, text stricter ${st.strictened}, disputed ${st.disputed}, expired ${st.expired}, text without rules ${st.textNoRule}, multi-part texts (not compared) ${st.multi}.`, '',
    '| Citation | Street | Change | Note |', '|---|---|---|---|', ...lines.slice(0, 400)].join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'check', `${row.id}-reparse.md`), md);
  if (APPLY && changed) {
    c.built = new Date().toISOString(); delete c.hash;
    const text = JSON.stringify(c); c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
    fs.writeFileSync(file, JSON.stringify(c));
  }
  tot.cities++; for (const k of Object.keys(st)) tot[k] = (tot[k] || 0) + st[k];
  console.log(`${row.id}: text ${st.withText}/${st.segs}, read ${st.fullyRead}+${st.partlyRead}, verified ${st.verified}, filled ${st.uFilled}, stricter ${st.strictened}, disputed ${st.disputed}, multi ${st.multi}, expired ${st.expired}, heavyOnly ${st.heavyOnly || 0}, dupes ${st.dupes}${APPLY ? `, changed ${changed}` : ''}`);
}
console.log(JSON.stringify(tot));
console.log('Day-type convention (Pelle → text), single-window cases:');
for (const [k, n] of [...dtTally].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${String(n).padStart(6)}  ${k}`);
if (UNREAD) {
  const top = [...unread.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, UNREAD);
  console.log(`\nTop unread sentence patterns (${unread.size} distinct):`);
  for (const [p, e] of top) console.log(`${String(e.n).padStart(5)}  ${e.c}  ${e.ex}`);
}
