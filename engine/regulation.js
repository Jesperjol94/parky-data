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
const MONTH_NAMES = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
export function ruleText(body) {
  if (!body) return null;
  const t = body.replace(/Publicerat på webbplatsen Svensk trafikföreskriftssamling den \d{1,2} \S+ \d{4}/g, ' ') /* page footers inside sentences (QA: Linköping, Norrköping) */.replace(/­/g, '').replace(/-\n(?=[a-zåäö])/g, '').replace(/\s+/g, ' ').replace(/sönoch/g, 'sön- och').replace(/sön och helgdag/g, 'sön- och helgdag')
    .replace(/sön ?- ?och/g, 'sön- och').replace(/sön ?- ?helgdag/g, 'sön- och helgdag').replace(/(\d{1,2}):[ae]\b/g, '$1') // "sön - och helgdag", "sön - helgdag", "1:a december"
    .replace(/\bMed avvikelse från bestämmelserna i \d+ § får/g, 'Får').replace(/\b(fordon) på (?:sträckan|platsen|sträckorna|platserna)\b/gi, '$1') // "Med avvikelse från bestämmelserna i 1 § får fordon på sträckan inte parkeras …"
    .replace(/\bTillåtelsen (?:att parkera )?i \d+ § gäller/g, 'Tillåtelsen gäller').replace(/\bFörbudet i \d+ § gäller/g, 'Förbudet gäller')
    .replace(/\bmellan (?:den )?(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)) och (?:den )?(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december))/gi, '$1 - $2') /* season "mellan 1 maj och 30 september" (Tanum) */.replace(/\bden (\d{1,2}) i (varje )?månaden/gi, 'den $1 dagen i $2månaden').replace(/\b(\d{1,2}) i (varje )?månaden/gi, '$1 dagen i $2månaden') /* "2:a i månaden" (Norrköping) */.replace(/sön\s*[–—-]\s*(?:och\s+)?helgdag/g, 'sön- och helgdag').replace(/\b(\d{1,2})\/(\d{1,2})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\b/g, (z, d1, m1, d2, m2) => (+m1 >= 1 && +m1 <= 12 && +m2 >= 1 && +m2 <= 12 ? `${+d1} ${MONTH_NAMES[+m1 - 1]} - ${+d2} ${MONTH_NAMES[+m2 - 1]}` : z)) /* "1/9- 30/12" */.replace(/(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)) till(?: och med)? (\d{1,2} )/gi, '$1 - $2');

  const m = t.match(/följande\.?\s*(.*?)(?:Denna författning|Dessa föreskrifter träder|Denna föreskrift träder|Dessa föreskrifter gäller|På [^.]{0,60}?vägnar|$)/i);
  return m ? m[1].trim() : null;
}

const TIME = String.raw`(\d{1,2})(?:[.:](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[.:](\d{2}))?`;
const toMin = (h, m) => +h * 60 + (+m || 0);

