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
  let t = body.replace(/Publicerat på webbplatsen Svensk trafikföreskriftssamling den \d{1,2} \S+ \d{4}/g, ' ') /* page footers inside sentences (QA: Linköping, Norrköping) */.replace(/­/g, '').replace(/(?<=[a-zåäö])-\n(?=[a-zåäö])/g, '') /* not "augusti -\njuni": a season's dash (QA 8 Nov: Solna lost 'augusti - juni') */.replace(/\s+/g, ' ').replace(/sönoch/g, 'sön- och').replace(/sön och helgdag/g, 'sön- och helgdag')
    .replace(/sön ?- ?och/g, 'sön- och').replace(/sön ?- ?helgdag/g, 'sön- och helgdag').replace(/(\d{1,2}):[ae]\b/g, '$1') // "sön - och helgdag", "sön - helgdag", "1:a december"
    .replace(/(\d{2}|[a-zåäö)])\s+(?=(?:Avgiften i \d+ § är|Med avvikelse från bestämmelserna i \d+ § får)\s)/g, '$1. ') /* a list ending without a full stop ran into the next sentence (QA 12 Nov round 18: Örnsköldsvik Lasarettsgatan drew the fee's 09–18 as an odd-date ban) */.replace(/\bMed avvikelse från bestämmelserna i \d+ § får/g, 'Får').replace(/\b(fordon) på (?:sträckan|platsen|sträckorna|platserna)\b/gi, '$1') // "Med avvikelse från bestämmelserna i 1 § får fordon på sträckan inte parkeras …"
    .replace(/,\s+(Gäller (?:endast|enbart) )/g, '. $1') /* "… högst 24 timmar i följd, Gäller endast buss." (Växjö) */.replace(/(\d\s*§)(?=[A-ZÅÄÖ])/g, '$1 ') /* "2 §Tillåtelsen" (QA 6 Nov: Örebro Fredsgatan) */.replace(/\bTillåtelsen (?:att parkera )?i \d+ § gäller/g, 'Tillåtelsen gäller').replace(/\bFörbudet i \d+ § gäller/g, 'Förbudet gäller')
    .replace(/\bmellan (?:den )?(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)) och (?:den )?(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december))/gi, '$1 - $2') /* season "mellan 1 maj och 30 september" (Tanum) */.replace(/\b(under (?:tiden|perioden)) (?:den )?(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)) och (?:den )?(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december))/gi, '$1 $2 - $3') /* "förbjuden under tiden 1:a november och 30:e april" (QA 11 Nov round 14: Örebro Hagagatan drew the winter ban all year) */.replace(/\bden (\d{1,2}) i (varje )?månaden/gi, 'den $1 dagen i $2månaden').replace(/\b(\d{1,2}) i (varje )?månaden/gi, '$1 dagen i $2månaden') /* "2:a i månaden" (Norrköping) */.replace(/sön\s*[–—-]\s*(?:och\s+)?helgdag/g, 'sön- och helgdag').replace(/\b(\d{1,2})\/(\d{1,2})\s*(?:[-–]|till(?: och med)?)\s*(\d{1,2})\/(\d{1,2})\b/g, (z, d1, m1, d2, m2) => (+m1 >= 1 && +m1 <= 12 && +m2 >= 1 && +m2 <= 12 ? `${+d1} ${MONTH_NAMES[+m1 - 1]} - ${+d2} ${MONTH_NAMES[+m2 - 1]}` : z)) /* "1/9- 30/12", "1/12 till 31/3" (QA 10 Nov: Vimmerby winter night bans drawn all year) */.replace(/(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)) till(?: och med)? (\d{1,2} )/gi, '$1 - $2');

  // Falun: "… får fordon, med avvikelse från <area ban>, parkeras … Villkoret gäller ej mellan datumen 15/12-30/4 Torsdagar kl 09:00-15:00":
  // the permission lapses then, so the underlying ban holds (QA 1 Nov). Only for a permission that deviates from another regulation.
  if (/får fordon,? med avvikelse från [^.]*?parkeras/i.test(t)) t = t.replace(/\.?\s*Villkoret gäller (?:ej|inte) mellan datumen (\d{1,2} [a-zåäö]+ - \d{1,2} [a-zåäö]+)\s+((?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?:ar)?)\s+(?:kl\.?|klockan)?\s*(\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2})/gi, (z, per, wd, tm) => `. Parkering är dock förbjuden ${wd.toLowerCase()} klockan ${tm} under tiden ${per}.`);
  const m = t.match(/följande\.?\s*(.*?)(?:Denna\s*(?:Publicerat på webbplatsen\s+)?författning|Dessa föreskrifter träder|Denna föreskrift träder|Dessa föreskrifter gäller|På [^.]{0,60}?vägnar|$)/i);
  if (m) return m[1].trim();
  // Old decision forms without the "föreskriver följande" preamble (Svedala "Föreskrift FÖRBUD ATT PARKERA FORDON § 1 På …
  // § 2 Förbudet gäller … Ikraftträdande", Nynäshamn "… trafikförordningen (1998:1276) 1 § På …"): the rules start at the first
  // paragraph that names a place (QA 12 Nov round 18: 170 Svedala texts were never read; Svetsaregatan kept the register's Saturday-only ban)
  const p = t.match(/(?:§\s*1|\b1\s*§)\s+((?:På|Inom)\s.*?)(?:Denna\s*föreskrift|Dessa föreskrifter träder|Dessa föreskrifter gäller|Ikraftträdande\s+\d|På [^.]{0,60}?vägnar|$)/);
  return p ? p[1].replace(/§\s*(\d{1,2})(?=\s+[A-ZÅÄÖ])/g, '$1 §').trim() : null;
}

const TIME = String.raw`(\d{1,2})(?:[.:](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[.:](\d{2}))?`;
const toMin = (h, m) => +h * 60 + (+m || 0);

function season(s) {
  s = s.replace(/\bsepember\b/gi, 'september'); s = s.replace(/\b(\d{1,2})\s*(jan|feb|apr|aug|sept?|okt|nov|dec)\.?(?![a-zåäö])/gi, (z, d, a) => `${d} ${{ jan: 'januari', feb: 'februari', apr: 'april', aug: 'augusti', sep: 'september', sept: 'september', okt: 'oktober', nov: 'november', dec: 'december' }[a.toLowerCase()]}`); // "1 sept – 1 juni" (QA 11 Nov round 14: Sollefteå Kyrkvägen)
  const all = [...s.matchAll(/(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/gi)]
    .map((r) => [[MONTHS[r[2].toLowerCase()], +r[1]], [MONTHS[r[4].toLowerCase()], +r[3]]]);
  if (!all.length) { // "under augusti - juni": whole months (QA: Solna)
    const mm = s.match(/\b(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*(?:[-–—]|till(?: och med)?)\s*(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b/i); // also "under perioden april till november" (Kungsbacka)
    if (!mm) return null; const m2 = MONTHS[mm[2].toLowerCase()];
    return [[MONTHS[mm[1].toLowerCase()], 1], [m2, [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m2 - 1]]];
  }
  // "1 april - 31 oktober samt under tiden 1 november - 31 mars": seasons that together cover the year are no season (Tyresö)
  if (all.length > 1) { const days = new Set(); for (const [[m1, d1], [m2, d2]] of all) { let m = m1, d = d1; for (let i = 0; i < 400; i++) { days.add(m * 100 + d); if (m === m2 && d === d2) break; d++; if (d > 31) { d = 1; m = m % 12 + 1; } } } if (days.size >= 366) return null; }
  return all[0];
}
// "vecka 42 - 18", "från vecka 42 till vecka 18": ISO weeks (wrapping over New Year), Rättvik
function weeks(s) { s = s.replace(/\bgon [VvOo]\b/g, 'gon'); /* "RT90 2.5 gon V 0:-15" is a coordinate system, not week 0 (QA 11 Nov round 14: Västervik) */ const one = s.match(/(?<![\wåäö])(?:v\.?|vecka)\s*(\d{1,2})\b(?!\s*[-–—:.]\s*\d)/i); if (one && (+one[1] < 1 || +one[1] > 53)) return null; if (one && !/(?:v\.?|vecka)\s*\d{1,2}\s*(?:[-–—]|till)/i.test(s)) return [+one[1], +one[1]]; // "v 30" (QA 8 Nov: Rättvik Classic Car Week)
  const r = s.match(/(?<!(?:udda|jämna?)\s)vecka\s+(\d{1,2})\s*(?:[-–—]|till(?: och med)?(?: vecka)?)\s*(?:vecka\s+)?(\d{1,2})\b/i); return r ? [+r[1], +r[2]] : null; } // not "jämn vecka 05-07": those are hours (QA 8 Nov: Karlstad Kungsgatan)
const PWD = '(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)';
const parity = (s) => (new RegExp(`udda (?:veck(?:a|or)|${PWD})`, 'i').test(s) ? 'odd' : new RegExp(`jämna? (?:veck(?:a|or)|${PWD})`, 'i').test(s) ? 'even' : null); // "jämn måndag" = Monday of even weeks (QA 10 Nov round 12: Örebro Södra Lindhult)

// Day-type phrase right before a "klockan" → day types (null = every day).
function dayTypesOf(s) {
  let x = s.toLowerCase().replace(/\b(vardag(?:ar)?),\s+(?=utom\b)/g, '$1 '); // "vardagar, utom vardag före …" in a days-only sentence (QA 26 Oct: Norrköping, Sollentuna read as Saturdays)
  x = x.replace(/^\s*(?:och|samt)\s+/, ''); // "…, och vardag före sön- och helgdag och sön- och helgdag kl 00-24": a leading "och" hid the list (QA 26 Oct: Vellinge dropped the Sunday ban)
  // several day types in one phrase: "vardag samt sön- och helgdag", "vardag utom dag före … och sön- och helgdag"
  let parts = x.split(/(?:\s*,|\s+samt|\s+och)\s+(?=(?:vardag|dag(?:ar)? före|sön- och helgdag|lördag))/);
  if (parts.length > 1 && !/vardag|dag(?:ar)? före|sön- och helgdag|lördag/.test(parts[0])) parts = parts.slice(1); // "får parkering ske, under högst 10 min i följd, vardag, vardag före … och sön- och helgdag" (QA 8 Nov: Degerfors)
  if (parts.length > 1) {
    const all = new Set(); let ok = true;
    for (const part of parts) { const d = dayTypesOf1(part); if (d === undefined) { ok = false; break; } if (d === null) return null; d.forEach((k) => all.add(k)); }
    if (ok && all.size) return ['vardag', 'fore', 'helgdag'].filter((k) => all.has(k));
  }
  return dayTypesOf1(x);
}
function dayTypesOf1(x) {
  if (/\butom (?:vardag(?:ar)? |dag(?:ar)? )?före sön- och helgdag/.test(x)) return ['vardag']; // "onsdagar utom vardag före sön- och helgdag" with the weekday taken out by windows(): Wednesdays that are ordinary weekdays (QA 8 Nov: Katrineholm read as Wednesdays before holidays)
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
  // "tisdag - onsdag mellan klockan 12.00 - 12.00": with the same start and end hour this can only be one span from the first day to the
  // second (QA 6 Nov: Gällivare cleaning bans read as zero-length windows); rewritten to the span form below
  clause = clause.replace(new RegExp(String.raw`\b${WD}\s*[-–—]\s*${WD}\s+(?:mellan\s+)?(?:(?:klockan|kl\.?)\s*)?(\d{1,2})[.:](\d{2})\s*[-–—]\s*(\d{1,2})[.:](\d{2})`, 'gi'), (z, d1, d2, h1, m1, h2, m2) => (+h1 === +h2 && m1 === m2 ? `mellan ${d1} klockan ${h1}.${m1} - ${d2} klockan ${h2}.${m2}` : z));
  // "mellan fredag klockan 22.00-söndag klockan 04.00": one span over several days, as a list of day windows (QA 3 Nov: Växjö Stortorget lost its weekend ban)
  clause = clause.replace(new RegExp(String.raw`(?:mellan\s+)?(?:från\s+)?\b${WD}\s+(?:klockan|kl\.?)\s*(\d{1,2})(?:[.:](\d{2}))?\s*(?:[-–—]|till|och)\s*${WD}\s+(?:klockan|kl\.?)\s*(\d{1,2})(?:[.:](\d{2}))?`, 'gi'), (z, d1, h1, m1, d2, h2, m2) => {
    const N = ['', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag', 'söndag'], a = WEEKDAYS[d1.toLowerCase()], b = WEEKDAYS[d2.toLowerCase()];
    if (!a || !b || a === b) return z; const parts = [`${N[a]} klockan ${h1}.${m1 || '00'} - 24.00`];
    for (let d = a % 7 + 1; d !== b; d = d % 7 + 1) parts.push(`${N[d]} klockan 00.00 - 24.00`);
    parts.push(`${N[b]} klockan 00.00 - ${h2}.${m2 || '00'}`); return parts.join(', ');
  });
  clause = clause.replace(/\b(vardag(?:ar)?),\s+(?=utom\b)/gi, '$1 '); // "vardagar, utom vardag före …": one day type, not a list (QA: Borås)
  clause = clause.replace(/\b(helgdag(?:ar)?),\s+(?=(?:mellan\s+)?(?:klockan|kl\b))/gi, '$1 '); // "vardagar, utom dag före sön- och helgdag, mellan klockan 07 och 16": the comma cut the day type off its hours
  clause = clause.replace(/\b(helgdag(?:ar)?|vardag(?:ar)?|måndag(?:ar)?|tisdag(?:ar)?|onsdag(?:ar)?|torsdag(?:ar)?|fredag(?:ar)?|lördag(?:ar)?|söndag(?:ar)?)\s+(?=\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})/gi, '$1 klockan '); // "… och vardag före sön- och helgdag 09.00 - 15.00" (no "klockan"; QA: Jönköping, Kalmar)
  clause = clause.replace(/([a-zåäö]),\s+(?=(?:vardag|dag(?:ar)? före|sön- och helgdag))/gi, '$1 och '); // "vardag utom …, vardag före … och sön- och helgdag klockan 8-22": one list of day types
  clause = clause.replace(/(klockan\s*\d{1,2}(?:[.:]\d{2})?\s*[-–—]\s*\d{1,2}(?:[.:]\d{2})?)\s*\(gäller ([^)]+)\)/gi, '$2 $1'); // "… 09.00 - 12.00 (gäller vardag utom …)"
  clause = clause.replace(/\b(klockan|kl\.?)\s*(\d{1,2}(?:[.:]\d{2})?)\s+till\s+(?:klockan\s+|kl\.?\s*)?(\d{1,2}(?:[.:]\d{2})?)(?![\d.:]*\s*(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b)/gi, '$1 $2 - $3'); // "klockan 7 till 9", "mellan klockan 08:00 till 18:00" (QA 2 Nov: Timrå, Kungsbacka, Haparanda, Gällivare)
  clause = clause.replace(/(mellan (?:klockan|kl\.?)\s*\d{1,2}(?:[.:]\d{2})?\s*och)\s*(?:klockan|kl\.?)\s*(?=\d)/gi, '$1 '); // "mellan kl. 08.00 och kl. 17.00" (Vingåker)
  clause = clause.replace(/mellan (klockan|kl\.?)\s*(\d{1,2}(?:[.:]\d{2})?)\s*och\s*(\d{1,2}(?:[.:]\d{2})?)/gi, '$1 $2 - $3'); // "mellan klockan 8 och 18"
  clause = clause.replace(/\bmellan (\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})/gi, 'klockan $1');
  clause = clause.replace(/\b(\d{1,2}[.:]\d{2})\s+till\s+(\d{1,2}[.:]\d{2})\b/gi, '$1 - $2').replace(/\b(vardag(?:ar)?)\s+(?=\d{1,2}[.:]\d{2}\s*[-–—])/gi, '$1 klockan '); // "vardagar 07.00 till 17.00" (QA 8 Nov: Ekerö read as all day)
  clause = clause.replace(/\b(vardag(?:ar)?)\s+(klockan\s+\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})\s+utom\s+((?:vardag |dag(?:ar)? )?före sön- och helgdag)/gi, '$1 utom $3 $2'); // the exception after the hours (Ekerö)
  clause = clause.replace(/\b((?:udda|jämna?) veck(?:a|or))\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})\b(?![.:]\d)/gi, (z, w, a, b) => (+a <= 24 && +b <= 24 ? `${w} klockan ${a}.00 - ${b}.00` : z)); // "Torsdagar jämn vecka 05-07" (QA 8 Nov: Karlstad)
  clause = clause.replace(/\bunder tiden (\d{1,2}[.:]\d{2}) och (\d{1,2}[.:]\d{2})\b/gi, 'klockan $1 - $2'); // "under tiden 09.00 och 18.00" (QA 8 Nov: Tanum) // "mellan 00:00 - 17:00" (Rättvik)
  clause = clause.replace(/\b(parkeras|stannas|förbjuden|tillåten)\s+(?=\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})/gi, '$1 klockan '); // "inte stannas eller parkeras 21.00 - 03.00" (Hudiksvall)
  clause = clause.replace(/(\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})\s+och\s+(?=\d{1,2}[.:]\d{2}\s*[-–—])/g, '$1 och klockan '); // "07.00 - 10.00 och 15.00 - 18.00"
  clause = clause.replace(/\b(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december),?\s+och\s+(?=\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})/gi, '$1 klockan '); // "under tiden 15 maj - 15 augusti och 08.00 - 18.00": the season's hours (QA 7 Nov: Tanum showed the limit all day)
  // time before day type ("Mellan klockan 8 och 22 vardagar utom vardag före … och mellan klockan 8 och 22 vardag före …", Kungsbacka):
  // move each day-type phrase in front of its hours
  // also right after a limit ("högst 4 timmar i följd mellan klockan 9-16, vardagar utom vardag före …", "… mellan klockan 8 och 18 vardagar utom … och mellan klockan 8 och 15 vardag före …"; QA 14 Nov round 25: Hudiksvall, Vellinge)
  const hoursFirst = /i följd,?\s+(?:under tiden\s+)?(?:mellan\s+)?(?:klockan|kl\.?)\s*\d/i.test(clause);
  if (hoursFirst || /^\s*(?:\d+\s*§\s*)?(?:(?:Föreskriften|Villkoret|Tidsbegränsningen|Förbudet|Tillåtelsen) gäller (?:under tiden )?(?:mellan )?)?(?:klockan|kl\.?)\s*\d/i.test(clause)) clause = clause.replace(new RegExp(String.raw`(?:klockan|kl\.?)\s*(${TIME})${hoursFirst ? ',?' : ''}\s+((?:vardag|dag(?:ar)? före|sön- och helgdag|lördag|söndag)[^,;]*?)(?=\s+och\s+(?:klockan|kl)|\s+gäller|\s*[.,;]|$)`, 'gi'), (z, tm, a1, a2, a3, a4, days) => `${days} klockan ${tm}`);
  const out = [];
  const re = new RegExp(String.raw`([^,;]*?)\b(?:klockan|kl\.?)\s*${TIME}`, 'gi');
  let m, lastDt;
  while ((m = re.exec(clause))) {
    const pre = m[1];
    let a = toMin(m[2], m[3]), b = toMin(m[4], m[5]); if (a === 1440) a = 0; // "24.00 - 08.00" starts at midnight (QA 8 Nov: Sölvesborg)
    if (b === 0) b = 1440;
    if (a === b) { a = 0; b = 1440; } // "klockan 06.00 - 06.00": round the clock, not a zero-length window (QA 9 Nov: Tyresö)
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
  if (wds) { const dtw = dayTypesOf(s.replace(new RegExp(String.raw`\b${WD}\b`, 'gi'), ' ')); return wds.length ? wds.map((w) => clean({ w, a: 0, b: 1440, dt: dtw ?? null })) : [{ a: 0, b: 1440 }]; } // "torsdagar utom dag före sön- och helgdag" (Skellefteå): the weekday and its day type, as windows() does
  const dt = dayTypesOf(s);
  return dt === undefined ? [] : [clean({ dt, a: 0, b: 1440 })];
}
const ALL_DAYS_RE = /alla dagar|dagligen|samtliga dagar|måndag(?:ar)?\s*(?:[-–—]|till|\s)\s*söndag(?:ar)?/gi; // "måndag söndag": the dash lost in the text (QA 8 Nov: Lysekil summer limit was dropped)
const DAY_WORD_RE = /\b(?:vardag|helgdag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|dag(?:ar)? före|klämdag)/i;
// True when the sentence names days or hours that the windows do not carry: the sentence was only half read.
function halfRead(s, ws) {
  if (/\b(?:varje|i) månad(?:en)?\b/i.test(s) && !ws.some((w) => w.dm || w.nw)) return true; // "måndag-fredag 08-12 den 15 varje månad": the day of the month was not read (QA 3 Nov: Ystad Dragaregatan)
  if (/\b(?:klockan|kl\.?)\s*\d/i.test(s) && !ws.length) return true;
  if (ws.length && ws.every((w) => w.a === 0 && w.b === 1440) && [...s.matchAll(/(?<![\d/.:])([01]?\d|2[0-4])(?:[.:](\d{2}))?\s*[-–]\s*([01]?\d|2[0-4])(?:[.:](\d{2}))?(?![\d/]|\s*(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|dygn|tim|min|m\b|meter))/gi)].some((r) => !(+r[1] === 0 && !+r[2] && +r[3] === 24))) return true; // "vardagar 8-18 på vardagar och 8-15 på lördagar": hours written without klockan were lost (QA 12 Nov round 18: Svedala Storgatan)
  const x = s.replace(ALL_DAYS_RE, ' ');
  if (DAY_WORD_RE.test(x) && !ws.some((w) => w.dt || w.w)) return true;
  if (/\bklämdag/i.test(x)) return true; // a bridge day is not a day type the data can carry
  const hasW = ws.some((w) => w.w), hasDt = ws.some((w) => w.dt);
  if (hasW && !hasDt && /\b(?:vardag|helgdag)/i.test(x)) return true; // "lördag, söndag och helgdag": the holidays were dropped
  if (hasDt && !hasW && new RegExp(String.raw`\b${WD}\b`, 'i').test(x)) return true;
  return false;
}
const NUM_WORDS = { en: 1, ett: 1, två: 2, tre: 3, fyra: 4, fem: 5, sex: 6, sju: 7, åtta: 8, nio: 9, tio: 10, tolv: 12, femton: 15, tjugo: 20, trettio: 30 };
function duration(s) {
  // "högst två timmar", "högst en timma", "högst sju (7) dygn": the number written as a word (QA 25 Oct: the limit was dropped)
  s = s.replace(/\b(högs?t|under)\s+(en|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|tolv|femton|tjugo|trettio)\s+(?:\((\d+)\)\s*)?(?=tim|min|dygn|dag)/gi, (_, h, w, d) => `${h.toLowerCase() === 'högt' ? 'högst' : h} ${d || NUM_WORDS[w.toLowerCase()]} `).replace(/\bhögst\s+(\d+)\s*\(\d+\)\s*(?=tim|min|dygn|dag)/gi, 'högst $1 ').replace(/\bhögt\s+(?=\d)/gi, 'högst ');
  s = s.replace(/\bhögst\s+(\d+)\s*\((tim\w*|min\w*|dygn)\)/gi, 'högst $1 $2') /* "högst 1 (timme) i följd" (Bollnäs) */.replace(/\b(parkeras|stannas eller parkeras) under (\d+)\s*(?=(?:tim\w*|min\w*|dygn)\s+i följd)/gi, '$1 under högst $2 '); // "får fordon parkeras under två timmar i följd" (Bollnäs Storgatan)
  const m = s.match(/högst\s+(\d+)\s*(tim(?:me|mar|ma|mar)?|timmar|min(?:uter)?|dygn|dag(?:ar)?|veck(?:a|or))\b/i) || s.match(/gäller (?:under )?(\d+)\s*(tim(?:me|mar)?|min(?:uter)?|dygn) i följd/i); // also "Tillåtelsen gäller 4 tim i följd" (Uppsala)
  if (!m) return null;
  const n = +m[1], u = m[2].toLowerCase();
  return u.startsWith('veck') ? n * 7 * 1440 : u.startsWith('dygn') || u.startsWith('dag') ? n * 1440 : u.startsWith('tim') ? n * 60 : n;
}

