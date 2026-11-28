import { parseRegulation } from '../engine/regulation.js';
// Shared helpers for the RDT municipality pipeline.
import { ruleText, STOPPING } from "../engine/regulation.js";
export const ALL_DAYS = ['vardag', 'fore', 'helgdag'];

// Pelle's fee tables sometimes list several prices for the same hours (one municipality-wide table: "8 kr/tim,
// 10 kr/tim, 12 kr/tim"). The rules on those streets are still known; only the price is not. The table is flattened to
// the highest price wherever prices overlap (never cheaper than reality) and marked priceVaries, instead of making
// every street with that fee uncertain. `bad` lists the zones that were flattened.
export function fixTaxa(taxa) {
  const bad = new Set();
  const out = {};
  for (const [k, z] of Object.entries(taxa || {})) {
    const periods = (z.periods || []).map((p) => ({ ...p, days: p.days && p.days.length ? p.days : ALL_DAYS }));
    let overlap = false;
    for (let i = 0; i < periods.length; i++) for (let j = i + 1; j < periods.length; j++) {
      const p = periods[i], q = periods[j];
      if (p.days.some((d) => q.days.includes(d)) && p.start < q.end && q.start < p.end && p.price !== q.price) overlap = true;
    }
    if (!overlap) { out[k] = { ...z, periods }; continue; }
    bad.add(k);
    const flat = [];
    for (const day of ALL_DAYS) {
      const ps = periods.filter((p) => p.days.includes(day));
      const cuts = [...new Set(ps.flatMap((p) => [p.start, p.end]))].sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i++) {
        const a = cuts[i], b = cuts[i + 1];
        const cover = ps.filter((p) => p.start <= a && p.end >= b);
        if (!cover.length) continue;
        const price = Math.max(...cover.map((p) => p.price));
        const last = flat[flat.length - 1];
        if (last && last.days[0] === day && last.days.length === 1 && last.end === a && last.price === price) last.end = b;
        else flat.push({ start: a, end: b, price, days: [day] });
      }
    }
    // merge day types with identical period lists
    const merged = [];
    for (const p of flat) {
      const twin = merged.find((q) => q.start === p.start && q.end === p.end && q.price === p.price);
      if (twin) twin.days.push(...p.days); else merged.push({ ...p, days: [...p.days] });
    }
    const prices = [...new Set(periods.map((p) => p.price))].sort((a, b) => a - b);
    out[k] = { ...z, periods: merged, priceVaries: true, label: `${prices[0]}–${prices[prices.length - 1]} kr/tim (varierar, se skylt)` };
  }
  return { taxa: out, bad };
}

// Regulations whose geometry in the export is wrong and cannot be repaired: dropped entirely (rdt-process.mjs at build,
// rdt-drop.mjs on the published files).
export const DROP_CITATIONS = {
  '0162 2016-00023': 'no parking at all turning areas (vändplaner) "enligt kartbild": the export maps it to 687 whole streets of Danderyd, 373 m on average',
  '0162 2013-00361': 'no stopping or parking "i terräng" (off-road public land): the export maps it to 30 Danderyd streets',
};

