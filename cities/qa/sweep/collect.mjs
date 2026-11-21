// Collects the readers' verdicts of a sweep (see README.md in this folder).
//   node cities/qa/sweep/collect.mjs <work-dir> <name> --samples a.json,b.json [--write]
// <work-dir> holds the sheets (<sheet>.ids) and the readers' files (out/<sheet>.jsonl); the samples are the files the
// sheets were made from (rdt-qa-sample.mjs / qa-city-sample.mjs output). Run from the repo root.
// Prints the result per town. With --write it also
//   - writes cities/qa/sweep/findings/<name>.jsonl: one line per regulation that was not judged "ok";
//   - appends the judged citations to cities/qa/reviewed.txt (Stockholm: cities/qa/reviewed-cities.txt).
// A regulation without a valid verdict line is not marked as read; the list is printed so it can be read again.
import fs from 'node:fs'; import path from 'node:path';

const argv = process.argv.slice(2);
const take = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv.splice(i, 2)[1] : null; };
const flag = (name) => { const i = argv.indexOf(name); if (i >= 0) argv.splice(i, 1); return i >= 0; };
const samples = (take('--samples') || '').split(',').filter(Boolean);
const WRITE = flag('--write');
const [dir, name] = argv;
if (!dir || !name || !samples.length) { console.error('usage: collect.mjs <work-dir> <name> --samples a.json,b.json [--write]'); process.exit(2); }

const rows = new Map(); // citation → { city, nseg }
for (const f of samples) for (const r of JSON.parse(fs.readFileSync(f, 'utf8'))) rows.set(r.c, { city: r.city, nseg: r.nseg || 1 });
const VERDICTS = new Set(['ok', 'loose', 'strict', 'grey', 'unsure', 'minor']);
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const judged = new Map(); const bad = []; let sheets = 0, missingSheets = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ids')).sort()) {
  const sheet = f.slice(0, -4); sheets++;
  const ids = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
  const out = path.join(dir, 'out', sheet + '.jsonl');
  if (!fs.existsSync(out)) { missingSheets.push(sheet); continue; }
  const want = new Set(ids);
  for (const line of fs.readFileSync(out, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { bad.push(`${sheet}: not JSON: ${line.slice(0, 60)}`); continue; }
    const c = String(j.c || '').trim();
    if (!want.has(c)) { bad.push(`${sheet}: citation not on the sheet: ${c.slice(0, 30)}`); continue; }
    if (!VERDICTS.has(j.v)) { bad.push(`${sheet}: unknown verdict "${j.v}" for ${c}`); continue; }
    // A missing parking-disc flag with everything else right is collected as "minor": not a wrong answer about where
    // and when to park, but worth fixing. Readers write it as ok + note or (first wave) as loose.
    const disc = /parking disc|parkeringsskiva|p-skiva|disc missing|\bps\b/i;
    if ((j.v === 'ok' && disc.test(String(j.note || ''))) || (j.v === 'loose' && disc.test(String(j.pattern || '')) && !/limit .*missing|ban .*missing|fee/i.test(String(j.pattern || '')))) { j.v = 'minor'; j.pattern = j.pattern || 'parking disc sentence not read (ps missing)'; }
    judged.set(c, { sheet, v: j.v, clear: j.v === 'grey' ? j.clear === true : undefined, what: clip(j.what, 240), pattern: clip(j.pattern, 120), quote: clip(j.quote, 200), note: clip(j.note, 120) });
  }
}
const unjudged = [...rows.keys()].filter((c) => !judged.has(c));

const by = {}; // city → verdict → [regulations, segments]
for (const [c, j] of judged) {
  const r = rows.get(c); if (!r) continue;
  const k = j.v === 'grey' ? (j.clear ? 'grey-clear' : 'grey') : j.v;
  for (const city of [r.city, 'ALL']) { const b = (by[city] ||= {}); const x = (b[k] ||= [0, 0]); x[0]++; x[1] += r.nseg; }
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
console.log(`${name}: ${judged.size} of ${rows.size} regulations judged on ${sheets} sheets` + (missingSheets.length ? `; sheets without a file: ${missingSheets.join(', ')}` : ''));
console.log('town · regulations · lines · correct (by lines) · looser · stricter · grey (text clear) · grey (text unclear) · unsure · minor (parking disc not shown)');
for (const [city, b] of Object.entries(by).sort((a, c) => (a[0] === 'ALL') - (c[0] === 'ALL') || a[0].localeCompare(c[0]))) {
  const n = Object.values(b).reduce((a, x) => a + x[0], 0), s = Object.values(b).reduce((a, x) => a + x[1], 0);
  const g = (k) => b[k] || [0, 0];
  console.log(`${city} · ${n} · ${s} · ${g('ok')[0]} (${pct(g('ok')[1], s)}) · ${g('loose')[0]} (${pct(g('loose')[1], s)}) · ${g('strict')[0]} (${pct(g('strict')[1], s)}) · ${g('grey-clear')[0]} (${pct(g('grey-clear')[1], s)}) · ${g('grey')[0]} (${pct(g('grey')[1], s)}) · ${g('unsure')[0]} (${pct(g('unsure')[1], s)}) · ${g('minor')[0]} (${pct(g('minor')[1], s)})`);
}
if (bad.length) console.log(`${bad.length} lines could not be used, e.g. ${bad.slice(0, 5).join(' | ')}`);
if (unjudged.length) console.log(`${unjudged.length} regulations without a verdict (not marked as read)`);

if (WRITE) {
  const fdir = 'cities/qa/sweep/findings'; fs.mkdirSync(fdir, { recursive: true });
  const lines = [...judged].filter(([, j]) => j.v !== 'ok').map(([c, j]) => { const r = rows.get(c); const o = { c, city: r.city, lines: r.nseg, v: j.v }; if (j.v === 'grey') o.clear = !!j.clear; for (const k of ['what', 'pattern', 'quote']) if (j[k]) o[k] = j[k]; return JSON.stringify(o); });
  fs.writeFileSync(`${fdir}/${name}.jsonl`, lines.join('\n') + (lines.length ? '\n' : ''));
  const add = (file, list) => { if (!list.length) return; const have = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').map((x) => x.trim()) : []); const fresh = list.filter((c) => !have.has(c)); if (fresh.length) fs.appendFileSync(file, (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').endsWith('\n') ? '\n' : '') + fresh.join('\n') + '\n'); console.log(`${fresh.length} citations added to ${file}`); };
  add('cities/qa/reviewed.txt', [...judged.keys()].filter((c) => rows.get(c)?.city !== 'stockholm'));
  add('cities/qa/reviewed-cities.txt', [...judged.keys()].filter((c) => rows.get(c)?.city === 'stockholm'));
  console.log(`${lines.length} findings → ${fdir}/${name}.jsonl`);
}
