// Area-wide bans on top of overlapping street rules. A regulation such as "På samtliga vägar inom Område Klingsta får fordon
// inte parkeras" is drawn along every road in the area, on top of the lines of other regulations for the same roads ("förbud
// vardag 09–13" on Backstigen). Each line was judged on its own, so tapping one showed "park until Wed 09:00" and the other
// "not this week" on the same road (owner screenshots, 20 Oct). The area-wide ban applies to every curb of those roads, so
// its ban windows are added to every line it overlaps (≥ 70 % of the line's points within 15 m of it: side lines are drawn offset from the centre). Only bans, never
// permissions: the result can only be stricter. Run after reparse, before trim/index. Idempotent (marks added windows ov: 1).
//   node cities/rdt-overlay.mjs cities/rdt [--apply]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const [dir, flag] = process.argv.slice(2);
const APPLY = flag === '--apply';
const AREA = /samtliga (?:vägar|gator)|på alla (?:vägar|gator)|samtliga allmänna vägar/i; // all roads of an area, both sides (not "markerade sträckor inom område …")
const m = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110574);
const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
let added = 0, files = 0, areaRegs = 0, renamed = 0;
for (const row of idx.cities) {
  const file = path.join(dir, `${row.id}.json`);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const tf = `rdt/texts/${row.kommunkod}.jsonl.gz`; if (!fs.existsSync(tf)) continue;
  let raw; try { raw = zlib.gunzipSync(fs.readFileSync(tf)).toString(); } catch { continue; }
  const area = new Set(), named = new Set(); // named: street names the municipality's regulation titles mention
  for (const l of raw.split('\n')) { if (!l) continue; const r = JSON.parse(l); for (const w of (r.rubrik || '').match(/[A-ZÅÄÖ][\wåäöéü-]+(?:vägen|gatan|stigen|gränd|gränden|backen|leden|allén|torget|plan|väg|gata)\b/g) || []) named.add(w.toLowerCase()); const t = (r.body || '').replace(/\s+/g, ' '); const i = t.indexOf('följande'); const head = t.slice(i, i + 400); if (AREA.test(head) && /(?:inte|ej) (?:stannas eller )?parkeras|förbjud/i.test(head) && !/gäller (?:ej|inte) (?:på |för )?markerade|med undantag|undantaget|utom (?:på|där)/i.test(t)) area.add(r.c); }
  // drop earlier overlay windows (idempotent)
  for (const s of c.segments) if (s.f) { s.f = s.f.filter((w) => !w.ov); if (!s.f.length) delete s.f; }
  const src = c.segments.filter((s) => area.has(s.c) && s.f && s.f.length && !s.v);
  if (!src.length) { if (APPLY) write(file, c); continue; }
  areaRegs += new Set(src.map((s) => s.c)).size;
  const dl = (p, line) => { const k = Math.cos(p[1] * Math.PI / 180); const X = (q) => [(q[0] - p[0]) * 111320 * k, (q[1] - p[1]) * 110574]; let b = Infinity;
    for (let i = 1; i < line.length; i++) { const [ax, ay] = X(line[i - 1]), [bx, by] = X(line[i]); const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0; b = Math.min(b, Math.hypot(ax + t * dx, ay + t * dy)); } return b; };
  const box = src.map((s) => ({ w: Math.min(...s.g.map((p) => p[0])) - 0.0004, e: Math.max(...s.g.map((p) => p[0])) + 0.0004, s: Math.min(...s.g.map((p) => p[1])) - 0.0002, n: Math.max(...s.g.map((p) => p[1])) + 0.0002 }));
  let changed = false;
  for (const s of c.segments) {
    if (s.v || area.has(s.c)) continue;
    // Only on top of other BANS on the same road (Klingsta: "förbud 9–17" under "förbud på samtliga vägar"). A curb whose own
    // regulation permits parking (a limit, a fee, allowed hours, date parking) is the exception the area ban leaves room for
    // ("Gäller ej markerade platser", Norrköping/Linköping innerstad): QA 22 Oct found 4,100 such curbs wrongly banned.
    if (!(s.f || []).some((w) => !w.ov) || s.l || s.aw || s.t > 0 || s.fu || s.dp || s.o) continue;
    const hits = new Map();
    src.forEach((a, k) => { const b = box[k]; let n = 0; for (const p of s.g) if (p[0] >= b.w && p[0] <= b.e && p[1] >= b.s && p[1] <= b.n && dl(p, a.g) < 15) n++; if (n) hits.set(k, n); });
    for (const [k, n] of hits) {
      if (n < Math.max(2, 0.7 * s.g.length)) continue;
      const have = new Set((s.f || []).map((w) => JSON.stringify({ ...w, ov: undefined })));
      for (const w of src[k].f) { const ww = { ...w }; if (have.has(JSON.stringify({ ...ww, ov: undefined }))) continue; (s.f ||= []).push({ ...ww, ov: 1 }); have.add(JSON.stringify(ww)); added++; changed = true; }
      if (src[k].sb && !s.sb) s.sb = 1;
      // The area line got its name from the nearest OSM way (which can be a footpath: "Bergåsstigen" on Backstigen's access
      // road); the street regulation on the same road names the street, so the area line takes that name.
      if (src[k].an && s.n && s.n !== src[k].n && named.has(s.n.toLowerCase()) && !named.has(src[k].n.toLowerCase())) { src[k].n = s.n; changed = true; renamed++; }
    }
  }
  if (changed) files++;
  if (APPLY) write(file, c);
}
function write(file, c) {
  c.built = new Date().toISOString(); delete c.hash;
  const text = JSON.stringify(c); c.hash = crypto.createHash('sha1').update(text.replace(c.built, '')).digest('hex').slice(0, 16);
  fs.writeFileSync(file, JSON.stringify(c));
}
console.log(`${areaRegs} area-wide ban regulations; ${added} ban windows added to overlapping lines in ${files} municipalities; ${renamed} area lines renamed after the street regulation on the same road${APPLY ? '' : ' (dry run)'}`);
