// Removes map lines of regulations that a newer regulation has repealed ("… då Norrköpings kommuns lokala
// trafikföreskrifter (0581 2018:00103) om parkering på Fleminggatan ska upphöra att gälla"). The register download
// kept both, so the old and the new rule were drawn side by side (owner/Pelle 24 Oct: double lines in Norrköping).
// Only when the new regulation is already in force; "i fråga om …" (partly repealed) is left alone.
//   node cities/rdt-repealed.mjs cities/rdt [--apply]   (from the repo root)
import fs from 'node:fs'; import zlib from 'node:zlib';

const dir = process.argv[2] || 'cities/rdt', APPLY = process.argv.includes('--apply');
const norm = (c) => String(c).replace(/[:]/, '-').replace(/-0*(\d+)$/, '-$1');
const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const today = new Date().toISOString().slice(0, 10);
const inForce = (body) => {
  const m = body.match(/träder i kraft den (\d{1,2}) (\w+) (\d{4})/i); if (!m) return true;
  const mo = MONTHS.indexOf(m[2].toLowerCase()); if (mo < 0) return true;
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` <= today;
};
const rep = new Map(); let future = 0, partly = 0, mismatch = 0; const all = [], title = new Map();
for (const f of fs.readdirSync('rdt/texts')) {
  if (!f.endsWith('.jsonl.gz')) continue;
  for (const l of zlib.gunzipSync(fs.readFileSync(`rdt/texts/${f}`)).toString().split('\n')) { if (!l) continue; const r = JSON.parse(l); all.push(r); title.set(norm(r.c), r.rubrik || ''); }
}
// the words that name the place in a title ("… om parkering på Hybelejens gata" → Hybelejens); a repeal sentence that
// describes the old regulation must name one of them, so a mistyped number can't remove the wrong street (Haninge)
const STOP = /^(?:kommuns?|lokala|trafikföreskrifter|om|på|i|och|för|av|vid|med|parkering|parkera|förbud|att|stanna|del|delen|samt|inom|område|området|gata|gatan|väg|vägen|den|det|norra|södra|östra|västra|fordon|rörelsehindrade?|parkeringstillstånd|tillåten|högst|min|minuter|timmar)$/i;
const placeWords = (t) => t.replace(/^.*?trafikföreskrifter/i, '').split(/[^A-Za-zÅÄÖÉÜåäöéü]+/).filter((w) => w.length >= 4 && !STOP.test(w)).map((w) => w.toLowerCase());
for (const r of all) {
  const b = (r.body || '').replace(/\s+/g, ' ');
  const ss = b.replace(/(\d{4}):(\d+)\.(?=\d)/g, '$1:$2').match(/[^.]*(?:skall|ska) upphöra att gälla[^.]*|[^.]*upphör att gälla[^.]*/gi); if (!ss) continue;
  if (!inForce(b)) { future++; continue; }
  for (const s of ss) {
    if (/i fråga om|såvitt avser|till den del/i.test(s)) { partly++; continue; }
    const xs = [...s.matchAll(/\b(\d{4}) ?(\d{4})[:-](\d+)\b/g)];
    xs.forEach((x, i) => {
      const c = `${x[1]} ${x[2]}-${+x[3]}`; if (c === norm(r.c)) return;
      const desc = s.slice(x.index + x[0].length, xs[i + 1]?.index ?? s.length).toLowerCase(), words = placeWords(title.get(c) || '');
      if (/\bom\b/.test(desc) && words.length && !words.some((w) => desc.includes(w))) { mismatch++; return; }
      rep.set(c, r.c);
    });
  }
}
const idx = JSON.parse(fs.readFileSync(`${dir}/index.json`, 'utf8'));
let segs = 0; const by = {}, ex = [];
for (const c of idx.cities) {
  const file = `${dir}/${c.id}.json`; const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const keep = d.segments.filter((s) => { const k = rep.get(norm(s.c)); if (!k) return true; segs++; by[c.id] = (by[c.id] || 0) + 1; if (ex.length < 400) ex.push(`${c.id} ${s.n}: ${s.c} → replaced by ${k}`); return false; });
  if (APPLY && keep.length !== d.segments.length) { d.segments = keep; fs.writeFileSync(file, JSON.stringify(d)); }
}
console.log(`repealed regulations named in texts: ${rep.size} (not yet in force: ${future} texts, partly repealed skipped: ${partly}, description names another place: ${mismatch})`);
console.log(`${APPLY ? 'removed' : 'would remove'} ${segs} segments:`, Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', '));
console.log(ex.join('\n'));
