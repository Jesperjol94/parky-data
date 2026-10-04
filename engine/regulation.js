// Reads the official regulation text (RDT, "Stockholms kommuns lokala trafikföreskrifter om …") into rules.
// Runs in the nightly data pipeline. The city's structured open data is sometimes incomplete compared with
// the text (missing time limits, "Övrig tid får fordon inte parkeras", winter bans, night bans on loading
// zones), so the text is used to add what the data lacks. Anything we can't read is reported, not guessed.
//
// Output windows use the segment format: { w?, dt?, a, b, m?, p? } (weekday 1–7, day types, minutes, season, parity).

const MONTHS = { januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6, juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12 };
const WEEKDAYS = { måndag: 1, tisdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lördag: 6, söndag: 7, måndagar: 1, tisdagar: 2, onsdagar: 3, torsdagar: 4, fredagar: 5, lördagar: 6, söndagar: 7 };
const clean = (o) => { for (const k of Object.keys(o)) if (o[k] == null) delete o[k]; return o; };

// The rule paragraphs: between "… följande." and "Denna författning …" / signatures.
export function ruleText(body) {
  if (!body) return null;
  const t = body.replace(/­/g, '').replace(/-\n(?=[a-zåäö])/g, '').replace(/\s+/g, ' ');
  const m = t.match(/följande\.?\s*(.*?)(?:Denna författning|Dessa föreskrifter träder|På trafiknämndens vägnar|$)/i);
  return m ? m[1].trim() : null;
}

const TIME = String.raw`(\d{1,2})(?:[.:](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[.:](\d{2}))?`;
const toMin = (h, m) => +h * 60 + (+m || 0);