// The line's last day. The register gives the end date as a day, and the app treats that day as already over. A regulation that
// "upphör att gälla den 27 november 2026 klockan 16:00" still holds for most of that day, so its end is the day after (the ban shows
// to midnight rather than ending at 00:00 with 16 hours to go: sweep wave 1, Uppsala Geijersgatan and three more roadworks bans).
const MONTH_NO = { januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6, juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12 };
export function endDay(rec) {
  const to = rec && rec.to && /^\d{4}-\d{2}-\d{2}$/.test(rec.to) ? rec.to : null;
  if (!to) return null;
  const m = String(rec.body || '').replace(/\s+/g, ' ').match(/upphör(?:a)? att gälla (?:den )?(\d{1,2}) (januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december) (20\d\d),? (?:klockan|kl\.?) ?(\d{1,2})[.:](\d{2})/i);
  if (!m || (+m[4] === 0 && +m[5] === 0)) return to;
  if (`${m[3]}-${String(MONTH_NO[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}` !== to) return to;
  const d = new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// A line whose whole rule, read from its regulation's text, is one plain all-day ban ("På vändplatsen … får fordon inte parkeras") or one
// plain reservation (a disabled bay): nothing about hours, days, seasons, limits or fees that a point-sized drawing could misplace.
// rdt-tiny.mjs keeps such a line as fact instead of greying it (sweep waves 1–5: about 330 turning-area bans in Nacka, Täby and
// Södertälje were read right but shown as "check the sign").
export function plainWholeRule(s) {
  if (!s.rx || s.ux || s.ex || s.l || s.aw || s.k || s.dp || s.o || s.t || s.fu || s.hv) return false;
  const own = (s.f || []).filter((w) => !w.ov);
  if (s.v) return !own.length;
  return own.length === 1 && own[0].a === 0 && own[0].b === 1440 && Object.keys(own[0]).every((k) => k === 'a' || k === 'b');
}

// "Övrig tid är parkering tillåten utan avgift och tidsbegränsning": free outside the fee hours, so the words "utan avgift" there do not
// make the regulation free of charge (sweep wave 3: Danderyd Brovägen "högst 4 tim i följd mot avgift" was shown free at all hours)
export const dropOtherTimeFree = (body) => String(body).replace(/(?<![a-zåäö])övrig tid\b[^.]*?\b(?:utan avgift|avgiftsfri)[^.]*/gi, ' ');

// The register put a ban's season on the time limit as well ("får fordon parkeras högst 3 timmar i följd. Parkering är dock förbjuden torsdag
// klockan 02.00 - 05.00 1 november - 30 april": the line had the 3 h limit in winter only). True when the text's limits carry no season, the
// line's limits are the same windows with the season of one of the text's bans (sweep wave 2: Järfälla Kopparvägen)
export function limitSeasonFromBan(text, line) {
  const tl = text.l || [], ll = line.l || [];
  if (!tl.length || tl.length !== ll.length || tl.some((w) => w.m) || !ll.every((w) => w.m)) return false;
  const key = (w) => JSON.stringify([w.w || 0, w.dt || null, w.a, w.b, w.max, w.p || null]);
  const a = tl.map(key).sort(), b = ll.map(key).sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) return false;
  return (text.f || []).some((f) => f.m && ll.every((w) => JSON.stringify(w.m) === JSON.stringify(f.m)));
}

