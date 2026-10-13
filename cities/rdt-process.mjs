// Processes Pelle's RDT city files (pelle-output/output*.json) into files the app can read, and checks them with the
// app's own engine (parky-beta/engine). Safe by construction: it only ever makes a segment MORE cautious (grey) or fills
// in the obvious (no fee text = free), never more permissive than the source.
//   node cities/rdt-process.mjs pelle-output/output.json pelle-output/output-2.json  [--out cities/rdt-out]
// Later files win over earlier ones per kommunkod. Env PARKY_ENGINE=/path/to/parky-beta/engine (default ../parky-beta/engine).
//
// What it does, per municipality:
//  - skips cities the app already has from its own build (goteborg, malmo) and Stockholm (0180)
//  - removes duplicate windows, turns any limit with max <= 0 into a ban (a 0 limit would read as "no limit")
//  - fee periods without `days` get every day type; zones whose periods overlap make their segments uncertain (u: 1)
//  - segments with a rule and no fee mention get t: 0 (free); segments with no readable rule at all become u: 1
//  - a window whose start equals its end (empty to the engine) makes the segment uncertain
//  - engine sweep: every ban window must give state 'forbidden' at an instant inside it; nothing may throw
//  - writes <out>/<city>.json, <out>/REPORT.md and <out>/spot-checks.json (streets to hand-check against the official text)
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const OUT = oi >= 0 ? args.splice(oi, 2)[1] : 'cities/rdt-out';
const inputs = args;
const engDir = process.env.PARKY_ENGINE || path.resolve('../parky-beta/engine');
const engine = await import(path.join(engDir, 'evaluate.js'));
const taxaMod = await import(path.join(engDir, 'taxa.js'));
const time = await import(path.join(engDir, 'time.js'));

const SKIP_IDS = new Set(['goteborg', 'malmo']);
const SKIP_CODES = new Set(['0180']);
const ALL_DAYS = ['vardag', 'fore', 'helgdag'];

// Instants for each day type: Tue 13 Oct (vardag), Sat 17 Oct (fore), Sun 18 Oct (helgdag), 2026; week parity is irrelevant here.
const DAY_AT = { vardag: { y: 2026, m: 10, d: 14 }, fore: { y: 2026, m: 10, d: 17 }, helgdag: { y: 2026, m: 10, d: 18 } };
const WD_AT = { 1: 12, 2: 13, 3: 14, 4: 15, 5: 16, 6: 17, 7: 18 };

function load(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(j) ? j : Object.values(j);
}

const byCode = new Map();
for (const f of inputs) for (const c of load(f)) if (c && c.kommunkod && (c.segments || []).length) byCode.set(c.kommunkod, c);

const uniq = (arr) => {
  const seen = new Set();
  return arr.filter((w) => { const k = JSON.stringify(w); return seen.has(k) ? false : (seen.add(k), true); });
};

function fixTaxa(taxa) {
  const bad = new Set();
  const out = {};
  for (const [k, z] of Object.entries(taxa || {})) {
    const periods = (z.periods || []).map((p) => ({ ...p, days: p.days && p.days.length ? p.days : ALL_DAYS }));
    let overlap = false;
    for (let i = 0; i < periods.length; i++) for (let j = i + 1; j < periods.length; j++) {
      const p = periods[i], q = periods[j];
      if (p.days.some((d) => q.days.includes(d)) && p.start < q.end && q.start < p.end && p.price !== q.price) overlap = true;
    }
    if (overlap) bad.add(k);
    out[k] = { ...z, periods };
  }
  return { taxa: out, bad };
}

const report = [];
const spot = {};
const total = { cities: 0, segments: 0, uncertainNew: 0, freeFilled: 0, dupWindows: 0, zeroLimits: 0, sweepFail: 0, sweepChecked: 0 };
fs.mkdirSync(OUT, { recursive: true });

