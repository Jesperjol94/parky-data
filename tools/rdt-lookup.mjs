// Prints the official text of given regulations (Transportstyrelsen RDT) — for checking converted data by hand.
//   node tools/rdt-lookup.mjs "1489 2008-0097" "0162 2000-1118" > out.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const BASE = 'https://rdt.transportstyrelsen.se/rdt/';
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


for (const c of process.argv.slice(2)) {
  let t; try { t = await text(c); } catch (e) { t = 'ERROR ' + e.message; }
  console.log(`\n## ${c}\n\n` + (t ? t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000) : '(no document)'));
}