// Day types from the text for windows whose hours the register and the text agree on. The register often holds a window on the wrong day
// type: plain "vardagar" (Mon–Sat) as Mon–Fri, "vardagar och vardag före sön- och helgdag" or a list of all three day types as its last
// one only, "vardagar, dock ej dag före …" as Saturdays. A register window (bans or limits) gets the text's day types when the text has
// a window of the same weekday, hours, length, season and parity and either names more day types (the line gets stricter) or the register
// has only 'fore' where the text has only 'vardag'. Windows without a twin in the text are left alone. `uniqueOnly`: for texts with
// several places, only when the text has exactly one window of that shape. `explicitOnly`: for texts with an unread sentence, only text
// windows that name their day types count (a window without day words may have them in the unread sentence: Vimmerby Nybblevägen,
// "Tidsbegräsningen gäller vardag före sön- och helgdag"). Returns the new list, or null when nothing changes.
// (sweep findings batch 4: Kalmar Larmgatan, Burlöv Svenshögsvägen, Hagfors Uddeholmsvägen)
export function dayTypesFromText(reg, txt, uniqueOnly = false, explicitOnly = false) {
  if (!reg || !reg.length || !txt || !txt.length) return null;
  const shape = (w) => JSON.stringify([w.w || 0, w.nw || 0, w.dm || 0, w.a, w.b, w.max ?? null, w.m || null, w.p || null, w.dd || null, w.wk || null]);
  const T = new Map(); const seen = new Set();
  for (const w of txt) { if (explicitOnly && !w.dt) continue; const full = JSON.stringify(w); if (seen.has(full)) continue; seen.add(full); const k = shape(w); const e = T.get(k) || { n: 0, dt: new Set() }; e.n++; for (const d of w.dt || ALL_DAYS) e.dt.add(d); T.set(k, e); }
  let changed = false;
  const out = reg.map((w) => {
    if (w.ov || w.w || !w.dt) return w; // overlays, named weekdays and all-day-type windows are never touched
    const e = T.get(shape(w)); if (!e || (uniqueOnly && e.n !== 1)) return w;
    const have = new Set(w.dt), wider = w.dt.every((d) => e.dt.has(d)) && e.dt.size > have.size;
    const swap = w.dt.length === 1 && w.dt[0] === 'fore' && e.dt.size === 1 && e.dt.has('vardag');
    if (!wider && !swap) return w;
    changed = true; const dt = ALL_DAYS.filter((d) => e.dt.has(d)); const { dt: _dt, ...rest } = w;
    return dt.length === 3 ? rest : { ...w, dt };
  });
  if (!changed) return null;
  const uniq = new Set(); return out.filter((w) => { const k = JSON.stringify(w); if (uniq.has(k)) return false; uniq.add(k); return true; });
}

const seasonDays = (m) => { const s = new Set(); let [mo, d] = m[0]; for (let i = 0; i < 400; i++) { s.add(mo * 100 + d); if (mo === m[1][0] && d === m[1][1]) break; d++; if (d > 31) { d = 1; mo = mo % 12 + 1; } } return s; };
// The register put a season on the time limit that the text does not give it: the fee's season ("högst 24 tim i följd mot avgift.
// Avgiftsplikten gäller 1 juni - 31 augusti": Båstad, Orust), the season a weekday ban is lifted in ("Parkering är dock förbjuden tisdag
// 07–16, utom under tiden 30 juni – 1 oktober": Kiruna), or a season the text never mentions (Sotenäs Köpmansgatan). True when the text's
// limits carry no season and the line's limits are the same windows, all with one such season. The limit then holds all year (stricter).
export function limitSeasonNotInText(text, line, feeWindows, textNamesMonths) {
  const tl = text.l || [], ll = line.l || [];
  if (!tl.length || tl.length !== ll.length || tl.some((w) => w.m) || !ll.every((w) => w.m)) return false;
  const key = (w) => JSON.stringify([w.w || 0, w.dt || null, w.a, w.b, w.max, w.p || null]);
  if (JSON.stringify(tl.map(key).sort()) !== JSON.stringify(ll.map(key).sort())) return false;
  const m0 = JSON.stringify(ll[0].m); if (!ll.every((w) => JSON.stringify(w.m) === m0)) return false;
  if (!textNamesMonths) return true;
  if ((feeWindows || []).length && feeWindows.every((w) => w.m && JSON.stringify(w.m) === m0)) return true;
  const mine = seasonDays(ll[0].m);
  return (text.f || []).some((f) => { if (!f.m) return false; const s = seasonDays(f.m); return [...s].every((d) => !mine.has(d)) && s.size + mine.size >= 365; });
}

