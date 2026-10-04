// Fetches the official regulation (RDT, Transportstyrelsen) for every citation in segments.json:
// title, expiry ("Upphör att gälla") and the full decision text. Cached in rdt/rdt.jsonl.gz – only new
// citations are fetched (plus a monthly recheck of expiry for everything).
//   node pipeline/fetch-rdt.mjs out/segments.json [limit]
import fs from 'node:fs';
import zlib from 'node:zlib';

const [segFile, limitArg] = process.argv.slice(2);
const LIMIT = limitArg ? +limitArg : Infinity;
const CACHE = 'rdt/rdt.jsonl.gz';
const BASE = 'https://rdt.transportstyrelsen.se/rdt/';
const cache = new Map();
if (fs.existsSync(CACHE)) for (const l of zlib.gunzipSync(fs.readFileSync(CACHE)).toString().split('\n')) if (l) { const r = JSON.parse(l); cache.set(r.c, r); }

const segs = JSON.parse(fs.readFileSync(segFile)).segments;
const all = [...new Set(segs.map((s) => s.c).filter(Boolean))];
const recheck = new Date().getUTCDate() === 1;
const todo = all.filter((c) => !cache.has(c) || cache.get(c).err || recheck).slice(0, LIMIT);
console.log(`citations ${all.length}, cached ${cache.size}, to fetch ${todo.length}`);

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
const text = (html) => decode(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const field = (t, label) => { const i = t.indexOf(label); if (i < 0) return null; return t.slice(i + label.length, i + label.length + 300).replace(/^[\s:]+/, '').split('\n')[0].trim() || null; };
async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Parky/2.0 (parkeringsapp; open data check)' } }); if (r.ok) return await r.text(); if (r.status < 500) throw new Error('HTTP ' + r.status); }
    catch (e) { if (i === tries - 1) throw e; }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
}
async function one(c) {
  const [y, n] = c.split(' ')[1].split('-');
  const url = `${BASE}AF06_View.aspx?BeslutsMyndighetKod=0180&BeslutadAr=${y}&LopNr=${n}`;
  const html = await get(url);
  const t = text(html);
  const doc = html.match(/AF06_ViewDocument\.aspx\?ForeskriftId=[^"'&\s]+/i);
  let body = null;
  if (doc) body = text(await get(BASE + doc[0] + '&NoNavigation=1'));
  return { c, rubrik: field(t, 'Rubrik'), from: field(t, 'Dag för ikraftträdande'), to: field(t, 'Upphör att gälla'), body, at: new Date().toISOString().slice(0, 10) };
}
let done = 0, errs = 0, i = 0;
async function worker() {
  while (i < todo.length) {
    const c = todo[i++];
    try { cache.set(c, await one(c)); } catch (e) { errs++; cache.set(c, { c, err: String(e.message || e), at: new Date().toISOString().slice(0, 10) }); }
    if (++done % 200 === 0) { console.log(`${done}/${todo.length} (errors ${errs})`); save(); }
    await new Promise((res) => setTimeout(res, 150));
  }
}
function save() { fs.mkdirSync('rdt', { recursive: true }); fs.writeFileSync(CACHE, zlib.gzipSync([...cache.values()].map((r) => JSON.stringify(r)).join('\n') + '\n', { level: 9 })); }
await Promise.all(Array.from({ length: 4 }, worker));
save();
console.log(`done ${done}, errors ${errs}`);
const sample = [...cache.values()].filter((r) => r.body).slice(0, 3);
console.log(JSON.stringify(sample, null, 1).slice(0, 4000));
