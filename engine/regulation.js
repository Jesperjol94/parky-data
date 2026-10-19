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
  const t = body.replace(/­/g, '').replace(/-\n(?=[a-zåäö])/g, '').replace(/\s+/g, ' ').replace(/sönoch/g, 'sön- och').replace(/sön och helgdag/g, 'sön- och helgdag')
    .replace(/sön ?- ?och/g, 'sön- och').replace(/sön ?- ?helgdag/g, 'sön- och helgdag').replace(/(\d{1,2}):[ae]\b/g, '$1') // "sön - och helgdag", "sön - helgdag", "1:a december"
    .replace(/\bMed avvikelse från bestämmelserna i \d+ § får/g, 'Får').replace(/\b(fordon) på (?:sträckan|platsen|sträckorna|platserna)\b/gi, '$1') // "Med avvikelse från bestämmelserna i 1 § får fordon på sträckan inte parkeras …"
    .replace(/\bTillåtelsen (?:att parkera )?i \d+ § gäller/g, 'Tillåtelsen gäller').replace(/\bFörbudet i \d+ § gäller/g, 'Förbudet gäller')
    .replace(/\bden (\d{1,2}) i (varje )?månaden/gi, 'den $1 dagen i $2månaden').replace(/(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)) till(?: och med)? (\d{1,2} )/gi, '$1 - $2');

  const m = t.match(/följande\.?\s*(.*?)(?:Denna författning|Dessa föreskrifter träder|Denna föreskrift träder|Dessa föreskrifter gäller|På [^.]{0,60}?vägnar|$)/i);
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
  const r = x.match(WD_RANGE);
  if (r) { const from = WEEKDAYS[r[1]], to = WEEKDAYS[r[2]]; if (from === 1 && to === 7) return []; const out = []; for (let d = from; d <= to; d++) out.push(d); return out; }
  const ws = [...new Set([...x.matchAll(WD_WORD)].map((m) => WEEKDAYS[m[1]]))];
  return ws.length ? ws : null;
}

// All "<day words> klockan A - B" pieces in a clause.
// "första tisdagen i månaden", "sista fredagen i varje månad": one weekday a month (nw 1–4, or -1 for the last).
const NTH = /\b(?:under\s+)?(?:den\s+)?(första|andra|tredje|fjärde|sista)\s+(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?:en)?\s+i\s+(?:varje\s+)?månad(?:en)?/i;
const NTH_N = { första: 1, andra: 2, tredje: 3, fjärde: 4, sista: -1 };
function windows(clause) {
  const nth = NTH.exec(clause);
  if (nth) {
    const ws = windows(clause.replace(NTH, ' ').replace(/\s+året runt\b/i, ''));
    return ws.map(({ a, b, m, p }) => clean({ w: WEEKDAYS[nth[2].toLowerCase()], nw: NTH_N[nth[1].toLowerCase()], a, b, m, p }));
  }
  clause = clause.replace(/\b(vardag(?:ar)?),\s+(?=utom\b)/gi, '$1 '); // "vardagar, utom vardag före …": one day type, not a list (QA: Borås)
  clause = clause.replace(/\b(helgdag(?:ar)?|vardag(?:ar)?|lördag(?:ar)?|söndag(?:ar)?)\s+(?=\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})/gi, '$1 klockan '); // "… och vardag före sön- och helgdag 09.00 - 15.00" (no "klockan"; QA: Jönköping, Kalmar)
  clause = clause.replace(/([a-zåäö]),\s+(?=(?:vardag|dag(?:ar)? före|sön- och helgdag))/gi, '$1 och '); // "vardag utom …, vardag före … och sön- och helgdag klockan 8-22": one list of day types
  clause = clause.replace(/(klockan\s*\d{1,2}(?:[.:]\d{2})?\s*[-–—]\s*\d{1,2}(?:[.:]\d{2})?)\s*\(gäller ([^)]+)\)/gi, '$2 $1'); // "… 09.00 - 12.00 (gäller vardag utom …)"
  clause = clause.replace(/mellan (klockan|kl\.?)\s*(\d{1,2}(?:[.:]\d{2})?)\s*och\s*(\d{1,2}(?:[.:]\d{2})?)/gi, '$1 $2 - $3'); // "mellan klockan 8 och 18"
  clause = clause.replace(/(\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})\s+och\s+(?=\d{1,2}[.:]\d{2}\s*[-–—])/g, '$1 och klockan '); // "07.00 - 10.00 och 15.00 - 18.00"
  const out = [];
  const re = new RegExp(String.raw`([^,;]*?)\b(?:klockan|kl\.?)\s*${TIME}`, 'gi');
  let m, lastDt;
  while ((m = re.exec(clause))) {
    const pre = m[1];
    let a = toMin(m[2], m[3]), b = toMin(m[4], m[5]);
    if (b === 0) b = 1440;
    const wds = weekdaysOf(pre);
    const dm = (pre.match(/\b(?:den )?(\d{1,2}) dagen i (?:varje )?månaden/i) || [])[1]; // "den 7 dagen", "19:e dagen i månaden"
    if (wds) { lastDt = undefined; if (!wds.length) out.push({ a, b }); else for (const w of wds) out.push({ w, a, b }); continue; }
    let dt = dayTypesOf(pre);
    if (dt === undefined) dt = lastDt; // "… 07.00 - 19.00 och 11.00 - 17.00" keeps the previous day type
    lastDt = dt;
    out.push(clean({ dm: dm ? +dm : null, dt: dt ?? null, a, b }));
  }
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
function duration(s) {
  const m = s.match(/högst\s+(\d+)\s*(tim(?:me|mar)?|min(?:uter)?|dygn)/i);
  if (!m) return null;
  const n = +m[1], u = m[2].toLowerCase();
  return u.startsWith('dygn') ? n * 1440 : u.startsWith('tim') ? n * 60 : n;
}