// "Parkering är dock förbjuden under tiden 1 tisdagen i månaden klockan 08.00 - 12.00": where the line holds the text's n-th weekday ban AND the
// same weekday and hours without the n-th (the register's plain weekly window), the plain one is dropped: the text bans one Tuesday a month, not
// every Tuesday. Only when the text itself has no plain window of that weekday and hours. Returns the new list, or null when nothing changes.
// (sweep findings batch 5: Hässleholm Torsgatan, Kungsgatan, Nygatan were banned every Tuesday morning)
export function nthWeekdayFromText(reg, txt) {
  if (!reg || !reg.length || !txt || !txt.length) return null;
  const key = (w) => JSON.stringify([w.w, w.a, w.b, w.dt || null, w.m || null, w.p || null, w.dd || null, w.wk || null]);
  const nth = new Set(txt.filter((w) => w.w && w.nw).map(key)), plain = new Set(txt.filter((w) => w.w && !w.nw).map(key));
  const onLine = new Set(reg.filter((w) => !w.ov && w.w && w.nw).map(key));
  const out = reg.filter((w) => !(!w.ov && w.w && !w.nw && !w.dm && nth.has(key(w)) && onLine.has(key(w)) && !plain.has(key(w))));
  return out.length === reg.length ? null : out;
}

// True when the rule text plainly permits ordinary cars ("får fordon parkeras", "får endast personbil (klass I) (och motorcykel) parkeras") and, for a
// disabled reservation, no sentence reserves anything for permit holders (sentences about their fee, their longer stay or where their bays are do not)
export function carsPermitted(body, v) {
  const t = (ruleText(body) || '').replace(/\s+/g, ' ').replace(/,?\s*med avvikelse från [^,]*,/gi, ' ');
  const ss = t.split(/(?<=[.;])\s+(?=[A-ZÅÄÖ0-9])/);
  const permit = ss.some((x) => /\bfår (?:endast |enbart |bara )?(?:fordon|(?:motorcykel (?:och|samt) )?personbil(?:ar)?(?: klass (?:I|1)\b)?(?! klass)(?: (?:och|samt) motorcykel)?)(?: (?:stannas eller|stannas och))? parkeras\b/i.test(x) && !/\b(?:inte|ej)\b/i.test(x.replace(/(?:ger|ge) (?:inte|ej) rätt att.*$/i, '')));
  if (!permit) return false;
  if (v === 'rörelsehindrade') return ss.filter((x) => /rörelse?hind|handikapp/i.test(x)).every((x) => /avgift|gäller (?:inte|ej)|förutom|får parkera under högst/i.test(x));
  return !/reserverad|\bavses\b|gäller (?:endast|enbart)\b|(?:endast|enbart) för\b|tillstånd/i.test(t); // "Med fordon avses endast taxi" (Karlshamn Stationsvägen) keeps its bay
}