// Split into sentences, keeping "kl. 7" and "8 §" intact; paragraph numbers ("1 §") and "med avvikelse från …" asides are dropped.
function sentences(t) {
  t = t.replace(/(\d)§/g, '$1 §'); // "Tillåtelsen i 1§ gäller …": a glued paragraph sign hid the sentence's subject (QA 14 Nov round 25: Hudiksvall)
  t = t.replace(/,\s*med avvikelse från [^.,]*?trafikföreskrifter\s*\([^)]*\)([^.,]*?)\s(parkeras|stannas)\b/gi, (z, mid, v) => (/\b(?:inte|ej|får)\b/i.test(mid) ? z : ` ${v}`)) /* no comma after the clause: "får fordon, med avvikelse från … (0484 2016 : 211) om område med förbud att parkera parkeras under högst 3 tim" (QA 30 Oct: Eskilstuna) */;
  t = t.replace(/\b(får (?:fordon|motorfordon|motordrivet fordon|personbil(?:ar)?)(?: som används (?:av|för) [^.,;]{1,80}?)?) med avvikelse från ((?:[^.,;]|\.(?!\s+[A-ZÅÄÖ]|\s*$))*?(?:trafikföreskrifter|trafikförordningen|\(1998:1276\))(?:[^.,;]|\.(?!\s+[A-ZÅÄÖ]|\s*$))*?)\s(parkeras|stannas)\b/g, (z, f, mid, v) => (/\b(?:inte|ej|får)\b/i.test(mid) ? z : `${f} ${v}`)); // no commas around the clause: "får fordon med avvikelse från kommunens lokala trafikföreskrifter 1981 2004 : 0110 parkeras" (Sala, Åstorp, Alingsås, Mjölby)
  t = t.replace(/,?\s*med avvikelse från [^.]*?,\s*((?:inte |ej )?(?:stannas eller )?(?:parkeras|stannas))\b/gi, ' $1').replace(/\b(får (?:fordon|motorfordon|motordrivet fordon|personbil(?:ar)?)(?: som används (?:av|för) [^.,;]{1,80}?)?) med avvikelse från ((?:[^.,;]|\.(?!\s+[A-ZÅÄÖ]|\s*$))*?(?:trafikföreskrifter|trafikförordningen|\(1998:1276\))(?:[^.,;]|\.(?!\s+[A-ZÅÄÖ]|\s*$))*?)\s(parkeras|stannas)\b/g, (z, f, mid, v) => (/\b(?:inte|ej|får)\b/i.test(mid) ? z : `${f} ${v}`)) /* again, now the comma clause is gone: "får fordon med avvikelse från 3 kap. 53 § 2 trafikförordningen (1998:1276), med avvikelse från <area ban, list>, parkeras" (QA 10 Nov round 13: Kalmar Unionsgatan) */ /* the clause names a list of areas or regulations with commas (Kalmar; "…, 1780 2024:00346 om parkering på Norra Klaragatan, 1780 2024:00347 …, inte parkeras", QA 5 Nov: Karlstad) */.replace(/(^|\.\s+(?:\d{1,2}\s*§\s+)?)Med avvikelse från (?:bestämmelser(?:na)?|förbudet|tillåtelsen) i [^,.]{0,40}?,\s*(\p{Ll})/gu, (z, a, c) => `${a}${c.toUpperCase()}`) /* the clause opens the sentence: keep it a sentence of its own (Lerum: "3 § Med avvikelse från bestämmelserna i 1 §, får tung lastbil inte parkeras" swallowed the 4 h limit before it) */.replace(/,?\s*med avvikelse från [^,]*?,/gi, ' ').replace(/\b(får fordon) [^.,]{1,40}, (parkeras)/g, '$1 $2').replace(/\b(får fordon), (parkeras)\b/g, '$1 $2') /* stray comma: "får fordon, parkeras där stannande och parkering är förbjuden …" (QA 9 Nov round 10: Eskilstuna Gredbyvägen drawn as a total ban) */.replace(/\bTrots tillåtelsen i \d+ § får /g, 'Får ').replace(/\bTilllåtelsen\b/g, 'Tillåtelsen').replace(/\bFöbudet\b/g, 'Förbudet') /* typo (Skurup) */.replace(/\bsön- och heldag/g, 'sön- och helgdag') /* typo (Ängelholm) */.replace(/\b((?:klockan|kl\.?) [\d.:]+ (?:och|till|[-–]) [\d.:]+) på (?=vardag|dag före|sön- och helgdag|lördag|söndag)/g, '$1 ') /* "Mellan klockan 9 och 15 på vardagar före sön- och helgdag gäller dock tillåtelsen …" (QA 4 Nov: Ängelholm) */.replace(/\b(dag(?:ar)?) för (sön- och helgdag)/g, '$1 före $2') /* "utom dag för sön- och helgdag" (Kiruna) */.replace(/\binnom\b/g, 'inom').replace(/\b((?:klockan|kl\.?|och)\s*)([01]\d|2[0-4])([0-5]\d)\b(?![.:,]\d)/g, '$1$2.$3') /* "klockan 0800 och 1800" (Värmdö) */.replace(/\b(dag(?:ar)? före) söndag och helgdag/g, '$1 sön- och helgdag').replace(/\bTillåtelsen (?:att parkera )?i paragraf ?\d*\s*§? ?(?=gäller)/g, 'Tillåtelsen ').replace(/\bTillåtelsen att parkera (?:i|enligt) \d+\s*§?\s*(?=gäller)/g, 'Tillåtelsen ').replace(/\b((?:vardag|måndag|tisdag|onsdag|torsdag|fredag|lördag)(?:ar)?), utom ([^,.]*?helgdag(?:ar)?),\s+/g, '$1 utom $2 ') /* "vardagar, utom vardag före sön- och helgdag, mellan …" (Vellinge) */.replace(/personbil klass (?:I|1) (?:och|samt|eller) personbil klass (?:II|2)/gi, 'personbil') /* both classes = any car (Lysekil) */.replace(/(\s)-(?=(?:vardag|sön|lördag|dag|fredag|måndag|tisdag|onsdag|torsdag)\w*)/g, '$1') /* "-vardagar … och -vardag före …" list bullets */.replace(/\b([Ff]år) dock fordon\b/g, '$1 fordon').replace(/\b([Ff]år) ((?:på|inom|i) [^.,]{1,80}?) (fordon) (parkeras)\b/g, (z, f, pl, fo, pa) => (/\b(?:inte|ej|endast|enbart|klass|ton|lastbil|buss|tillstånd|rörelsehindrad\w*)\b/i.test(pl) ? z : `${f} ${fo} ${pa}`)).replace(/\b([Ff]år fordon) ((?:på|inom|i) [^.,]{1,100}?) (parkeras)\b/g, (z, f, pl, pa) => (/\b(?:inte|ej|endast|enbart|klass|ton|lastbil|buss|tillstånd|rörelsehindrad\w*|får)\b/i.test(pl) ? z : `${f} ${pa}`)) /* "får på markerade platser fordon parkeras", "får fordon på markerade platser inom slingan … parkeras" (QA 30 Oct: Bollnäs, Smedjebacken) */.replace(/\bvardag(ar)? dag före sön- och helgdag/g, 'vardag$1 före sön- och helgdag') /* "vardagar utom vardag dag före" (Bollnäs) */.replace(/\b(inte|ej) parkers\./g, '$1 parkeras.') /* typo (QA 6 Nov: Staffanstorp Hjärup) */.replace(/\bfår (?:endast )?(?:lätt lastbil(?:ar)? och personbil(?:ar)?|personbil(?:ar)? och lätt lastbil(?:ar)?) (?=parkeras)/g, 'får fordon ') /* "får lätt lastbil och personbil parkeras": ordinary vehicles (QA 6 Nov: Västerås Skerikesvägen) */.replace(/\s{2,}/g, ' ');
  t = t.replace(/\b(får fordon) (under tiden \d{1,2} [a-zåäö]+ ?[-–] ?\d{1,2} [a-zåäö]+) (parkeras)\b([^.]*)/g, '$1 $3$4 $2'); // "får fordon under tiden 1 oktober - 30 april parkeras mot avgift" (Sundsvall)
  // "personbil klass I" is an ordinary car: a permission for it (alone or listed with mopeds, motorcycles, A-tractors) is a permission
  // for cars, motorhomes excluded ("får moped, motorcykel, personbil klass I och traktor a parkeras", "får personbil klass I stannas eller
  // parkeras", "får enbart personbil klass 1 parkera"; QA 3 Nov: Sigtuna, Oxelösund, Vellinge, Orust)
  { const LV = String.raw`(?:moped(?:er)?(?: klass (?:I|1|II|2))?|motorcykel|motorcyklar|traktor a|a-traktor(?:er)?)`;
    t = t.replace(new RegExp(String.raw`\b([Ff]år)(?: (?:endast|enbart|bara))? (?:${LV},? (?:(?:och|samt|eller) )?)*personbil(?:ar)? klass (?:I|1)\b(?:(?:,|,? (?:och|samt|eller)) ${LV})*(?=,? (?:stannas|parkeras?)\b|,? (?:på|inom|i|under|mellan|med) )`, 'g'), '$1 fordon')
      .replace(/\bTillåtelsen gäller (?:endast |enbart )?(?:för )?personbil(?:ar)? klass (?:I|1)\.(?=\s|$)/g, 'Tillåtelsen gäller endast personbil.'); }
  t = t.replace(/\b((?:måndag|tisdag|onsdag|torsdag|fredag|lördag)(?:ar)?) som infaller (?:på )?vardag(?:ar)?\b/g, '$1 utom dag före sön- och helgdag'); // "torsdagar som infaller vardagar" (Skellefteå): the weekday when it is an ordinary weekday
  t = t.replace(/\bklocka(?=\s*\d)/g, 'klockan');
  t = t.replace(/(\d\d),? (och|samt) (sön- och helgdag(?:ar)?)(?=\s*(?:\.(?!\d)|$))/g, '$1 $2 $3 klockan 00.00 - 24.00'); // "… klockan 14.00 - 08.00 och sön- och helgdag.": a day type after the timed ones, with no hours of its own, is the whole day (QA 13 Nov round 20: Vänersborg Torget was free on Sundays) // "mellan klocka 08.00- 17.00": a typo for "klockan" (QA 13 Nov round 20: Gävle Ulvsätersvägen kept the register's limit at the wrong hours)
  t = t.replace(/\b(under tiden|gäller) (\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})\b/g, '$1 klockan $2'); // "Förbudet gäller under tiden 07:00 - 12:00": hours without "klockan"
  t = t.replace(/\b(\d):(?=\s+(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)en\b)/g, '$1'); // "den 1: måndagen i varje månad" (Kalmar)
  // "får fordon (inte) parkera": the active form, read as "parkeras" (QA 3 Nov: Leksand, Strömstad, Ekerö)
  t = t.replace(/\b([Ff]år (?:(?:inte|ej) )?(?:fordon|motorfordon|personbil(?:ar)?)(?: (?:inte|ej))?) parkera\b(?!s)/g, '$1 parkeras');
  // "… klockan 08.00 – 24.00 Under tisdag klockan 06.00 – 18.00 får fordon inte parkeras": a new sentence without its full stop (QA 3 Nov: Uppsala Svartmangatan lost the Tuesday ban)
  t = t.replace(/(\d)\s+(?=Under (?:tiden )?(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|vardag)(?:ar(?:na)?)?\b)/g, '$1. '); // also "… 06.00 - 00.00 Under tiden måndag - söndag klockan 00.00 - 06.00 får dock fordon inte parkeras" (Ludvika: read as a ban all day)
  t = t.replace(/\bmellan ([01]?\d|2[0-4])((?:[.:][0-5]\d)?) och ([01]?\d|2[0-4])((?:[.:][0-5]\d)?)(?=\s*(?:[.,;]|$))/g, 'mellan klockan $1$2 och $3$4'); // "vardag … mellan 08 och 18." without "klockan" (Lund): hours, not metres
  t = t.replace(/\b(dag|vardag(?:ar)?) (?:före|för) söndag(?:ar)? och helgdag(?:ar)?/gi, '$1 före sön- och helgdag').replace(/\b(vardag(?:ar)?) för (sön- och helgdag)/gi, '$1 före $2'); // "dag före söndag och helgdag" (Hallstahammar), "vardagar för sön- och helgdag" (Mullsjö): the usual day type, not a Sunday
  t = t.replace(/\b(Förbudet|Tidsbegränsningen|Tillåtelsen|Villkoret) gäller ((?:mellan )?klockan [^.]+?)\.\s*(?:\d+ §\s*)?\1 gäller ((?:under tiden )?(?:vardag|sön- och helgdag|dag före)[^.]*?)\./g, '$1 gäller $3 $2.'); // hours in one sentence, their days in the next ("Förbudet gäller mellan klockan 8 och 12. 3 § Förbudet gäller vardagar, utom …", QA 26 Oct: Katrineholm)
  t = t.replace(/\b((?:vardag|dag)(?:ar)?) före helgdag(?:ar)?\b/g, '$1 före sön- och helgdag').replace(/\b(före sön- och helgdag) (och|samt) helgdag(?:ar)?\b/g, '$1 $2 sön- och helgdag'); // "vardagar utom dag före helgdag kl 08-18 samt dag före helgdag kl 08-15" (Växjö): the usual day types, Saturday included
  t = t.replace(/\b(vardag(?:ar)?),?\s+dock (?:ej|inte)\s+(?=(?:vardag(?:ar)? |dag(?:ar)? )?före sön- och helgdag)/gi, '$1 utom '); // "vardagar, dock ej dag före sön- och helgdag" = "utom" (QA 26 Oct: Hagfors read as Saturdays)
  t = t.replace(/([^.;\s])\s+(?=Tillåtelsen ger inte rätt)/g, '$1. '); // the city text sometimes lacks the full stop before this sentence
  t = t.replace(/([a-zåäö)0-9])\.(?=[A-ZÅÄÖ][a-zåäö])/g, '$1. '); // "… i följd.Tillåtelsen", "… 14.00.Tillåtelsen": glued sentences
  t = t.replace(/([^.;\s])\s+(\d{1,2}\s*§\s+)(?=[A-ZÅÄÖ][a-zåäö])/g, '$1. $2');
  t = t.replace(/([^.;\s])\s+(?=(?:Parkering (?:är|får)|Förbudet (?:gäller|ger)|Tillåtelsen (?:att parkera )?(?:gäller|ger)|Tidsbegränsningen gäller|Avgiftsplikten gäller|Avgift ska betalas)\b)/g, '$1. '); // a rule sentence with no full stop before it ("… KF § 119/18 Parkering är dock förbjuden …", Skövde) // "… (1998:1276) 2 § Mellan klockan …": a new paragraph without a full stop before it (Kungsbacka)
  t = t.replace(/\bFörbuden i [\d\s§,och-]+§§? gäller\b/g, 'Förbudet gäller');
  t = t.replace(/\b(Förbudet|Tidsbegränsningen|Tillåtelsen) i (?:paragraf )?\d+ ?§ gäller (?=(?:under tiden )?(?:vardag|dag(?:ar)? före|sön- och helgdag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|mellan klockan|klockan|kl\.? ?\d))/g, '$1 gäller '); // "Tidsbegränsningen i 1 § gäller vardag utom … mellan klockan 08.00- 17.00": the hours of the rule in 1 § (QA 13 Nov round 20: Gävle Ulvsätersvägen) // "Förbuden i 2 § och 3 § gäller onsdagar …" (Norrtälje): the hours of the bans above
  t = t.replace(/(^|[.;]\s+)\d{1,2}\s*§\s+(?=[A-ZÅÄÖ])/g, '$1');
  t = t.replace(/(^|[.;]\s+)\d{1,2}\s*§\s+(?=\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b)/g, '$1Under tiden '); // "… gäller 31 juli - 1 maj. 4 § 1 maj - 31 juli gäller dock …": a paragraph opening with a date is a sentence of its own (QA 28 Oct: Sotenäs merged both seasons into none) // paragraph numbers "2 § Tidsbegränsningen …" (not "13 kap. 8 § trafikförordningen")
  t = t.replace(/\b(kv|ca|nr|resp|fast)\.(?=\s)/gi, '$1§DOT§'); // "parkeringsplats kv. Pilen": an abbreviation, not the end of a sentence
  return t.replace(/(\d)\.(\d)/g, '$1§DOT§$2').split(/(?<=[.;])\s+(?=[A-ZÅÄÖ])/).map((s) => s.replace(/§DOT§/g, '.').trim()).filter(Boolean);
}

