// Turns a QA sample (rdt-qa-sample.mjs or qa-city-sample.mjs output) into reading sheets for a sweep (README.md here):
//   node cities/qa/sweep/sheets.mjs <sample.json> <out-prefix> [per-sheet] --engine <path to the app's engine/evaluate.js>
// Each sheet is plain text: the regulation's operative text (heading, legal basis and signatures cut, so no names),
// the line as the app holds it, and what the app answers at six instants, computed with the app's own engine
// (parky-beta, engine/evaluate.js; that repository is private, so its path is given, not copied here).
// Writes <out-prefix>-NN.txt (the sheet) and <out-prefix>-NN.ids (its citations).
import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const ei = argv.indexOf('--engine'); const enginePath = ei >= 0 ? argv.splice(ei, 2)[1] : null;
if (!enginePath || !fs.existsSync(enginePath)) { console.error('needs --engine <path to parky-beta/engine/evaluate.js>'); process.exit(2); }
const { stateAt } = await import(pathToFileURL(path.resolve(enginePath)).href);
const { registerTaxa } = await import(pathToFileURL(path.resolve(path.dirname(enginePath), 'taxa.js')).href);
const [file, prefix, per = '100'] = argv;
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));

const core = (body) => {
  let t = String(body || '').replace(/\r/g, '');
  const m = t.match(/föreskriver[\s\S]{0,500}?följande\.?/);
  if (m) t = t.slice(m.index + m[0].length);
  let e = t.search(/\n[^\n]*\bvägnar\b/);
  if (e < 0) { const k = t.search(/träder i kraft/); if (k >= 0) { const n = t.indexOf('\n\n', k); e = n > 0 ? n : -1; } }
  if (e > 0) t = t.slice(0, e);
  return t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').replace(/^\s+|\s+$/g, '');
};

// Stockholm local time (CET, UTC+1 in winter; CEST, UTC+2 in July)
const INSTANTS = [
  ['Tue 24 Nov 10:00', Date.UTC(2026, 10, 24, 9, 0)],
  ['Tue 24 Nov 20:00', Date.UTC(2026, 10, 24, 19, 0)],
  ['Wed 25 Nov 03:00', Date.UTC(2026, 10, 25, 2, 0)],
  ['Sat 28 Nov 12:00', Date.UTC(2026, 10, 28, 11, 0)],
  ['Sun 29 Nov 12:00', Date.UTC(2026, 10, 29, 11, 0)],
  ['Tue 13 Jul 2027 10:00 (summer)', Date.UTC(2027, 6, 13, 8, 0)],
];
const says = (seg, taxa) => INSTANTS.map(([label, t]) => {
  let a;
  try {
    if (taxa && seg.t) registerTaxa({ [String(seg.t)]: taxa }); // the town's fee table, as the app loads it with the town's file
    const s = stateAt(seg, t);
    const fee = s.state === 'paid' || s.reason === 'Okänd taxa';
    a = s.reason === 'Okänd taxa' ? `PAID (fee table: ${taxa?.label || 'number ' + seg.t})` : s.state === 'paid' ? `PAID${s.price != null ? ' ' + s.price + ' kr/h' : ''}${s.reason ? ' (' + s.reason + ')' : ''}` : s.state === 'free' ? 'FREE' : s.state === 'forbidden' ? `NO (${s.reason})` : s.state === 'reserved' ? `NO, RESERVED (${s.reason})` : s.state === 'unknown' ? `GREY/UNKNOWN (${s.reason})` : `${String(s.state).toUpperCase()}${s.reason ? ' (' + s.reason + ')' : ''}`;
    if ((fee || s.state === 'free') && s.max) a += `, at most ${s.max} min`;
  } catch (e) { a = 'engine error: ' + String(e.message).slice(0, 60); }
  return `  ${label}: ${a}`;
}).join('\n');

const sheet = (r, k) => [
  `=== ${k} · ${r.c} · ${r.city}${r.d ? ' · ' + r.d : ''} · street: ${r.n || '(no name)'} · lines with this regulation: ${r.nseg}${r.from || r.to ? ` · register validity: ${r.from || '?'} → ${r.to || 'open'}` : ''}`,
  `TITLE: ${String(r.rub || '').replace(/\s+/g, ' ').trim()}`,
  'TEXT:', core(r.body),
  `APP LINE: ${JSON.stringify(r.seg)}`,
  r.taxa ? `FEE TABLE ${r.seg.t}: ${JSON.stringify(r.taxa)}` : null,
  'APP ANSWERS:', says(r.seg, r.taxa),
  r.others?.length ? `OTHER LINES OF THE SAME REGULATION WITH DIFFERENT RULES: ${r.others.map((o) => JSON.stringify(o)).join('  ||  ')}` : null,
].filter((x) => x != null).join('\n');

const n = +per; let files = 0;
for (let i = 0; i < rows.length; i += n) {
  const part = rows.slice(i, i + n); files++;
  const name = `${prefix}-${String(files).padStart(2, '0')}`;
  fs.writeFileSync(`${name}.txt`, part.map((r, j) => sheet(r, i + j + 1)).join('\n\n') + '\n');
  fs.writeFileSync(`${name}.ids`, part.map((r) => r.c).join('\n') + '\n');
}
console.log(`${rows.length} regulations → ${files} sheets (${prefix}-NN.txt)`);