// A text that only says "får fordon parkeras" (optionally "mot avgift …" with the fee's hours) and nothing else with hours, days or
// a duration: safe to read as "park freely / pay the fee". Anything more (hours on the permission, "24 tim i följd" without
// "högst", "endast …") keeps a grey segment grey (QA 27 Oct).
const TIMEWORD = /(?<![\d:])\d{1,2}[.:]\d{2}(?![\d:])|(?<![a-zåäö])(?:tim(?:me|mar|ma)?|dygn|minut\w*|klockan|kl|vardag\w*|helgdag\w*|högst|endast|enbart|måndag\w*|tisdag\w*|onsdag\w*|torsdag\w*|fredag\w*|lördag\w*|söndag\w*|udda|jämna|datum\w*|januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|förbjud\w*|inte|ej|reserver\w*|tillstånd|klass)(?![a-zåäö])/i; // letters, not \b: \b is ASCII-only, so "kl" matched in "Klågerup" and "Klövergatan" (sweep findings batch 7: 22 Svedala texts stayed grey)
export function plainPermit(body) {
  let t = ruleText(body); if (!t) return false;
  // words that look like conditions but are none (sweep findings batch 7: about 110 plain permissions stayed grey for these alone): the boilerplate about other
  // bans, also glued to the permission without a full stop (Söderköping, Jönköping); "3 kap. 53 §" split as a sentence end (Åstorp, Kumla, Säffle); the numbers of
  // other regulations and of properties ("0484 2010:129", "FÅGELÖ 4:13") read as clock times (Eskilstuna, Mariestad, Sala); where to stand ("endast på särskilt
  // markerade platser": Lund ×12, Skurup, Sala); "endast mot avgift" (Trelleborg ×35: a fee, not a reservation)
  t = t.replace(/\(\d{4}:\d+\)/g, '').replace(/\s+/g, ' ')
    .replace(/(?:Tillåtelsen|Förbudet)(?: i \d+ ?§)? (?:ger|ge) (?:inte|ej) rätt att (?:stanna (?:eller|och) )?parkera där det (?:enligt trafikförordningen )?är förbjudet att stanna (?:eller|och) parkera(?: enligt trafikförordningen)?\s*\.?/gi, '. ')
    .replace(/\b(\d+) kap\. ?/g, '$1 kap ').replace(/\b\d{4} \d{4}:\d+\b/g, ' ').replace(/\bfastighet(?:en|erna)? [^,.;]*?\d+:\d+/gi, 'fastigheten')
    .replace(/,? ?(?:och )?\b(?:endast|enbart) (?:tillåte[nt] )?(?:på|inom|i) (?:de )?(?:särskilt )?(?:markerade?|anvisade?|uppmärkta?|anordnade?|iordningställda?) (?:parkerings)?(?:plats(?:er|erna|en)?|rutor|fickor)\b/gi, ' ')
    .replace(/\b(?:endast|enbart) (?=mot (?:att )?avgift\b)/gi, '');
  const ss = t.split(/(?<=[.;])(?!\d)\s*/).map((x) => x.replace(/^\s*\d+\s*§\s*/, '').trim()) /* not inside "08.00": a fee sentence's hours were split off and read as permission hours (QA 30 Oct: Uppsala Marknadsgatan stayed grey) */.filter((x) => /[a-zåäö]{3}/i.test(x));
  let permit = false;
  for (const x of ss) {
    if (/^(?:tillåtelsen|förbudet) (?:ger|ge) (?:inte|ej) rätt/i.test(x)) continue;
    if (/^tillåtelsen gäller även\b/i.test(x) || /^publicerat\b/i.test(x)) continue; // "Tillåtelsen gäller även parkering närmare korsningen än …" (Uppsala); a colophon line the text layer mixed into the rules (Nyköping, Östersund)
    if (/får (?:fordon|parkeras)[^.]*parkeras|får fordon[^.]*parkeras|får parkeras|^(?:på|inom) [^.]*[a-zåäö] parkeras\.?$/i.test(x)) { // also a place followed straight by "parkeras" ("får fordon" lost: Uppsala Råbyvägen)
      const head = x.replace(/\bmot (?:att )?avgift\b.*$/i, '').replace(/med avvikelse från [^,]*,/i, ''); if (TIMEWORD.test(head)) return false; permit = true; continue; }
    if (/^(?:avgift\w*|parkeringsavgift\w*)\b/i.test(x)) continue; // fee sentences: their hours are the fee's
    if (TIMEWORD.test(x)) return false;
  }
  return permit;
}