const IGNORE = [
  /^(?:Personbil klass (?:II|2)|Släpfordon|Husvagn(?:ar)?)(?: och (?:släpfordon|personbil klass (?:II|2)|husvagn(?:ar)?))? får (?:inte|ej) parkeras\.?$/i, // motorhomes and trailers: no rule for cars (Tanum, Gotland)
  /^Avgiftsplikten gäller/i, /^Avgift ska betalas/i, /^(?:Parkeringsskiva|P-skiva)/i, /^Med (boende|fordon|.*avses)/i, /^med stöd av/i,
  /^Koordinatsystem/i, /^Föreskriften (?:skall|ska) utmärkas/i, /^Vägmärkesförordningen/i, /^Denna föreskrift ersätter/i, /^Föreskriften ersätter/i,
  /gäller inte (?:ambulans|lastbil|buss|taxi|utryckning|moped|cykel|motorcykel|fordon som används i (?:väg|gatu)arbete)/i,
  /^Stockholms kommun föreskriver/i, /trafikförordningen \(1998:1276\) följande/i, /^Publicerat/i, /^beslutade den/i,
  /^Uppställning av fordon sker/i, /^Tillåtelsen ger inte rätt/i, /^Föreskrifterna gäller/i, /^Bestämmelsen gäller/i, /^Detta gäller/i, /^Undantag(?![^.]*(?:klockan|kl\b|\d[.:]?\d* (?:och|-|–) \d|förbud))/i /* not "Undantag från §1 på vardagar … mellan klockan 02 och 04 då parkeringsförbud gäller": a ban (QA 12 Nov round 18: Nynäshamn) */,
  /^Förbudet ger inte rätt/i, /^Parkering (?:ska|skall) ske vinkelrätt|^Parkering sker vinkelrätt/i /* how to stand, no rule (Täby) */, /^För parkering på [^.]* ska avgift erläggas/i /* the fee's season; the fee itself is in the data (Vaxholm) */, /gäller (?:inte|ej) (?:på )?enskild väg/i, /^Tiden, avrundad/i, /anges med parkeringsskiva/i, /^Förbudet gäller alla fordon/i, /^Förbudet gäller om inte annat/i, /gäller inte fordon i linjetrafik/i,
  /^Förbudet gäller inte där parkering är tillåten enligt/i, /^Se /i, /^Övrig tid se parkering\.?$/i /* a pointer to the sign (QA 10 Nov: Vimmerby) */, /^Tillåtelsen gäller (?:endast )?på särskilt anordnade? parkeringsplats(?:er)?\.?$/i, /\bboendeparkering\b[^.]*(?:tillåte?n?|villkor|bestämmelser)/i, /^särskilda (?:villkor|bestämmelser)/i, /^förbudet gäller (?:inte|ej) fordon med (?:särskilt )?tillstånd/i, /^förbudet gäller (?:inte|ej) [^.]{0,40}\bpersonal(?:en|s)?\b/i, /^första (?:timmen|halvtimmen|(?:två|tre|fyra|\d+) timmarna) är avgiftsfria?/i /* free first hours: a fee detail, no rule (QA 13 Nov round 21: Huddinge Sjödalsvägen) */, /^förbuden i [^.]*ger (?:inte|ej) rätt/i, /^följande (?:gator|vägar) ingår/i, /^om inte annat föreskrivits/i, /^övrig tid får parkering ske utan/i, /^föreskriften träder i kraft/i, /^i området ingår även/i, /^förbudet gäller endast på allmänna platser/i, /^förbudet gäller (?:inte|ej) (?:på )?markerade platser/i, /^förbudet gäller (?:inte|ej) om annat/i, /^\S+ taxa\b[^.]*biljett/i, /^taxa\s*[-–]/i, /^vid parkering enligt \d+\s*§/i, /^\S+ kommuns lokala trafikföreskrifter om\b/i, /^tillåtelsen gäller endast personbil(?:ar)?\.?$/i, /^parkering (?:är )?endast tillåte[nt] för (?:fordon|personbil(?:ar)?) klass (?:I|1)\.?$/i, /^på parkeringsskiva/i, /^vid använ-?dande av parkeringsskiva får parkering ske\b/i /* rounding to the next half hour: no rule (QA 5 Nov: Lomma, Danderyd) */, /^samtliga koordinater/i, /^zon\.?$/i, /^förbudet gäller på (?:gatans|vägens) båda sidor/i, /^tillåtelsen gäller följande sidor\.?$/i, /^(?:med (?:hus)?nr\.? \d+\s*[-–]\s*\d+ gäller (?:\S+ )?\S*sidan?\.?\s*)+$/i /* which side by house number: placement only (QA 8 Nov round 7: Täby Åkerbyvägen lost its night ban) */, /^förbudet gäller (?:inte|ej) (?:för )?(?:skolskjuts|vid på- eller avlastning|vid av- och pålastning)/i, /^avvikelsen avser även/i, /^trf \(/i, /^allmänna lokala trafikföreskrifter\b/i, /^(?:röd|blå|grön|gul|vit|lila) taxa\.?$/i, /^förbudet gäller (?:endast )?(?:under )?skoldagar\.?$/i, /^boende(?:parkering)? zon \S+\.?$/i, /(?:inte|ej) parkeras annat än (?:på|inom) (?:särskilt )?(?:markerad|anordnad)/i, /^vid parkering ska(?:ll)? fordon uppställas/i, /^förbudet gäller (?:inte|ej) (?:inom|på) särskilt (?:anordnad|markerad)/i, /nämnden\b(?![^.]*(?:får|parkeras|gäller|förbjud))/i, /\btaxa\b[^.]*boendeparkering[^.]*gäller/i, /^Instruktioner på parkeringsmätare/i, /^villkor för boendeparkering gäller/i, /^tillåtelsen gäller endast (?:\w+ )?(?:särskilt )?(?:markerade|anvisade|uppmärkta) platser\.?$/i, /^camping är (?:inte|ej) tillåte[nt]/i, /^Digital registrering/i, /^Den första timmen/i, /^För parkering inom .* tas avgift/i,
  /årligen återkommande/i, /^(?:Författningen|Föreskriften|Denna författning) (?:ersätter|upphäver)/i, /^Denna föreskrift gäller ej där annat/i, /^Tillåtelsen (?:att parkera )?gäller dock mot avgift/i, /^Parkeringsregler för boendeparkering/i, /^Om förbud att parkera fordon är föreskriven viss tid på plats för boendeparkering/i, /^Tillåtelsen gäller även/i, /boendeparkeringskort|boendeparkeringstillstånd/i, /^Avgift(?:en)?\b/i, /behöver inte erläggas/i, /^Fordonet ska vara försett/i, /^Tillstånd(?:et)? /i,
  /^(?:Parkering|Uppställning) får (?:endast )?ske (?:i|på) (?:markerade|anvisade)/i, /ska ha (?:ett )?giltigt parkeringstillstånd/i,
  // where on the street a rule applies, not when (QA 29 Oct: Ystad, Eslöv, Strömstad, Visby texts stayed unread for these alone)
  /^Tillåtelsen (?:att parkera )?gäller (?:endast|enbart|bara) (?:på |inom )?(?:de )?(?:särskilt )?(?:markerade|anvisade|uppmärkta|anordnade) (?:parkerings)?(?:platser|platserna|rutor)\.?$/i,
  /^Parkering(?:en)? är (?:endast|enbart|bara) tillåten (?:på|inom) (?:de )?(?:särskilt )?(?:markerade|anvisade|uppmärkta|anordnade) (?:parkerings)?(?:platser|platserna|rutor)\.?$/i,
  /^Förbudet (?:att (?:parkera|stanna)\S* )?gäller (?:på )?båda sid(?:or|orna|an)\b(?![^.]*(?:klockan|kl\b|\d[.:]\d|vardag|helgdag|dag\b|tim|datum|januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|inte|ej|endast))/i,
  /^(?:Parkeringsplats(?:ernas|ens)|Plats(?:ernas|ens)) läge fram ?går av\b/i,
  /^Förbudet gäller (?:inte|ej) (?:parkering )?(?:på|inom) (?:de )?(?:särskilt )?(?:markerade|anvisade|uppmärkta|anordnade) (?:parkerings)?(?:platser|platserna|parkeringsfickor|parkeringsfickorna|rutor)\.?$/i, // the ban's own map lines leave out the bays (QA 1 Nov: Katrineholm, Motala)
  // which side of the street, by house number: where, not when ("Tillåtelsen gäller följande sidor: Vid husnr 271-291 avses västra sidan."; QA 13 Nov round 20: Täby Marknadsvägen stayed unread and lost its night ban)
  /^(?:Tillåtelsen|Förbudet|Tidsbegränsningen) (?:att parkera )?gäller följande sid(?:a|or)\s*[.:]?(?:\s*(?:Vid|Med) (?:hus)?(?:nr|nummer)\.? [\d\s,–-]+ (?:avses|gäller) (?:(?:norra|södra|östra|västra) sidan|hussidan)\.?)*$/i,
  /^(?:Vid|Med) (?:hus)?(?:nr|nummer)\.? [\d\s,–-]+ (?:avses|gäller) (?:(?:norra|södra|östra|västra) sidan|hussidan)\.?$/i,
  /^Vid parkering av (?:motorcykel|moped)[^.]*krävs (?:inte|ej) parkeringsskiva\.?$/i,
  /^Tillåtelsen (?:att parkera )?gäller (?:inte|ej) (?:på|för) (?:de )?(?:plats(?:er|en|erna)?|parkeringsplats(?:er|en|erna)?|rutor) (?:som är )?(?:reserverade?|avsedda?) för rörelsehindrade(?: med (?:särskilt )?(?:parkerings)?tillstånd)?\.?$/i, // the disabled bays inside the area have their own regulation (QA 2 Nov: Vellinge)
];

// → { taxa, reserved, purpose, allowOnly, limits, bans, otherAllowed, unread: [sentences we could not interpret] }
// Which special vehicle a "får endast …" / "gäller endast …" sentence reserves the curb for (null = ordinary cars).
const RESERVED = [[/rörelsehindrad|handikappad|parkeringstillstånd enligt 13 kap\.? ?8 §/, 'rörelsehindrade'], // the disabled-parking permit of 13 kap. 8 § trafikförordningen (QA 6 Nov: Örnsköldsvik, Falun, Hörby)
  [/beskickning/, 'beskickningsfordon'], [/motorcykel/, 'motorcykel'], [/moped/, 'moped'],
  [/buss/, 'buss'], [/utryckning/, 'utryckningsfordon'], [/lastbil/, 'lastbil'], [/taxi/, 'taxi'], [/elfordon|laddning|laddas externt|laddplats/, 'laddning'], [/cykel/, 'cykel'],
  [/personbil klass (?:ii|2)\b|husbil/, 'husbil'], [/med (?:tillkoppla[dt] )?(?:släp|husvagn)/, 'fordon med släp'], [/tjänstefordon/, 'tjänstefordon']]; // personbil klass II = motorhomes
function reservedFor(x) { for (const [re, v] of RESERVED) if (re.test(x)) return v; return null; }

// Ban windows minus allowed windows, per weekday (1–5 vardag, 6 fore, 7 helgdag). null when a window has conditions (season, parity,
// dates …) or nothing overlaps; 'grey' when an exception by day type (not a named weekday) cuts the ban. Pieces that change become weekday windows (a holiday on that weekday then shows the ban: the safe side).
const SIMPLE = (w) => Object.keys(w).every((k) => ['a', 'b', 'dt', 'w'].includes(k)) && w.a < w.b;
const DAYTYPE = (k) => (k <= 5 ? 'vardag' : k === 6 ? 'fore' : 'helgdag');
const onDay = (w, k) => (w.w ? w.w === k : w.dt ? w.dt.includes(DAYTYPE(k)) : true);
function subtractWindows(bans, allows) {
  if (!bans.length || !bans.every(SIMPLE) || !allows.every(SIMPLE)) return null;
  const out = []; let any = false;
  for (const b of bans) {
    const pieces = []; let changed = false;
    for (let k = 1; k <= 7; k++) {
      if (!onDay(b, k)) continue;
      let iv = [[b.a, b.b]];
      for (const w of allows) if (onDay(w, k)) { if (!w.w && w.a < b.b && w.b > b.a && !(b.dt && !b.w && w.dt && b.dt.every((d) => w.dt.includes(d)))) return 'grey'; /* an exception on the same day types as the ban ("får inte parkeras vardag utom … 07-19. Parkering är dock tillåten … onsdag 07-19 och vardag utom … 11-17") cuts it on exactly those days (QA 11 Nov round 14: Nacka Gamla Värmdövägen, Oxelvägen) */ iv = iv.flatMap(([a, z]) => (w.b <= a || w.a >= z ? [[a, z]] : [[a, Math.max(a, w.a)], [Math.min(z, w.b), z]].filter(([p, q]) => q > p))); }
      if (iv.length !== 1 || iv[0][0] !== b.a || iv[0][1] !== b.b) changed = true;
      for (const [a, z] of iv) pieces.push({ w: k, a, b: z });
    }
    if (changed) { any = true; out.push(...pieces); } else out.push(b);
  }
  return any ? out : null;
}

// "Första två timmarna är avgiftsfria med e-biljett", "Den första timmen är avgiftsfri": a discount on a fee, not free parking
// (QA 13 Nov round 21: Huddinge Sjödalsvägen showed the register's ban instead of fee parking; Nyköping, Mora)
export const FREE_FIRST_HOURS = /(?:\d+ §\s*)?(?:den )?första (?:timmen|halvtimmen|(?:två|tre|fyra|\d+) timmarna) är avgiftsfria?[^.]*/gi;
export function dropFreeFirstHours(t) { return t.replace(FREE_FIRST_HOURS, ''); }

export function parseRegulation(body) {
  const t = ruleText(body);
  let feeFromConditions = false, feeSeason = null, feeTaxaLetter = null, feeExplicit = false; // fee hours taken from "Villkoret gäller": a later explicit fee sentence replaces them
  const out = { taxa: null, feeWindows: null, reserved: false, reservedSeason: null, reservedWindows: [], purpose: [], allowOnly: [], limits: [], bans: [], dp: [], otherAllowed: null, unread: [] };
  if (!t) { out.unread.push('(no rule text)'); return out; }
  // A permission with hours ("Tillåtelsen gäller vardagar 09–18") only bans parking outside those hours when something else
  // bans it there (an area ban the text deviates from, or a ban in the text). Otherwise the general rules apply then.
  const banContext = /avvikelse från|trots förbudet|förbud att parkera|parkeringsförbud|(?:inte|ej) (?:stannas eller )?parkeras|parkering(?:en)? (?:är |råder )?förbjuden|övrig tid/i.test(body.replace(/(?:ger|ge) (?:inte|ej) rätt att[^.]*/gi, ''));
  let lastAllow = null, lastLimit = null, lastBan = null, lastDp = false, feeNext = false, permitSeason = null; let seasonFromBan = null; let anySeasonPermit = null; const tillWs = []; const limitAllow = [];
  const unread = (s) => out.unread.push(s);
  // A ban sentence with a season per window ("förbjuden under tiden 1 november - 30 april måndag 00-06 och 1 maj - 31 oktober
  // jämna veckor måndag 09-13", Örebro): one sentence per season, so each window keeps its own season and week parity
  const SEASON_START = /\s+och\s+(?=(?:under tiden\s+)?\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december))/i;
  let list = sentences(t).flatMap((s) => {
    if (!/förbjud|(?:inte|ej) (?:stannas eller )?parkeras/i.test(s) || [...s.matchAll(/\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/gi)].length < 2) return [s];
    let parts = s.split(SEASON_START);
    if (parts.length < 2) { // "… onsdag 07-13 under tiden 1 november - 30 april samt onsdag 07-10 under tiden 1 maj - 30 oktober" (QA 8 Nov: Botkyrka lost the summer ban)
      const q = s.split(/\s+(?:och|samt)\s+(?=(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?:ar)?\b)/i);
      if (q.length >= 2 && q.every((z) => /\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]/i.test(z) && /(?:klockan|kl\.?)\s*\d/i.test(z))) parts = q;
    }
    if (parts.length < 2) return [s];
    const head = (parts[0].match(/^.*?(?:förbjuden|(?:inte|ej) (?:stannas eller )?parkeras)/i) || [''])[0];
    return [parts[0], ...parts.slice(1).map((q) => `${head} ${q}`)];
  });
  // "Förbudet gäller torsdag klockan 07-24, fredag och lördag 00-24 och söndag 00-17.30 vecka 18 och vecka 40": the weeks at the end belong to
  // every part of the list, one ban per week (QA 11 Nov round 14: Rättvik Knihsgatan had the ban every week, Sunday in week 18 only)
  list = list.flatMap((s) => { const tail = s.match(/^(\s*(?:\d+\s*§\s*)?förbudet gäller\s+)(.*?(?:klockan|kl\.?)?\s*\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2})[\s,]+((?:(?:v\.?|vecka)\s*\d{1,2}(?:\s*(?:,|och|samt)\s*)?){2,})\.?\s*$/i);
    if (!tail || /(?:v\.?|vecka)\s*\d/i.test(tail[2]) || /[-–]\s*$|till\s*$/.test(tail[3])) return [s];
    const wks = [...tail[3].matchAll(/(?:v\.?|vecka)\s*(\d{1,2})/gi)].map((r) => r[1]);
    const parts = tail[2].split(/(?<=\d)\s*(?:,|\boch\b|\bsamt\b)\s*(?=(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?:ar)?\b)/i).filter(Boolean);
    return wks.flatMap((k) => parts.map((q) => `Förbudet gäller ${q} vecka ${k}.`)); });
  const weekCont = new Set(); // later parts of a week list split above: they add to the rule of the first part
  list = list.flatMap((s) => { const n = (s.match(/(?<![\wåäö])(?:v\.?|vecka)\s*\d{1,2}\b/gi) || []).length; const hd = s.match(/^\s*(?:\d+\s*§\s*)?(förbudet|tillåtelsen|tidsbegränsningen) gäller\s*/i); if (n < 2 || !hd) return [s];
    const H = hd[1][0].toUpperCase() + hd[1].slice(1).toLowerCase(); // also "Tillåtelsen gäller onsdag - söndag vecka 30, måndag - söndag vecka 31 …" (QA 11 Nov round 14: Rättvik Riksvägen limit only in week 30)
    const parts = s.slice(hd[0].length).split(/\s*(?:,|\boch\b|\bsamt\b)\s*(?=(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?:ar)?\b)/i).filter(Boolean);
    if (parts.length < 2) return [s]; const out2 = parts.map((q) => `${H} gäller ${q.replace(/\.$/, '')}.`); out2.slice(1).forEach((q) => weekCont.add(q)); return out2; }); // (QA 8 Nov: Rättvik Classic Car Week)
  for (let s of list) {
    s = s.replace(/\bunder tiden (\d{1,2}[.:]\d{2}) och (\d{1,2}[.:]\d{2})\b/gi, 'klockan $1 - $2').replace(/\bendast motordriv(?:et|na) fordon\b/gi, 'fordon').replace(/\bsamat\b/gi, 'samt').replace(/\bunder tider\b/gi, 'under tiden').replace(/^(\s*(?:\d+\s*§\s*)?)förbudet att parkera (på|under) /i, '$1parkering är förbjuden $2 ').replace(/\bunder tiden (?=\d{1,2}[.:]\d{2}\s*[-–—])/gi, 'klockan ') // typos and odd forms (QA 8 Nov: Bjuv)
      .replace(/^(\s*(?:\d+\s*§\s*)?)Parkering(?:en)? är (?:dock )?förbjuden övrig tid(?:en)?\.?$/i, '$1Övrig tid är parkering förbjuden.') // word order (QA 10 Nov round 13: Umeå Plangatan drew a ban around the clock over its 15 min bays)
      .replace(/\blördag(?:ar)? (?:och|samt) dag(?:ar)? före (?:sön- och )?helgdag(?:ar)?/gi, 'dag före sön- och helgdag').replace(/\bsöndag(?:ar)? (?:och|samt) helgdag(?:ar)?/gi, 'sön- och helgdag'); // Växjö: pinned to Saturday/Sunday only // "mot avgift under tiden 09.00 och 18.00" (QA 8 Nov: Tanum)
    // "2 § Gäller vardagar mellan kl.11.00-05.00, …": a bare "Gäller" refers to the rule just stated (QA 10 Nov round 12: Växjö Sandgärdsgatan, Klostergatan lost Saturday/Sunday bans)
    if (/^\s*(?:\d+\s*§\s*)?gäller\s+(?:vardag|dag(?:ar)? före|sön|lördag|söndag|måndag|tisdag|onsdag|torsdag|fredag|helgdag)/i.test(s)) {
      const head = lastBan && !lastLimit ? 'Förbudet' : lastLimit ? 'Tidsbegränsningen' : null;
      if (head) s = s.replace(/^(\s*(?:\d+\s*§\s*)?)gäller/i, `$1${head} gäller`);
    }
    // "Tillåtelsen gäller även personbil klass I under högst 2 timmar i följd mellan 16 augusti och 14 juni, …", "Tillåtelsen gäller även
    // 2 tim övriga året mellan …": a second limit period, not a vehicle list (QA 10 Nov round 12: Tanum Fjällbacka had no off-season limit)
    s = s.replace(/^(\s*(?:\d+\s*§\s*)?Tillåtelsen gäller) även (?:personbil(?:ar)?(?: klass (?:I|1))? |fordon )?(?:under )?(?:högst )?(\d+|en|ett|två|tre|fyra) (tim\w*|dygn)(?: övriga året)?/i, '$1 under högst $2 $3');
    let x = s.toLowerCase();
    // "får fordon inte (stannas eller) parkeras. Tidsbegränsningen gäller fredag klockan 06.00 - 14.00": the hours of that ban, worded as a
    // "time limit" (QA 4 Nov: Borlänge, Burlöv, Klippan, Aneby; the register showed the ban all day or not at all)
    if (/^tidsbegränsningen gäller\b/.test(x) && lastBan && lastBan.provisional && !lastLimit && !lastAllow && !out.limits.length) { s = s.replace(/^Tidsbegränsningen/i, 'Förbudet'); x = s.toLowerCase(); }
    if (!/\b(?:får|gäller|förbjud\w*|tillåt\w*|parker\w*|stann\w*|avgift\w*|högst|klockan|kl|reserver\w*|datum\w*)\b|\d{1,2}[.:]\d{2}/i.test(s)) continue; // a sentence with no rule word and no hours describes a place ("… Dalviksvägen 750m norr om Tackjärnsgränd, …", Nora)
    if (!/[a-zåäö]{3}/i.test(s)) continue; // stray punctuation (":.", ";") left by the PDF text
    if (/^uppställning av (?:släpfordon|släp(?:vagn(?:ar)?)?|husvagn(?:ar)?|(?:tung(?:a)? )?lastbil(?:ar)?|buss(?:ar)?)\b[^.]*förbjud/.test(x)) { out.heavyOnly = true; continue; } // "Uppställning av släpfordon förbjuden": trailers only, no rule for cars (Tanum Bygdegårdsplan showed a ban)
    if (/^fordon som (?:inte|ej) får parkeras,? får (?:inte|ej) hell(?:er|re) stannas?\b/.test(x)) continue; // boilerplate after a ban: no rule of its own, not a permission
    if (/(?:inte|ej) (?:stannas eller )?parkeras (?:annat än (?:på|inom)|utanför (?:de )?(?:särskilt )?(?:markerade|anvisade|anordnade|uppmärkta))/.test(x)) continue; // "Trots tillåtelsen i 1 § får fordon inte parkeras utanför markerade platser" (Norrköping): where to park, not a ban // "får fordon inte parkeras annat än på särskilt markerad uppställningsplats": where to park, not a ban (Östersund)
    if (/^på \d+ av (?:ovan nämnda |dessa |de |ovanstående )?(?:\d+ )?(?:markerade |ovan nämnda )?(?:platser|platserna|parkeringsplatser|parkeringsplatserna)\b/.test(x) && out.permitted) continue; // (QA 8 Nov: Svedala lot shown as disabled-only)
    if (/^förbudet (?:i (?:paragraf \d+|\d+\s*§) )?gäller endast (?:personbil klass (?:ii|2)|husbil(?:ar)?|släpfordon|lastbil(?:ar)?|buss(?:ar)?)/.test(x)) { if (lastBan) { out.bans = out.bans.filter((b) => !lastBan.items.includes(b)); lastBan = null; } continue; } // (QA 8 Nov: Sölvesborg night ban is for motorhomes)
    let m = season(s); const p = parity(s), wk = weeks(s);
    // "Förbudet gäller klockan 07.00 - 16.00 11 juni": a ban on one date, not every day (QA 11 Nov round 14: Strängnäs Bataljonsgatan showed the
    // ban all year); without a year it is read as that date every year (the safe side)
    if (!m && /^(?:\d+\s*§\s*)?förbudet gäller\b/.test(x) && !/^(?:\d+\s*§\s*)?förbudet gäller (?:inte|ej)\b/.test(x)) { const ds = [...x.matchAll(/(?<![\d.:])(\d{1,2}) (januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b/g)]; if (ds.length === 1 && !/\d{1,2}\s*[a-zåäö.]+\s*[-–—]\s*\d|\b\d{1,2}\s*(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|okt|nov|dec)\b\.?|\btill och med\b|\bfrån\b/.test(x)) m = [[MONTHS[ds[0][2]], +ds[0][1]], [MONTHS[ds[0][2]], +ds[0][1]]]; }
    const withSP = (w) => clean({ ...w, m, p, wk });
    // "får endast tung lastbil parkeras. Tidsbegränsningen gäller vardag utom … klockan 16.00 - 08.00, …": the hours the curb is kept for that
    // vehicle; at other times the general rules apply (QA 11 Nov round 14: Tyresö Radiovägen reserved around the clock). Not for disabled bays.
    if (/^(?:\d+\s*§\s*)?(?:tidsbegränsningen|tillåtelsen|reservationen) gäller (?:under tiden )?(?:vardag|dag(?:ar)? före|sön- och helgdag|lördag|söndag|måndag|tisdag|onsdag|torsdag|fredag|mellan|klockan|kl)/.test(x) && out.reserved && ['lastbil', 'buss', 'motorcykel', 'moped', 'husbil', 'fordon med släp'].includes(out.reservedFor) && !out.reservedWindows.length && !out.reservedSeason && !lastLimit && !lastBan && !out.limits.length && !out.bans.length && !duration(s) && !m && !p && !wk) {
      const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.reservedWindows.push(...ws); out.otherAllowed = true; continue; } }
    const tx = x.match(/taxa\s+(\d+)\b(?!\s*(?:kr|kronor|:-))/); // not "taxa 35 kronor per timme" (Båstad): that is a price
    if (tx && /avgift/.test(x)) { out.taxa = +tx[1]; }
    if (/mot avgift/.test(x)) feeNext = true;
    // "Avgift enligt Taxa Zon 2 under vardagar utom vardag före sön- och helgdag mellan klockan 09.00 - 18.00": the hours the fee is
    // charged, when the text gives them (the register's fee table may say all day; QA: Växjö)
    if (/^avgiftsplikten gäller (?:under tiden )?(?:vardag|dag(?:ar)? före|sön- och helgdag|lördag)[^.]*\.?$/.test(x) && !/(?:klockan|kl\.?)\s*\d/.test(x) && out.feeWindows && out.feeWindows.every((w) => !w.dt)) { const dt = dayTypesOf(s); if (dt) { out.feeWindows = out.feeWindows.map((w) => ({ ...w, dt })); continue; } } // "Avgiftsplikten gäller vardag utom …" after hours (QA 8 Nov: Sundbyberg)
    // "Avgiften är enligt Taxa 2, vardag utom vardag före sön- och helgdag, enligt bestämmelserna om …": the fee's days, no hours (QA 13 Nov round 22: Värnamo charged on weekends)
    if (/^avgift(?:en)? (?:är |tas ut )?enligt taxa \S+,? (?:under )?(?:vardag|dag(?:ar)? före|sön- och helgdag|lördag)/.test(x) && !/(?:klockan|kl\.?)\s*\d|\d{1,2}[.:]\d{2}/.test(x) && !out.feeWindows) { const dt = dayTypesOf(s.replace(/^.*?taxa \S+,?\s*/i, '').replace(/,?\s*enligt\b.*$/i, '')); if (dt && dt.length && dt.length < 3) { out.feeWindows = [{ a: 0, b: 1440, dt, daysOnly: true }]; continue; } }
    if (/^avgiftsplikten gäller även\b/.test(x) && out.feeWindows && /(?:klockan|kl\.?)\s*\d/.test(x)) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.feeWindows.push(...ws.map(withSP)); continue; } } // (QA 8 Nov: Gävle Redargatan had no Saturday fee)
    // also "Avgiftsplikt gäller", "Avgiftspliken" (QA 8 Nov: Nacka, Uppsala)
    if (/^(?:parkerings)?avgift(?:splikt(?:en)?|spliken|en)?\b/.test(x) && (/(?:klockan|kl\.?)\s*\d/.test(x) || /^avgiftsplikten gäller (?:under tiden )?(?:vardag|dag(?:ar)? före|sön- och helgdag|lördag|måndag|tisdag|onsdag|torsdag|fredag)[^.]*?\b\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}/.test(x))) { // also "Avgiftsplikten gäller vardagar 09.00 - 18.00 och …" without "klockan" (QA 11 Nov round 14: Visby Schweitzergränd charged around the clock)
      // "Avgift enligt taxa G … 08.00 - 18.00 … Avgift enligt taxa F på vardagar före sön- och helgdag … 18.00 - 22.00": a second taxa's sentence adds its hours (QA 10 Nov: Örebro had no fee on Saturday evenings)
      const txl = x.match(/^avgift enligt taxa (\S+)/); if (txl && feeTaxaLetter && txl[1] !== feeTaxaLetter && out.feeWindows && !feeFromConditions && !/taxa \S+ [^.]*och (?:enligt )?taxa/.test(x)) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.feeWindows.push(...ws.map(withSP)); continue; } }
      // "… parkeras under högst 4 tim i följd mot avgift under tiden <all days> 07.00 - 21.00 … Avgiftsplikten gäller under tiden vardag utom … 07.00 - 19.00 och vardag före … 11.00 - 17.00": the explicit fee sentence gives the fee hours, not the permission's (QA 13 Nov round 22: Nacka Tor Boijes gata charged on Sundays and evenings)
      const feeOwn = /^avgiftsplikten gäller (?!även\b)/.test(x) && !feeExplicit;
      if ((out.feeWindows && !feeFromConditions && !feeOwn) || /taxa \S+ [^.]*och (?:enligt )?taxa/.test(x)) continue; if (txl) feeTaxaLetter = txl[1]; const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.feeWindows = ws.map(withSP); feeFromConditions = false; if (/^avgiftsplikt/.test(x)) feeExplicit = true; } continue; } // the first sentence giving the fee's days and hours (it overrides hours taken from "Villkoret gäller", Sundsvall Sjögatan); "taxa C 08-18 och taxa E 18-24" splits the price, not the days
    // "Avgiftsplikten gäller (endast under perioden) 1 juni - 15 augusti": the fee's season; the fee hours may come before or after (QA 27 Oct: Trelleborg Smyge strandväg, Haninge showed the fee all year)
    if (/^avgiftsplikten (?:gäller|råder) (?:endast |enbart |bara )?(?:under (?:tiden|perioden) )?(?:den )?\d{1,2}\s*[a-zåäö]+\s*[-–—]/.test(x) && m && !windows(s).length && !p && !wk) { feeSeason = m; continue; }
    // "Mellan klockan 09.00 och 18.00 gäller dock tillåtelsen i 1 § högst 5 timmar i följd mot avgift eller högst en timma … parkeringsskiva" (Tanum):
    // a limit in those hours (the longer one: paying), and the fee then
    if (/^(?:(?:vardag|vardagar|sön- och helgdag(?:ar)?)[^.]*?)?(?:mellan )?(?:klockan|kl\.?)\s*\d.*?gäller (?:dock )?tillåtelsen/.test(x) && (duration(s) || /mot (?:att )?avgift/.test(x))) {
      let ws = windows(s).map(withSP);
      // "Mellan klockan 0 och 24 gäller dock tillåtelsen i 1 § högst 24 timmar i följd vardag, utom vardag före sön- och helgdag.": the day type
      // comes after the limit (QA 28 Oct: Sotenäs, about 60 segments unread)
      if (ws.length === 1 && !ws[0].dt && !ws[0].w && halfRead(s, ws)) { const dt = dayTypesOf(s.replace(/^.*?gäller (?:dock )?tillåtelsen/i, '')); if (dt && dt.length) ws = [clean({ ...ws[0], dt })]; }
      if (ws.length && !halfRead(s, ws)) { const d = duration(s.split(/\beller\b/)[0]); if (d) { const items = ws.map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items }; } if (/mot (?:att )?avgift/.test(x)) out.feeWindows = ws; continue; } // "mot att avgift erläggs eller högst 1 timme … parkeringsskiva": paying has no limit; only a limit stated for the paid option counts
    }
    // "Förbudet gäller under tiden jämna veckor." after a ban: the ban holds in those weeks only (QA 14 Nov round 23: Falun Zinkstigen was banned every week)
    if (/^förbudet (?:i (?:paragraf )?\d+ ?§? ?)?gäller (?:endast |enbart |bara )?(?:under tiden )?(?:jämna|udda) veckor\.?$/.test(x) && p && !m && !wk && !windows(s).length && lastBan && lastBan.items.length && lastBan.items.every((b) => !b.p && !b.wk && !b.dd)) { for (const b of lastBan.items) b.p = p; continue; }
    // "Tillåtelsen i paragraf 1 och villkoren i 2 § gäller 1 maj - 30 september": the season of the permission, its limits and fee
    // … and when the permission departs from an area ban ("Med avvikelse från … om förbud att parkera fordon i området Smögen får fordon parkeras …
    // 3 § Tillåtelsen i 1 § och villkoren i 2 § gäller mellan 1 september och 31 maj"), the area ban holds the rest of the year (QA 14 Nov round 23: Sotenäs Kyrkogatan was free in summer)
    if (/^tillåtelsen (?:i (?:paragraf )?\d+ ?§? ?)?(?:och villkoren (?:i [\d\s–-]+§§? )?)?gäller (?:under (?:tiden|perioden) )?(?:mellan )?(?:den )?\d/.test(x) && m && !windows(s).length && !p && !wk && !out.reserved && !seasonFromBan && !out.bans.length && /\bmed\s+avvikelse\s+från\s[^.]*?\b(?:om\s+)?(?:förbud\s+att\s+parkera|parkeringsförbud|förbud\s+mot\s+parkering)/i.test(body)) { seasonFromBan = m; if (!(out.limits.length || out.feeWindows)) continue; }
    if (/^tillåtelsen (?:i (?:paragraf )?\d+ ?§? ?)?(?:och villkoren (?:i [\d\s–-]+§§? )?)?gäller/.test(x) && m && !windows(s).length && (out.limits.length || out.feeWindows)) { for (const l of (/villkoren/.test(x) && lastLimit ? lastLimit.items : out.limits)) l.m = m; for (const w of out.feeWindows || []) w.m = m; continue; } // "villkoren i 3 §": the season of that paragraph's limit, not the 24 h rule in 2 § (Sotenäs)
    // "Tillåtelsen gäller inte personbil klass I": ordinary cars may not park there (Vellinge)
    if (/^tillåtelsen gäller (?:inte|ej) personbil(?: klass (?:i|1))?\.?$/.test(x)) { out.reserved = true; out.reservedFor = 'husbil'; continue; }
    // "Parkering är dock tillåten endast mot avgift 15 juni - 15 augusti mellan klockan 08.00 - 21.00": the fee's hours and season (QA: Motala)
    if (/endast mot avgift|mot avgift (?:under|mellan|klockan|\d|vardag|dag före|sön- och helgdag)|mot (?:att )?avgift (?:betalas|erläggs)/.test(x) && /(?:klockan|kl\.?)\s*\d/.test(x) && !out.feeWindows) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.feeWindows = ws.map(withSP); if (/^(?:mellan )?(?:klockan|kl\.?)\s*\d.*?gäller (?:dock )?tillåtelsen/.test(x)) continue; } } // "Mellan klockan 8 och 22 … gäller dock tillåtelsen … mot att avgift betalas eller högst 1 timme … parkeringsskiva": the fee hours (pay, or 1 h with a disc)
    if (/^(?:tillåtelsen|förbudet)(?: i (?:§\s*\d+|\d+\s*§|föreskriften|paragraf \d+|första stycket))? (?:ger|ge) (?:inte|ej) rätt/.test(x)) continue;
    if (/^(?:förbud(?:et|en)|tillåtelse(?:n|rna))(?: i [\d\s§,och-]+)?(?: (?:och|samt) (?:förbud(?:et|en)|tillåtelse(?:n|rna))(?: i [\d\s§,och-]+)?)* (?:ger|ge) (?:inte|ej) rätt|^föreskriften innebär (?:inte|ej) tillåtelse/.test(x)) continue; // "Förbudet i 1 § och tillåtelsen i 2 § ger inte rätt att stanna …" (Täby), "Föreskriften innebär inte tillåtelse att stanna där …" (Helsingborg): no rule
    if (/^(?:föreskriften|föreskrifterna|förbudet|tillåtelsen) gäller med avvikelse från (?:bestämmelserna i )?[^.]*?trafikföreskrifter[^.]*?\.?$/.test(x) && !/\d{1,2}[.:]\d{2}|klockan|vardag|helgdag|högst|inte|ej\b/.test(x.replace(/\([\d\s:]+\)/g, ''))) continue; // "Föreskriften gäller med avvikelse från bestämmelserna i … (2523 2010:001) om datumparkering …": which rules it departs from, no rule (QA 6 Nov: Gällivare)
    if (/^tillåtelsen (?:ger|ge) rätt att parkera (?:på ett sådant sätt|där det)/.test(x)) continue; // a permission that overrides a national ban, not a ban (QA 26 Oct: Hallsberg)
    x = x.replace(/,?\s*(?:tillåtelsen |förbudet )?(?:ger|ge) (?:inte|ej) rätt att (?:stanna|parkera)[^.]*/g, '').replace(/där det (?:enligt [^.]*?)?är förbjudet att stanna eller parkera[^.]*/g, '').replace(/där (?:stannande och |stannande eller )?parkering är förbjuden (?:enligt [^.]*)?/g, ''); // "… får fordon parkeras där stannande och parkering är förbjuden enligt 3 kap. 52 §" (Eskilstuna): a permission, not a ban // "… får parkeras där det är förbjudet …" is not a ban
    { // "får endast personbil och motorcykel (stannas eller) parkeras …" (Söderköping), "får endast personbilar och lastbilar parkeras" (Vaxholm), "endast personbil klass I, lätt lastbil, moped, motorcykel" (Sigtuna): a list that includes ordinary cars reserves nothing
      const lst = (x.match(/får endast (.*?)\s+(?:stannas eller |stannas|)parkeras/) || [])[1] || '';
      if (/(?:\bpersonbil(?:ar|er)? klass (?:i|1)\b|\bpersonbil(?:ar|er)?\b(?! klass))(?! med (?:tillkopplad )?(?:släp|husvagn))/.test(lst) && !/rörelsehindr|tillstånd|klass (?:ii|2)\b/.test(lst)) { x = x.replace(/får endast .*?\s+(?=(?:stannas eller |stannas|)parkeras)/, 'får fordon '); s = s.replace(/får endast .*?\s+(?=(?:stannas eller |stannas|)parkeras)/i, 'får fordon '); } }
    // "får fordon stannas eller parkeras under högst 3 tim i följd": a permission to stop or park, read like "får fordon parkeras" (Linköping, Söderköping)
    if (/får (?:fordon )?stannas (?:eller|och) parkeras/.test(x) && !/(?:inte|ej) stannas/.test(x)) { x = x.replace(/får (fordon )?stannas (?:eller|och) parkeras/g, 'får $1parkeras').replace(/  +/g, ' '); s = s.replace(/får (fordon )?stannas (?:eller|och) parkeras/gi, 'får $1parkeras'); }
    // Date parking ("udda datum … udda adressnummer"): one side is always allowed — dp windows, not a ban
    // "får fordon inte parkeras 00.00 - 08.00 jämna datum" on one stretch (no address sides): a ban on those dates (QA: Umeå, Gävle)
    if (/udda datum|jämn(?:a|t) datum/.test(x) && !/adressnummer|sida av (?:vägen|gatan)|udda[^.]*jämn|jämn[^.]*udda/.test(x)) { let ws = windows(s); if (halfRead(s, ws) && !ws.length) { unread(s); continue; } if (!ws.length) ws = [{ a: 0, b: 1440 }]; const dd = /udda datum/.test(x) ? 'odd' : 'even'; const items = ws.map((w) => ({ ...withSP(w), dd })); out.bans.push(...items); lastBan = { items, provisional: false }; continue; }
    // "Datumparkering gäller mellan kl 00.00 och kl 08.00.": date parking in those hours (QA 1 Nov: Kiruna)
    if (/^datumparkering gäller\b/.test(x)) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.dp.push(...ws.map(withSP)); lastDp = true; continue; } }
    if (/udda datum|jämn(?:a|t) datum/.test(x)) { let ws = windows(s); if (!ws.length) ws = [{ a: 0, b: 1440 }]; out.dp.push(...ws.map(withSP)); lastDp = true; continue; }
    if (/^förbudet (?:att (?:parkera|stanna)[^ ]* )?(?:i (?:första stycket|paragraf \d+|\d+\s*§) )?gäller/.test(x) && lastDp && !lastBan) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.dp = ws.map(withSP); continue; } }
    // "Parkering är dock förbjuden enligt … lokala trafikföreskrifter om datumparkering": a reference to another regulation
    if (/förbjud[^.]*enligt (?:bestämmelserna i )?[^.]*trafikföreskrifter/.test(x)) { if (/datumparkering/.test(x) && !out.dp.length) out.dp.push({ a: 0, b: 1440, ref: 1 }); continue; }
    if (/^tillåtelsen gäller även|boendeparkeringskort|boendeparkeringstillstånd/.test(x)) continue;
    if ((/\bboende\b[^.]*tillstånd|tillstånd[^.]*\bboende\b/.test(x)) && !/förbjud|(?:inte|ej) (?:stannas eller )?parkeras/.test(x.replace(/gäller (?:inte|ej) boende/, ''))) continue; // rules for residents with a permit ("Boende med särskilt tillstånd … högst 7 dygn", "Tidsbegränsningen gäller inte boende …"): not for visitors, and no resident permits outside the big three (QA: Kalmar, Hallsberg) // resident permits are out of scope outside the big three
    if (/ändamålsplats/.test(x)) { out.purpose.push(...windows(s).map(withSP)); continue; }
    if (/^övrig tid får endast/.test(x) && reservedFor(x) && lastAllow) { out.otherAllowed = false; out.allowOnly.push(...lastAllow.filter((w) => !out.allowOnly.includes(w))); continue; } // "Övrig tid får endast tung lastbil parkeras"
    if (/vändplats med förbud att (?:stanna och |stanna eller )?parkera/.test(x)) { const items = [{ a: 0, b: 1440 }]; out.bans.push(...items); lastBan = { items, provisional: true }; continue; }
    // "motorcyk(?:lar|el)" below: the old "motorcykl(?:ar|el)" never matched "motorcykel" (QA 9 Nov: Uppsala S:t Persgatan MC bay was open to all cars)
    // "Övrig tid får motorcykel parkeras" after a motorcycle bay: the bay's other hours, still for motorcycles
    if (/^övrig tid får (?:motorcyk(?:lar|el)|moped(?:er)?) parkeras\.?$/.test(x) && out.reserved && (out.reservedFor === 'motorcykel' || out.reservedFor === 'moped')) { out.reservedWindows = []; continue; }
    // also "får beskickningsfordon parkeras" without "endast": a diplomatic bay; a limit after it is the bay's (QA 4 Nov: Sigtuna showed a 3 h limit for all cars)
    if (/^(?:på|inom|i|från) [^.]*? får (?:taxi|beskickningsfordon|(?:motordrivet fordon|motorfordon|personbil(?:ar)?|bil(?:ar)?) med (?:tillkoppla[dt] )?(?:släpfordon|släpvagn|släp|husvagn)|buss(?:ar)?|(?:tung |tungt )?(?:lastbil(?:ar)?|släpfordon)(?: och (?:tung |tungt )?(?:lastbil(?:ar)?|släpfordon))?|motorcyk(?:lar|el)|moped(?:er)?) parkeras/.test(x) && !/(?:inte|ej) parkeras|får (?:inte|ej)/.test(x)) { out.reserved = true; out.reservedFor = reservedFor(x); if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    // "… enligt markering i kartbild ska vara laddplats": a charging bay, for cars being charged only (QA 8 Nov round 7: Helsingborg, Växjö, Kalmar, Trollhättan showed them open to all cars)
    // "På laddplatsen får fordon som kan laddas externt med elektrisk energi … parkeras", with or without "endast": only cars being charged
    if (/\bfår (?:endast )?(?:fordon|personbil(?:ar)?|elfordon) som (?:kan )?laddas externt\b/.test(x) && /parkeras/.test(x) && !/\b(?:inte|ej) parkeras|får (?:inte|ej)\b/.test(x)) { out.reserved = true; out.reservedFor = 'laddning'; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    // after a charging bay: "Tillåtelsen … gäller parkering enbart under den tid som laddning pågår", "Parkering är endast tillåten vid laddning av elfordon": the bay's own terms
    if (out.reservedFor === 'laddning' && /\bladdning\b/.test(x) && !/\b(?:inte|ej)\b/.test(x) && !/(?:klockan|kl\.?)\s*\d/.test(x)) continue;
    if (/\b(?:ska|skall) vara (?:en )?laddplats(?:er)?\b/.test(x) && !/\b(?:inte|ej)\b/.test(x)) { out.reserved = true; out.reservedFor = 'laddning'; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    // "får personbil klass II parkeras …": a motorhome spot, whether or not it says "endast"
    if (/personbil klass (?:ii|2)\b/.test(x) && /parkeras/.test(x) && !/får (?:inte|ej)\b|inte parkeras/.test(x) && !/personbil klass (?:i|1)\b/.test(x)) { out.reserved = true; out.reservedFor = 'husbil'; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    // "får fordon som används av rörelsehindrade med särskilt tillstånd parkeras (under högst 2 tim …)" without "endast": a disabled bay; the text
    // gives other cars no permission, so it is reserved at all hours and its limits are for the disabled (QA 31 Oct: Ronneby showed a 2 h limit for all cars)
    if (/^(?!övrig tid).*?\bfår fordon som används (?:av|för) (?:befordran av )?rörelsehindrade?\b[^.]*\bparkeras\b/.test(x) && !/(?:inte|ej) (?:stannas eller )?parkeras|får (?:inte|ej)\b|\bendast\b/.test(x) && !out.permitted && !out.limits.length && !out.bans.length && !out.reserved) {
      if (m) { unread(s); continue; }
      out.reserved = true; out.reservedFor = 'rörelsehindrade'; continue;
    }
    if (/^övrig tid får fordon som används (?:av|för) (?:befordran av )?rörelsehindrade?\b[^.]*\bparkeras\b/.test(x) && out.reservedFor === 'rörelsehindrade' && !/(?:inte|ej) parkeras/.test(x)) continue; // the bay's other hours, still for the disabled
    // "får inte andra fordon parkeras än sådana som används för befordran av rörelsehindrade med särskilt tillstånd": a reserved bay, not a ban
    // for everyone (QA 2 Nov: Nynäshamn); an unnamed group ("servicefordon till kvarteret") stays a ban
    { const ao = x.match(/får (?:inte|ej) andra fordon (?:parkeras |stannas |stannas eller parkeras )?än (.*)$/); const who = ao && reservedFor(ao[1]);
      if (who) { out.reserved = true; out.reservedFor = who; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; } }
    // "får fordon endast parkeras med stöd av parkeringstillstånd enligt 13 kap. 8 §": a disabled bay (QA 6 Nov: Örnsköldsvik Läroverksgatan showed a 3 h limit for all cars)
    if (/\bfår fordon endast parkeras med stöd av (?:särskilt )?parkeringstillstånd enligt 13 kap\.? ?8 §/.test(x)) { x = x.replace(/\bfår fordon endast parkeras/, 'får endast fordon parkeras'); s = s.replace(/\bfår fordon endast parkeras/i, 'får endast fordon parkeras'); }
    if (/får endast\b/.test(x) && /parkeras|stannas|får endast [^.]*?\b(?:stanna|parkera)\b/.test(x)) { // also the infinitive: "får endast bussar stanna eller parkera i högst 15 minuter" (QA 10 Nov round 13: Kiruna Malmvägen showed 15 min for all cars)
      const who = reservedFor(x);
      if (who) { out.reserved = true; out.reservedFor = who; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; } // the hours stated here are the hours it is reserved ("…parkeras mot avgift vardagar 07.00 - 19.00")
      // "får endast personbil parkeras …": ordinary cars may park; read the rest of the sentence as usual
      x = x.replace(/får endast (?:personbil(?:ar)?(?: klass (?:i|1)\b)?|fordon)\s*/, 'får fordon '); s = s.replace(/får endast (?:personbil(?:ar)?(?: klass (?:I|1)\b)?|fordon)\s*/i, 'får fordon ');
    }
    if (/^övrig(?:a)? (?:del(?:en)? av året|tid(?:en)? av året) (?:gäller|råder|är det) (?:parkeringsförbud|förbud att parkera|förbjudet att parkera)/.test(x)) { // "… högst 24 tim i följd under tiden 1 juli – 30 september. Övrig del av året gäller parkeringsförbud." (QA 9 Nov: Kiruna read as an all-year ban)
      const ms = lastLimit && lastLimit.items.length && lastLimit.items.every((w) => w.m && JSON.stringify(w.m) === JSON.stringify(lastLimit.items[0].m)) ? lastLimit.items[0].m : !lastLimit ? permitSeason : null;
      if (ms && !windows(s).length) { const items = [{ a: 0, b: 1440, m: complement(ms) }]; out.bans.push(...items); lastBan = { items, provisional: false }; continue; }
      unread(s); continue;
    }
    if (/^övrig tid (?:får (?:fordon inte|inte fordon) parkeras|(?:är |råder )?parkering(?:en)? förbjuden|är det förbjudet att (?:stanna (?:eller|och) )?parkera|(?:(?:råder|gäller) )?parkeringsförbud|gäller förbud (?:att|mot att) parkera|får fordon (?:inte|ej) stannas)/.test(x)) { // also "Övrig tid gäller parkeringsförbud" (Ekerö, Nynäshamn), bare "Övrig tid parkeringsförbud." (QA 9 Nov: Danderyd), "Övrig tid gäller förbud mot att parkera fordon" (Eskilstuna) // outside the stated hours: not allowed
      if (!lastAllow && lastBan && !lastBan.items.some((b) => b.w || b.m || b.p || b.dm || b.nw || b.dd)) { const o = outsideHours(lastBan.items); if (o && o.length) { out.bans.push(...o); continue; } } // a stopping ban at set hours, "Övrig tid får fordon inte parkeras" (Huddinge): no parking at other times either
      // after a time-limited permission with set hours and no "Tillåtelsen gäller …" ("… högst 1 tim i följd. Tidsbegränsningen gäller vardag …
      // 10.00 - 14.00. Övrig tid får fordon inte parkeras."): no parking outside the limit's hours (QA 30 Oct: Danderyd, Täby showed free parking)
      if (!lastAllow && lastLimit && !lastLimit.items.some((w) => w.w || w.m || w.p || w.wk || w.dm || w.nw || w.dd || !(w.a < w.b))) { const o = outsideHours(lastLimit.items); if (o && o.length) { out.bans.push(...o); lastBan = { items: o, provisional: false }; continue; } }
      // "… får endast personbil klass II parkeras mellan klockan 09.00 - 20.00. Övrig tid får fordon inte parkeras." (Halmstad): banned outside the reserved hours
      if (!lastAllow && !lastLimit && out.reserved && out.reservedWindows.length && !out.reservedWindows.some((w) => w.w || w.m || w.p || w.wk || w.dm || w.nw || w.dd || !(w.a < w.b))) { const o = outsideHours(out.reservedWindows); if (o && o.length) { out.bans.push(...o); lastBan = { items: o, provisional: false }; continue; } }
      if (!lastAllow && !lastLimit && permitSeason && !windows(s).length) { const items = [{ a: 0, b: 1440, m: complement(permitSeason) }]; out.bans.push(...items); lastBan = { items, provisional: false }; continue; } // "… parkeras 15 april – 15 oktober. Övrig tid får fordon inte parkeras": banned the rest of the year (Knivsta, Karlskoga)
      if (!lastAllow) { unread(s); continue; }
      out.otherAllowed = false; out.allowOnly.push(...lastAllow.filter((w) => !out.allowOnly.includes(w))); continue;
    }
    if (/^övrig tid (?:fri parkering|får (?:fordon|personbil(?:ar)?(?! klass (?:ii|2)\b)) (?:stannas eller )?parkeras|är parkering tillåten\b)/.test(x)) { // also "Övrig tid får personbil parkeras" after a klass I permission (QA 12 Nov round 17: Helsingborg Palmqvistgatan) // also "Övrig tid är parkering tillåten under högst 5 minuter i följd" (QA 9 Nov: Uppsala S:t Johannesgatan, Ronneby) // "…other times vehicles may park": the permission hours are not the only hours
      out.otherAllowed = true; out.allowOnly = out.allowOnly.filter((w) => !tillWs.includes(w));
      if (/mot avgift/.test(x) && lastLimit && !out.feeWindows) {
        let items = lastLimit.items; const ws5 = new Set(items.map((w) => w.w)); // "måndag - fredag 07-17" was expanded per weekday: Mon–Fri is the vardag day type
        if (items.every((w) => w.w >= 1 && w.w <= 5 && w.a === items[0].a && w.b === items[0].b && !w.m && !w.p) && ws5.size === 5) items = [{ dt: ['vardag'], a: items[0].a, b: items[0].b }];
        const o = outsideHours(items); if (o && o.length) out.feeWindows = o.map(withSP);
      } // "Övrig tid får fordon parkeras mot avgift": the fee only outside the limit's hours (QA 8 Nov: Solna Ankdammsgatan charged around the clock)
      const d = duration(s);
      if (d) { // "Övrig tid får fordon parkeras under högst 4 tim i följd": a limit in the hours outside the limit just stated
        let o = lastLimit ? outsideHours(lastLimit.items) : null;
        // "Tillåtelsen gäller under tiden vardag … 18.00 – 07.00 … Övrig tid är parkering tillåten under högst 5 minuter i följd": the limit holds outside the permission's hours (QA 9 Nov: Uppsala S:t Johannesgatan)
        if (!lastLimit && lastAllow && tillWs.length && lastAllow.every((w) => tillWs.includes(w) && !w.w && !w.m && !w.p && !w.wk && !w.dm && !w.nw && !w.dd)) o = outsideHours(lastAllow);
        // a limit in a season ("… högst 20 min i följd. Tidsbegränsningen gäller under tiden 15 augusti - 15 juni. Övrig tid får fordon parkeras
        // under högst 2 timmar i följd."): other hours of that season, and the whole rest of the year (QA 29 Oct: Kil, Hjo, Ljusdal, Tranemo)
        const sm = lastLimit && lastLimit.items[0].m;
        if (!o && sm && lastLimit.items.every((w) => JSON.stringify(w.m) === JSON.stringify(sm) && !w.w && !w.p && !w.wk && !w.dm && !w.nw && !w.dd) && !windows(s).length && !/vardag|helgdag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag/.test(x)) {
          const inSeason = outsideHours(lastLimit.items.map(({ m: _m, ...w }) => w)) || [];
          o = [...inSeason.map((w) => ({ ...w, m: sm })), { a: 0, b: 1440, m: complement(sm) }];
        }
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
        // "Förbudet gäller inte (fordon) (under tiden) 1 juni - 30 september": the ban just stated applies the rest of the year (QA 27 Oct: Skellefteå showed it only in summer)
        if (lastBan && m && !windows(s).length && !p && !wk && /^(?:fordon )?(?:under (?:tiden|perioden) )?(?:mellan )?(?:den )?\d{1,2}\s*[a-zåäö]+\s*[-–—]\s*(?:den )?\d{1,2}\s*[a-zåäö]+\.*$/.test(ex) && lastBan.items.every((b) => !b.m)) { const mm = complement(m); for (const b of lastBan.items) b.m = mm; continue; }
        unread(s); continue;
      }
      // "Förbudet gäller endast (fordon) vardagar" after a ban with its own hours: the days of that ban, not a new all-day ban (QA 27 Oct: Skellefteå)
      if (lastBan && !lastBan.provisional && /^förbudet gäller (?:endast|enbart|bara) (?:fordon )?(?:under )?(?:vardag|vardagar|helgfri)[^.]*$/.test(x.replace(/\.$/, '')) && !windows(s).length) {
        const d = dayOnlyWindows(s); if (d.length === 1 && d[0].dt && !d[0].w) { for (const b of lastBan.items) b.dt = (b.dt || ['vardag', 'fore', 'helgdag']).filter((k) => d[0].dt.includes(k)); continue; }
      }
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s);
      if (!ws.length && m) { // "Förbudet gäller 1 december - 31 mars": the season of the ban just stated, or a whole-season ban
        if (lastBan) { for (const b of lastBan.items) { b.m = m; if (p) b.p = p; } continue; }
        ws = [{ a: 0, b: 1440 }];
      }
      // "får fordon inte parkeras under udda datum. Förbudet gäller endast under perioden 1 oktober till 31 maj mellan kl. 00.00-07.00": the
      // hours and season of that date-parity ban, not a second ban every night (QA 12 Nov round 17: Östersund Torgbrinken)
      if (lastBan && !lastBan.provisional && /^förbudet gäller (?:endast|enbart|bara)\b/.test(x) && ws.length && ws.every((w) => !w.w && !w.dt && !w.nw && !w.dm && !w.dd && !w.p) && !DAY_WORD_RE.test(s.replace(ALL_DAYS_RE, ' ')) && lastBan.items.length && lastBan.items.every((b) => b.dd && b.a === 0 && b.b === 1440 && !b.w && !b.dt && !b.m)) {
        const items = lastBan.items.flatMap((b) => ws.map((w) => clean({ ...w, dd: b.dd, ...(m && !w.m ? { m } : {}) }))); out.bans = out.bans.filter((b) => !lastBan.items.includes(b)); out.bans.push(...items); lastBan = { items, provisional: false }; continue;
      }
      // "får fordon inte parkeras torsdagar. Förbudet gäller klockan 07.00 - 12.00": the hours of the weekday ban just stated, not a second ban every day (Skellefteå)
      if (lastBan && ws.length && ws.every((w) => !w.w && !w.dt && !w.nw && !w.dm) && !(wk && lastBan.items.some((b) => JSON.stringify(b.wk) !== JSON.stringify(wk))) /* "Förbudet gäller måndag - söndag v 31" after "onsdag - söndag v 30": its own week, not the hours of the last ban (QA 10 Nov round 13: Rättvik Pilgatan) */ && !DAY_WORD_RE.test(s.replace(ALL_DAYS_RE, ' ')) && lastBan.items.every((b) => b.a === 0 && b.b === 1440 && (b.w || b.dt))) {
        const items = lastBan.items.flatMap((b) => ws.map((w) => clean({ ...b, a: w.a, b: w.b }))); out.bans = out.bans.filter((b) => !lastBan.items.includes(b)); out.bans.push(...items); lastBan = { items, provisional: false }; continue;
      }
      if (ws.length && !halfRead(s, ws)) {
        if (lastBan && lastBan.provisional) out.bans = out.bans.filter((b) => !lastBan.items.includes(b));
        // "får fordon inte stannas eller parkeras under tiden 13 oktober - 8 december. Förbudet gäller … vardagar … 15.00 - 20.00": the hours
        // of that seasonal ban, within its season (QA 11 Nov round 14: Sundbyberg Oskarsvägen)
        const sb = lastBan && !lastBan.provisional && lastBan.items.length === 1 && lastBan.items[0].m && Object.keys(lastBan.items[0]).every((k) => ['a', 'b', 'm'].includes(k)) && lastBan.items[0].a === 0 && lastBan.items[0].b === 1440 && !m && !p && !wk ? lastBan.items[0] : null;
        if (sb) { out.bans = out.bans.filter((b) => b !== sb); const items = ws.map((w) => clean({ ...w, m: sb.m })); out.bans.push(...items); lastBan = { items, provisional: false }; continue; }
        const items = ws.map(withSP); out.bans.push(...items); lastBan = { items, provisional: false }; continue;
      }
      unread(s); continue;
    }
    // "får motorredskap, traktor, tung lastbil, personbil klass II och tung buss inte parkeras": heavy vehicles only, no rule for cars
    if (/får (?:(?:motorredskap|traktor|tung lastbil|lastbil|tung buss|buss|personbil klass (?:ii|2)|släpfordon|släpvagn|fordonståg)[^.]*?)(?:inte|ej) (?:heller )?(?:stannas eller )?parkeras/.test(x) && !/\bfordon (?:inte|ej)|får (?:inte|ej) fordon|personbil(?! klass (?:ii|2))|bruttovikt över/.test(x)) { out.heavyOnly = true; continue; }
    // a ban only for motorhomes and trailers ("Parkering är dock förbjuden för personbil klass II och släpkärra under tiden …", "Personbil klass II
    // får ej parkeras", "… får dock personbil klass II inte parkeras"): ordinary cars may park (QA 30 Oct: Landskrona, Karlskrona, Ulricehamn showed a ban)
    { const V = '(?:personbil(?:ar)? klass (?:ii|2)|släpkärr(?:a|or)|släpfordon|släpvagn(?:ar)?|husvagn(?:ar)?|husbil(?:ar)?)', L = `${V}(?:,? (?:och|samt|eller) (?:för )?${V})*`;
      if (new RegExp(`(?:^|\\s)(?:parkering(?:en)? (?:är |råder )?(?:dock )?förbjuden för ${L}(?=\\s+(?:under|mellan|klockan|kl|vardag|dag|sön|\\d)|\\.?$)|^${L} får (?:dock )?(?:inte|ej) (?:stannas eller )?parkeras|får dock ${L} (?:inte|ej) (?:stannas eller )?parkeras)`).test(x)) { if (!out.reserved) out.heavyOnly = true; continue; } } // a motorhome bay's other hours (Simrishamn) stay a reservation
    if (/(?:fordon(?:ståg)? )?med (?:en )?(?:brutto|total)vikt över [\d,.]+ ton (?:inte|ej) parkeras|frikopplat släpfordon/.test(x)) { out.heavyOnly = true; continue; } // also "får med totalvikt över 3,5 ton inte parkeras" (word lost, Burlöv)
    if (/får (?:inte|ej) (?:tung |tungt )?(?:lastbil(?:ar)?|buss(?:ar)?|släpvagn(?:ar)?|släpfordon|fordonståg|motordrivet fordon med tillkopplad)\b/.test(x) && !/får (?:inte|ej) fordon\b/.test(x)) { out.heavyOnly = true; continue; } // "får inte lastbil och motordrivet fordon med tillkopplad släpvagn … parkeras" (Alingsås)
    if (/förbjud|gäller (?:dock )?(?:förbud (?:att|mot att) parkera|parkeringsförbud)\b|får (?:dock )?(?:fordon |motorfordon |bil(?:ar)? |personbil(?:ar)? )?(?:inte|ej) (?:stannas eller )?parkeras|får (?:inte|ej) (?:fordon|motorfordon) (?:stannas eller )?parkeras/.test(x)) { // "gäller dock förbud att parkera onsdagar kl 00.00-06.00" (QA 8 Nov: Örebro), "På torsdagar gäller parkeringsförbud klockan 05.00-16.00" (Nässjö)
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
      if (/\butom\b/.test(s.replace(/\butom (?=[A-ZÅÄÖ])[^,.]*?(?=\s+(?:enligt|får)\b|,)/g, ' ').toLowerCase().replace(/sön- och/g, '').replace(/(?:vardag|måndag|tisdag|onsdag|torsdag|fredag|lördag)(?:ar)? utom (?:vardag(?:ar)? |dag(?:ar)? )?före/g, ''))) { unread(s); continue; } // other exceptions are not guessed
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s);
      if (halfRead(s, ws)) { unread(s); continue; }
      if (ws.length) { const items = ws.map(withSP); out.bans.push(...items); lastBan = { items, provisional: false }; }
      else if (m) { const items = [clean({ a: 0, b: 1440, m, p })]; out.bans.push(...items); lastBan = { items, provisional: false }; } // "Parkering är förbjuden under tiden 1 november – 15 maj"
      else { const items = [{ a: 0, b: 1440 }]; out.bans.push(...items); lastBan = { items, provisional: true }; } // "… får fordon inte parkeras.": all day, unless a "Förbudet gäller …" sentence follows
      continue;
    }
    if (/^(?:tillåtelsen |föreskriften |föreskrifterna |bestämmelsen )?gäller (?:endast|enbart) (?:för )?(?!under\b|mellan\b|klockan\b|vardag|dag\b|sön)/.test(x) && reservedFor(x)) { /* also a bare "Gäller endast buss." / "Föreskriften gäller endast motorcykel." after the permission (QA 11 Nov round 15: Växjö Kvarnvägen showed 24 h for all cars) */ out.reserved = true; out.reservedFor = reservedFor(x); continue; }
    if (/^(?:villkoret|tidsbegränsningen|begränsningen|förbudet) gäller/.test(x) && out.heavyOnly && !lastLimit && !lastBan) continue; // the hours of a heavy-vehicle rule
    // "Tillåtelsen gäller dock mot avgift. Villkoret gäller vardagar … 09.00 - 18.00 …" (Örnsköldsvik): the fee's hours
    if (/^villkoret gäller/.test(x) && !lastLimit && feeNext && !out.feeWindows) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.feeWindows = ws.map(withSP); feeFromConditions = true; continue; } }
    // "Tidsbegränsningen och avgiftsplikten gäller under tiden 1 juni - 31 augusti" (Båstad): the season of the limits and the fee
    if (/^tidsbegränsningen och avgiftsplikten gäller/.test(x) && lastLimit && windows(s).length) { const ws = windows(s); if (!halfRead(s, ws)) { out.limits = out.limits.filter((l) => !lastLimit.items.includes(l)); const items = ws.map(withSP).map((w) => ({ ...w, max: lastLimit.max })); out.limits.push(...items); lastLimit = { max: lastLimit.max, items }; out.feeWindows = ws.map(withSP); continue; } }
    if (/^tidsbegränsningen och avgiftsplikten gäller/.test(x) && m && !windows(s).length) { for (const l of out.limits) l.m = m; if (out.feeWindows) for (const w of out.feeWindows) w.m = m; else out.feeWindows = [{ a: 0, b: 1440, m }]; continue; }
    if (/^tidsbegränsningen gäller/.test(x) && out.reserved && !lastLimit) continue; // a limit for the reserved vehicles (disabled bays), not for other cars
    if (/^tidsbegränsningen gäller/.test(x) && !lastLimit && lastBan && m && !windows(s).length) { for (const b of lastBan.items) b.m = m; continue; } // "Tidsbegränsningen gäller 15 november – 15 april" after a ban (Hörby)
    // "Tidsbegränsningen gäller vardag … 08.00 - 16.00" in a text that never states the limit (Tyresö "får endast personbil parkeras",
    // Gävle, Jönköping): the length is only on the sign, so the segment goes grey; the register showed free parking (QA 4 Nov)
    if (/^tidsbegränsningen gäller/.test(x) && !lastLimit && !out.limits.length && !duration(t)) { out.limitUnknown = true; unread(s); continue; }
    // "Villkoret gäller under tiden vardag utom vardag före sön- och helgdag." after "Tillåtelsen att parkera gäller under tiden klockan 00.00 - 06.00
    // och 10.00 - 24.00" (no limit): those hours hold on these days only; on other days the permission holds all day (QA 2 Nov: Karlstad Tullholmen)
    if (/^villkoret gäller/.test(x) && !lastLimit && lastAllow && lastAllow.length && lastAllow.every((w) => !w.dt && !w.w && !w.m && !w.p && !w.wk && !w.dm && !w.nw && !w.dd) && !windows(s).length && !m && !/\b(?:inte|ej)\b/.test(x)) {
      const d = dayOnlyWindows(s);
      if (d.length === 1 && d[0].dt && !d[0].w && d[0].dt.length < 3) {
        for (const w of lastAllow) w.dt = d[0].dt;
        const rest = ['vardag', 'fore', 'helgdag'].filter((k) => !d[0].dt.includes(k)); const all = { dt: rest, a: 0, b: 1440 };
        out.allowOnly.push(all); tillWs.push(all); lastAllow = [...lastAllow, all]; continue;
      }
    }
    if ((/^(?:villkoret|tidsbegränsningen|begränsningen) gäller/.test(x) || (/^föreskriften gäller/.test(x) && !out.bans.length && !out.allowOnly.length)) && lastLimit) { // "Föreskriften gäller klockan 08.00 till 20.00 vardagar …" after a limit and nothing else (Gällivare) // "Villkoret gäller under tiden …": the hours of the limit just stated
      if (/gäller (?:inte|ej)\b/.test(x)) { unread(s); continue; }
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s);
      if (!ws.length && m) { for (const l of lastLimit.items) l.m = m; continue; } // "Tidsbegränsningen gäller under tiden 1 maj - 30 september": the limit's season (QA: Vänersborg, Tanum)
      if (ws.length && !halfRead(s, ws)) { out.limits = out.limits.filter((l) => !lastLimit.items.includes(l)); const items = ws.map(withSP).map((w) => ({ ...w, max: lastLimit.max })); out.limits.push(...items); lastLimit = { max: lastLimit.max, items }; if (feeNext && !out.feeWindows && /^villkoret/.test(x)) { out.feeWindows = ws.map(withSP); feeFromConditions = true; } continue; } // "… parkeras mot avgift. Tillåtelsen gäller under högst 2 timmar. Villkoret gäller <hours>": the conditions, fee included, hold in those hours (Uddevalla)
      unread(s); continue;
    }
    // "Tillåtelsen gäller inte den 1 måndagen i månaden mellan klockan 07.00 - 10.00": a ban in those hours (Ystad)
    if (/^tillåtelsen (?:att parkera )?gäller (?:inte|ej)\b/.test(x) && !/rätt att/.test(x) && !IGNORE.some((r) => r.test(s))) {
      const ws = windows(s).map(withSP); if (ws.length && !halfRead(s, ws)) { out.bans.push(...ws); lastBan = { items: ws, provisional: false }; continue; }
      unread(s); continue;
    }
    if (/tillåtelsen (?:i (?:paragraf )?\d+ ?§ )?(?:att parkera )?gäller/.test(x)) { // also "Tillåtelsen i 1 § gäller dock högst …" (QA 14 Nov round 25: Hudiksvall)
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
      } else if (!d && lastLimit && weekCont.has(s)) { const items = ws.map((w) => ({ ...w, max: lastLimit.max })); out.limits.push(...items); lastLimit = { max: lastLimit.max, items: [...lastLimit.items, ...items] }; } // "Tillåtelsen gäller onsdag - söndag vecka 30, måndag - söndag vecka 31 …": every week of the list (QA 11 Nov round 14: Rättvik Riksvägen)
      out.allowOnly.push(...ws); tillWs.push(...ws); lastAllow = ws; if (d) limitAllow.push(...ws);
      // "… får fordon parkeras under högst 3 tim i följd mot avgift. Tillåtelsen gäller under vardagar … 09.00 – 18.00.": the permission, fee
      // included, holds in those hours; no fee outside them (QA 28 Oct: Växjö zon 2 showed a fee at night and on Sundays)
      if (feeNext && !out.feeWindows) { out.feeWindows = ws; feeFromConditions = true; }
      if (d) { const items = ws.map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items }; }
      continue;
    }
    if (/får fordon parkeras|får (?:dock |även )?(?:fordon )?parkeras|parkering (?:är )?(?:dock )?tillåten|parkering får ske|får parkering ske|får personbil(?:ar)? (?:klass (?:i|1) )?parkeras/.test(x)) {
      // (a bay reserved for the disabled with "Parkering är dock tillåten under högst 2 tim": the limit is the permit holders', the bay stays reserved; reading it as open to all would be looser, QA 8 Nov Ystad Bollhusgatan)
      out.permitted = true; // the text permits parking (with or without conditions): a register ban on it is wrong
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s); ws = ws.map(withSP); const d = duration(s);
      if (halfRead(s, ws)) { unread(s); continue; }
      // "får fordon inte parkeras. Parkering är dock tillåten mot avgift onsdag klockan 07.00 - 19.00 och vardag före sön- och helgdag
      // klockan 11.00 - 17.00": the all-day ban has exceptions, parking is allowed only in those hours (QA 8 Nov: Nacka Becksjudarvägen showed a ban all week). Only plain hours and days: 'den 4:e tisdagen i månaden' as allowed-only hours is left to the ban (safe side)
      if (/^parkering (?:är )?dock tillåten\b/.test(x) && ws.length && !d && ws.every((w) => Object.keys(w).every((k) => ['a', 'b', 'dt', 'w'].includes(k))) && lastBan && lastBan.items.length && lastBan.items.every((w) => w.a === 0 && w.b === 1440 && Object.keys(w).length === 2) && !out.reserved && !out.purpose.length) {
        out.bans = out.bans.filter((w) => !lastBan.items.includes(w)); out.allowOnly.push(...ws); out.otherAllowed = false; lastBan = null;
        if (/mot avgift/.test(x) && !out.feeWindows) out.feeWindows = ws; lastAllow = ws; continue;
      }
      // "får fordon inte parkeras vardag utom vardag före sön- och helgdag klockan 07.00 - 19.00. Parkering är dock tillåten mot avgift
      // under onsdag klockan 07.00 - 19.00 och …": the ban has holes on those days (QA 8 Nov: Nacka Gamla Värmdövägen banned on Wednesdays)
      if (/^parkering (?:är )?dock tillåten\b/.test(x) && ws.length && !d && lastBan && !out.reserved && !out.purpose.length) {
        const cut = subtractWindows(lastBan.items, ws);
        if (cut === 'grey') { unread(s); continue; } // the exception covers the ban's own day type ("… vardag utom … 11.00 - 17.00" after a weekday ban): likely a slip in the text, the sign decides
        if (cut) { out.bans = out.bans.filter((w) => !lastBan.items.includes(w)).concat(cut); lastBan = { items: cut, provisional: false }; if (/mot avgift/.test(x) && !out.feeWindows) out.feeWindows = ws; lastAllow = ws; continue; }
      }
      if (/(?:och |samt )?mot avgift (?:under|mellan|klockan|kl\.?)/.test(x) && ws.length && !out.feeWindows && (!d || /(?:och|samt) mot avgift/.test(x))) out.feeWindows = ws; // also "högst 1 tim i följd och mot avgift under tiden …" (QA 8 Nov: Kalmar, Karlstad charged around the clock) // "får fordon parkeras mot avgift klockan 16.00 - 19.00" (QA 8 Nov: Sundbyberg Järnvägsgatan charged all week)
      if (d) { const items = (ws.length ? ws : [clean({ a: 0, b: 1440, m, p })]).map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items }; }
      if (/parkeras endast (?:under tiden |mellan |klockan |kl\.? )/.test(x) && ws.length && !d) { out.allowOnly.push(...ws); out.otherAllowed = false; } // "får fordon parkeras endast under tiden klockan 06.00 – 18.00" (QA 8 Nov: Bjuv)
      lastAllow = ws.length ? ws : null; permitSeason = !ws.length && !d && m ? m : null; if (permitSeason && /får (?:fordon|personbil) parkeras (?:under (?:tiden|perioden) )?(?:mellan )?(?:den )?\d/.test(x)) anySeasonPermit = permitSeason; if (permitSeason && !seasonFromBan && !out.reserved && /\bmed\s+avvikelse\s+från\s[^.]*?\b(?:om\s+)?(?:förbud\s+att\s+parkera|parkeringsförbud|förbud\s+mot\s+parkering)/i.test(body)) seasonFromBan = permitSeason; // "får fordon, med avvikelse från … om förbud att parkera i Centrum, under tiden 1 oktober - 30 april parkeras mot avgift": the area ban holds the rest of the year (QA 12 Nov round 19: Sundsvall winter-only streets) // "får fordon parkeras 15 april – 15 oktober": a permission for a season (Knivsta)
      continue;
    }
    if (IGNORE.some((r) => r.test(s))) continue;
    if (tx) continue;
    unread(s);
  }
  // "Avgift mot klockan 09.00 - 24.00. Tillåtelsen gäller under tiden vardag utom dag före sön- och helgdag. Övrig tid får fordon
  // parkeras": the fee has the permission's days (QA 8 Nov: Uppsala Bruno Liljeforsgatan charged on Sundays)
  if (out.feeWindows && out.feeWindows.every((w) => !w.dt) && out.limits.length && out.limits.every((w) => w.dt && JSON.stringify(w.dt) === JSON.stringify(out.limits[0].dt)) && /övrig tid får fordon parkeras/i.test(body)) out.feeWindows = out.feeWindows.map((w) => ({ ...w, dt: out.limits[0].dt }));
  // "får fordon parkeras under tiden 1 oktober - 30 april" with nothing about the rest of the year: what holds then (an area ban,
  // a summer pedestrian street, or nothing) is not in the text, so the reparse greys the line (QA 14 Nov round 25: Skellefteå Hörnellgatan was free in summer)
  if (anySeasonPermit && !seasonFromBan && !out.reserved && !out.limits.some((l) => l.m) && !out.bans.some((b) => b.a === 0 && b.b === 1440 && b.m && !b.w && !b.dt)) out.seasonOnly = anySeasonPermit;
  if (seasonFromBan) { const mm = complement(seasonFromBan); if (!out.bans.some((b) => b.a === 0 && b.b === 1440 && JSON.stringify(b.m) === JSON.stringify(mm) && Object.keys(b).length === 3)) out.bans.push({ a: 0, b: 1440, m: mm }); }
  if (feeSeason) { if (out.feeWindows) out.feeWindows = out.feeWindows.map((w) => (w.m ? w : { ...w, m: feeSeason })); else out.feeWindows = [{ a: 0, b: 1440, m: feeSeason }]; }
  // "Tillåtelsen gäller högst 3 timmar i följd under tiden … 06.00 - 22.00. Parkering är dock förbjuden jämna datum klockan 00.00 - 06.00.":
  // a ban only outside those hours would say nothing if the permission ended at 22, so the hours are the limit's, not the permission's
  // (QA 6 Nov: Örebro disabled bays would have shown no parking at night). Only a ban of its own on some dates or weeks (even dates, odd
  // weeks …), never bans derived from the hours ("Övrig tid är parkering förbjuden")
  // A weekly ban of its own reaching outside those hours ("Parkering är dock förbjuden torsdag mellan klockan 00.00 och 09.00" beside
  // 08.00 - 20.00) says the same: parking is otherwise allowed at night (QA 9 Nov: Örebro Sörbyvägen showed no parking nights and weekends)
  if (limitAllow.length && out.otherAllowed !== false) { const inside = (b) => out.allowOnly.some((w) => (w.a < w.b ? [[w.a, w.b]] : [[w.a, 1440], [0, w.b]]).some(([a, z]) => (b.a < b.b ? b.a < z && a < b.b : true)));
    const spans = (w) => (w.a < w.b ? [[w.a, w.b]] : [[w.a, 1440], [0, w.b]]);
    const reachesOut = (b) => b.a < b.b && [b.a, b.b - 1].some((t) => !out.allowOnly.some((w) => spans(w).some(([a, z]) => a <= t && t < z)));
    if (out.bans.some((b) => (!inside(b) && (b.dd || b.p || b.wk || b.dm || b.nw)) || (b.w && !b.dt && reachesOut(b)))) out.allowOnly = out.allowOnly.filter((w) => !limitAllow.includes(w)); }
  if (!banContext && out.otherAllowed !== false) out.allowOnly = []; // outside the stated hours the general rules apply, not a ban
  return out;
}

const DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const nextDay = ([m, d]) => (d >= DIM[m - 1] ? [m % 12 + 1, 1] : [m, d + 1]);
const prevDay = ([m, d]) => (d <= 1 ? [m === 1 ? 12 : m - 1, DIM[(m + 10) % 12]] : [m, d - 1]);
// The hours outside a reserved spot's reserved hours, as car-allowed windows { dt, a, b } (null when the hours can't be read safely).
export function outsideHours(ws) {
  if (!ws.length || ws.some((w) => w.w || w.m || w.p || w.a == null || w.b == null)) return null;
  const gaps = new Map();
  for (const D of ['vardag', 'fore', 'helgdag']) {
    const iv = ws.filter((w) => !w.dt || w.dt.includes(D)).flatMap((w) => (w.a > w.b ? [[w.a, 1440], [0, w.b]] : [[w.a, w.b]])).sort((x, y) => x[0] - y[0]); // a window over midnight (18.00 – 07.00) covers both ends of the day
    let at = 0;
    for (const [a, b] of iv) { if (a > at) gaps.set(`${at}-${a}`, [...(gaps.get(`${at}-${a}`) || []), D]); at = Math.max(at, b); }
    if (at < 1440) gaps.set(`${at}-1440`, [...(gaps.get(`${at}-1440`) || []), D]);
  }
  return [...gaps].map(([k, dt]) => { const [a, b] = k.split('-').map(Number); return { dt, a, b }; });
}
const complement = (m) => [nextDay(m[1]), prevDay(m[0])];

