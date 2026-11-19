// Dates and temporary regulations (owner, 19 Nov: Österplan in Uppsala showed five green lines on a street closed for
// roadworks until 2027). The register snapshot does not age by itself, and every line is judged against its own
// regulation only. This step re-reads the dates with today's date, every run:
//   1. ended      a regulation whose validity has ended (the line's `to` or the text's) is dropped: on 19 Nov 1,110 lines,
//                 among them one-day event bans from 2010–2013 still shown as bans
//   2. not yet    a regulation that is not in force yet is parked (c.parked) until its first day
//   3. suspended  "… (0380 2024:534) om parkering på Österplan ska inte tillämpas mellan 27 november 2024 … och 28 februari
//                 2027": the named regulation is parked while the temporary one applies (whole regulations only, not
//                 "Del av …" or "på motsvarande sträckor")
//   4. roadworks  a temporary all-day ban in force (a line with an end date) is laid on the lines of other regulations
//                 along the same stretch (within 5 m, running the same way): they get its ban (window ov: 2 with the end
//                 date, s.tb = [citation, end]); a line it covers partly is cut at the edge of the ban. Texts that name
//                 opposite sides of the street are left alone, and so is a newer temporary permission; a permanent
//                 regulation as new as the ban goes grey (which sign stands there cannot be told). Only stricter.
// Parked lines are out of `segments` (the app never sees them) and come back when the reason is over. Idempotent.
//   node cities/rdt-temp.mjs cities/rdt [--apply]      after rdt-overlay, before rdt-trim (TODAY=2027-03-01 tests a date)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d, m, y) => { const k = MONTHS.indexOf(String(m).toLowerCase()); return k < 0 ? null : `${y}-${pad(k + 1)}-${pad(d)}`; };
export const norm = (c) => String(c).replace(/[:]/, '-').replace(/-0*(\d+)$/, '-$1');
export const stockholmToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());
const CIT = /\b(\d{4}) ?(\d{4})\s*[:-]\s*0*(\d+)\b/g;
const clean = (body) => String(body || '').replace(/\s+/g, ' ').replace(/Publicerat på webbplatsen Svensk trafikföreskriftssamling den \d{1,2} \w+ \d{4}/g, '')
  .replace(/(\d{4}):(\d+)\.(?=\d)/g, '$1:$2').replace(/(\d) kap\. (\d)/g, '$1 kap $2').replace(/\b(\d{1,2})\.(\d{2})(?!\d)/g, '$1:$2'); // "klockan 07.00" must not end the sentence
export const allDay = (w) => (w.a || 0) === 0 && (w.b ?? 1440) === 1440 && !w.dt && !w.w && !w.nw && !w.m && !w.dm && !w.dd && !w.wk && !w.p;
// a typed year like 3010 is not a start date (Gävle 2180 2010-577)
const sane = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d > '1990' && d < '2100';

const STOP = /^(?:kommuns?|lokala|trafikföreskrifter?|om|på|i|och|för|av|vid|med|parkering|parkera|förbud|att|stanna|del|delen|samt|inom|område|området|gata|gatan|väg|vägen|den|det|norra|södra|östra|västra|fordon|rörelsehindrade?|parkeringstillstånd|tillåten|högst|min|minuter|timmar|zon|särskilt|tillstånd|gäller|förbjuden|sidan|båda|sidor|stannande|parkeringsförbud|föreskrift(?:er)?|ändamålsplats|enkelriktad|trafik)$/i;
const words = (t) => String(t).split(/[^A-Za-zÅÄÖÉÜåäöéü]+/).filter((w) => w.length >= 4 && !STOP.test(w)).map((w) => w.toLowerCase());