// ---- sweep findings batch 8 (26 Nov 2026) ----
// Is the regulation a stopping ban? Judged on the operative text when it can be cut out (ruleText), else on the whole body: the title ("… om förbud att stanna eller parkera
// på X") and the sentence about the regulation this one replaces made plain parking bans ("får fordon inte parkeras") stopping bans (Gävle Glaciärvägen, Eskilstuna
// Munktellsgatan, Skellefteå, Nynäshamn, Helsingborg). Left out before testing: the boilerplate "… ger inte rätt att stanna där det är förbjudet att stanna eller parkera" in
// any wording, repeal sentences, and the title of a regulation the text departs from ("med avvikelse från … föreskrifter 2080 2025:00259 om förbud att stanna och parkera").
export function stoppingBan(body, rule) {
  const rt = rule && rule.replace(/\s+/g, ' ').trim().length > 30 ? rule.replace(/\s+/g, ' ') : String(body || '');
  return STOPPING.test(rt.replace(/(?:ger|ge) (?:inte|ej) rätt att[^.]*/gi, '').replace(/[^.]*\bdär det är förbjudet att stanna (?:eller|och) parkera[^.]*/gi, '')
    .replace(/[^.]*(?:upphör|upphöra) att gälla[^.]*/gi, '').replace(/föreskrifter[^.]{0,40}?\bom (?:område med )?förbud (?:mot )?att stanna[^.,]*/gi, ''));
}
// A bay the parser DID read as reserved at all hours for a vehicle or a group ("får endast personbil klass II parkeras", "… skall vara laddplats") while another sentence
// is unread (a fee detail, the same bay worded twice): reserving never relaxes a line, so the reservation is added, as read bans are. Not when an unread sentence may open
// the place to other cars or other hours ("Övrig tid …", "För övrig parkering gäller ingen tidsbegränsning", "… får fordon parkeras …", residents), and not when the text also
// lets every car park somewhere (Ängelholm's motorhome bays on Klittervägen and Valhallsvägen and Kungsbacka's charging bays in Parkeringshus Linden gave every car the bay's limit).
export function reservedBesideUnread(r) {
  return !!r.reserved && r.unread.length > 0 && !r.purpose.length && !r.reservedSeason && !r.reservedWindows.length && !r.otherAllowed && !r.reservedOpenOutside && !r.permitted && !r.bans.length && !r.allowOnly.length
    && !r.unread.some((u) => /^(?:övrig tid|för övrig|under tiden|trots|parkering är dock|på övriga|tillåtelsen gäller (?:även|också))|\bfår (?:fordon|personbil(?:ar)?(?: klass (?:i|1))?|motorfordon|bil(?:ar)?) [^.]*\bparkeras?\b|\bboende\b|\bövriga (?:platser|fordon)\b/i.test(u));
}
// A line's own bans: not those laid on it from an area regulation (ov: 1) or roadworks (ov: 2). Counting the laid-on bans made a one-place text "several rule sets" wherever
// roadworks touched one of its lines, so the text was never applied (Västervik Skeppsbron kept its 10-day limit in the fee hours only).
export const ownBans = (s) => (s.f || []).filter((w) => !w.ov);

// The text states the rate ("Avgift ska betalas för parkering enligt beslutad taxa 5kr/timme och 40kr/dygn") and the line's table charges another one: the
// municipality's register table with exactly that rate (and day cap, or none when the text gives none) is the line's table. Returns its id, or null.
// (QA 27 Nov: Skövde Vasagatan and 30 more regulations showed 20 kr/tim where the text says 5)
export function tableForTextRate(body, taxa, t) {
  if (!t || !taxa) return null;
  const pm = body.replace(/\s+/g, ' ').match(/\btaxa:?\s*(\d+)\s*(?:kr|kronor)\s*(?:\/|per)\s*tim(?:me|men)?\b(?:,?\s*(?:och\s*)?(?:högst\s*)?(\d+)\s*(?:kr|kronor)\s*(?:\/|per)\s*dygn(?:et)?\b)?/i);
  if (!pm) return null;
  const N = +pm[1], M = pm[2] ? +pm[2] : null;
  const base = taxa[t >= 1e7 ? Math.floor(t / 100) : t];
  if (!base?.periods?.length || base.periods.every((p) => p.price === N)) return null;
  const id = Object.keys(taxa).map(Number).find((k) => k < 1e7 && taxa[k].periods?.length && taxa[k].periods.every((p) => p.price === N) && (M == null ? !taxa[k].dayCap : taxa[k].dayCap === M));
  return id || null;
}