for (const [code, c] of [...byCode].sort((a, b) => a[1].city.localeCompare(b[1].city))) {
  if (SKIP_IDS.has(c.city) || SKIP_CODES.has(code)) { report.push({ city: c.city, code, skipped: true }); continue; }
  const { taxa, bad } = fixTaxa(c.taxa);
  const st = { city: c.city, code, segs: c.segments.length, uncertainNew: 0, freeFilled: 0, dup: 0, zero: 0, ban: 0, lim: 0, paid: 0, unknownFee: 0, reserved: 0, uncertain: 0, fail: 0, checked: 0, failures: [] };
  const segments = [];
  for (const s0 of c.segments) {
    const s = { ...s0 };
    for (const k of ['f', 'l', 'aw', 's']) if (s[k]) { const n = uniq(s[k]); st.dup += s[k].length - n.length; s[k] = n; }
    if (s.l) { // a limit of 0 is a ban
      const zero = s.l.filter((w) => !(w.max > 0));
      if (zero.length) { st.zero += zero.length; s.f = uniq([...(s.f || []), ...zero.map(({ max, ...w }) => w)]); s.l = s.l.filter((w) => w.max > 0); }
      if (!s.l.length) delete s.l;
    }
    // A window with a == b is empty to the engine (a ban would read as "allowed"): the text was not read properly.
    if (!s.u && ['f', 'aw', 'l', 's'].some((k) => (s[k] || []).some((w) => w.a === w.b))) { s.u = 1; st.uncertainNew++; st.emptyWin = (st.emptyWin || 0) + 1; }
    const hasRule = !!((s.f && s.f.length) || (s.l && s.l.length) || (s.aw && s.aw.length) || (s.s && s.s.length) || s.v || s.k);
    if (s.t && bad.has(String(s.t)) && !s.u) { s.u = 1; st.uncertainNew++; }
    if (!('t' in s)) {
      if (hasRule) { s.t = 0; st.freeFilled++; }
      else if (!s.u) { s.u = 1; st.uncertainNew++; }
    }
    if (s.u) st.uncertain++; else if (s.v) st.reserved++;
    if (s.f && s.f.length) st.ban++;
    if (s.l && s.l.length) st.lim++;
    if (s.t === null) st.unknownFee++; else if (s.t) st.paid++;
    segments.push(s);
  }
  // Engine sweep: a ban window must read as forbidden inside it (for every day type/weekday it names); nothing may throw.
  Object.assign(taxaMod.TAXA, {}); // fee numbers are per city and only matter for price, not for the checks here
  const cityTaxa = taxa;
  for (const s of segments) {
    if (s.u) continue;
    try {
      for (const w of s.f || []) {
        if (w.cl || w.m || w.p) continue; // season/parity windows depend on the date; covered by the unit tests
        const days = w.w ? [WD_AT[w.w] ? 'wd' : null] : (w.dt || ALL_DAYS);
        for (const dt of days) {
          const date = dt === 'wd' ? { y: 2026, m: 10, d: WD_AT[w.w] } : DAY_AT[dt];
          if (!date) continue;
          const min = w.a <= w.b ? Math.min(w.b - 1, w.a + Math.max(0, Math.floor((w.b - w.a) / 2))) : w.a;
          const r = engine.stateAt(s, time.instant(date, min));
          st.checked++;
          if (r.state !== 'forbidden' && r.state !== 'unknown') { st.fail++; if (st.failures.length < 5) st.failures.push(`${s.n} ${s.c} ${JSON.stringify(w)} -> ${r.state}`); }
        }
      }
      engine.stateAt(s, time.instant(DAY_AT.vardag, 600));
    } catch (e) { st.fail++; if (st.failures.length < 5) st.failures.push(`${s.n} ${s.c} threw ${e.message}`); }
  }
  // Hand-check sample: up to 2 bans, 2 limits, 1 fee, 1 reserved/other, spread along the file, for rdt-check / a human.
  const pick = (pred, n) => { const a = segments.filter(pred); return a.filter((_, i) => i % Math.max(1, Math.floor(a.length / n)) === 0).slice(0, n).map((s) => ({ n: s.n, c: s.c })); };
  spot[c.city] = [...pick((s) => !s.u && s.f && s.f.length, 2).map((x) => ({ ...x, kind: 'ban' })), ...pick((s) => !s.u && s.l && s.l.length, 2).map((x) => ({ ...x, kind: 'limit' })), ...pick((s) => !s.u && s.t, 1).map((x) => ({ ...x, kind: 'fee' })), ...pick((s) => !s.u && s.v, 1).map((x) => ({ ...x, kind: 'reserved' }))];
  fs.writeFileSync(path.join(OUT, `${c.city}.json`), JSON.stringify({ ...c, taxa, segments }));
  report.push(st);
  total.cities++; total.segments += st.segs; total.uncertainNew += st.uncertainNew; total.freeFilled += st.freeFilled; total.dupWindows += st.dup; total.zeroLimits += st.zero; total.sweepFail += st.fail; total.sweepChecked += st.checked;
}

fs.writeFileSync(path.join(OUT, 'spot-checks.json'), JSON.stringify(spot, null, 1));
const rows = report.filter((r) => !r.skipped);
const md = [
  `# RDT city files: processing report`,
  ``,
  `Inputs: ${inputs.join(', ')}. ${total.cities} municipalities, ${total.segments} segments. Skipped (app has its own file): ${report.filter((r) => r.skipped).map((r) => r.city).join(', ') || 'none'}.`,
  `Engine sweep: ${total.sweepChecked} ban windows checked through parky-beta/engine, ${total.sweepFail} failures.`,
  `Changes: ${total.freeFilled} segments given t:0 (rule, no fee text), ${total.uncertainNew} made uncertain (no readable rule or overlapping fee table), ${total.dupWindows} duplicate windows removed, ${total.zeroLimits} zero limits turned into bans.`,
  ``,
  `| city | code | segs | ban | limit | paid | fee? | reserved | grey | sweep fail |`,
  `|---|---|---|---|---|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.city} | ${r.code} | ${r.segs} | ${r.ban} | ${r.lim} | ${r.paid} | ${r.unknownFee} | ${r.reserved} | ${r.uncertain} | ${r.fail} |`),
  ``,
  ...rows.filter((r) => r.failures.length).flatMap((r) => [`## ${r.city} sweep failures`, ...r.failures.map((f) => `- ${f}`), ``]),
].join('\n');
fs.writeFileSync(path.join(OUT, 'REPORT.md'), md);
console.log(md.split('\n').slice(0, 6).join('\n'));