// The regulations that another regulation suspends today: Map(citation → { by, until }).
export function suspensions(records, today) {
  const out = new Map(); const title = new Map(records.map((r) => [norm(r.c), r.rubrik || '']));
  for (const r of records) {
    if ((sane(r.from) && r.from > today) || (sane(r.to) && r.to < today)) continue;
    for (const s of clean(r.body).match(/[^.]*\b(?:inte|ej) tillämpas[^.]*/gi) || []) {
      if (/\bdel(?:ar)? av\b|i fråga om|såvitt avser|till den del|motsvarande sträck/i.test(s)) continue; // a part only: the ban's own line covers it (step 4)
      let from = sane(r.from) ? r.from : null, to = sane(r.to) ? r.to : null;
      const p = s.match(/mellan (?:den )?(\d{1,2}) ([a-zåäö]+) (\d{4})(?: klockan [\d:]+)? och (?:den )?(\d{1,2}) ([a-zåäö]+) (\d{4})/i);
      if (p) { from = iso(p[1], p[2], p[3]) || from; to = iso(p[4], p[5], p[6]) || to; }
      if (!to) continue; // no end date anywhere: not a temporary suspension this step can undo
      if ((from && from > today) || to < today) continue;
      const xs = [...s.matchAll(CIT)];
      xs.forEach((x, i) => {
        const c = `${x[1]} ${x[2]}-${+x[3]}`; if (c === norm(r.c) || x[1] !== String(r.c).slice(0, 4)) return;
        // a mistyped number must not hide another street: when the description names a place, the title must share a word
        const desc = s.slice(x.index + x[0].length, xs[i + 1]?.index ?? s.length).toLowerCase().replace(/\S+ kommuns? lokala trafikföreskrift.*$|\b(?:ska|skall) .*$/, '');
        const dw = words(desc), tw = words((title.get(c) || '').replace(/^.*?trafikföreskrifter/i, ''));
        if (/\bom\b/.test(desc) && dw.length && tw.length && !tw.some((w) => desc.includes(w))) return;
        const prev = out.get(c); if (!prev || prev.until < to) out.set(c, { by: norm(r.c), until: to });
      });
    }
  }
  return out;
}

// Which side(s) of the street a text is about, as compass vectors; empty when it names none (or says both).
const COMPASS = { norra: [0, 1], södra: [0, -1], östra: [1, 0], västra: [-1, 0], nordöstra: [1, 1], nordostra: [1, 1], nordvästra: [-1, 1], sydöstra: [1, -1], sydostra: [1, -1], sydvästra: [-1, -1] };
export function sides(body) {
  const t = clean(body).replace(/[^.]*(?:upphör|upphöra) att gälla[^.]*/gi, '').replace(/[^.]*\b(?:inte|ej) tillämpas[^.]*/gi, '');
  if (/\b(?:båda|bägge|ömse) sidor/i.test(t)) return [];
  const out = [];
  for (const m of t.matchAll(/(?<![A-Za-zÅÄÖåäö])(norra|södra|östra|västra|nord[öo]stra|nordvästra|syd[öo]stra|sydvästra)\s+(?:gatu|väg|kör)?sida(?:n)?(?![A-Za-zÅÄÖåäö])/gi)) out.push(COMPASS[m[1].toLowerCase()]); // no \b: it is ASCII-only and misses \"östra\"
  return out;
}
export const oppositeSides = (a, b) => a.length > 0 && b.length > 0 && a.every((p) => b.every((q) => p[0] * q[0] + p[1] * q[1] < 0));

const R = 5, STEP = 2, MIN_PIECE = 8, GAP = 6, WHOLE = 0.85;