// A ban on named weekdays between two dates without a year, where the dates are those very weekdays in the regulation's own year ("Förbudet gäller fredag
// 11 december - 11 december" in 0126 2020-105: 11 Dec 2020 was a Friday; "måndag - tisdag 15 september - 16 september" in 0486 2025-188): a one-off, not a
// yearly season. Returns its last day (ISO), or null. Every ban of the text must be of this kind, the span at most a week, and each day of the span must be
// one of the named weekdays (sweep findings batch 10: Huddinge Rådsvägen and Strängnäs ×2 came back every year).
export function oneOffEnd(citation, bans) {
  const y = +(String(citation).match(/^\d{4} (\d{4})-/) || [])[1]; if (!y || !bans || !bans.length) return null;
  if (!bans.every((b) => b.w && b.m && !b.nw && !b.dt && !b.p && !b.wk && JSON.stringify(b.m) === JSON.stringify(bans[0].m))) return null;
  const [[m1, d1], [m2, d2]] = bans[0].m; const ws = new Set(bans.map((b) => b.w));
  for (const yy of [y, y + 1]) {
    const from = new Date(Date.UTC(yy, m1 - 1, d1)), to = new Date(Date.UTC(yy, m2 - 1, d2)); const n = Math.round((to - from) / 864e5) + 1;
    if (n < 1 || n > 7 || n !== ws.size) continue;
    let ok = true; for (let i = 0; i < n; i++) { const d = new Date(from.getTime() + i * 864e5); if (!ws.has(d.getUTCDay() || 7)) ok = false; }
    if (ok) return to.toISOString().slice(0, 10);
  }
  return null;
}

// The hours and days of a time limit, from the text, when the line holds the same limit more widely: an all-day twin beside the text's windows ("… under högst
// 2 tim i följd. Tillåtelsen gäller vardag utom … 08.00 – 18.00 och vardag före … 08.00 – 15.00": Vellinge Stortorget, Norrtälje Minervavägen, Härnösand Storgatan
// limited parking around the clock), a window without its day type (Sjöbo Gamla Torg ×4, Gällivare, Burlöv: Sundays too), or the days without the hours (Timrå
// Källvägen, Degerfors Medborgargatan). Only when the text has ONE limit length, every limit of the line has that length, no limit of the text holds around the
// clock, and every window of the text lies inside a window of the line (same season): the text's windows then replace the line's. Never wider than the line was,
// so a text with several places (whose limits the parser merges) cannot make a line stricter. Returns the new list or null (sweep findings batch 10).
export function limitsFromText(cur, text) {
  if (!cur || !cur.length || !text || !text.length) return null;
  const plain = (w) => !w.w && !w.nw && !w.dm && !w.dd && !w.p && !w.wk && !w.ov && w.max > 0;
  if (![...cur, ...text].every(plain)) return null;
  const max = text[0].max; if (!text.every((w) => w.max === max) || !cur.every((w) => w.max === max)) return null;
  const ALL = ['vardag', 'fore', 'helgdag'], days = (w) => w.dt || ALL, mm = (w) => JSON.stringify(w.m || null);
  const spans = (w) => (w.a < w.b ? [[w.a, w.b]] : [[w.a, 1440], [0, w.b]]);
  if (text.some((w) => w.a === 0 && w.b === 1440 && days(w).length === 3 && !w.m)) return null;
  const inside = (w, c) => mm(w) === mm(c) && days(w).every((d) => days(c).includes(d)) && spans(w).every(([a, b]) => spans(c).some(([x, y]) => x <= a && b <= y));
  if (!text.every((w) => cur.some((c) => inside(w, c)))) return null;
  const sig = (ws) => JSON.stringify([...new Set(ws.map((w) => JSON.stringify([days(w).slice().sort(), w.a, w.b, w.m || null])))].sort());
  if (sig(cur) === sig(text)) return null;
  const seen = new Set(); return text.filter((w) => { const k = JSON.stringify([days(w).slice().sort(), w.a, w.b, w.m || null]); if (seen.has(k)) return false; seen.add(k); return true; }).map((w) => ({ ...w }));
}

