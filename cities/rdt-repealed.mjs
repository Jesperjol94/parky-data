// Removes map lines of regulations that a newer regulation in force has repealed ("… (0581 2012:00380) om … ska upphöra att gälla",
// "Författningen ersätter …", "Föreskriften upphäver …", verb-less "träder i kraft … då … (c) om …"; spaced citations "(1484 2013 : 0022)").
// Citations are taken only from the repeal clause, so a deviation glued to it is not repealed; a description naming another
// street blocks the repeal (mis-typed numbers). Partly repealed ("i fråga om") and not-yet-in-force texts are skipped.
//   node cities/rdt-repealed.mjs cities/rdt [--apply]   (from the repo root; QA 8 Nov rewrite after the dup/conflict audit)
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
const rep = new Map(); let future = 0, partly = 0, mismatch = 0; const all = [], title = new Map(); const byKind = {};
for (const f of fs.readdirSync('rdt/texts')) {
  if (!f.endsWith('.jsonl.gz')) continue;
  for (const l of zlib.gunzipSync(fs.readFileSync(`rdt/texts/${f}`)).toString().split('\n')) { if (!l) continue; const r = JSON.parse(l); all.push(r); title.set(norm(r.c), r.rubrik || ''); }
}
const STOP = /^(?:kommuns?|lokala|trafikföreskrifter?|om|på|i|och|för|av|vid|med|parkering|parkera|förbud|att|stanna|del|delen|samt|inom|område|området|gata|gatan|väg|vägen|den|det|norra|södra|östra|västra|fordon|rörelsehindrade?|parkeringstillstånd|tillåten|högst|min|minuter|timmar|zon|särskilt|tillstånd|gäller|förbjuden|sidan|båda|sidor|stannande|parkeringsförbud|föreskrift(?:er)?|myndighetens|ltf)$/i;
const words = (t) => t.split(/[^A-Za-zÅÄÖÉÜåäöéü]+/).filter((w) => w.length >= 4 && !STOP.test(w)).map((w) => w.toLowerCase());
const placeWords = (t) => words(t.replace(/^.*?trafikföreskrifter/i, ''));
// CITATION: "0581 2018:00103", "0581 2018-103", "1484 2013 : 0022" (spaces around the colon are common in older PDFs)
const CIT = /\b(\d{4}) ?(\d{4})\s*[:-]\s*0*(\d+)\b/g;
// repeal sentences: the usual "… ska upphöra att gälla", plus "ersätter …", "upphäver/upphävs …" and the verb-less
// "träder i kraft den … då/när <kommun>s lokala trafikföreskrifter (c) om …" (the verb lost to a page break or written "ska sluta gälla")
const SENT = /[^.]*(?:(?:skall|ska) upphöra att gälla|upphör att gälla|ska sluta gälla|\bersätter\b|\bupphäv(?:er|s)\b|träder i kraft[^.]*?\b(?:då|när)\b)[^.]*/gi;
for (const r of all) {
  const b = (r.body || '').replace(/\s+/g, ' ').replace(/Publicerat på webbplatsen Svensk trafikföreskriftssamling den \d{1,2} \w+ \d{4}/g, ''); // page headers break sentences
  const ss = b.replace(/(\d{4}):(\d+)\.(?=\d)/g, '$1:$2').replace(/(\d) kap\. (\d)/g, '$1 kap $2').match(SENT); if (!ss) continue;
  if (!inForce(b)) { future++; continue; }
  for (const s of ss) {
    if (/i fråga om|såvitt avser|till den del/i.test(s)) { partly++; continue; }
    // only the repeal clause: a deviation ("med avvikelse från … (c) …") glued to the same sentence must not count
    const k = s.search(/träder i kraft|\bersätter\b|\bupphäv/i); let clause = k >= 0 ? s.slice(k) : s; if (!new RegExp(CIT.source).test(clause)) clause = s; // "Beslut 2101 2009:49 upphör att gälla … Dessa föreskrifter träder i kraft" (Ockelbo)
    const kind = /upphöra|upphör/i.test(clause) ? 'upphöra' : /ersätter/i.test(clause) ? 'ersätter' : /upphäv/i.test(clause) ? 'upphäver' : 'träder-då';
    const xs = [...clause.matchAll(CIT)];
    xs.forEach((x, i) => {
      const c = `${x[1]} ${x[2]}-${+x[3]}`; if (c === norm(r.c)) return;
      // the description of the old regulation: "om förbud att parkera på Hybelejens gata" up to the next listed regulation
      const desc = clause.slice(x.index + x[0].length, xs[i + 1]?.index ?? clause.length).toLowerCase().replace(/\S+ kommuns? lokala trafikföreskrift.*$|\b(?:ska|skall) .*$/, '');
      const dw = words(desc), tw = placeWords(title.get(c) || '');
      // a mistyped number can't remove the wrong street (Haninge): when the description names a place, the title must share a word
      if (/\bom\b/.test(desc) && dw.length && tw.length && !tw.some((w) => desc.includes(w))) { mismatch++; console.error("MISMATCH", c, "by", r.c, JSON.stringify(desc.slice(0,80))); return; }
      if (!rep.has(c)) byKind[kind] = (byKind[kind] || 0) + 1;
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
console.log(`repealed regulations named in texts: ${rep.size} (not yet in force: ${future} texts, partly repealed skipped: ${partly}, description names another place: ${mismatch}) by kind ${JSON.stringify(byKind)}`);
console.log(`${APPLY ? 'removed' : 'would remove'} ${segs} segments:`, Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', '));
if (process.env.OUTREP) fs.writeFileSync(process.env.OUTREP, JSON.stringify([...rep])); else console.log(ex.join('\n'));