// "4 § Trots tillåtelsen i 1 § får fordon inte parkeras den 21:a dagen i månaden klockan 09.00 - 12.00": an exception that names no place
// of its own applies to every place of the paragraph it refers to. Returns how many such sentences the rule text has (the reparse's
// multi-part check does not count them as another rule set; QA 7 Nov: Norrköping City-P texts listing many street sides stayed grey).
// "Tillåtelsen i 1 § anger inte rätt att parkera fordon i strid mot 3 kap. 49 a § trafikförordningen (1998:1276): På allmän plats …
// får fordon parkeras högst 24 timmar i följd på vardagar, utom vardag före sön- och helgdag." quotes the national 24-hour rule: it is the
// same for every place the text lists, so it must not count as a second rule set (QA 14 Nov round 24: Norrköping Duvelundsvägen kept
// the register's Saturday-only 24 h limit because the quote made the text look multi-part).
export function dropGeneralRuleQuote(t) {
  return t.replace(/\b(?:Tillåtelsen|Förbudet)(?: i \d+ §)? (?:anger|ger) (?:inte|ej) rätt att parkera (?:fordon )?i strid mot 3 kap\.? 49 a ?§ trafikförordningen(?: \(1998:1276\))?:[^.]*\./gi, '');
}

export function samePlaceExceptions(t) {
  return ((t || '').match(/Trots (?:tillåtelsen|förbudet) i \d+\s*§ får (?:fordon|endast|personbil)(?:[^.]|\.(?=\d))*?(?=\.(?!\d)|$)/g) || [])
    .filter((x) => !/\bpå [A-ZÅÄÖ]|\bsidan?\b|sträck|\bmellan [A-ZÅÄÖ]|\bplats/.test(x)).length;
}