// A regulation that itself permits parking and bans it only at stated times ("På markerad sträcka … får fordon parkeras. Parkering är dock förbjuden under tiden fredag
// klockan 08.00 - 12.00 under tiden 1 november - 15 maj"): the curb is the exception an area-wide ban leaves room for, so rdt-overlay lays no area ban on it (sweep findings
// batch 11: Sundbyberg, Nacka, Falkenberg, Falun, Örebro, Sigtuna, Täby answered NO at all times). Fully read texts only; not a text with an all-day ban of its own (a
// street ban with a permission for one side), not a bay for some vehicles, not a text about heavy vehicles.
export function permitsWithTimedBans(body) {
  if (!/får (?:fordon|personbil|endast)[^.]*?parkeras/i.test(body || '')) return false;
  let p; try { p = parseRegulation(body); } catch { return false; }
  const allDay = (w) => w.a === 0 && w.b === 1440 && !w.w && !w.dt && !w.m && !w.nw && !w.dm && !w.p && !w.wk && !w.dd;
  return !!p.permitted && !p.reserved && !p.heavyOnly && p.bans.length > 0 && !p.bans.some(allDay) && !p.unread.length;
}

// A longest stay granted to permit holders as an exception to the place's own signed time ("Ett fordon med för platsen gällande
// boendeparkeringstillstånd får med avvikelse från gällande tidsangivelse på platsen parkeras högst 7 dygn i följd", "fordon med för platsen
// gällande tillstånd får, med avvikelse från gällande tidsbegränsning på platsen …"): the text says the place has another time for everyone
// else, which it does not give. The register's limit on such a line is the permit holders' and no rule for an ordinary car, so the line is
// grey "check the sign" (QA 28 Nov: Landskrona's 1,188 resident-parking lines showed 7 days for every car; Kungsbacka 14 days).
// Returns the permit holders' longest stay in minutes, or 0.
export function permitHolderLimit(body) {
  const b = String(body || '').replace(/\s+/g, ' ');
  const m = b.match(/\b(?:fordon|personbil(?:ar)?)\s+med\s+(?:för platsen gällande\s+|giltigt\s+|särskilt\s+)?(?:boende)?(?:parkerings)?tillstånd\b[^.]{0,60}?\bfår,?\s+med avvikelse från gällande (?:tidsangivelse|tidsbegränsning|tidsbestämmelse)[^.]{0,160}?\bparkeras\s+(?:under\s+)?högst\s+(\d+)\s*(dygn|dagar|timm(?:ar|e)|tim|minuter|min)\b/i);
  if (!m) return 0;
  return +m[1] * ({ dygn: 1440, dagar: 1440, timmar: 60, timme: 60, tim: 60, minuter: 1, min: 1 }[m[2].toLowerCase()]);
}

// A start date far in the future is a slip of the pen in the register ("3010-03-10" in a regulation of 2010): the regulation is in force, it has no start
// to wait for. The app shows a line with a future `fr` as free until then (sweep findings batch 12: Gävle Valbovägen 2180 2010-577, a parking ban shown free).
export function startDay(from, today) {
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || from <= today) return null;
  return +from.slice(0, 4) - +today.slice(0, 4) > 5 ? null : from;
}

// A register fee table without a single period (the register named the tariff but no hours: "avgift eller 600 kr/månad") makes the app answer "free" at all hours.
// Such a line is a fee line whose hours the table does not know: "fee – see the sign", with the text's fee hours when it gives them (rdt-reparse derives them).
// Not a table that only holds an "other time" rate (sweep findings batch 12: Kalmar Bjelkegatan 0880 2022-433 was free in its fee hours).
export function emptyFeeTable(taxa, t) {
  const e = t && taxa ? taxa[t] : null;
  return !!(e && Array.isArray(e.periods) && !e.periods.length && !e.otherTime);
}