// Step 4. `rec(citation)` returns the text record or undefined. Returns { lines, cut, unsure, examples }.
export function layTemporaryBans(c, rec, today) {
  const none = { lines: 0, cut: 0, unsure: 0, examples: [] };
  const segs = c.segments; if (!segs.length) return none;
  const lat0 = (c.bounds.s + c.bounds.n) / 2, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
  const X = (p) => [p[0] * kx, p[1] * ky];
  const end = (s) => [s.to, rec(s.c)?.to].filter(sane).sort()[0]; // the line's end date or the text's
  const banText = (r) => !!r && /(?:inte|ej)\s+(?:stannas|parkeras)|förbud/i.test(`${r.rubrik || ''} ${r.body || ''}`) && !(sane(r.from) && r.from > today);
  const src = segs.filter((s) => end(s) >= today && !s.u && !s.v && !s.hv && !s.ar && (s.f || []).some((w) => allDay(w) && !w.ov) && banText(rec(s.c)));
  if (!src.length) return none;
  const CELL = 8, grid = new Map();
  src.forEach((s, k) => {
    const pts = s.g.map(X);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!d) continue;
      const ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d, n = Math.max(1, Math.round(d / STEP));
      for (let j = 0; j <= n; j++) { const x = a[0] + (b[0] - a[0]) * j / n, y = a[1] + (b[1] - a[1]) * j / n; const q = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`; let g = grid.get(q); if (!g) grid.set(q, g = []); g.push([k, x, y, ux, uy]); }
    }
  });
  const info = new Map(); // citation → { sides, from, cites }
  const of = (cit) => { if (!info.has(cit)) { const r = rec(cit); info.set(cit, { sides: sides(r?.body), from: sane(r?.from) ? r.from : '', cites: new Set([...clean(r?.body).matchAll(CIT)].map((x) => `${x[1]} ${x[2]}-${+x[3]}`)) }); } return info.get(cit); };
  const monthBefore = (d) => new Date(new Date(`${d}T12:00:00Z`).getTime() - 31 * 864e5).toISOString().slice(0, 10);
  // How a temporary ban relates to a line of another regulation:
  //   'no'      the same regulation, the opposite side of the street, or a temporary permission decided after the ban
  //   'ban'     the ban names the line's regulation ("med avvikelse från …"), or the line's regulation is clearly older
  //   'unsure'  the line's regulation is as new as the ban or newer (Örebro Engelbrektsgatan: the yellow area closed and
  //             the red area opened by two decisions of the same week): which one the signs show cannot be told → grey
  const relation = (S, t) => {
    if (S.c === t.c) return 'no';
    const a = of(S.c), b = of(t.c);
    if (a.cites.has(norm(t.c))) return 'ban';
    if (oppositeSides(a.sides, b.sides)) return 'no';
    if (!a.from || !b.from || b.from < monthBefore(a.from)) return 'ban';
    return end(t) && b.from > a.from ? 'no' : 'unsure';
  };
  let next = Math.max(0, ...segs.map((s) => s.i), ...(c.parked || []).map((s) => s.i)) + 1;
  const out = []; let lines = 0, cut = 0, unsure = 0; const examples = [];
  for (const t of segs) {
    if (t.ar || (t.f || []).some((w) => allDay(w) && !w.ov) || t.g.length < 2) { out.push(t); continue; }
    const pts = t.g.map(X);
    const sm = []; let L = 0; // samples along the line: [distance, x, y, ux, uy]
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!d) continue;
      const ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d, n = Math.max(1, Math.round(d / STEP));
      for (let j = sm.length ? 1 : 0; j <= n; j++) sm.push([L + d * j / n, a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n, ux, uy]);
      L += d;
    }
    if (sm.length < 2) { out.push(t); continue; }
    const rel = new Map(); const relOf = (k) => { if (!rel.has(k)) rel.set(k, relation(src[k], t)); return rel.get(k); };
    const by = { ban: new Map(), unsure: new Map() }; // kind → source index → samples it covers
    const hits = sm.map(([, x, y, ux, uy]) => {
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL); const h = { ban: false, unsure: false };
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const [k, sx, sy, vx, vy] of grid.get(`${cx + dx},${cy + dy}`) || []) {
        if (Math.hypot(sx - x, sy - y) > R || Math.abs(ux * vx + uy * vy) < 0.87) continue;
        const kind = relOf(k); if (kind === 'no') continue;
        h[kind] = true; by[kind].set(k, (by[kind].get(k) || 0) + 1);
      }
      return h;
    });
    // runs along the line: close short gaps, forget short covered runs, absorb short uncovered ends (only stricter)
    const runsOf = (kind) => {
      const runs = []; hits.forEach((h, i) => { const last = runs[runs.length - 1]; if (last && last.c === h[kind]) last.b = i; else runs.push({ c: h[kind], a: i, b: i }); });
      const len = (r) => sm[Math.min(r.b + 1, sm.length - 1)][0] - sm[r.a][0];
      const merge = (pred, to) => { for (let again = true; again;) { again = false; for (let i = 0; i < runs.length; i++) { if (runs.length > 1 && pred(runs[i], i)) { runs[i].c = to; again = true; } } for (let i = runs.length - 1; i > 0; i--) if (runs[i].c === runs[i - 1].c) { runs[i - 1].b = runs[i].b; runs.splice(i, 1); } } };
      merge((r, i) => !r.c && i > 0 && i < runs.length - 1 && len(r) < GAP, true);
      merge((r) => r.c && len(r) < MIN_PIECE, false);
      merge((r) => !r.c && len(r) < MIN_PIECE, true);
      return { runs, covered: runs.filter((r) => r.c).reduce((a, r) => a + len(r), 0) };
    };
    let kind = 'ban', { runs, covered } = runsOf('ban');
    if (!covered) { kind = 'unsure'; ({ runs, covered } = runsOf('unsure')); }
    if (!covered) { out.push(t); continue; }
    const top = [...by[kind].entries()].sort((a, b) => b[1] - a[1])[0][0];
    const until = [...by[kind].keys()].map((k) => end(src[k])).sort().pop();
    const mark = (s) => {
      if (kind === 'ban') { (s.f ||= []).push({ a: 0, b: 1440, ov: 2, to: until }); s.tb = [src[top].c, until]; lines++; }
      else if (!s.u) { s.u = 1; s.tb = [src[top].c, until, 'u']; unsure++; }
      return s;
    };
    const whole = runs.length === 1 || covered / L >= WHOLE;
    if (examples.length < 600) examples.push(` ${t.n}: ${t.c} ${kind === 'ban' ? 'under' : 'grey beside'} ${src[top].c} until ${until}${whole ? '' : ` (${Math.round(covered)} of ${Math.round(L)} m)`}`);
    if (whole) { out.push(mark(t)); continue; }
    const parts = cutLine(t.g, pts, runs.slice(1).map((r) => sm[r.a][0]));
    if (parts.length !== runs.length) { out.push(mark(t)); continue; } // cannot place the cut: the whole line (stricter)
    parts.forEach((g, k) => { const { pc, p, ...base } = t; const s = { ...base, g, i: k === 0 ? t.i : next++ }; if (base.f) s.f = base.f.map((w) => ({ ...w })); out.push(runs[k].c ? mark(s) : s); });
    cut++;
  }
  c.segments = out;
  return { lines, cut, unsure, examples };
}

// Cuts a line (lon/lat `g`, metric `pts`) at distances along it; returns the pieces as lon/lat lines.
export function cutLine(g, pts, cuts) {
  const parts = []; let cur = [g[0]], L = 0, ci = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    while (ci < cuts.length && cuts[ci] <= L + d && d > 0) {
      const f = Math.max(0, Math.min(1, (cuts[ci] - L) / d)); const p = [+(g[i - 1][0] + (g[i][0] - g[i - 1][0]) * f).toFixed(6), +(g[i - 1][1] + (g[i][1] - g[i - 1][1]) * f).toFixed(6)];
      cur.push(p); parts.push(cur); cur = [p]; ci++;
    }
    cur.push(g[i]); L += d;
  }
  parts.push(cur);
  return parts.map((q) => q.filter((p, k) => k === 0 || p[0] !== q[k - 1][0] || p[1] !== q[k - 1][1])).filter((q) => q.length >= 2);
}

// All four steps on one municipality file. `records` are its official texts. Returns the counts.
export function temp(c, records, today) {
  const byC = new Map(records.map((r) => [norm(r.c), r])); const rec = (cit) => byC.get(norm(cit));
  const st = { ended: 0, notYet: 0, suspended: 0, lines: 0, cut: 0, unsure: 0, back: 0, examples: [], gone: [] };
  // 0. undo the last run: parked lines back (a fresh id if theirs was reused meanwhile), earlier roadworks windows off
  if (c.parked && c.parked.length) {
    const used = new Set(c.segments.map((s) => s.i)); let next = Math.max(0, ...used, ...c.parked.map((s) => s.i)) + 1;
    for (const { pk, ...s } of c.parked) { if (used.has(s.i)) s.i = next++; used.add(s.i); c.segments.push(s); }
  }
  const was = new Set((c.parked || []).map((s) => `${s.c}|${JSON.stringify(s.g[0])}`)); delete c.parked;
  for (const s of c.segments) { if (s.f) { s.f = s.f.filter((w) => w.ov !== 2); if (!s.f.length) delete s.f; } if (s.tb && s.tb[2] === 'u') delete s.u; delete s.tb; }
  // 1. ended
  c.segments = c.segments.filter((s) => { const r = rec(s.c); const to = [s.to, r && r.to].filter(sane).sort()[0]; if (!to || to >= today) return true; st.ended++; if (st.gone.length < 400) st.gone.push(`${s.n}: ${s.c} ended ${to}`); return false; });
  // 2. not yet in force, 3. suspended
  const sus = suspensions(records, today); const parked = [];
  c.segments = c.segments.filter((s) => {
    const r = rec(s.c);
    if (r && sane(r.from) && r.from > today) { parked.push({ ...s, pk: { why: 'from', until: r.from } }); st.notYet++; return false; }
    const x = sus.get(norm(s.c)); if (x) { parked.push({ ...s, pk: { why: 'suspended', by: x.by, until: x.until } }); st.suspended++; if (st.gone.length < 400) st.gone.push(`${s.n}: ${s.c} suspended by ${x.by} until ${x.until}`); return false; }
    return true;
  });
  if (parked.length) c.parked = parked;
  st.back = [...was].filter((k) => !parked.some((s) => `${s.c}|${JSON.stringify(s.g[0])}` === k)).length;
  // 4. roadworks
  const r4 = layTemporaryBans(c, rec, today); st.lines = r4.lines; st.cut = r4.cut; st.unsure = r4.unsure; st.examples = r4.examples;
  return st;
}

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
const asScript = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (asScript) {
  const dir = process.argv[2] || 'cities/rdt', APPLY = process.argv.includes('--apply'), LIST = process.argv.includes('--list');
  const today = process.env.TODAY || stockholmToday();
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const T = { ended: 0, notYet: 0, suspended: 0, lines: 0, cut: 0, unsure: 0, back: 0 }; let files = 0; const per = {}, ex = [];
  for (const row of idx.cities) {
    const file = path.join(dir, `${row.id}.json`); const raw = fs.readFileSync(file, 'utf8'); const c = JSON.parse(raw);
    const tf = `rdt/texts/${row.kommunkod}.jsonl.gz`; let records = [];
    if (fs.existsSync(tf)) { try { records = zlib.gunzipSync(fs.readFileSync(tf)).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { records = []; } }
    const st = temp(c, records, today);
    for (const k of Object.keys(T)) T[k] += st[k];
    if (st.lines) per[row.id] = st.lines;
    for (const e of st.gone) ex.push(`${row.id} ${e}`); for (const e of st.examples) ex.push(`${row.id}${e}`);
    const { built, hash, ...a } = JSON.parse(raw), { built: b2, hash: h2, ...b } = c;
    if (canon(a) === canon(b)) continue; // key order aside: taking a window off and putting it back must not publish a new file
    files++;
    c.built = new Date().toISOString(); delete c.hash;
    const text = JSON.stringify(c); c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
    if (APPLY) fs.writeFileSync(file, JSON.stringify(c));
  }
  console.log(`${today}: ${T.ended} lines of ended regulations dropped; ${T.notYet} not yet in force and ${T.suspended} suspended parked (${T.back} back in force); temporary bans laid on ${T.lines} lines of other regulations (${T.cut} lines cut, ${T.unsure} newer lines beside a ban greyed) in ${files} changed municipalities${APPLY ? '' : ' (dry run)'}`);
  console.log('roadworks by municipality:', Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k} ${v}`).join(', '));
  if (LIST) console.log(ex.join('\n'));
}
