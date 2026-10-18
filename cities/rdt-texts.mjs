// Fetches the official regulation text (RDT, Transportstyrelsen) for the citations in the published RDT municipality
// files (cities/rdt/<id>.json), so the rules can be re-read and checked offline. Same record format as the Stockholm
// cache (rdt/rdt.jsonl.gz), one cache per municipality: rdt/texts/<kommunkod>.jsonl.gz. Resumable: cached citations are
// skipped. Citations of uncertain (u: 1) segments come first, then the rest.
//   node cities/rdt-texts.mjs <group> <groups> [minutes]   e.g. group 0 of 4, stop after 300 minutes
// Env WORKERS (default 2). Polite: a short pause between requests, 3 tries, never more than WORKERS requests in flight.
import fs from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [gArg, nArg, mArg] = process.argv.slice(2);
const GROUP = +gArg || 0, GROUPS = +nArg || 1, BUDGET = (+mArg || 300) * 60000, WORKERS = +(process.env.WORKERS || 2);
const t0 = Date.now();
const DIR = 'cities/rdt', CACHE_DIR = 'rdt/texts';
const BASE = 'https://rdt.transportstyrelsen.se/rdt/';
fs.mkdirSync(CACHE_DIR, { recursive: true });

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
const text = (html) => decode(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const field = (t, label) => { const i = t.indexOf(label); if (i < 0) return null; return t.slice(i + label.length, i + label.length + 300).replace(/^[\s:]+/, '').split('\n')[0].trim() || null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3, binary = false) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'Parky/2.0 (https://parky.se; info@parky.se) open data check' } });
      if (r.ok) return binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
      if (r.status < 500) throw new Error('HTTP ' + r.status);
    } catch (e) { if (i === tries - 1) throw e; }
    await sleep(1500 * (i + 1));
  }
}

async function one(c) {
  const [code, rest] = c.split(' ');
  const [y, n] = rest.split('-');
  const html = await get(`${BASE}AF06_View.aspx?BeslutsMyndighetKod=${code}&BeslutadAr=${y}&LopNr=${n}`);
  const t = text(html);
  const doc = html.match(/AF06_ViewDocument\.aspx\?ForeskriftId=[^"'&\s]+/i);
  let body = null, kind = null;
  if (doc) {
    const buf = await get(BASE + doc[0] + '&NoNavigation=1', 3, true);
    if (buf.slice(0, 5).toString() === '%PDF-') {
      const f = path.join(os.tmpdir(), `rdt-${process.pid}-${Math.random().toString(36).slice(2)}.pdf`);
      fs.writeFileSync(f, buf);
      try {
        body = execFileSync('pdftotext', ['-layout', f, '-'], { maxBuffer: 1 << 24 }).toString().trim(); kind = 'pdf';
        if (body.replace(/\s/g, '').length < 80 || !/följande|föreskriv|parker/i.test(body)) { // a scan (sometimes with a text header): OCR the first two pages in Swedish
          execFileSync('pdftoppm', ['-r', '200', '-png', '-f', '1', '-l', '2', f, f]);
          body = fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith(path.basename(f)) && x.endsWith('.png')).sort()
            .map((x) => { const p = path.join(os.tmpdir(), x); const o = execFileSync('tesseract', [p, '-', '-l', 'swe'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); fs.unlinkSync(p); return o; }).join('\n').trim();
          kind = 'ocr';
        }
      } finally { fs.rmSync(f, { force: true }); }
    } else { body = text(buf.toString('utf8')); kind = 'html'; }
  }
  return { c, kind, rubrik: field(t, 'Rubrik'), from: field(t, 'Dag för ikraftträdande'), to: field(t, 'Upphör att gälla'), body, at: new Date().toISOString().slice(0, 10) };
}

function loadCache(file) {
  const m = new Map();
  if (fs.existsSync(file)) for (const l of zlib.gunzipSync(fs.readFileSync(file)).toString().split('\n')) if (l) { const r = JSON.parse(l); m.set(r.c, r); }
  return m;
}
const saveCache = (file, m) => fs.writeFileSync(file, zlib.gzipSync([...m.values()].map((r) => JSON.stringify(r)).join('\n') + '\n'));

const index = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')).cities.sort((a, b) => a.id.localeCompare(b.id));
const mine = index.filter((_, i) => i % GROUPS === GROUP);
// Two passes over this group's municipalities: first the citations of uncertain segments everywhere (the texts that can
// change what the app shows), then everything else (verification). Caches are saved per municipality as we go.
const caches = new Map();
const cacheOf = (row) => { const file = path.join(CACHE_DIR, `${row.kommunkod}.jsonl.gz`); if (!caches.has(file)) caches.set(file, loadCache(file)); return [file, caches.get(file)]; };
let fetched = 0, errs = 0;
for (const pass of ['uncertain', 'rest']) {
  for (const row of mine) {
    if (Date.now() - t0 > BUDGET) break;
    const city = JSON.parse(fs.readFileSync(path.join(DIR, `${row.id}.json`), 'utf8'));
    const [file, cache] = cacheOf(row);
    const want = new Set();
    for (const s of city.segments) if (s.c && (pass === 'uncertain' ? s.u : true)) want.add(s.c);
    const todo = [...want].filter((c) => !cache.has(c) || cache.get(c).err);
    if (!todo.length) continue;
    console.log(`${row.id} (${pass}): ${want.size} citations, cached ${cache.size}, to fetch ${todo.length}`);
    let i = 0, dirty = 0;
    const worker = async () => {
      while (i < todo.length && Date.now() - t0 < BUDGET) {
        const c = todo[i++];
        try { cache.set(c, await one(c)); fetched++; }
        catch (e) { cache.set(c, { c, err: e.message, at: new Date().toISOString().slice(0, 10) }); errs++; }
        if (++dirty % 100 === 0) saveCache(file, cache);
        await sleep(300);
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    saveCache(file, cache);
    console.log(`${row.id} (${pass}): done, ${[...cache.values()].filter((r) => !r.err).length} texts, ${[...cache.values()].filter((r) => r.err).length} errors, ${Math.round((Date.now() - t0) / 60000)} min`);
  }
  if (Date.now() - t0 > BUDGET) { console.log('time budget reached'); break; }
}
console.log(`fetched ${fetched}, errors ${errs}`);