function season(s) {
  const all = [...s.matchAll(/(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/gi)]
    .map((r) => [[MONTHS[r[2].toLowerCase()], +r[1]], [MONTHS[r[4].toLowerCase()], +r[3]]]);
  if (!all.length) { // "under augusti - juni": whole months (QA: Solna)
    const mm = s.match(/\b(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b/i);
    if (!mm) return null; const m2 = MONTHS[mm[2].toLowerCase()];
    return [[MONTHS[mm[1].toLowerCase()], 1], [m2, [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m2 - 1]]];
  }
  // "1 april - 31 oktober samt under tiden 1 november - 31 mars": seasons that together cover the year are no season (Tyresö)
  if (all.length > 1) { const days = new Set(); for (const [[m1, d1], [m2, d2]] of all) { let m = m1, d = d1; for (let i = 0; i < 400; i++) { days.add(m * 100 + d); if (m === m2 && d === d2) break; d++; if (d > 31) { d = 1; m = m % 12 + 1; } } } if (days.size >= 366) return null; }
  return all[0];
}
// "vecka 42 - 18", "från vecka 42 till vecka 18": ISO weeks (wrapping over New Year), Rättvik
function weeks(s) { const r = s.match(/vecka\s+(\d{1,2})\s*(?:[-–—]|till(?: och med)?(?: vecka)?)\s*(?:vecka\s+)?(\d{1,2})\b/i); return r ? [+r[1], +r[2]] : null; }
const parity = (s) => (/udda veckor/i.test(s) ? 'odd' : /jämna veckor/i.test(s) ? 'even' : null);

// Day-type phrase right before a "klockan" → day types (null = every day).
function dayTypesOf(s) {
  let x = s.toLowerCase().replace(/\b(vardag(?:ar)?),\s+(?=utom\b)/g, '$1 '); // "vardagar, utom vardag före …" in a days-only sentence (QA 26 Oct: Norrköping, Sollentuna read as Saturdays)
  x = x.replace(/^\s*(?:och|samt)\s+/, ''); // "…, och vardag före sön- och helgdag och sön- och helgdag kl 00-24": a leading "och" hid the list (QA 26 Oct: Vellinge dropped the Sunday ban)
  // several day types in one phrase: "vardag samt sön- och helgdag", "vardag utom dag före … och sön- och helgdag"
  const parts = x.split(/(?:\s*,|\s+samt|\s+och)\s+(?=(?:vardag|dag(?:ar)? före|sön- och helgdag|lördag))/);
  if (parts.length > 1) {
    const all = new Set(); let ok = true;
    for (const part of parts) { const d = dayTypesOf1(part); if (d === undefined) { ok = false; break; } if (d === null) return null; d.forEach((k) => all.add(k)); }
    if (ok && all.size) return ['vardag', 'fore', 'helgdag'].filter((k) => all.has(k));
  }
  return dayTypesOf1(x);
}
function dayTypesOf1(x) {
  if (/vardag(?:ar)? utom (?:vardag(?:ar)? )?(?:dag(?:ar)? )?före sön- och helgdag/.test(x)) return ['vardag'];
  if (/vardag(ar)? före sön- och helgdag/.test(x)) return ['fore'];
  if (/\bdag(ar)? före sön- och helgdag/.test(x)) return ['fore'];
  if (/sön- och helgdag/.test(x)) return ['helgdag'];
  if (/\bvardag(ar)?\b/.test(x)) return ['vardag', 'fore'];
  if (/alla dagar|dagligen|samtliga dagar/.test(x)) return null;
  return undefined; // nothing said
}

const WD = String.raw`(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?:ar)?`;
const WD_RANGE = new RegExp(String.raw`\b${WD}\s*(?:[-–—]|till|t\.o\.m\.?)\s*${WD}\b`, 'i');
const WD_WORD = new RegExp(String.raw`\b${WD}\b`, 'gi');
// The weekdays named before a "klockan" ("måndag - fredag", "måndag och torsdag"): a list of weekday numbers, [] for
// every day ("måndag - söndag"), or null when no weekday is named.
function weekdaysOf(pre) {
  const x = pre.toLowerCase();
  if (/\bmåndag(?:ar)?\s+söndag(?:ar)?\b/.test(x)) return []; // "måndag söndag" (the dash lost in the text): every day (QA: Ludvika)
  const r = x.match(WD_RANGE);
  if (r) { const from = WEEKDAYS[r[1]], to = WEEKDAYS[r[2]]; if (from === 1 && to === 7) return []; const out = []; for (let d = from; d <= to; d++) out.push(d); return out; }
  const ws = [...new Set([...x.matchAll(WD_WORD)].map((m) => WEEKDAYS[m[1]]))];
  return ws.length ? ws : null;
}

// All "<day words> klockan A - B" pieces in a clause.
// "första tisdagen i månaden", "sista fredagen i varje månad": one weekday a month (nw 1–4, or -1 for the last).
const NTH = /\b(?:under\s+)?(?:den\s+)?(första|andra|tredje|fjärde|sista|[1-4])\s+(?:helgfria\s+)?(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?:en)?\s+(?:i\s+)?(?:varje\s+)?månad(?:en)?/i;
const NTH_N = { första: 1, andra: 2, tredje: 3, fjärde: 4, sista: -1, 1: 1, 2: 2, 3: 3, 4: 4 }; // "1:a tisdagen" arrives as "1 tisdagen" (ruleText)
export function windows(clause) {
  const nth = NTH.exec(clause);
  if (nth) {
    const ws = windows(clause.replace(NTH, ' ').replace(/\s+året runt\b/i, ''));
    return ws.map(({ a, b, m, p }) => clean({ w: WEEKDAYS[nth[2].toLowerCase()], nw: NTH_N[nth[1].toLowerCase()], a, b, m, p }));
  }
  clause = clause.replace(/\b(vardag(?:ar)?),\s+(?=utom\b)/gi, '$1 '); // "vardagar, utom vardag före …": one day type, not a list (QA: Borås)
  clause = clause.replace(/\b(helgdag(?:ar)?),\s+(?=(?:mellan\s+)?(?:klockan|kl\b))/gi, '$1 '); // "vardagar, utom dag före sön- och helgdag, mellan klockan 07 och 16": the comma cut the day type off its hours
  clause = clause.replace(/\b(helgdag(?:ar)?|vardag(?:ar)?|lördag(?:ar)?|söndag(?:ar)?)\s+(?=\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})/gi, '$1 klockan '); // "… och vardag före sön- och helgdag 09.00 - 15.00" (no "klockan"; QA: Jönköping, Kalmar)
  clause = clause.replace(/([a-zåäö]),\s+(?=(?:vardag|dag(?:ar)? före|sön- och helgdag))/gi, '$1 och '); // "vardag utom …, vardag före … och sön- och helgdag klockan 8-22": one list of day types
  clause = clause.replace(/(klockan\s*\d{1,2}(?:[.:]\d{2})?\s*[-–—]\s*\d{1,2}(?:[.:]\d{2})?)\s*\(gäller ([^)]+)\)/gi, '$2 $1'); // "… 09.00 - 12.00 (gäller vardag utom …)"
  clause = clause.replace(/(mellan (?:klockan|kl\.?)\s*\d{1,2}(?:[.:]\d{2})?\s*och)\s*(?:klockan|kl\.?)\s*(?=\d)/gi, '$1 '); // "mellan kl. 08.00 och kl. 17.00" (Vingåker)
  clause = clause.replace(/mellan (klockan|kl\.?)\s*(\d{1,2}(?:[.:]\d{2})?)\s*och\s*(\d{1,2}(?:[.:]\d{2})?)/gi, '$1 $2 - $3'); // "mellan klockan 8 och 18"
  clause = clause.replace(/\bmellan (\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})/gi, 'klockan $1'); // "mellan 00:00 - 17:00" (Rättvik)
  clause = clause.replace(/\b(parkeras|stannas|förbjuden|tillåten)\s+(?=\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})/gi, '$1 klockan '); // "inte stannas eller parkeras 21.00 - 03.00" (Hudiksvall)
  clause = clause.replace(/(\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})\s+och\s+(?=\d{1,2}[.:]\d{2}\s*[-–—])/g, '$1 och klockan '); // "07.00 - 10.00 och 15.00 - 18.00"
  // time before day type ("Mellan klockan 8 och 22 vardagar utom vardag före … och mellan klockan 8 och 22 vardag före …", Kungsbacka):
  // move each day-type phrase in front of its hours
  if (/^\s*(?:\d+\s*§\s*)?(?:klockan|kl\.?)\s*\d/i.test(clause)) clause = clause.replace(new RegExp(String.raw`(?:klockan|kl\.?)\s*(${TIME})\s+((?:vardag|dag(?:ar)? före|sön- och helgdag|lördag|söndag)[^,;]*?)(?=\s+och\s+(?:klockan|kl)|\s+gäller|\s*[.,;]|$)`, 'gi'), (z, tm, a1, a2, a3, a4, days) => `${days} klockan ${tm}`);
  const out = [];
  const re = new RegExp(String.raw`([^,;]*?)\b(?:klockan|kl\.?)\s*${TIME}`, 'gi');
  let m, lastDt;
  while ((m = re.exec(clause))) {
    const pre = m[1];
    let a = toMin(m[2], m[3]), b = toMin(m[4], m[5]);
    if (b === 0) b = 1440;
    const wds = weekdaysOf(pre);
    const dm = (pre.match(/\b(?:den )?(\d{1,2}) dagen i (?:varje )?månaden/i) || [])[1]; // "den 7 dagen", "19:e dagen i månaden"
    if (wds) { lastDt = undefined; const dtw = dayTypesOf(pre.replace(new RegExp(String.raw`\b${WD}\b`, 'gi'), ' ')); if (!wds.length) out.push(clean({ a, b, dt: dtw ?? null })); else for (const w of wds) out.push(clean({ w, a, b, dt: dtw ?? null })); continue; } // "måndagar 08-11 (gäller vardag utom …)": the weekday, and only when it is a vardag (Norrköping)
    let dt = dayTypesOf(pre);
    if (dt === undefined) dt = lastDt; // "… 07.00 - 19.00 och 11.00 - 17.00" keeps the previous day type
    lastDt = dt;
    out.push(clean({ dm: dm ? +dm : null, dt: dt ?? null, a, b }));
  }
  // "förbjuden vardag mellan klockan 18.00 - 06.00, vardag före sön- och helgdag samt sön- och helgdag": day types after the last hours,
  // with no hours of their own, are whole days (Mullsjö)
  const tail = clause.match(/\d{1,2}(?:[.:]\d{2})?\s*,\s*((?:vardag(?:ar)? före sön- och helgdag(?:ar)?|sön- och helgdag(?:ar)?)(?:\s+(?:samt|och)\s+(?:sön- och helgdag(?:ar)?))?)\s*\.?\s*$/i);
  if (tail && out.length) { const dt = dayTypesOf(tail[1]); if (dt && dt.length) out.push({ dt, a: 0, b: 1440 }); }
  // "vardag 08.00 - 18.00 samt vardag före sön- och helgdag 08.00 - 15.00": with Saturday listed on its own, "vardag" is Mon–Fri (QA: Järfälla)
  if (out.some((w) => w.dt && w.dt.includes('fore') && !w.dt.includes('vardag'))) for (const w of out) if (w.dt && w.dt.length === 2 && w.dt.includes('vardag') && w.dt.includes('fore')) w.dt = ['vardag'];
  return out;
}
// A sentence that names days but no hours ("… under vardag utom dag före sön- och helgdag."): whole-day windows.
function dayOnlyWindows(s) {
  if (/\b(?:klockan|kl\.?)\s*\d/i.test(s) || /mellan (?:klockan|kl\.?)\s*\d/i.test(s)) return [];
  const wds = weekdaysOf(s);
  if (wds) return wds.length ? wds.map((w) => ({ w, a: 0, b: 1440 })) : [{ a: 0, b: 1440 }];
  const dt = dayTypesOf(s);
  return dt === undefined ? [] : [clean({ dt, a: 0, b: 1440 })];
}
const ALL_DAYS_RE = /alla dagar|dagligen|samtliga dagar|måndag(?:ar)?\s*(?:[-–—]|till)\s*söndag(?:ar)?/gi;
const DAY_WORD_RE = /\b(?:vardag|helgdag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|dag(?:ar)? före)/i;
// True when the sentence names days or hours that the windows do not carry: the sentence was only half read.
function halfRead(s, ws) {
  if (/\b(?:klockan|kl\.?)\s*\d/i.test(s) && !ws.length) return true;
  const x = s.replace(ALL_DAYS_RE, ' ');
  if (DAY_WORD_RE.test(x) && !ws.some((w) => w.dt || w.w)) return true;
  const hasW = ws.some((w) => w.w), hasDt = ws.some((w) => w.dt);
  if (hasW && !hasDt && /\b(?:vardag|helgdag)/i.test(x)) return true; // "lördag, söndag och helgdag": the holidays were dropped
  if (hasDt && !hasW && new RegExp(String.raw`\b${WD}\b`, 'i').test(x)) return true;
  return false;
}
const NUM_WORDS = { en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10, tolv: 12, femton: 15, tjugo: 20, trettio: 30 };
function duration(s) {
  // "högst två timmar", "högst en timma", "högst sju (7) dygn": the number written as a word (QA 25 Oct: the limit was dropped)
  s = s.replace(/\b(högs?t|under)\s+(en|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|tolv|femton|tjugo|trettio)\s+(?:\((\d+)\)\s*)?(?=tim|min|dygn|dag)/gi, (_, h, w, d) => `${h.toLowerCase() === 'högt' ? 'högst' : h} ${d || NUM_WORDS[w.toLowerCase()]} `).replace(/\bhögst\s+(\d+)\s*\(\d+\)\s*(?=tim|min|dygn|dag)/gi, 'högst $1 ').replace(/\bhögt\s+(?=\d)/gi, 'högst ');
  const m = s.match(/högst\s+(\d+)\s*(tim(?:me|mar|ma|mar)?|timmar|min(?:uter)?|dygn|dag(?:ar)?)\b/i) || s.match(/gäller (?:under )?(\d+)\s*(tim(?:me|mar)?|min(?:uter)?|dygn) i följd/i); // also "Tillåtelsen gäller 4 tim i följd" (Uppsala)
  if (!m) return null;
  const n = +m[1], u = m[2].toLowerCase();
  return u.startsWith('dygn') || u.startsWith('dag') ? n * 1440 : u.startsWith('tim') ? n * 60 : n;
}