// The last day of the dated periods a rule sentence is limited to ("får fordon inte stannas eller parkeras under 27 april 2026 - 30 april 2026
// … samt 4 maj 2026 - 8 maj 2026", "Förbudet gäller 20 mars 2019", "Förbudet gäller under tiden 20 november 2023 - 25 november 2023"),
// or null when the text names no such period. A temporary regulation whose periods have all ended is expired even when the register
// has no end date (QA 14 Nov round 24: Höör Nya torg drew an April/May 2026 night ban every night).
const MONTH_NO = { januari: 1, februari: 2, mars: 3, april: 4, maj: 5, juni: 6, juli: 7, augusti: 8, september: 9, oktober: 10, november: 11, december: 12 };
export function datedPeriodEnd(body) {
  const t = (ruleText(body) || '').replace(/\s+/g, ' ').replace(/^.*?följande\.?/, '');
  const D = '(\\d{1,2}) (januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december) (20\\d\\d)';
  const per = new RegExp(`\\b(?:under(?: tiden)?|gäller)(?: från)? (?:den )?${D}(?:(?: klockan [\\d.:]+)?\\s*(?:-|–|till|t\\.o\\.m\\.?)\\s*(?:den )?${D})?|\\bsamt (?:den )?${D}\\s*(?:-|–|till)\\s*(?:den )?${D}`, 'gi');
  if (!per.test(t)) return null;
  // the latest dated day anywhere in the rules (a list "20 september 2014 klockan …, 5 oktober 2014 …, och 2 januari 2017 – 27 januari 2017"),
  // leaving out when the text comes into force or replaces another
  let end = null;
  const rules = t.split(/(?<=\.)\s+(?=[A-ZÅÄÖ0-9])/).filter((x) => !/träder i kraft|upphör(?:a)? att gälla|beslutade?|publicerat/i.test(x)).join(' ');
  for (const m of rules.matchAll(new RegExp(D, 'gi'))) { const d = `${m[3]}-${String(MONTH_NO[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`; if (!end || d > end) end = d; }
  return end;
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