// Split into sentences, keeping "kl. 7" and "8 §" intact; paragraph numbers ("1 §") and "med avvikelse från …" asides are dropped.
function sentences(t) {
  t = t.replace(/,?\s*med avvikelse från [^,]*?,/gi, ' ').replace(/\bTrots tillåtelsen i \d+ § får /g, 'Får ').replace(/\s{2,}/g, ' ');
  t = t.replace(/([^.;\s])\s+(?=Tillåtelsen ger inte rätt)/g, '$1. '); // the city text sometimes lacks the full stop before this sentence
  t = t.replace(/([a-zåäö)0-9])\.(?=[A-ZÅÄÖ][a-zåäö])/g, '$1. '); // "… i följd.Tillåtelsen", "… 14.00.Tillåtelsen": glued sentences
  t = t.replace(/(^|[.;]\s+)\d{1,2}\s*§\s+(?=[A-ZÅÄÖ])/g, '$1'); // paragraph numbers "2 § Tidsbegränsningen …" (not "13 kap. 8 § trafikförordningen")
  t = t.replace(/\b(kv|ca|nr|resp|fast)\.(?=\s)/gi, '$1§DOT§'); // "parkeringsplats kv. Pilen": an abbreviation, not the end of a sentence
  return t.replace(/(\d)\.(\d)/g, '$1§DOT§$2').split(/(?<=[.;])\s+(?=[A-ZÅÄÖ])/).map((s) => s.replace(/§DOT§/g, '.').trim()).filter(Boolean);
}