// Split into sentences, keeping "kl. 7" and "8 §" intact; paragraph numbers ("1 §") and "med avvikelse från …" asides are dropped.
function sentences(t) {
  t = t.replace(/,?\s*med avvikelse från [^.]*?,\s*(parkeras|stannas)\b/gi, ' $1') /* the clause names a list of areas with commas (Kalmar) */.replace(/,?\s*med avvikelse från [^,]*?,/gi, ' ').replace(/\b(får fordon) [^.,]{1,40}, (parkeras)/g, '$1 $2').replace(/\bTrots tillåtelsen i \d+ § får /g, 'Får ').replace(/\bTilllåtelsen\b/g, 'Tillåtelsen').replace(/\binnom\b/g, 'inom').replace(/\b((?:klockan|kl\.?|och)\s*)([01]\d|2[0-4])([0-5]\d)\b(?![.:,]\d)/g, '$1$2.$3') /* "klockan 0800 och 1800" (Värmdö) */.replace(/\b(dag(?:ar)? före) söndag och helgdag/g, '$1 sön- och helgdag').replace(/\bTillåtelsen (?:att parkera )?i paragraf ?\d*\s*§? ?(?=gäller)/g, 'Tillåtelsen ').replace(/\bTillåtelsen att parkera (?:i|enligt) \d+\s*§?\s*(?=gäller)/g, 'Tillåtelsen ').replace(/\b(vardag(?:ar)?), utom ([^,.]*?helgdag(?:ar)?),\s+/g, '$1 utom $2 ') /* "vardagar, utom vardag före sön- och helgdag, mellan …" (Vellinge) */.replace(/personbil klass (?:I|1) (?:och|samt|eller) personbil klass (?:II|2)/gi, 'personbil') /* both classes = any car (Lysekil) */.replace(/(\s)-(?=(?:vardag|sön|lördag|dag|fredag|måndag|tisdag|onsdag|torsdag)\w*)/g, '$1') /* "-vardagar … och -vardag före …" list bullets */.replace(/\b([Ff]år) dock fordon\b/g, '$1 fordon').replace(/\s{2,}/g, ' ');
  t = t.replace(/\bmellan ([01]?\d|2[0-4])((?:[.:][0-5]\d)?) och ([01]?\d|2[0-4])((?:[.:][0-5]\d)?)(?=\s*(?:[.,;]|$))/g, 'mellan klockan $1$2 och $3$4'); // "vardag … mellan 08 och 18." without "klockan" (Lund): hours, not metres
  t = t.replace(/\b(dag|vardag(?:ar)?) (?:före|för) söndag(?:ar)? och helgdag(?:ar)?/gi, '$1 före sön- och helgdag').replace(/\b(vardag(?:ar)?) för (sön- och helgdag)/gi, '$1 före $2'); // "dag före söndag och helgdag" (Hallstahammar), "vardagar för sön- och helgdag" (Mullsjö): the usual day type, not a Sunday
  t = t.replace(/\b(Förbudet|Tidsbegränsningen|Tillåtelsen|Villkoret) gäller ((?:mellan )?klockan [^.]+?)\.\s*(?:\d+ §\s*)?\1 gäller ((?:under tiden )?(?:vardag|sön- och helgdag|dag före)[^.]*?)\./g, '$1 gäller $3 $2.'); // hours in one sentence, their days in the next ("Förbudet gäller mellan klockan 8 och 12. 3 § Förbudet gäller vardagar, utom …", QA 26 Oct: Katrineholm)
  t = t.replace(/\b(vardag(?:ar)?),?\s+dock (?:ej|inte)\s+(?=(?:vardag(?:ar)? |dag(?:ar)? )?före sön- och helgdag)/gi, '$1 utom '); // "vardagar, dock ej dag före sön- och helgdag" = "utom" (QA 26 Oct: Hagfors read as Saturdays)
  t = t.replace(/([^.;\s])\s+(?=Tillåtelsen ger inte rätt)/g, '$1. '); // the city text sometimes lacks the full stop before this sentence
  t = t.replace(/([a-zåäö)0-9])\.(?=[A-ZÅÄÖ][a-zåäö])/g, '$1. '); // "… i följd.Tillåtelsen", "… 14.00.Tillåtelsen": glued sentences
  t = t.replace(/([^.;\s])\s+(\d{1,2}\s*§\s+)(?=[A-ZÅÄÖ][a-zåäö])/g, '$1. $2');
  t = t.replace(/([^.;\s])\s+(?=(?:Parkering (?:är|får)|Förbudet (?:gäller|ger)|Tillåtelsen (?:att parkera )?(?:gäller|ger)|Tidsbegränsningen gäller|Avgiftsplikten gäller|Avgift ska betalas)\b)/g, '$1. '); // a rule sentence with no full stop before it ("… KF § 119/18 Parkering är dock förbjuden …", Skövde) // "… (1998:1276) 2 § Mellan klockan …": a new paragraph without a full stop before it (Kungsbacka)
  t = t.replace(/(^|[.;]\s+)\d{1,2}\s*§\s+(?=[A-ZÅÄÖ])/g, '$1'); // paragraph numbers "2 § Tidsbegränsningen …" (not "13 kap. 8 § trafikförordningen")
  t = t.replace(/\b(kv|ca|nr|resp|fast)\.(?=\s)/gi, '$1§DOT§'); // "parkeringsplats kv. Pilen": an abbreviation, not the end of a sentence
  return t.replace(/(\d)\.(\d)/g, '$1§DOT§$2').split(/(?<=[.;])\s+(?=[A-ZÅÄÖ])/).map((s) => s.replace(/§DOT§/g, '.').trim()).filter(Boolean);
}