function season(s) {
  const r = s.match(/(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/i);
  return r ? [[MONTHS[r[2].toLowerCase()], +r[1]], [MONTHS[r[4].toLowerCase()], +r[3]]] : null;
}
const parity = (s) => (/udda veckor/i.test(s) ? 'odd' : /jämna veckor/i.test(s) ? 'even' : null);

// Day-type phrase right before a "klockan" → day types (null = every day).
function dayTypesOf(s) {
  const x = s.toLowerCase();
  if (/vardag(ar)? utom vardag(ar)? före sön- och helgdag/.test(x)) return ['vardag'];
  if (/vardag(ar)? före sön- och helgdag/.test(x)) return ['fore'];
  if (/sön- och helgdag/.test(x)) return ['helgdag'];
  if (/\bvardag(ar)?\b/.test(x)) return ['vardag', 'fore'];
  if (/alla dagar|dagligen/.test(x)) return null;
  return undefined; // nothing said
}

// All "<day words> klockan A - B" pieces in a clause.
function windows(clause) {
  const out = [];
  const re = new RegExp(String.raw`([^,;]*?)\b(?:klockan|kl\.?)\s*${TIME}`, 'gi');
  let m, lastDt;
  while ((m = re.exec(clause))) {
    const pre = m[1];
    const wd = (pre.toLowerCase().match(/\b(måndag(?:ar)?|tisdag(?:ar)?|onsdag(?:ar)?|torsdag(?:ar)?|fredag(?:ar)?|lördag(?:ar)?|söndag(?:ar)?)\b/) || [])[1];
    let dt = dayTypesOf(pre);
    if (dt === undefined) dt = lastDt; // "… 07.00 - 19.00 och 11.00 - 17.00" keeps the previous day type
    lastDt = dt;
    let a = toMin(m[2], m[3]), b = toMin(m[4], m[5]);
    if (b === 0) b = 1440;
    out.push(clean({ w: wd ? WEEKDAYS[wd] : null, dt: wd ? null : dt ?? null, a, b }));
  }
  return out;
}
function duration(s) {
  const m = s.match(/högst\s+(\d+)\s*(tim(?:me|mar)?|min(?:uter)?|dygn)/i);
  if (!m) return null;
  const n = +m[1], u = m[2].toLowerCase();
  return u.startsWith('dygn') ? n * 1440 : u.startsWith('tim') ? n * 60 : n;
}

// Split into sentences, keeping "kl. 7" and "8 §" intact.
function sentences(t) {
  return t.replace(/(\d)\.(\d)/g, '$1§DOT§$2').split(/(?<=[.;])\s+(?=[A-ZÅÄÖ])/).map((s) => s.replace(/§DOT§/g, '.').trim()).filter(Boolean);
}

const IGNORE = [
  /^Avgiftsplikten gäller/i, /^Avgift ska betalas/i, /Parkeringsskiva|parkeringsskiva/i, /^Med (boende|fordon|.*avses)/i,
  /^Stockholms kommun föreskriver/i, /trafikförordningen \(1998:1276\) följande/i, /^Publicerat/i, /^beslutade den/i,
  /^Föreskrifterna gäller/i, /^Bestämmelsen gäller/i, /^Detta gäller/i, /^Undantag/i,
];

// → { taxa, reserved, purpose, allowOnly, limits, bans, otherAllowed, unread: [sentences we could not interpret] }
export function parseRegulation(body) {
  const t = ruleText(body);
  const out = { taxa: null, reserved: false, purpose: [], allowOnly: [], limits: [], bans: [], otherAllowed: null, unread: [] };
  if (!t) { out.unread.push('(no rule text)'); return out; }
  let lastAllow = null;
  for (const s of sentences(t)) {
    const x = s.toLowerCase();
    const m = season(s), p = parity(s);
    const withSP = (w) => clean({ ...w, m, p });
    const tx = x.match(/taxa\s+(\d+)/);
    if (tx && /avgift/.test(x)) { out.taxa = +tx[1]; }
    if (/ändamålsplats/.test(x)) { out.purpose.push(...windows(s).map(withSP)); continue; }
    if (/får endast\b/.test(x) && /parkeras|stannas/.test(x)) { out.reserved = true; continue; }
    if (/^övrig tid får fordon inte parkeras/.test(x)) { out.otherAllowed = false; if (lastAllow) out.allowOnly.push(...lastAllow); continue; }
    if (/^övrig tid får fordon parkeras/.test(x)) { out.otherAllowed = true; continue; }
    if (/förbjud|får (?:dock )?(?:fordon )?inte (?:stannas eller )?parkeras|får fordon inte parkeras/.test(x)) {
      const ws = windows(s);
      if (ws.length) out.bans.push(...ws.map(withSP));
      else if (m) out.bans.push(clean({ a: 0, b: 1440, m, p })); // "Parkering är förbjuden under tiden 1 november – 15 maj"
      else out.unread.push(s);
      continue;
    }
    if (/tillåtelsen (?:att parkera )?gäller/.test(x)) {
      const ws = windows(s).map(withSP); const d = duration(s);
      if (!ws.length) { out.unread.push(s); continue; }
      out.allowOnly.push(...ws);
      if (d) out.limits.push(...ws.map((w) => ({ ...w, max: d })));
      continue;
    }
    if (/får fordon parkeras|får parkeras|parkering (?:är )?tillåten/.test(x)) {
      const ws = windows(s).map(withSP); const d = duration(s);
      if (d) out.limits.push(...(ws.length ? ws : [clean({ a: 0, b: 1440, m, p })]).map((w) => ({ ...w, max: d })));
      lastAllow = ws.length ? ws : null;
      continue;
    }
    if (IGNORE.some((r) => r.test(s))) continue;
    if (tx) continue;
    out.unread.push(s);
  }
  return out;
}

export function expired(rec, today = new Date().toISOString().slice(0, 10)) {
  return !!(rec && rec.to && /^\d{4}-\d{2}-\d{2}$/.test(rec.to) && rec.to <= today);
}

// Adds what the regulation text says to a segment built from the city's data. Returns null when the
// regulation has expired (the city data sometimes keeps expired regulations). Stricter rules from the text win;
// the data is never made more permissive.
export function applyRegulation(seg, rec, today) {
  if (!rec || rec.err) return seg;
  if (expired(rec, today)) return null;
  const r = parseRegulation(rec.body);
  const changed = [];
  if (r.purpose.length) {
    if (!seg.k) changed.push('purpose');
    seg.v = seg.v || 'lastning'; seg.k = r.purpose;
    if (r.otherAllowed) seg.ko = 1;
  } else if (r.reserved) {
    return Object.assign(seg, r.unread.length ? { ru: 1 } : {});
  }
  if (r.bans.length) { seg.f = r.bans; changed.push('bans'); }
  if (r.allowOnly.length) { seg.aw = r.allowOnly; changed.push('allowOnly'); } // "Övrig tid … inte parkeras" / "Tillåtelsen gäller …"
  if (r.limits.length) {
    const before = JSON.stringify(seg.l || []);
    seg.l = r.unread.length ? [...(seg.l || []), ...r.limits] : r.limits;
    if (JSON.stringify(seg.l) !== before) changed.push('limits');
  }
  if (seg.t == null && r.taxa != null) { seg.t = r.taxa; changed.push('taxa'); }
  if (r.unread.length) seg.ru = 1; // parts of the text we could not read (QA statistics)
  if (changed.length) seg.rx = 1;  // rules completed from the regulation text
  return seg;
}
