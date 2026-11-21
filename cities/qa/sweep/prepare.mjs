// Prepares one sweep (README.md here): draws the samples and makes the reading sheets. Run from the repo root.
//   node cities/qa/sweep/prepare.mjs <work-dir> --engine <parky-beta>/engine/evaluate.js [--stockholm 800] [--national 1200] [--seed N]
// Stockholm is drawn from the live data on branch main. The national register is drawn town group by town group in
// the order of order.txt (one group per line, "*" = the whole country); a group whose pool is empty is skipped, and
// what Stockholm cannot fill is added to the national draw. Prints the sheets to hand to the readers.
// Writes <work>/sthlm.json, <work>/rdt.json (the samples, for collect.mjs), <work>/s-NN.txt, <work>/t-NN.txt (+ .ids).
import fs from 'node:fs'; import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const take = (flag, d) => { const i = argv.indexOf(flag); return i >= 0 ? argv.splice(i, 2)[1] : d; };
const engine = take('--engine', null); let wantS = +take('--stockholm', 800); let wantN = +take('--national', 1200);
const seed = +take('--seed', Date.now() % 1e9);
const [work] = argv;
if (!work || !engine || !fs.existsSync(engine)) { console.error('usage: prepare.mjs <work-dir> --engine <parky-beta>/engine/evaluate.js [--stockholm N] [--national N] [--seed N]'); process.exit(2); }
fs.mkdirSync(path.join(work, 'out'), { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30 });
const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

// Stockholm
let sthlm = [];
if (wantS > 0) {
  try {
    try { run('git', ['fetch', '-q', '--depth', '1', 'origin', 'main:refs/remotes/origin/main']); } catch { /* use what is there */ }
    fs.writeFileSync(path.join(work, 'sthlm-segments.json'), run('git', ['show', 'origin/main:segments.json']));
    fs.writeFileSync(path.join(work, 'sthlm-rdt.jsonl.gz'), run('git', ['show', 'origin/main:rdt/rdt.jsonl.gz']));
    run('node', ['cities/qa-city-sample.mjs', String(wantS), path.join(work, 'sthlm.json'), String(seed), '--segments', path.join(work, 'sthlm-segments.json'), '--texts', path.join(work, 'sthlm-rdt.jsonl.gz')]);
    sthlm = read(path.join(work, 'sthlm.json'));
  } catch (e) { console.log('Stockholm could not be drawn: ' + String(e.stderr || e.message).slice(0, 300)); }
}
if (!sthlm.length) fs.writeFileSync(path.join(work, 'sthlm.json'), '[]');
wantN += Math.max(0, wantS - sthlm.length);

// National register, group by group
const groups = fs.readFileSync(new URL('./order.txt', import.meta.url), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const got = new Map(); const from = [];
for (const [k, g] of groups.entries()) {
  if (got.size >= wantN) break;
  const out = path.join(work, `rdt-part-${k}.json`);
  const args = ['cities/rdt-qa-sample.mjs', String(wantN - got.size), out, String(seed + k + 1)];
  if (g !== '*') args.push('--only', g);
  try { run('node', args); } catch (e) { console.log(`group ${k + 1} could not be drawn: ` + String(e.stderr || e.message).slice(0, 200)); continue; }
  let n = 0; for (const r of read(out)) if (!got.has(r.c)) { got.set(r.c, r); n++; }
  fs.rmSync(out, { force: true });
  if (n) from.push(`${n} from ${g === '*' ? 'the whole country' : g}`);
}
fs.writeFileSync(path.join(work, 'rdt.json'), JSON.stringify([...got.values()], null, 1));

const sheets = (file, prefix) => { if (!read(file).length) return; run('node', ['cities/qa/sweep/sheets.mjs', file, path.join(work, prefix), '100', '--engine', engine]); };
sheets(path.join(work, 'sthlm.json'), 's'); sheets(path.join(work, 'rdt.json'), 't');
const list = fs.readdirSync(work).filter((f) => /^[st]-\d+\.txt$/.test(f)).sort();
console.log(`Stockholm: ${sthlm.length} regulations. National register: ${got.size}${from.length ? ' (' + from.join('; ') + ')' : ''}.`);
console.log(`${list.length} sheets in ${work}: ${list.map((f) => f.slice(0, -4)).join(' ')}`);
if (!list.length) console.log('NOTHING LEFT TO READ: every regulation has been read once.');