const IGNORE = [
  /^Avgiftsplikten gäller/i, /^Avgift ska betalas/i, /^(?:Parkeringsskiva|P-skiva)/i, /^Med (boende|fordon|.*avses)/i, /^med stöd av/i,
  /^Koordinatsystem/i, /^Föreskriften (?:skall|ska) utmärkas/i, /^Vägmärkesförordningen/i, /^Denna föreskrift ersätter/i, /^Föreskriften ersätter/i,
  /gäller inte (?:ambulans|lastbil|buss|taxi|utryckning|moped|cykel|motorcykel|fordon som används i (?:väg|gatu)arbete)/i,
  /^Stockholms kommun föreskriver/i, /trafikförordningen \(1998:1276\) följande/i, /^Publicerat/i, /^beslutade den/i,
  /^Uppställning av fordon sker/i, /^Tillåtelsen ger inte rätt/i, /^Föreskrifterna gäller/i, /^Bestämmelsen gäller/i, /^Detta gäller/i, /^Undantag/i,
  /^Förbudet ger inte rätt/i, /gäller (?:inte|ej) (?:på )?enskild väg/i, /^Tiden, avrundad/i, /anges med parkeringsskiva/i, /^Förbudet gäller alla fordon/i, /^Förbudet gäller om inte annat/i, /gäller inte fordon i linjetrafik/i,
  /^Förbudet gäller inte där parkering är tillåten enligt/i, /^Se /i, /\bboendeparkering\b[^.]*(?:tillåte?n?|villkor|bestämmelser)/i, /^särskilda (?:villkor|bestämmelser)/i, /^förbudet gäller (?:inte|ej) fordon med (?:särskilt )?tillstånd/i, /^första (?:timmen|halvtimmen) är avgiftsfri/i, /^förbuden i [^.]*ger (?:inte|ej) rätt/i, /^följande (?:gator|vägar) ingår/i, /^om inte annat föreskrivits/i, /^övrig tid får parkering ske utan/i, /^föreskriften träder i kraft/i, /^i området ingår även/i, /^förbudet gäller endast på allmänna platser/i, /^förbudet gäller (?:inte|ej) (?:på )?markerade platser/i, /^förbudet gäller (?:inte|ej) om annat/i, /^\S+ taxa\b[^.]*biljett/i, /^taxa\s*[-–]/i, /^vid parkering enligt \d+\s*§/i, /^\S+ kommuns lokala trafikföreskrifter om\b/i, /^tillåtelsen gäller endast personbil(?:ar)?\.?$/i, /^på parkeringsskiva/i, /^samtliga koordinater/i, /^zon\.?$/i, /^förbudet gäller på (?:gatans|vägens) båda sidor/i, /^förbudet gäller (?:inte|ej) (?:för )?(?:skolskjuts|vid på- eller avlastning|vid av- och pålastning)/i, /^avvikelsen avser även/i, /^trf \(/i, /^allmänna lokala trafikföreskrifter\b/i, /^(?:röd|blå|grön|gul|vit|lila) taxa\.?$/i, /^förbudet gäller (?:endast )?(?:under )?skoldagar\.?$/i, /^boende(?:parkering)? zon \S+\.?$/i, /(?:inte|ej) parkeras annat än (?:på|inom) (?:särskilt )?(?:markerad|anordnad)/i, /^vid parkering ska(?:ll)? fordon uppställas/i, /^förbudet gäller (?:inte|ej) (?:inom|på) särskilt (?:anordnad|markerad)/i, /nämnden\b(?![^.]*(?:får|parkeras|gäller|förbjud))/i, /\btaxa\b[^.]*boendeparkering[^.]*gäller/i, /^Instruktioner på parkeringsmätare/i, /^Digital registrering/i, /^Den första timmen/i, /^För parkering inom .* tas avgift/i,
  /årligen återkommande/i, /^(?:Författningen|Föreskriften|Denna författning) (?:ersätter|upphäver)/i, /^Denna föreskrift gäller ej där annat/i, /^Tillåtelsen (?:att parkera )?gäller dock mot avgift/i, /^Parkeringsregler för boendeparkering/i, /^Om förbud att parkera fordon är föreskriven viss tid på plats för boendeparkering/i, /^Tillåtelsen gäller även/i, /boendeparkeringskort|boendeparkeringstillstånd/i, /^Avgift(?:en)?\b/i, /behöver inte erläggas/i, /^Fordonet ska vara försett/i, /^Tillstånd(?:et)? /i,
  /^(?:Parkering|Uppställning) får (?:endast )?ske (?:i|på) (?:markerade|anvisade)/i, /ska ha (?:ett )?giltigt parkeringstillstånd/i,
];

// → { taxa, reserved, purpose, allowOnly, limits, bans, otherAllowed, unread: [sentences we could not interpret] }
// Which special vehicle a "får endast …" / "gäller endast …" sentence reserves the curb for (null = ordinary cars).
const RESERVED = [[/rörelsehindrad|handikappad/, 'rörelsehindrade'], [/beskickning/, 'beskickningsfordon'], [/motorcykel/, 'motorcykel'], [/moped/, 'moped'],
  [/buss/, 'buss'], [/utryckning/, 'utryckningsfordon'], [/lastbil/, 'lastbil'], [/taxi/, 'taxi'], [/elfordon|laddning/, 'laddning'], [/cykel/, 'cykel'],
  [/personbil klass (?:ii|2)\b|husbil/, 'husbil'], [/med (?:tillkopplad )?släp/, 'fordon med släp'], [/tjänstefordon/, 'tjänstefordon']]; // personbil klass II = motorhomes
function reservedFor(x) { for (const [re, v] of RESERVED) if (re.test(x)) return v; return null; }

export function parseRegulation(body) {
  const t = ruleText(body);
  let feeFromConditions = false; // fee hours taken from "Villkoret gäller": a later explicit fee sentence replaces them
  const out = { taxa: null, feeWindows: null, reserved: false, reservedSeason: null, reservedWindows: [], purpose: [], allowOnly: [], limits: [], bans: [], dp: [], otherAllowed: null, unread: [] };
  if (!t) { out.unread.push('(no rule text)'); return out; }
  // A permission with hours ("Tillåtelsen gäller vardagar 09–18") only bans parking outside those hours when something else
  // bans it there (an area ban the text deviates from, or a ban in the text). Otherwise the general rules apply then.
  const banContext = /avvikelse från|trots förbudet|förbud att parkera|parkeringsförbud|(?:inte|ej) (?:stannas eller )?parkeras|parkering(?:en)? (?:är |råder )?förbjuden|övrig tid/i.test(body.replace(/(?:ger|ge) (?:inte|ej) rätt att[^.]*/gi, ''));
  let lastAllow = null, lastLimit = null, lastBan = null, lastDp = false, feeNext = false; const tillWs = [];
  const unread = (s) => out.unread.push(s);
  // A ban sentence with a season per window ("förbjuden under tiden 1 november - 30 april måndag 00-06 och 1 maj - 31 oktober
  // jämna veckor måndag 09-13", Örebro): one sentence per season, so each window keeps its own season and week parity
  const SEASON_START = /\s+och\s+(?=(?:under tiden\s+)?\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december))/i;
  const list = sentences(t).flatMap((s) => {
    if (!/förbjud|(?:inte|ej) (?:stannas eller )?parkeras/i.test(s) || [...s.matchAll(/\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/gi)].length < 2) return [s];
    const parts = s.split(SEASON_START); if (parts.length < 2) return [s];
    const head = (parts[0].match(/^.*?(?:förbjuden|(?:inte|ej) (?:stannas eller )?parkeras)/i) || [''])[0];
    return [parts[0], ...parts.slice(1).map((q) => `${head} ${q}`)];
  });
  for (let s of list) {
    let x = s.toLowerCase();
    if (!/\b(?:får|gäller|förbjud\w*|tillåt\w*|parker\w*|stann\w*|avgift\w*|högst|klockan|kl|reserver\w*|datum\w*)\b|\d{1,2}[.:]\d{2}/i.test(s)) continue; // a sentence with no rule word and no hours describes a place ("… Dalviksvägen 750m norr om Tackjärnsgränd, …", Nora)
    if (!/[a-zåäö]{3}/i.test(s)) continue; // stray punctuation (":.", ";") left by the PDF text
    if (/(?:inte|ej) (?:stannas eller )?parkeras annat än (?:på|inom)/.test(x)) continue; // "får fordon inte parkeras annat än på särskilt markerad uppställningsplats": where to park, not a ban (Östersund)
    const m = season(s), p = parity(s), wk = weeks(s);
    const withSP = (w) => clean({ ...w, m, p, wk });
    const tx = x.match(/taxa\s+(\d+)\b(?!\s*(?:kr|kronor|:-))/); // not "taxa 35 kronor per timme" (Båstad): that is a price
    if (tx && /avgift/.test(x)) { out.taxa = +tx[1]; }
    if (/mot avgift/.test(x)) feeNext = true;
    // "Avgift enligt Taxa Zon 2 under vardagar utom vardag före sön- och helgdag mellan klockan 09.00 - 18.00": the hours the fee is
    // charged, when the text gives them (the register's fee table may say all day; QA: Växjö)
    if (/^avgift(?:splikten|en)?\b/.test(x) && /(?:klockan|kl\.?)\s*\d/.test(x)) { if ((out.feeWindows && !feeFromConditions) || /taxa \S+ [^.]*och (?:enligt )?taxa/.test(x)) continue; const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.feeWindows = ws.map(withSP); feeFromConditions = false; } continue; } // the first sentence giving the fee's days and hours (it overrides hours taken from "Villkoret gäller", Sundsvall Sjögatan); "taxa C 08-18 och taxa E 18-24" splits the price, not the days
    // "Mellan klockan 09.00 och 18.00 gäller dock tillåtelsen i 1 § högst 5 timmar i följd mot avgift eller högst en timma … parkeringsskiva" (Tanum):
    // a limit in those hours (the longer one: paying), and the fee then
    if (/^(?:(?:vardag|vardagar|sön- och helgdag(?:ar)?)[^.]*?)?(?:mellan )?(?:klockan|kl\.?)\s*\d.*?gäller (?:dock )?tillåtelsen/.test(x) && (duration(s) || /mot (?:att )?avgift/.test(x))) {
      const ws = windows(s).map(withSP); if (ws.length && !halfRead(s, ws)) { const d = duration(s.split(/\beller\b/)[0]); if (d) { const items = ws.map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items }; } if (/mot (?:att )?avgift/.test(x)) out.feeWindows = ws; continue; } // "mot att avgift erläggs eller högst 1 timme … parkeringsskiva": paying has no limit; only a limit stated for the paid option counts
    }
    // "Tillåtelsen i paragraf 1 och villkoren i 2 § gäller 1 maj - 30 september": the season of the permission, its limits and fee
    if (/^tillåtelsen (?:i (?:paragraf )?\d+ ?§? ?)?(?:och villkoren (?:i [\d\s–-]+§§? )?)?gäller/.test(x) && m && !windows(s).length && (out.limits.length || out.feeWindows)) { for (const l of (/villkoren/.test(x) && lastLimit ? lastLimit.items : out.limits)) l.m = m; for (const w of out.feeWindows || []) w.m = m; continue; } // "villkoren i 3 §": the season of that paragraph's limit, not the 24 h rule in 2 § (Sotenäs)
    // "Tillåtelsen gäller inte personbil klass I": ordinary cars may not park there (Vellinge)
    if (/^tillåtelsen gäller (?:inte|ej) personbil(?: klass (?:i|1))?\.?$/.test(x)) { out.reserved = true; out.reservedFor = 'husbil'; continue; }
    // "Parkering är dock tillåten endast mot avgift 15 juni - 15 augusti mellan klockan 08.00 - 21.00": the fee's hours and season (QA: Motala)
    if (/endast mot avgift|mot avgift (?:under|mellan|klockan|\d)|mot (?:att )?avgift (?:betalas|erläggs)/.test(x) && /(?:klockan|kl\.?)\s*\d/.test(x) && !out.feeWindows) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.feeWindows = ws.map(withSP); if (/^(?:mellan )?(?:klockan|kl\.?)\s*\d.*?gäller (?:dock )?tillåtelsen/.test(x)) continue; } } // "Mellan klockan 8 och 22 … gäller dock tillåtelsen … mot att avgift betalas eller högst 1 timme … parkeringsskiva": the fee hours (pay, or 1 h with a disc)
    if (/^(?:tillåtelsen|förbudet)(?: i (?:§\s*\d+|\d+\s*§))? (?:ger|ge) (?:inte|ej) rätt/.test(x)) continue;
    if (/^tillåtelsen (?:ger|ge) rätt att parkera (?:på ett sådant sätt|där det)/.test(x)) continue; // a permission that overrides a national ban, not a ban (QA 26 Oct: Hallsberg)
    x = x.replace(/,?\s*(?:tillåtelsen |förbudet )?(?:ger|ge) (?:inte|ej) rätt att (?:stanna|parkera)[^.]*/g, '').replace(/där det (?:enligt [^.]*?)?är förbjudet att stanna eller parkera[^.]*/g, '').replace(/där (?:stannande och |stannande eller )?parkering är förbjuden (?:enligt [^.]*)?/g, ''); // "… får fordon parkeras där stannande och parkering är förbjuden enligt 3 kap. 52 §" (Eskilstuna): a permission, not a ban // "… får parkeras där det är förbjudet …" is not a ban
    // "får fordon stannas eller parkeras under högst 3 tim i följd": a permission to stop or park, read like "får fordon parkeras" (Linköping, Söderköping)
    if (/får (?:fordon )?stannas (?:eller|och) parkeras/.test(x) && !/(?:inte|ej) stannas/.test(x)) { x = x.replace(/får (fordon )?stannas (?:eller|och) parkeras/g, 'får $1parkeras').replace(/  +/g, ' '); s = s.replace(/får (fordon )?stannas (?:eller|och) parkeras/gi, 'får $1parkeras'); }
    // Date parking ("udda datum … udda adressnummer"): one side is always allowed — dp windows, not a ban
    // "får fordon inte parkeras 00.00 - 08.00 jämna datum" on one stretch (no address sides): a ban on those dates (QA: Umeå, Gävle)
    if (/udda datum|jämn(?:a|t) datum/.test(x) && !/adressnummer|sida av (?:vägen|gatan)|udda[^.]*jämn|jämn[^.]*udda/.test(x)) { let ws = windows(s); if (halfRead(s, ws) && !ws.length) { unread(s); continue; } if (!ws.length) ws = [{ a: 0, b: 1440 }]; const dd = /udda datum/.test(x) ? 'odd' : 'even'; const items = ws.map((w) => ({ ...withSP(w), dd })); out.bans.push(...items); lastBan = { items, provisional: false }; continue; }
    if (/udda datum|jämn(?:a|t) datum/.test(x)) { let ws = windows(s); if (!ws.length) ws = [{ a: 0, b: 1440 }]; out.dp.push(...ws.map(withSP)); lastDp = true; continue; }
    if (/^förbudet (?:att (?:parkera|stanna)[^ ]* )?(?:i (?:första stycket|paragraf \d+|\d+\s*§) )?gäller/.test(x) && lastDp && !lastBan) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.dp = ws.map(withSP); continue; } }
    // "Parkering är dock förbjuden enligt … lokala trafikföreskrifter om datumparkering": a reference to another regulation
    if (/förbjud[^.]*enligt (?:bestämmelserna i )?[^.]*trafikföreskrifter/.test(x)) { if (/datumparkering/.test(x) && !out.dp.length) out.dp.push({ a: 0, b: 1440, ref: 1 }); continue; }
    if (/^tillåtelsen gäller även|boendeparkeringskort|boendeparkeringstillstånd/.test(x)) continue;
    if ((/\bboende\b[^.]*tillstånd|tillstånd[^.]*\bboende\b/.test(x)) && !/förbjud|(?:inte|ej) (?:stannas eller )?parkeras/.test(x.replace(/gäller (?:inte|ej) boende/, ''))) continue; // rules for residents with a permit ("Boende med särskilt tillstånd … högst 7 dygn", "Tidsbegränsningen gäller inte boende …"): not for visitors, and no resident permits outside the big three (QA: Kalmar, Hallsberg) // resident permits are out of scope outside the big three
    if (/ändamålsplats/.test(x)) { out.purpose.push(...windows(s).map(withSP)); continue; }
    if (/^övrig tid får endast/.test(x) && reservedFor(x) && lastAllow) { out.otherAllowed = false; out.allowOnly.push(...lastAllow.filter((w) => !out.allowOnly.includes(w))); continue; } // "Övrig tid får endast tung lastbil parkeras"
    if (/vändplats med förbud att (?:stanna och |stanna eller )?parkera/.test(x)) { const items = [{ a: 0, b: 1440 }]; out.bans.push(...items); lastBan = { items, provisional: true }; continue; }
    if (/^(?:på|inom|i|från) [^.]*? får (?:taxi|buss(?:ar)?|(?:tung |tungt )?(?:lastbil(?:ar)?|släpfordon)(?: och (?:tung |tungt )?(?:lastbil(?:ar)?|släpfordon))?|motorcykl(?:ar|el)|moped(?:er)?) parkeras/.test(x) && !/(?:inte|ej) parkeras|får (?:inte|ej)/.test(x)) { out.reserved = true; out.reservedFor = reservedFor(x); if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    // "får personbil klass II parkeras …": a motorhome spot, whether or not it says "endast"
    if (/personbil klass (?:ii|2)\b/.test(x) && /parkeras/.test(x) && !/får (?:inte|ej)\b|inte parkeras/.test(x) && !/personbil klass (?:i|1)\b/.test(x)) { out.reserved = true; out.reservedFor = 'husbil'; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    if (/får endast\b/.test(x) && /parkeras|stannas/.test(x)) {
      const who = reservedFor(x);
      if (who) { out.reserved = true; out.reservedFor = who; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; } // the hours stated here are the hours it is reserved ("…parkeras mot avgift vardagar 07.00 - 19.00")
      // "får endast personbil parkeras …": ordinary cars may park; read the rest of the sentence as usual
      x = x.replace(/får endast (?:personbil(?:ar)?(?: klass (?:i|1)\b)?|fordon)\s*/, 'får fordon '); s = s.replace(/får endast (?:personbil(?:ar)?(?: klass (?:I|1)\b)?|fordon)\s*/i, 'får fordon ');
    }
    if (/^övrig tid (?:får (?:fordon inte|inte fordon) parkeras|(?:är |råder )?parkering(?:en)? förbjuden|råder parkeringsförbud|får fordon (?:inte|ej) stannas)/.test(x)) { // outside the stated hours: not allowed
      if (!lastAllow && lastBan && !lastBan.items.some((b) => b.w || b.m || b.p || b.dm || b.nw || b.dd)) { const o = outsideHours(lastBan.items); if (o && o.length) { out.bans.push(...o); continue; } } // a stopping ban at set hours, "Övrig tid får fordon inte parkeras" (Huddinge): no parking at other times either
      if (!lastAllow) { unread(s); continue; }
      out.otherAllowed = false; out.allowOnly.push(...lastAllow.filter((w) => !out.allowOnly.includes(w))); continue;
    }
    if (/^övrig tid (?:fri parkering|får fordon (?:stannas eller )?parkeras)/.test(x)) { // "…other times vehicles may park": the permission hours are not the only hours
      out.otherAllowed = true; out.allowOnly = out.allowOnly.filter((w) => !tillWs.includes(w));
      const d = duration(s);
      if (d) { // "Övrig tid får fordon parkeras under högst 4 tim i följd": a limit in the hours outside the limit just stated
        const o = lastLimit ? outsideHours(lastLimit.items) : null;
        if (o) { const items = o.map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items }; }
        else { let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s); if (lastBan && ws.length && !halfRead(s, ws)) { const items = ws.map(withSP).map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items }; } else if (lastBan && !/(?:klockan|kl\.?)\s*\d|vardag|helgdag/.test(x)) { const items = [{ a: 0, b: 1440, max: d }]; out.limits.push(...items); lastLimit = { max: d, items }; } else unread(s); } // after a ban: "Övrig tid … högst 24 tim i följd vardag …" (Lidköping)
      }
      continue;
    }
    // "Villkoret gäller under tiden 1 september - 30 december" after a ban (and no limit): the ban's season (QA: Ängelholm)
    if (/^villkoret gäller/.test(x) && m && lastBan && !lastLimit && !windows(s).length) { for (const b of lastBan.items) b.m = m; continue; }
    if (/^förbudet (?:att (?:parkera|stanna)[^ ]* )?(?:i (?:första stycket|paragraf \d+|\d+\s*§) )?gäller/.test(x) && out.heavyOnly && !lastBan) continue;
    if (/^förbudet gäller (?:inte|ej) (?:vardag|dag|sön)/.test(x) && !lastBan && out.permitted) continue; // about the area ban this permission departs from (Norrköping)
    // "Förbudet gäller endast under den första helgfria måndagen varje månad" (Eslöv): the weekday of the ban just stated
    if (/^förbudet (?:att parkera )?(?:i (?:paragraf \d+|\d+ §) )?gäller/.test(x) && lastBan && NTH.test(s) && !/(?:klockan|kl\.?)\s*\d/.test(x)) { const n = NTH.exec(s); for (const b of lastBan.items) { b.w = WEEKDAYS[n[2].toLowerCase()]; b.nw = NTH_N[n[1].toLowerCase()]; delete b.dt; } continue; }
    // "Tillåtelsen gäller inte personbil klass II …": a rule for motorhomes only; ordinary cars are not affected (Visby)
    if (/^tillåtelsen gäller (?:inte|ej) (?:för )?personbil klass (?:ii|2)\b/.test(x)) continue; // the hours of a heavy-vehicle ban (Norrtälje 0188 2020-00111)
    if (/^förbudet (?:att (?:parkera|stanna)[^ ]* )?(?:i (?:första stycket|paragraf \d+|\d+\s*§) )?gäller/.test(x)) { // the hours of the ban just stated
      if (IGNORE.some((r) => r.test(s))) continue;
      if (/gäller (?:inte|ej)\b/.test(x)) {
        if (IGNORE.some((r) => r.test(s))) continue;
        if (out.heavyOnly && /gäller (?:inte|ej) på:/.test(x)) continue; // streets exempt from a heavy-vehicle rule
        const ex = x.replace(/^förbudet gäller (?:inte|ej)\s*/, '');
        if (lastBan && /^(?:vardag|dag före|sön- och helgdag)/.test(ex) && !/\b(?:klockan|kl\.?)\s*\d/.test(ex)) { // "Förbudet gäller inte vardag före sön- och helgdag samt sön- och helgdag" (also after a weekday ban: "onsdag 08-11 … gäller inte vardag före …", Norrköping; the app reads w and dt together)
          const off = new Set(); if (/vardag(?:ar)? utom/.test(ex)) off.add('vardag'); else if (/\bvardag(?:ar)?(?! före)/.test(ex)) { off.add('vardag'); off.add('fore'); }
          if (/(?:vardag|dag)(?:ar)? före sön- och helgdag/.test(ex)) off.add('fore'); if (/(?:samt |och )?sön- och helgdag(?:ar)?\.?$/.test(ex) || /\bsön- och helgdag/.test(ex.replace(/(?:vardag|dag)(?:ar)? före sön- och helgdag/g, ''))) off.add('helgdag');
          for (const b of lastBan.items) { const dt = (b.dt || ['vardag', 'fore', 'helgdag']).filter((d) => !off.has(d)); if (!dt.length) { out.bans = out.bans.filter((q) => q !== b); } else b.dt = dt; }
          continue;
        }
        unread(s); continue;
      }
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s);
      if (!ws.length && m) { // "Förbudet gäller 1 december - 31 mars": the season of the ban just stated, or a whole-season ban
        if (lastBan) { for (const b of lastBan.items) { b.m = m; if (p) b.p = p; } continue; }
        ws = [{ a: 0, b: 1440 }];
      }
      if (ws.length && !halfRead(s, ws)) {
        if (lastBan && lastBan.provisional) out.bans = out.bans.filter((b) => !lastBan.items.includes(b));
        const items = ws.map(withSP); out.bans.push(...items); lastBan = { items, provisional: false }; continue;
      }
      unread(s); continue;
    }
    // "får motorredskap, traktor, tung lastbil, personbil klass II och tung buss inte parkeras": heavy vehicles only, no rule for cars
    if (/får (?:(?:motorredskap|traktor|tung lastbil|lastbil|tung buss|buss|personbil klass (?:ii|2)|släpfordon|släpvagn|fordonståg)[^.]*?)(?:inte|ej) (?:heller )?(?:stannas eller )?parkeras/.test(x) && !/\bfordon (?:inte|ej)|får (?:inte|ej) fordon|personbil(?! klass (?:ii|2))|bruttovikt över/.test(x)) { out.heavyOnly = true; continue; }
    if (/fordon(?:ståg)? med (?:en )?(?:brutto|total)vikt över [\d,.]+ ton (?:inte|ej) parkeras|frikopplat släpfordon/.test(x)) { out.heavyOnly = true; continue; }
    if (/får (?:inte|ej) (?:tung |tungt )?(?:lastbil(?:ar)?|buss(?:ar)?|släpvagn(?:ar)?|släpfordon|fordonståg|motordrivet fordon med tillkopplad)\b/.test(x) && !/får (?:inte|ej) fordon\b/.test(x)) { out.heavyOnly = true; continue; } // "får inte lastbil och motordrivet fordon med tillkopplad släpvagn … parkeras" (Alingsås)
    if (/förbjud|får (?:dock )?(?:fordon |motorfordon |bil(?:ar)? |personbil(?:ar)? )?(?:inte|ej) (?:stannas eller )?parkeras|får (?:inte|ej) (?:fordon|motorfordon) (?:stannas eller )?parkeras/.test(x)) {
      // "Parkering är förbjuden onsdag klockan 09.00 - 14.00 utom under tiden jämna veckor 1 maj - 31 oktober": the ban applies
      // everywhere EXCEPT in the stated weeks/season, so it is the complement of that, not the stated period itself.
      const ix = s.search(/\butom (?:under )?(?:tiden\b|(?:jämna|udda) veckor)/i);
      if (ix > 0) {
        const head = s.slice(0, ix), tail = s.slice(ix), hw = windows(head), em = season(tail), ep = parity(tail);
        if (hw.length && !season(head) && !parity(head) && (em || ep) && !/\boch\b/i.test(tail.replace(/sön- och/g, ''))) {
          const opp = ep === 'odd' ? 'even' : 'odd';
          for (const w of hw) {
            if (em && ep) { out.bans.push(clean({ ...w, m: em, p: opp })); out.bans.push(clean({ ...w, m: complement(em) })); }
            else if (em) out.bans.push(clean({ ...w, m: complement(em) }));
            else out.bans.push(clean({ ...w, p: opp }));
          }
        } else unread(s);
        continue;
      }
      if (/\butom\b/.test(s.replace(/\butom (?=[A-ZÅÄÖ])[^,.]*?(?=\s+(?:enligt|får)\b|,)/g, ' ').toLowerCase().replace(/sön- och/g, '').replace(/vardag(?:ar)? utom (?:vardag(?:ar)? |dag(?:ar)? )?före/g, ''))) { unread(s); continue; } // other exceptions are not guessed
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s);
      if (halfRead(s, ws)) { unread(s); continue; }
      if (ws.length) { const items = ws.map(withSP); out.bans.push(...items); lastBan = { items, provisional: false }; }
      else if (m) { const items = [clean({ a: 0, b: 1440, m, p })]; out.bans.push(...items); lastBan = { items, provisional: false }; } // "Parkering är förbjuden under tiden 1 november – 15 maj"
      else { const items = [{ a: 0, b: 1440 }]; out.bans.push(...items); lastBan = { items, provisional: true }; } // "… får fordon inte parkeras.": all day, unless a "Förbudet gäller …" sentence follows
      continue;
    }
    if (/^tillåtelsen gäller endast/.test(x) && reservedFor(x)) { out.reserved = true; out.reservedFor = reservedFor(x); continue; }
    if (/^(?:villkoret|tidsbegränsningen|begränsningen|förbudet) gäller/.test(x) && out.heavyOnly && !lastLimit && !lastBan) continue; // the hours of a heavy-vehicle rule
    // "Tillåtelsen gäller dock mot avgift. Villkoret gäller vardagar … 09.00 - 18.00 …" (Örnsköldsvik): the fee's hours
    if (/^villkoret gäller/.test(x) && !lastLimit && feeNext && !out.feeWindows) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.feeWindows = ws.map(withSP); feeFromConditions = true; continue; } }
    // "Tidsbegränsningen och avgiftsplikten gäller under tiden 1 juni - 31 augusti" (Båstad): the season of the limits and the fee
    if (/^tidsbegränsningen och avgiftsplikten gäller/.test(x) && lastLimit && windows(s).length) { const ws = windows(s); if (!halfRead(s, ws)) { out.limits = out.limits.filter((l) => !lastLimit.items.includes(l)); const items = ws.map(withSP).map((w) => ({ ...w, max: lastLimit.max })); out.limits.push(...items); lastLimit = { max: lastLimit.max, items }; out.feeWindows = ws.map(withSP); continue; } }
    if (/^tidsbegränsningen och avgiftsplikten gäller/.test(x) && m && !windows(s).length) { for (const l of out.limits) l.m = m; if (out.feeWindows) for (const w of out.feeWindows) w.m = m; else out.feeWindows = [{ a: 0, b: 1440, m }]; continue; }
    if (/^tidsbegränsningen gäller/.test(x) && out.reserved && !lastLimit) continue; // a limit for the reserved vehicles (disabled bays), not for other cars
    if (/^tidsbegränsningen gäller/.test(x) && !lastLimit && lastBan && m && !windows(s).length) { for (const b of lastBan.items) b.m = m; continue; } // "Tidsbegränsningen gäller 15 november – 15 april" after a ban (Hörby)
    if (/^(?:villkoret|tidsbegränsningen|begränsningen) gäller/.test(x) && lastLimit) { // "Villkoret gäller under tiden …": the hours of the limit just stated
      if (/gäller (?:inte|ej)\b/.test(x)) { unread(s); continue; }
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s);
      if (!ws.length && m) { for (const l of lastLimit.items) l.m = m; continue; } // "Tidsbegränsningen gäller under tiden 1 maj - 30 september": the limit's season (QA: Vänersborg, Tanum)
      if (ws.length && !halfRead(s, ws)) { out.limits = out.limits.filter((l) => !lastLimit.items.includes(l)); const items = ws.map(withSP).map((w) => ({ ...w, max: lastLimit.max })); out.limits.push(...items); lastLimit = { max: lastLimit.max, items }; if (feeNext && !out.feeWindows && /^villkoret/.test(x)) { out.feeWindows = ws.map(withSP); feeFromConditions = true; } continue; } // "… parkeras mot avgift. Tillåtelsen gäller under högst 2 timmar. Villkoret gäller <hours>": the conditions, fee included, hold in those hours (Uddevalla)
      unread(s); continue;
    }
    // "Tillåtelsen gäller inte den 1 måndagen i månaden mellan klockan 07.00 - 10.00": a ban in those hours (Ystad)
    if (/^tillåtelsen (?:att parkera )?gäller (?:inte|ej)\b/.test(x) && !/rätt att/.test(x)) {
      const ws = windows(s).map(withSP); if (ws.length && !halfRead(s, ws)) { out.bans.push(...ws); lastBan = { items: ws, provisional: false }; continue; }
      unread(s); continue;
    }
    if (/tillåtelsen (?:att parkera )?gäller/.test(x)) {
      if (/gäller (?:dock )?(?:endast )?mot avgift\.?$/.test(x) || IGNORE.some((r) => r.test(s))) continue; // "Tillåtelsen gäller dock mot avgift": the fee is in the data already
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s); ws = ws.map(withSP); const d = duration(s);
      if (halfRead(s, ws)) { unread(s); continue; }
      if (!ws.length) { // "Tillåtelsen att parkera gäller parkering under högst 3 tim i följd.": a limit at all hours
        if (d) { const items = [clean({ a: 0, b: 1440, m, p, max: d })]; out.limits.push(...items); lastLimit = { max: d, items }; continue; }
        unread(s); continue;
      }
      // "… under högst 2 tim i följd. Tillåtelsen gäller under tiden vardag … 08.00 - 18.00 …": the limit just stated holds in those hours (QA: Lidköping)
      if (!d && lastLimit && lastLimit.items.every((w) => w.a === 0 && w.b === 1440 && !w.dt && !w.w)) {
        out.limits = out.limits.filter((w) => !lastLimit.items.includes(w));
        const items = ws.map((w) => ({ ...w, max: lastLimit.max })); out.limits.push(...items); lastLimit = { max: lastLimit.max, items };
      }
      out.allowOnly.push(...ws); tillWs.push(...ws); lastAllow = ws;
      if (d) { const items = ws.map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items }; }
      continue;
    }
    if (/får fordon parkeras|får parkeras|parkering (?:är )?(?:dock )?tillåten|får personbil(?:ar)? (?:klass (?:i|1) )?parkeras/.test(x)) {
      out.permitted = true; // the text permits parking (with or without conditions): a register ban on it is wrong
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s); ws = ws.map(withSP); const d = duration(s);
      if (halfRead(s, ws)) { unread(s); continue; }
      if (d) { const items = (ws.length ? ws : [clean({ a: 0, b: 1440, m, p })]).map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items }; }
      lastAllow = ws.length ? ws : null;
      continue;
    }
    if (IGNORE.some((r) => r.test(s))) continue;
    if (tx) continue;
    unread(s);
  }
  if (!banContext && out.otherAllowed !== false) out.allowOnly = []; // outside the stated hours the general rules apply, not a ban
  return out;
}

const DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const nextDay = ([m, d]) => (d >= DIM[m - 1] ? [m % 12 + 1, 1] : [m, d + 1]);
const prevDay = ([m, d]) => (d <= 1 ? [m === 1 ? 12 : m - 1, DIM[(m + 10) % 12]] : [m, d - 1]);
// The hours outside a reserved spot's reserved hours, as car-allowed windows { dt, a, b } (null when the hours can't be read safely).
function outsideHours(ws) {
  if (!ws.length || ws.some((w) => w.w || w.m || w.p || w.a == null || w.b == null)) return null;
  const gaps = new Map();
  for (const D of ['vardag', 'fore', 'helgdag']) {
    const iv = ws.filter((w) => !w.dt || w.dt.includes(D)).map((w) => [w.a, w.b]).sort((x, y) => x[0] - y[0]);
    let at = 0;
    for (const [a, b] of iv) { if (a > at) gaps.set(`${at}-${a}`, [...(gaps.get(`${at}-${a}`) || []), D]); at = Math.max(at, b); }
    if (at < 1440) gaps.set(`${at}-1440`, [...(gaps.get(`${at}-1440`) || []), D]);
  }
  return [...gaps].map(([k, dt]) => { const [a, b] = k.split('-').map(Number); return { dt, a, b }; });
}
const complement = (m) => [nextDay(m[1]), prevDay(m[0])];

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
    // the city data sometimes lacks the vehicle ("får endast beskickningsfordon parkeras" with a plain record): reserve the curb
    if (!seg.v) { seg.v = r.reservedFor || 'reserverad'; seg.rx = 1; }
    // "Only motorcycles 1 April – 30 September. Other times vehicles may park": ordinary cars may park outside that season.
    if (r.otherAllowed && r.reservedSeason) { seg.o = [{ m: complement(r.reservedSeason) }]; seg.rx = 1; }
    // "Only motorcycles weekdays 07–19 … Other times vehicles may park" (Alströmergatan, owner mail 15 Oct): cars may park outside the reserved hours.
    else if (r.otherAllowed && !seg.o) { const o = outsideHours(r.reservedWindows); if (o) { seg.o = o; seg.rx = 1; } }
    // A ban in the same text (e.g. "Parkering är dock förbjuden fredag klockan 00.00 - 06.00") applies to everyone, reserved spot or not.
    if (r.bans.length && !seg.f) { seg.f = r.bans; seg.rx = 1; }
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
