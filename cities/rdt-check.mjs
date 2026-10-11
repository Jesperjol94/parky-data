// Independent check of a built city file against the official regulation texts (Transportstyrelsen RDT/STFS).
// Takes a fixed sample of citations, reads each regulation (PDF → text, OCR for scans, like pipeline/fetch-rdt.mjs),
// and checks that the time limit and cleaning ban we built appear in the text.
//   node cities/rdt-check.mjs goteborg [sampleSize]  →  cities/out/<city>-rdt-check.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [city, nArg] = process.argv.slice(2);
const N = +nArg || 200;
const file = JSON.parse(fs.readFileSync(`cities/out/${city}.json`));
const BASE = 'https://rdt.transportstyrelsen.se/rdt/';
const WD = ['', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'];

// One rule set per citation; a fixed, evenly spread sample
const byC = new Map();
for (const s of file.segments) if (s.c && !s.u && !byC.has(s.c)) byC.set(s.c, s);
const all = [...byC.values()];
const sample = all.filter((_, i) => i % Math.max(1, Math.floor(all.length / N)) === 0).slice(0, N);

async function get(url, binary) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'Parky/2.0 (parkeringsapp; open data check)' } }); if (r.ok) return binary ? Buffer.from(await r.arrayBuffer()) : r.text(); }
    catch {}
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw new Error('fetch failed');
}
async function text(c) {
  const [code, rest] = c.split(' ');
  const [y, n] = rest.split('-');
  const html = await get(`${BASE}AF06_View.aspx?BeslutsMyndighetKod=${code}&BeslutadAr=${y}&LopNr=${n}`);
  const doc = html.match(/AF06_ViewDocument\.aspx\?ForeskriftId=[^"'&\s]+/i);
  if (!doc) return null;
  const buf = await get(BASE + doc[0] + '&NoNavigation=1', true);
  if (buf.slice(0, 5).toString() !== '%PDF-') return buf.toString('utf8').replace(/<[^>]+>/g, ' ');
  const f = path.join(os.tmpdir(), `rdt-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(f, buf);
  try {
    let t = execFileSync('pdftotext', ['-layout', f, '-'], { maxBuffer: 1 << 24 }).toString();
    if (t.replace(/\s/g, '').length < 80) {
      execFileSync('pdftoppm', ['-r', '200', '-png', '-f', '1', '-l', '2', f, f]);
      t = fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith(path.basename(f)) && x.endsWith('.png')).sort()
        .map((x) => { const p = path.join(os.tmpdir(), x); const o = execFileSync('tesseract', [p, '-', '-l', 'swe'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); fs.unlinkSync(p); return o; }).join('\n');
    }
    return t;
  } finally { fs.rmSync(f, { force: true }); }
}

const norm = (t) => t.replace(/\s+/g, ' ').replace(/(\d)[.:](\d\d)/g, '$1.$2').toLowerCase();
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}.${String(m % 60).padStart(2, '0')}`;
const maxWords = (m) => (m % 1440 === 0 ? [`${m / 1440} dygn`, `${m / 60} tim`] : m % 60 === 0 ? [`${m / 60} tim`, `${m / 60} timm`] : [`${m} min`]);

const rows = [];
let i = 0;
async function worker() {
  while (i < sample.length) {
    const s = sample[i++];
    const r = { c: s.c, n: s.n, checks: [] };
    try {
      const t0 = await text(s.c);
      if (!t0) { r.err = 'no document'; rows.push(r); continue; }
      const t = norm(t0);
      r.repealed = /upphäv/.test(t) && !/får parkeras|förbjudet/.test(t);
      for (const w of s.l || []) {
        if (w.max >= 1440 && w.dt?.length === 1) continue; // "24 tim vardag": often from the general rules, not this text
        r.checks.push({ what: `max ${w.max} min`, ok: maxWords(w.max).some((x) => t.includes(x)) });
      }
      let tc = t;
      if (s.s && s.sc) for (const c2 of s.sc.split(',')) { const x = await text(c2).catch(() => null); if (x) tc += ' ' + norm(x); }
      for (const w of s.s || []) {
        const day = WD[w.w].slice(0, 3);
        const t = tc;
        r.checks.push({ what: `cleaning ${WD[w.w]} ${hhmm(w.a)}-${hhmm(w.b)}${w.p ? ' ' + w.p : ''}`, ok: t.includes(day) && t.includes(hhmm(w.a)) && t.includes(hhmm(w.b)) && (!w.p || t.includes(w.p === 'even' ? 'jämn' : 'udda')) });
      }
      if (s.v) r.checks.push({ what: `reserved ${s.v}`, ok: t.includes(s.v.slice(0, 6)) });
    } catch (e) { r.err = e.message; }
    rows.push(r);
    await new Promise((res) => setTimeout(res, 300));
  }
}
await Promise.all([worker(), worker(), worker()]);

const checks = rows.flatMap((r) => r.checks);
const okN = checks.filter((c) => c.ok).length;
const out = [`# ${city}: built rules vs official regulation texts`, '', `Run ${new Date().toISOString()}. Sample: ${sample.length} of ${all.length} regulations. Read: ${rows.filter((r) => !r.err).length}, errors: ${rows.filter((r) => r.err).length}.`, '',
  `**${okN} of ${checks.length} checked rules found in the official text (${checks.length ? Math.round(100 * okN / checks.length) : 0}%).**`, '',
  'A miss means the exact wording was not found (OCR, other phrasing) or the data disagrees with the text; each one needs a look.', '',
  '| Citation | Street | Rule | Found |', '|---|---|---|---|',
  ...rows.flatMap((r) => r.err ? [`| ${r.c} | ${r.n} | (${r.err}) | – |`] : r.checks.filter((c) => !c.ok).map((c) => `| ${r.c} | ${r.n} | ${c.what} | no |`))];
fs.mkdirSync('cities/out', { recursive: true });
fs.writeFileSync(`cities/out/${city}-rdt-check.md`, out.join('\n') + '\n');
console.log(out.slice(0, 6).join('\n'));