const IGNORE = [
  /^Avgiftsplikten gäller/i, /^Avgift ska betalas/i, /^(?:Parkeringsskiva|P-skiva)/i, /^Med (boende|fordon|.*avses)/i, /^med stöd av/i,
  /^Koordinatsystem/i, /^Föreskriften (?:skall|ska) utmärkas/i, /^Vägmärkesförordningen/i, /^Denna föreskrift ersätter/i, /^Föreskriften ersätter/i,
  /gäller inte (?:lastbil|buss|taxi|utryckning|moped|cykel|motorcykel|fordon som används i (?:väg|gatu)arbete)/i,
  /^Stockholms kommun föreskriver/i, /trafikförordningen \(1998:1276\) följande/i, /^Publicerat/i, /^beslutade den/i,
  /^Uppställning av fordon sker/i, /^Tillåtelsen ger inte rätt/i, /^Föreskrifterna gäller/i, /^Bestämmelsen gäller/i, /^Detta gäller/i, /^Undantag/i,
  /^Förbudet ger inte rätt/i, /gäller (?:inte|ej) (?:på )?enskild väg/i, /^Tiden, avrundad/i, /anges med parkeringsskiva/i, /^Förbudet gäller alla fordon/i, /^Förbudet gäller om inte annat/i, /gäller inte fordon i linjetrafik/i,
  /^Förbudet gäller inte där parkering är tillåten enligt/i, /^Se /i, /^Instruktioner på parkeringsmätare/i, /^Digital registrering/i, /^Den första timmen/i, /^För parkering inom .* tas avgift/i,
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
  const out = { taxa: null, feeWindows: null, reserved: false, reservedSeason: null, reservedWindows: [], purpose: [], allowOnly: [], limits: [], bans: [], dp: [], otherAllowed: null, unread: [] };
  if (!t) { out.unread.push('(no rule text)'); return out; }
  // A permission with hours ("Tillåtelsen gäller vardagar 09–18") only bans parking outside those hours when something else
  // bans it there (an area ban the text deviates from, or a ban in the text). Otherwise the general rules apply then.
  const banContext = /avvikelse från|trots förbudet|förbud att parkera|parkeringsförbud|(?:inte|ej) (?:stannas eller )?parkeras|parkering(?:en)? (?:är |råder )?förbjuden|övrig tid/i.test(body.replace(/(?:ger|ge) (?:inte|ej) rätt att[^.]*/gi, ''));
  let lastAllow = null, lastLimit = null, lastBan = null, lastDp = false; const tillWs = [];
  const unread = (s) => out.unread.push(s);
  for (let s of sentences(t)) {
    let x = s.toLowerCase();
    const m = season(s), p = parity(s);
    const withSP = (w) => clean({ ...w, m, p });
    const tx = x.match(/taxa\s+(\d+)/);
    if (tx && /avgift/.test(x)) { out.taxa = +tx[1]; }
    // "Avgift enligt Taxa Zon 2 under vardagar utom vardag före sön- och helgdag mellan klockan 09.00 - 18.00": the hours the fee is
    // charged, when the text gives them (the register's fee table may say all day; QA: Växjö)
    if (/^avgift\b/.test(x) && /(?:klockan|kl\.?)\s*\d/.test(x)) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) out.feeWindows = ws.map(withSP); continue; }
    if (/^(?:tillåtelsen|förbudet)(?: i (?:§\s*\d+|\d+\s*§))? (?:ger|ge) (?:inte|ej) rätt/.test(x)) continue;
    x = x.replace(/,?\s*(?:tillåtelsen |förbudet )?(?:ger|ge) (?:inte|ej) rätt att (?:stanna|parkera)[^.]*/g, '').replace(/där det (?:enligt [^.]*?)?är förbjudet att stanna eller parkera[^.]*/g, ''); // "… får parkeras där det är förbjudet …" is not a ban
    // Date parking ("udda datum … udda adressnummer"): one side is always allowed — dp windows, not a ban
    if (/udda datum|jämn(?:a|t) datum/.test(x)) { let ws = windows(s); if (!ws.length) ws = [{ a: 0, b: 1440 }]; out.dp.push(...ws.map(withSP)); lastDp = true; continue; }
    if (/^förbudet (?:att (?:parkera|stanna)[^ ]* )?(?:i första stycket )?gäller/.test(x) && lastDp && !lastBan) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.dp = ws.map(withSP); continue; } }
    // "Parkering är dock förbjuden enligt … lokala trafikföreskrifter om datumparkering": a reference to another regulation
    if (/förbjud[^.]*enligt (?:bestämmelserna i )?[^.]*trafikföreskrifter/.test(x)) { if (/datumparkering/.test(x) && !out.dp.length) out.dp.push({ a: 0, b: 1440, ref: 1 }); continue; }
    if (/^tillåtelsen gäller även|boendeparkeringskort|boendeparkeringstillstånd/.test(x)) continue; // resident permits are out of scope outside the big three
    if (/ändamålsplats/.test(x)) { out.purpose.push(...windows(s).map(withSP)); continue; }
    if (/^övrig tid får endast/.test(x) && reservedFor(x) && lastAllow) { out.otherAllowed = false; out.allowOnly.push(...lastAllow.filter((w) => !out.allowOnly.includes(w))); continue; } // "Övrig tid får endast tung lastbil parkeras"
    if (/vändplats med förbud att (?:stanna och |stanna eller )?parkera/.test(x)) { const items = [{ a: 0, b: 1440 }]; out.bans.push(...items); lastBan = { items, provisional: true }; continue; }
    if (/^(?:på|inom|i|från) [^.]*? får (?:taxi|buss(?:ar)?|(?:tung |tungt )?(?:lastbil(?:ar)?|släpfordon)(?: och (?:tung |tungt )?(?:lastbil(?:ar)?|släpfordon))?|motorcykl(?:ar|el)|moped(?:er)?) parkeras/.test(x) && !/(?:inte|ej) parkeras|får (?:inte|ej)/.test(x)) { out.reserved = true; out.reservedFor = reservedFor(x); if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    // "får personbil klass II parkeras …": a motorhome spot, whether or not it says "endast"
    if (/personbil klass (?:ii|2)\b/.test(x) && /parkeras/.test(x) && !/får (?:inte|ej)\b|inte parkeras/.test(x)) { out.reserved = true; out.reservedFor = 'husbil'; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    if (/får endast\b/.test(x) && /parkeras|stannas/.test(x)) {
      const who = reservedFor(x);
      if (who) { out.reserved = true; out.reservedFor = who; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; } // the hours stated here are the hours it is reserved ("…parkeras mot avgift vardagar 07.00 - 19.00")
      // "får endast personbil parkeras …": ordinary cars may park; read the rest of the sentence as usual
      x = x.replace(/får endast (?:personbil(?:ar)?(?: klass (?:i|1)\b)?|fordon)\s*/, 'får fordon '); s = s.replace(/får endast (?:personbil(?:ar)?(?: klass (?:I|1)\b)?|fordon)\s*/i, 'får fordon ');
    }
    if (/^övrig tid (?:får (?:fordon inte|inte fordon) parkeras|(?:är |råder )?parkering(?:en)? förbjuden|råder parkeringsförbud|får fordon (?:inte|ej) stannas)/.test(x)) { // outside the stated hours: not allowed
      if (!lastAllow) { unread(s); continue; }
      out.otherAllowed = false; out.allowOnly.push(...lastAllow.filter((w) => !out.allowOnly.includes(w))); continue;
    }
    if (/^övrig tid får fordon parkeras/.test(x)) { // "…other times vehicles may park": the permission hours are not the only hours
      out.otherAllowed = true; out.allowOnly = out.allowOnly.filter((w) => !tillWs.includes(w));
      const d = duration(s);
      if (d) { // "Övrig tid får fordon parkeras under högst 4 tim i följd": a limit in the hours outside the limit just stated
        const o = lastLimit ? outsideHours(lastLimit.items) : null;
        if (o) { const items = o.map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items }; } else unread(s);
      }
      continue;
    }
    if (/^förbudet (?:att (?:parkera|stanna)[^ ]* )?(?:i första stycket )?gäller/.test(x)) { // the hours of the ban just stated
      if (IGNORE.some((r) => r.test(s))) continue;
      if (/gäller (?:inte|ej)\b/.test(x)) {
        if (IGNORE.some((r) => r.test(s))) continue;
        if (out.heavyOnly && /gäller (?:inte|ej) på:/.test(x)) continue; // streets exempt from a heavy-vehicle rule
        const ex = x.replace(/^förbudet gäller (?:inte|ej)\s*/, '');
        if (lastBan && !lastBan.items.some((b) => b.w) && /^(?:vardag|dag före|sön- och helgdag)/.test(ex) && !/\b(?:klockan|kl\.?)\s*\d/.test(ex)) { // "Förbudet gäller inte vardag före sön- och helgdag samt sön- och helgdag"
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
    if (/fordon(?:ståg)? med (?:en )?bruttovikt över [\d,.]+ ton (?:inte|ej) parkeras|frikopplat släpfordon/.test(x)) { out.heavyOnly = true; continue; }
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
      if (/\butom\b/.test(x.replace(/sön- och/g, '').replace(/vardag(?:ar)? utom (?:vardag(?:ar)? |dag(?:ar)? )?före/g, ''))) { unread(s); continue; } // other exceptions are not guessed
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s);
      if (halfRead(s, ws)) { unread(s); continue; }
      if (ws.length) { const items = ws.map(withSP); out.bans.push(...items); lastBan = { items, provisional: false }; }
      else if (m) { const items = [clean({ a: 0, b: 1440, m, p })]; out.bans.push(...items); lastBan = { items, provisional: false }; } // "Parkering är förbjuden under tiden 1 november – 15 maj"
      else { const items = [{ a: 0, b: 1440 }]; out.bans.push(...items); lastBan = { items, provisional: true }; } // "… får fordon inte parkeras.": all day, unless a "Förbudet gäller …" sentence follows
      continue;
    }
    if (/^tillåtelsen gäller endast/.test(x) && reservedFor(x)) { out.reserved = true; out.reservedFor = reservedFor(x); continue; }
    if (/^(?:villkoret|tidsbegränsningen|begränsningen|förbudet) gäller/.test(x) && out.heavyOnly && !lastLimit && !lastBan) continue; // the hours of a heavy-vehicle rule
    if (/^(?:villkoret|tidsbegränsningen|begränsningen) gäller/.test(x) && lastLimit) { // "Villkoret gäller under tiden …": the hours of the limit just stated
      if (/gäller (?:inte|ej)\b/.test(x)) { unread(s); continue; }
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s);
      if (ws.length && !halfRead(s, ws)) { out.limits = out.limits.filter((l) => !lastLimit.items.includes(l)); const items = ws.map(withSP).map((w) => ({ ...w, max: lastLimit.max })); out.limits.push(...items); lastLimit = { max: lastLimit.max, items }; continue; }
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
