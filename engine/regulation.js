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
// A stopping ban: "får fordon inte stannas", the active "får fordon inte stanna" (QA 18 Nov round 36: Storfors Rörverksgatan),
// "får inte heller stannas", "förbud (mot) att stanna"
// also "får inte fordon stannas" (Mjölby), "Stannande eller parkering är dock förbjuden torsdag …" (Falun, Trelleborg), "får fordon inte Stannande eller parkering" (Karlskrona): sweep findings batch 8
export const STOPPING = /(?:inte|ej)(?: heller)?(?: fordon)? stannas?\b|förbud (?:mot )?att stanna|stanna(?:s)? eller parkera|(?<!\bdär )\bstannande (?:eller|och) parkering är (?:dock )?förbjud\w*(?! enligt)|(?:inte|ej) stannande eller parkering/i; // not "får fordon parkeras där stannande och parkering är förbjuden enligt 3 kap. 52 §": a permission (Örebro, Eskilstuna)

export function ruleText(body) {
  if (!body) return null;
  let t = body.replace(/Publicerat på webbplatsen Svensk trafikföreskriftssamling den \d{1,2} \S+ \d{4}/g, ' ') /* page footers inside sentences (QA: Linköping, Norrköping) */.replace(/­/g, '').replace(/(?<=[a-zåäö])-\n(?=[a-zåäö])/g, '') /* not "augusti -\njuni": a season's dash (QA 8 Nov: Solna lost 'augusti - juni') */.replace(/\s+/g, ' ').replace(/\bkockan\b/g, 'klockan') /* typo (QA 20 Nov: Sala Bråstagatan) */.replace(/sönoch/g, 'sön- och').replace(/sön och helgdag/g, 'sön- och helgdag')
    .replace(/\b(\d{1,2}),(\d{2})(?=\s*[-–]\s*\d{1,2}[.:]\d{2})/g, '$1.$2').replace(/\bbestämmelserna i § (\d+)/g, 'bestämmelserna i $1 §') // "klockan 09,00- 18.00", "bestämmelserna i § 1" (QA 17 Nov round 33: Örnsköldsvik Apoteksgränd)
    .replace(/sön ?- ?och/g, 'sön- och').replace(/sön ?- ?helgdag/g, 'sön- och helgdag').replace(/(\d{1,2}):[ae]\b/g, '$1') // "sön - och helgdag", "sön - helgdag", "1:a december"
    .replace(/(\d{2}|[a-zåäö)])\s+(?=(?:Avgiften i \d+ § är|Med avvikelse från bestämmelserna i \d+ § får)\s)/g, '$1. ') /* a list ending without a full stop ran into the next sentence (QA 12 Nov round 18: Örnsköldsvik Lasarettsgatan drew the fee's 09–18 as an odd-date ban) */.replace(/\bMed avvikelse från bestämmelserna i \d+ § får/g, 'Får').replace(/\b(fordon) på (?:sträckan|platsen|sträckorna|platserna)\b/gi, '$1') // "Med avvikelse från bestämmelserna i 1 § får fordon på sträckan inte parkeras …"
    .replace(/,\s+(Gäller (?:endast|enbart) )/g, '. $1') /* "… högst 24 timmar i följd, Gäller endast buss." (Växjö) */.replace(/(\d\s*§)(?=[A-ZÅÄÖ])/g, '$1 ').replace(/\b(\d+) § §\s+(?=[A-ZÅÄÖ])/g, '$1 § ') /* "2 § § Tidsbegränsningen och avgiftsplikten gäller …": a doubled paragraph sign hid the fee hours (QA 19 Nov round 39: Karlskrona Stortorget) */ /* "2 §Tillåtelsen" (QA 6 Nov: Örebro Fredsgatan) */.replace(/\bTillåtelsen (?:att parkera )?i \d+ § gäller/g, 'Tillåtelsen gäller').replace(/\bFörbudet i \d+ § gäller/g, 'Förbudet gäller')
    .replace(/\bmellan (?:den )?(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)) och (?:den )?(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december))/gi, '$1 - $2') /* season "mellan 1 maj och 30 september" (Tanum) */.replace(/\b(under (?:tiden|perioden)) (?:den )?(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)) och (?:den )?(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december))/gi, '$1 $2 - $3') /* "förbjuden under tiden 1:a november och 30:e april" (QA 11 Nov round 14: Örebro Hagagatan drew the winter ban all year) */.replace(/\bden (\d{1,2}) i (varje )?månaden/gi, 'den $1 dagen i $2månaden').replace(/\b(\d{1,2}) i (varje )?månaden/gi, '$1 dagen i $2månaden') /* "2:a i månaden" (Norrköping) */.replace(/sön\s*[–—-]\s*(?:och\s+)?helgdag/g, 'sön- och helgdag').replace(/\b(\d{1,2})\/(\d{1,2})\s*(?:[-–]|till(?: och med)?)\s*(\d{1,2})\/(\d{1,2})\b/g, (z, d1, m1, d2, m2) => (+m1 >= 1 && +m1 <= 12 && +m2 >= 1 && +m2 <= 12 ? `${+d1} ${MONTH_NAMES[+m1 - 1]} - ${+d2} ${MONTH_NAMES[+m2 - 1]}` : z)) /* "1/9- 30/12", "1/12 till 31/3" (QA 10 Nov: Vimmerby winter night bans drawn all year) */.replace(/(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)) till(?: och med)? (\d{1,2} )/gi, '$1 - $2');

  // Falun: "… får fordon, med avvikelse från <area ban>, parkeras … Villkoret gäller ej mellan datumen 15/12-30/4 Torsdagar kl 09:00-15:00":
  // the permission lapses then, so the underlying ban holds (QA 1 Nov). Only for a permission that deviates from another regulation.
  if (/får fordon,? med avvikelse från [^.]*?parkeras/i.test(t)) t = t.replace(/\.?\s*Villkoret gäller (?:ej|inte) (?:mellan datumen )?(\d{1,2} [a-zåäö]+ - \d{1,2} [a-zåäö]+)\s+((?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?:ar)?)\s+(?:kl\.?|klockan)?\s*(\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2})/gi, (z, per, wd, tm) => `. Parkering är dock förbjuden ${wd.toLowerCase()} klockan ${tm} under tiden ${per}.`);
  // Falun: "… får fordon, med avvikelse från <area ban>, parkeras under högst 7 dygn i följd … Tillåtelsen gäller udda veckor": the permission holds every
  // other week, so the ban it deviates from holds in the weeks between (sweep findings batch 9: Hyttgatan's two sides were open every week)
  if (/får fordon,? med avvikelse från [^.]*?parkeras/i.test(t)) t = t.replace(/\.?\s*Tillåtelsen gäller (udda|jämna) veckor\.?(?=\s|$)/gi, (z, par) => `. Parkering är dock förbjuden. Förbudet gäller ${par.toLowerCase() === 'udda' ? 'jämna' : 'udda'} veckor.`);
  // "får enbart personbil klass II parkera under högst 24 timmar i föjd", "enbart peronbil klass I parkera under högst 24 h i följd" (Ängelholm, Hässleholm:
  // the sentence with the limit was unread, so a motorhome bay showed as open and a car park had no limit; sweep findings batch 9)
  t = t.replace(/\bperonbil\b/g, 'personbil').replace(/\bi föjd\b/g, 'i följd').replace(/\b(under högst \d{1,2}) h(?= i följd)/g, '$1 tim').replace(/(?<=\. )(?:På|Inom) [^.]{3,80}? får enbart personbil(?:ar)? klass (?:II|I|1|2) parkera under högst (\d{1,2} (?:tim\w*|dygn)) i följd\b/g, 'Tillåtelsen gäller dock högst $1 i följd') /* the same place named a second time for its limit: one place, not two */
    .replace(/\bavgifsfri/g, 'avgiftsfri').replace(/\b(?:De )?([Tt]vå|[Tt]re|[Ff]yra) första parkeringstimmarna är avgiftsfria\b/g, (z, n) => `första ${n.toLowerCase()} timmarna är avgiftsfria`);
  // Sweep findings batch 9, sentence shapes that left a rule unread or bound to the wrong hours:
  { const MON = '(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)', SEAS = String.raw`\d{1,2}\s*${MON}\s*[-–]\s*\d{1,2}\s*${MON}`;
    const T = String.raw`\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}`;
    t = t.replace(/\b(\d{1,2})\s*(jan|feb|mar|apr|jun|jul|aug|sept?|okt|nov|dec)(?=[\s.,]|$)(?!\s*\d{4})/g, (z, d, mo) => `${d} ${{ jan: 'januari', feb: 'februari', mar: 'mars', apr: 'april', jun: 'juni', jul: 'juli', aug: 'augusti', sep: 'september', sept: 'september', okt: 'oktober', nov: 'november', dec: 'december' }[mo]}`) // "15 juni- 15 aug" (Lysekil)
      // hours before the place and the verb: "…, mellan klockan 05-23 på Slottstorgets parkeringsplats får fordon, med avvikelse från … om område med förbud att stanna och
      // parkera fordon, parkeras." (Gävle Slottstorget ×2: open at night inside the area ban)
      .replace(/,? mellan klockan (\d{1,2})\s*[-–]\s*(\d{1,2}) (på [^.]{3,80}? får fordon,? med avvikelse från [^.]*?,? parkeras)\s*\./g, (z, a, b, rest) => ` ${rest} under tiden klockan ${a.padStart(2, '0')}.00 - ${b.padStart(2, '0')}.00.`)
      // a bay for another vehicle, or for permit holders, in a season or at stated hours is no place for a car then: read as a ban for that time, the rest of the text as it stands
      // ("Under tiden 15 juni- 15 aug gäller tillåtelsen endast buss": Lysekil Verkstadsgatan; "Mellan den 1 maj - 31 augusti får endast personbil klass II parkeras.
      // Parkering får dock endast ske under högst 2 tim i följd": Karlstad Bjurbäcksgatan; "Tillåtelsen gäller för buss mot avgift enligt taxa gul. Det gäller för vardag
      // före sön- och helgdag kl 14:00-24:00 samt sön- och helgdag kl 00:00-24:00": Mölndal Göteborgsvägen; all three were open to cars then)
      .replace(new RegExp(String.raw`\bUnder tiden (${SEAS}) gäller tillåtelsen endast (?:buss(?:ar)?|lastbil(?:ar)?|husbil(?:ar)?|personbil(?:ar)? klass (?:II|2)|motorcyk(?:el|lar))\.+`, 'g'), 'Parkering är dock förbjuden under tiden $1.')
      .replace(new RegExp(String.raw`\bMellan (?:den )?(${SEAS}) får endast (?:buss(?:ar)?|lastbil(?:ar)?|husbil(?:ar)?|personbil(?:ar)? klass (?:II|2)|motorcyk(?:el|lar)) parkeras\.(?:\s*Parkering får dock endast ske under högst \d+ (?:tim\w*|min\w*|dygn) i följd\.)?`, 'g'), 'Parkering är dock förbjuden under tiden $1.')
      .replace(/\bTillåtelsen gäller för buss(?:ar)?(?: mot avgift(?: enligt taxa [\wåäö]+)?)?\. Det gäller (?:för |under tiden )?((?:vardag|sön-|dag före)[^.]*?\d{2})\.(?=\s|$)/g, 'Parkering är dock förbjuden under tiden $1.')
      // "… får endast släpvagn parkeras under högst 2 veckor i följd under tiden maj – oktober. 2 § Övrig tid får endast personbil klass I parkeras under högst 24 tim i följd."
      // (Eslöv Göingevägen: cars were let in all year)
      .replace(new RegExp(String.raw`\bfår endast (?:släpvagn(?:ar)?|släpfordon|husvagn(?:ar)?|buss(?:ar)?|lastbil(?:ar)?) parkeras(?: under högst \d+ (?:tim\w*|dygn|veck\w+) i följd)? under tiden (${MON})\s*[-–]\s*(${MON})\.\s*(?:\d+ §\s*)?Övrig tid får (?:endast personbil(?:ar)? klass (?:I|1)|fordon) parkeras( under högst \d+ (?:tim\w*|dygn) i följd)?\.+`, 'g'), (z, m1, m2, lim) => { const i1 = MONTH_NAMES.indexOf(m1.toLowerCase()), i2 = MONTH_NAMES.indexOf(m2.toLowerCase()), dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], n = (i2 + 1) % 12, pv = (i1 + 11) % 12;
        return `får fordon parkeras${lim || ''} under tiden 1 ${MONTH_NAMES[n]} - ${dim[pv]} ${MONTH_NAMES[pv]}. Parkering är dock förbjuden under tiden 1 ${MONTH_NAMES[i1]} - ${dim[i2]} ${MONTH_NAMES[i2]}.`; })
      // vehicle bays whose wording hid the vehicle: "får motordrivet fordon med tillkopplad släpvagn annat än påhängsvagn eller enaxlig släpvagn parkeras" (Mariestad Torsö),
      // "får godstransporter, fordon i linjetrafik och lastbil parkeras" (Tanum Prästgårdsvägen)
      .replace(/\b(med tillkoppla[dt] släpvagn) annat än påhängsvagn(?: eller enaxlig släpvagn)?(?= parkeras)/g, '$1')
      .replace(/\bfår (?:godstransporter|varutransporter),? (?:(?:fordon|buss(?:ar)?) i linjetrafik,? )?(?:och|samt) lastbil(?:ar)?(?= parkeras)/g, 'får lastbil')
      // a third hour range after "samt" that lost its day words follows weekdays and Saturdays: Sundays and holidays ("vardag utom vardag före sön- och helgdag klockan
      // 08.00 - 20.00, vardag före sön- och helgdag klockan 08.00 - 16.00 samt klockan 08.00 - 16.00": Sundsvall Tullgatan had no limit on Sundays)
      .replace(new RegExp(String.raw`(vardag(?:ar)? utom (?:vardag|dag) före sön- och helgdag (?:klockan|kl\.?) ${T},? (?:och )?(?:vardag|dag) före sön- och helgdag (?:klockan|kl\.?) ${T}) samt (?=(?:klockan|kl\.?) ${T})`, 'g'), '$1 samt sön- och helgdag ')
      // "Övrig tid får fordon parkeras 24 tim.." without "högst" (Tanum Halsviksvägen: no limit outside the season), and "… under högst 4 tim i följd under tiden
      // måndag-söndag" (every day: Orust Hamntorget). Not with day words after it ("… 24 tim i följd vardagar utom …" inside an area ban, Lerum Almekärrsvägen: what
      // holds at weekends is not in the text; the independent check refused a 24 h permission there)
      .replace(/(Övrig tid får fordon parkeras) (\d{1,2}) ?(tim(?:mar)?|dygn)(?=(?: i följd)?\.)/g, '$1 under högst $2 $3')
      .replace(/(Övrig tid får fordon parkeras under högst \d{1,2} (?:tim(?:mar)?|dygn)(?: i följd)?) (?:under tiden )?måndag\s*[-–]\s*söndag\.(?=\s|$)/g, '$1.')
      // "Tillåtelsen gäller inte den första helgfria måndagen varje månad 08-00-12.00" (Eslöv Palmgatan: the cleaning morning was missing)
      .replace(/\b(\d{2})-(\d{2})(?=\s*[-–]\s*\d{1,2}[.:]\d{2})/g, '$1.$2')
      .replace(new RegExp(String.raw`\b(Tillåtelsen gäller (?:inte|ej) den (?:första|andra|tredje|fjärde|sista) (?:helgfria )?(?:mån|tis|ons|tors|fre|lör|sön)dagen) varje månad (${T})`, 'g'), '$1 i månaden mellan klockan $2')
      // "Fordon får parkera högst under 2 tim" at the end of a fee text (Nacka Järla östra skolväg: the limit was kept inside the fee hours only)
      .replace(/\bFordon får parkera högst under (\d{1,2} (?:tim\w*|min\w*|dygn))\.?(?=\s|$)/g, 'Tillåtelsen gäller dock högst $1 i följd.')
      // a second, shorter limit worded on its own: "… parkeras högst 24 timmar i följd, Följande inskränkningar gäller: Parkering högst 2 timmar i följd vardagar utom dag
      // före helgdag kl 09.00 - 18.00 …" (Växjö Värnamovägen had the 24 h in those hours and no 2 h), "2 § En tidsbegränsning om att parkera fordon under högst 2 timmar
      // gäller vardagar, vardag före sön- och helgdag, samt sön- och helgdag mellan klockan 08 och 18" (Ljusdal Lantmätargatan: Saturdays only)
      .replace(/(i följd)[,.]? Följande inskränkningar gäller[:.] P[ae]rkering högst (\d{1,2} (?:tim\w*|min\w*)) i följd (?=vardag)/g, '$1. Tillåtelsen gäller dock högst $2 i följd. Villkoret gäller under tiden ')
      .replace(/\bEn tidsbegränsning om att parkera fordon under högst (\d{1,2}|en|två|tre|fyra) (tim\w*|min\w*) gäller (?=vardag|alla dagar|mellan|klockan)/g, 'Tillåtelsen gäller dock högst $1 $2 i följd. Villkoret gäller under tiden ')
      // all three day types in a row are every day ("vardagar, vardag före sön- och helgdag, samt sön- och helgdag mellan klockan 08 och 18")
      .replace(/(Villkoret gäller under tiden )vardag(?:ar)?,? (?:och |samt )?(?:vardag|dag)(?:ar)? före sön- och helgdag(?:ar)?,? (?:samt|och) sön- och helgdag(?:ar)?(?= (?:mellan )?(?:klockan|kl\.?) ?\d)/g, '$1alla dagar');
  }
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
  // "den 15 maj t.o.m. 15 september", "fr om 15 okt t om 15 april", "1 november - 30:april" (sweep: Vellinge, Övertorneå, Nykvarn lost the season)
  s = s.replace(/(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(?:t\.?\s?o\.?\s?m\.?|till och med)\s+(?:den\s+)?(\d{1,2})[:.]?\s*(?=januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/gi, '$1 $2 - $3 ').replace(/([-–—]\s*\d{1,2}):(?=(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b)/gi, '$1 ');
  // "mellan 1 nov och 30 april påföljande år", "från den 1 maj till den 30 september": a season (measure 25 Nov: Danderyd Slagrutevägen was banned all year)
  s = s.replace(/\b(mellan|från(?: och med)?)\s+(?:den\s+)?(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+(?:och|till(?: och med)?)\s+(?:den\s+)?(\d{1,2})\s+(?=(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b)/gi, '$1 $2 $3 - $4 ');
  s = s.replace(/(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s+till(?: och med)?\s+(?:den\s+)?(\d{1,2})\s+(?=(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b)/gi, '$1 $2 - $3 '); // "under tiden 15 oktober till 15 april" (sweep: Eskilstuna Årbygatan's Thursday ban held all year)
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
// every "D month - D month" period of a sentence, in order
function allSeasons(s) { return [...s.matchAll(/(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)/gi)].map((r) => [[MONTHS[r[2].toLowerCase()], +r[1]], [MONTHS[r[4].toLowerCase()], +r[3]]]); }
// "vecka 42 - 18", "från vecka 42 till vecka 18": ISO weeks (wrapping over New Year), Rättvik
function weeks(s) { s = s.replace(/\bgon [VvOo]\b/g, 'gon'); /* "RT90 2.5 gon V 0:-15" is a coordinate system, not week 0 (QA 11 Nov round 14: Västervik) */ const one = s.match(/(?<![\wåäö])(?:v\.?|vecka)\s*(\d{1,2})\b(?!\s*[-–—:.]\s*\d)/i); if (one && (+one[1] < 1 || +one[1] > 53)) return null; if (one && !/(?:v\.?|vecka)\s*\d{1,2}\s*(?:[-–—]|till)/i.test(s)) return [+one[1], +one[1]]; // "v 30" (QA 8 Nov: Rättvik Classic Car Week)
  const r = s.match(/(?<!(?:udda|jämna?)\s)vecka\s+(\d{1,2})\s*(?:[-–—]|till(?: och med)?(?: vecka)?)\s*(?:vecka\s+)?(\d{1,2})\b/i); return r ? [+r[1], +r[2]] : null; } // not "jämn vecka 05-07": those are hours (QA 8 Nov: Karlstad Kungsgatan)
const PWD = '(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)';
const parity = (s) => (new RegExp(`udd+a (?:veck(?:a|or)|${PWD})`, 'i').test(s) ? 'odd' : new RegExp(`jämna? (?:veck(?:a|or)|${PWD})`, 'i').test(s) ? 'even' : null); // "jämn måndag" = Monday of even weeks (QA 10 Nov round 12: Örebro Södra Lindhult); "uddda veckor": a typo (sweep wave 1: Solna Ankdammsgatan banned every Friday)

// The text itself names the same day type twice before two time ranges ("vardag utom vardag före sön- och helgdag klockan 09.00 - 18.00 och
// vardag utom vardag före sön- och helgdag klockan 09.00 - 15.00"): a slip, not a parser mis-read of two different phrases
function sameDayPhraseTwice(s) {
  const chunks = s.toLowerCase().split(/\d{1,2}(?:[.:]\d{2})?\s*[-–—]\s*\d{1,2}(?:[.:]\d{2})?/).slice(0, -1);
  const ph = chunks.map((c) => { const i = c.search(/\b(?:vardag|dag(?:ar)? före|sön- och|helgdag|lördag|söndag)/); return i < 0 ? null : c.slice(i).replace(/\b(?:mellan|klockan|kl\.?|under tiden)\b/g, ' ').replace(/[,.]/g, ' ').replace(/\b(vardag|helgdag)ar\b/g, '$1').replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  return new Set(ph).size < ph.length;
}
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
  if (/vardag(?:ar)? utom sön- och helgdag/.test(x)) return ['vardag', 'fore']; // "vardagar utom sön- och helgdagar" = Monday–Saturday (sweep: Västervik Kaptensgatan had its limit on Sundays only)
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
const NTH = /\b(?:under\s+)?(?:den\s+)?(första|andra|tredje|fjärde|sista|[1-4])\s+(helgfria\s+)?(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?:en)?\s+(?:i\s+)?(?:varje\s+)?månad(?:en)?/i; // group 2: "helgfria" (nh: holidays are skipped when counting)
const NTH_N = { första: 1, andra: 2, tredje: 3, fjärde: 4, sista: -1, 1: 1, 2: 2, 3: 3, 4: 4 }; // "1:a tisdagen" arrives as "1 tisdagen" (ruleText)
export function windows(clause) {
  const nth = NTH.exec(clause);
  if (nth) {
    const ws = windows(clause.replace(NTH, ' ').replace(/\s+året runt\b/i, ''));
    return ws.map(({ a, b, m, p }) => clean({ w: WEEKDAYS[nth[3].toLowerCase()], nw: NTH_N[nth[1].toLowerCase()], nh: nth[2] ? 1 : undefined, a, b, m, p }));
  }
  // "mot avgift under tiden klockan 18.00 - 07.00, vardag utom dag före sön- och helgdag, klockan 00.00 - 24.00, vardag före sön- och helgdag och
  // sön- och helgdag.": every time range comes first and its day types follow after a comma. Move each day list in front of its hours
  // (sweep wave 1: Solna Bagartorpsringen, Storgatan charged Mon–Fri around the clock where the text charges 18–07)
  { const DT = String.raw`(?:vardag(?:ar)?(?: utom (?:vardag(?:ar)? |dag(?:ar)? )?före sön- och helgdag(?:ar)?)?|(?:vardag(?:ar)?|dag(?:ar)?) före sön- och helgdag(?:ar)?|sön- och helgdag(?:ar)?)`;
    const re2 = new RegExp(String.raw`((?:klockan|kl\.?)\s*${TIME}),\s+(${DT}(?:(?:,|,? och|,? samt) ${DT})*)(?=,\s+(?:klockan|kl\.?)\s*\d|\s*\.?\s*$)`, 'gi');
    const first = clause.search(/\b(?:klockan|kl\.?)\s*\d/i), hits = [...clause.matchAll(re2)].length;
    if (hits >= 2 && first >= 0 && !DAY_WORD_RE.test(clause.slice(0, first)) && hits === (clause.match(/\b(?:klockan|kl\.?)\s*\d/gi) || []).length) clause = clause.replace(re2, (z, tm, a1, a2, a3, a4, days) => `${days} ${tm}`); }
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
  clause = clause.replace(/(\b(?:klockan|kl\.?)\s*\d{1,2}(?:[.:]\d{2})?\s*[-–—]\s*\d{1,2}(?:[.:]\d{2})?\s+(?:och|samt)\s+(?:(?:vardag(?:ar)?|dag(?:ar)?) före sön- och helgdag(?:ar)?|sön- och helgdag(?:ar)?))\s+(?=\d{1,2}\s*[-–—]\s*\d{1,2}\b(?![.:]\d|\s*(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b))/gi, '$1 klockan '); // "vardagar mellan klockan 8-19 och dag före sön- och helgdag 8-15": bare hours after a second day type (QA 20 Nov round 2: Vaggeryd Järnvägsgatan limited Saturdays to 19)
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
  clause = clause.replace(/(\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})\s+(?:och|samt)\s+(?=\d{1,2}[.:]\d{2}\s*[-–—])/g, '$1 och klockan '); // "07.00 - 10.00 och 15.00 - 18.00"
  clause = clause.replace(/((?:klockan|kl\.?)\s*\d{1,2}\s*[-–—]\s*\d{1,2})\s+(?:och|samt)\s+(?=\d{1,2}\s*[-–—]\s*\d{1,2}\b(?![.:]\d|\s*(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|dygn|tim|min|m\b|meter)))/gi, '$1 och klockan '); // "klockan 7-10 samt 15-18" (sweep wave 3: Lidingö Kalvhagsvägen)
  clause = clause.replace(new RegExp(String.raw`\b(${WD}),\s+(?=(?:mellan\s+)?(?:klockan|kl\b))`, 'gi'), '$1 '); // "på måndag till fredag, klockan 7-10": the comma cut the weekdays off their hours
  clause = clause.replace(/\b(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december),?\s+och\s+(?=\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})/gi, '$1 klockan '); // "under tiden 15 maj - 15 augusti och 08.00 - 18.00": the season's hours (QA 7 Nov: Tanum showed the limit all day)
  // time before day type ("Mellan klockan 8 och 22 vardagar utom vardag före … och mellan klockan 8 och 22 vardag före …", Kungsbacka):
  // move each day-type phrase in front of its hours
  // also right after a limit ("högst 4 timmar i följd mellan klockan 9-16, vardagar utom vardag före …", "… mellan klockan 8 och 18 vardagar utom … och mellan klockan 8 och 15 vardag före …"; QA 14 Nov round 25: Hudiksvall, Vellinge)
  // one time range with its day type after it, closing the sentence: "ändamålsplats för lastning … mellan klockan 09-18 under vardagar utom
  // vardag före sön- och helgdag." Move the day type in front of the hours (QA 20 Nov round 3: Gävle Norra Köpmangatan loading bay every day)
  { const tm = clause.match(new RegExp(String.raw`^([^]*?)((?:mellan\s+)?(?:klockan|kl\.?)\s*\d{1,2}(?:[.:]\d{2})?\s*[-–—]\s*\d{1,2}(?:[.:]\d{2})?)\s+(?:under\s+|på\s+)?((?:vardag(?:ar)?(?: utom (?:vardag(?:ar)? |dag(?:ar)? )?före sön- och helgdag(?:ar)?)?|(?:vardag(?:ar)?|dag(?:ar)?) före sön- och helgdag(?:ar)?|sön- och helgdag(?:ar)?))\s*\.?\s*$`, 'i'));
    if (tm && !DAY_WORD_RE.test(tm[1]) && !/\b(?:klockan|kl\.?)\s*\d/i.test(tm[1])) clause = `${tm[1]}${tm[3]} ${tm[2]}`; }
  const hoursFirst = /i följd,?\s+(?:under tiden\s+)?(?:mellan\s+)?(?:klockan|kl\.?)\s*\d/i.test(clause);
  if (hoursFirst || /^\s*(?:\d+\s*§\s*)?(?:(?:Föreskriften|Villkoret|Tidsbegränsningen|Förbudet|Tillåtelsen) gäller (?:under tiden )?(?:mellan )?)?(?:klockan|kl\.?)\s*\d/i.test(clause)) clause = clause.replace(new RegExp(String.raw`(?:klockan|kl\.?)\s*(${TIME})${hoursFirst ? ',?' : ''}\s+((?:vardag|dag(?:ar)? före|sön- och helgdag|lördag|söndag)[^,;]*?)(?=\s+och\s+(?:klockan|kl)|\s+gäller|\s*[.,;]|$)`, 'gi'), (z, tm, a1, a2, a3, a4, days) => `${days} klockan ${tm}`);
  const out = [];
  const re = new RegExp(String.raw`([^,;]*?)\b(?:klockan|kl\.?)\s*${TIME}`, 'gi');
  let m, lastDt, lastWds = null;
  while ((m = re.exec(clause))) {
    const pre = m[1];
    let a = toMin(m[2], m[3]), b = toMin(m[4], m[5]); if (a === 1440) a = 0; // "24.00 - 08.00" starts at midnight (QA 8 Nov: Sölvesborg)
    if (b === 0) b = 1440;
    if (a === b) { a = 0; b = 1440; } // "klockan 06.00 - 06.00": round the clock, not a zero-length window (QA 9 Nov: Tyresö)
    let wds = weekdaysOf(pre);
    // "måndag - fredag mellan klockan 08.00 - 10.00 och 15.00 - 17.00": the second range has the weekdays of the first (sweep wave 1:
    // Upplands Väsby Ryttargatan had the 30 min limit on Saturdays and Sundays 15–17 too)
    if (!wds && lastWds && /^\s*(?:och|samt)\s+(?:mellan\s+)?$/i.test(pre)) wds = lastWds; lastWds = wds;
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
  s = s.replace(/\bhögst\s+(\d+)\s*h\b(?![-–])/gi, 'högst $1 tim'); // "högst 8h i följd" (QA 17 Nov round 33: Upplands Väsby)
  const m = s.match(/högst\s*(\d+)\s*(tim(?:me|mar|ma|mar)?|timmar|min(?:uter)?|dygn|dag(?:ar)?|veck(?:a|or))\b/i) /* also "högst15 min" (sweep wave 2: Danderyd Mörbyhöjden lost its morning limit) */ || s.match(/gäller (?:under )?(\d+)\s*(tim(?:me|mar)?|min(?:uter)?|dygn) i följd/i); // also "Tillåtelsen gäller 4 tim i följd" (Uppsala)
  if (!m) return null;
  const n = +m[1], u = m[2].toLowerCase();
  return u.startsWith('veck') ? n * 7 * 1440 : u.startsWith('dygn') || u.startsWith('dag') ? n * 1440 : u.startsWith('tim') ? n * 60 : n;
}

// Split into sentences, keeping "kl. 7" and "8 §" intact; paragraph numbers ("1 §") and "med avvikelse från …" asides are dropped.
function sentences(t) {
  // "får fordon inte parkeras längre (tid) än 12 timmar": a longest stay, not a ban (QA 16 Nov round 31: Lidingö Kalvhagsvägen drawn as an all-day ban)
  // "mellan kl 18.00 – kl 02.00" (Sollefteå), hours straight after a season ("Förbudet gäller 15 april - 15 oktober 09.00 - 21.00", Degerfors), and a time
  // phrase between "får fordon" and "inte parkeras" ("får fordon under tiden 15 okt – 20 april inte stannas eller parkeras", "får fordon på tisdagar inte
  // parkeras 1 november - 30 april mellan klockan 07.00 - 11.00": Sollefteå, Hedemora were banned at all times)
  // Slips of the pen that hid hours or seasons (sweep findings batch 6): "mellan klockan 07 0ch 16" (Simrishamn), "(Tidsbegränsningen gäller …" (Sollefteå),
  // "mellan klockan 03:00 och klockan 05:00" (Kumla), "från klockan 19:00 till påföljande dag klockan 01:00" (Jokkmokk), "15:april" / "15oktober" / "31augusti"
  // (Eskilstuna, Värmdö, Sotenäs), "under perioden I november - 15 april" (Lycksele: a scanned 1)
  // a whole month named as the ban's period or as its exception ("får fordon inte parkeras under augusti.", "Förbudet gäller ej juli månad."), and Nynäshamn's
  // "Undantag från §1 på vardagar … mellan klockan 02 och 04 då parkeringsförbud gäller" (sweep: Orust Rosenlundsvägen was banned all year, Tidaholm Papegojas väg in July)
  { const names = Object.keys(MONTHS), dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    t = t.replace(/\b((?:inte|ej) (?:stannas eller )?parkeras) under (januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)(?: månad)?(?=\s*(?:\.|$))/gi, (z, v, mo) => { const k = MONTHS[mo.toLowerCase()]; return `${v} under tiden 1 ${names[k - 1]} - ${dim[k - 1]} ${names[k - 1]}`; });
    t = t.replace(/\bFörbudet gäller (?:inte|ej) (?:under )?(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)(?: månad)?(?=\s*(?:\.|$))/gi, (z, mo) => { const k = MONTHS[mo.toLowerCase()], nx = k % 12, pv = (k + 10) % 12; return `Förbudet gäller under tiden 1 ${names[nx]} - ${dim[pv]} ${names[pv]}`; }); }
  t = t.replace(/\bUndantag från ?§ ?\d+ (?:på |under )?([^.]*?\d) då parkeringsförbud gäller\b/gi, 'Parkering är dock förbjuden $1');
  t = t.replace(/\b(Förbudet gäller endast) fordon (?=den \d{1,2}(?::[ae])? (?:varje|i varje) månad)/g, '$1 ').replace(/\b(Förbudet gäller (?:endast )?den \d{1,2})(?::[ae])? (?:i )?varje månad\b/g, '$1 dagen i månaden'); // "Förbudet gäller endast fordon den 1 varje månad mellan klockan 08.00-12.00" (sweep: Eslöv Odengatan was banned 08–12 every day)
  t = t.replace(/\b(sön)- eller (helgdag(?:ar)?)\b/gi, '$1- och $2'); // "vardagar utom vardagar före sön- eller helgdag" (Norrtälje): the usual day type; it was read as Mon–Sat
  t = t.replace(/\b0ch\b/g, 'och').replace(/\((?=Tidsbegränsningen gäller\b)/g, '');
  // "får fordon parkeras under högst 2 tim i följd. Tillåtelsen gäller under tiden vardag … 09.00 - 18.00 och … 09.00 - 14.00 och under högst 2 tim iföljd.":
  // the limit repeated at the end of the hours sentence is the same limit, not a second one; it kept the first sentence's limit around the clock (QA 26 Nov: Osby Västra Storgatan)
  t = t.replace(/(\bhögst (\d+) (tim(?:me|mar)?|min(?:uter)?|dygn) i ?följd\.\s*(?:\d+\s*§\s*)?Tillåtelsen gäller (?:under (?:tiden|perioden) )?(?:[^.§]|\.(?=\d))*?\d),? och (?:under )?högst \2 \3 i ?följd(?=\s*\.)/gi, '$1');
  t = t.replace(/\b(mellan (?:klockan|kl\.?)\s*\d{1,2}(?:[.:]\d{2})?) och (?:klockan|kl\.?)\s*(?=\d)/gi, '$1 och ');
  t = t.replace(/(?:\b(?:från|mellan) )?\b(?:klockan|kl\.?)\s*(\d{1,2}[.:]\d{2}) (?:till|och|[-–—]) (?:påföljande|nästföljande) dag (?:klockan |kl\.? ?)?(\d{1,2}[.:]\d{2})/gi, 'klockan $1 - $2');
  t = t.replace(/\b(\d{1,2}):\s*(?=(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b)/gi, '$1 ').replace(/(?<![\d.:])(\d{1,2})(?=(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b)/gi, '$1 ');
  t = t.replace(/\b(under (?:tiden|perioden)) [Il] (?=(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—])/g, '$1 1 ');
  t = t.replace(/(\d{1,2}[.:]\d{2})\s*[-–—]\s*(?:kl\.?|klockan)\s*(?=\d{1,2}[.:]\d{2})/gi, '$1 - ');
  t = t.replace(/\b(\d{1,2} (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december))\s+(?=\d{2}[.:]\d{2}\s*[-–—]\s*\d{2}[.:]\d{2}(?!\d))/gi, '$1 klockan ');
  t = t.replace(/\bfår fordon (under tiden \d{1,2}[^.§]{3,40}?|på (?:mån|tis|ons|tors|fre|lör|sön)dagar) (inte|ej) ((?:stannas eller )?parkeras)\b/gi, 'får fordon $2 $3 $1');
  // "… får fordon parkeras. Tillåtelsen gäller 1 maj - 30 november. Övrig tid är parkering förbjuden.": a ban for the rest of the year (sweep: Sundsvall ×2 were banned all year)
  t = t.replace(/\bTillåtelsen gäller (?:under tiden )?(\d{1,2}) (januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*(\d{1,2}) (januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\.\s*(?:\d+\s*§\s*)?Övrig tid är parkering(?:en)? förbjuden\./gi, (z, d1, m1, d2, m2) => {
    const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], names = Object.keys(MONTHS); const a = MONTHS[m1.toLowerCase()], b = MONTHS[m2.toLowerCase()];
    const next = +d2 >= dim[b - 1] ? [b % 12 + 1, 1] : [b, +d2 + 1], prev = +d1 <= 1 ? [(a + 10) % 12 + 1, dim[(a + 10) % 12]] : [a, +d1 - 1];
    return `Parkering är förbjuden under tiden ${next[1]} ${names[next[0] - 1]} - ${prev[1]} ${names[prev[0] - 1]}.`; });
  // a full stop glued to the next sentence ("får fordon inte parkeras.Förbudet ger inte rätt …", Bollnäs: the plain ban stayed beside its own hours)
  t = t.replace(/\b(parkeras|stannas)\.(?=(?:Förbudet|Tillåtelsen|Parkering|Övrig)\b)/g, '$1. ');
  // "får fordon parkeras under högst 5 min i följd. Förbudet gäller vardag klockan 07.00 - 17.00" in a text that bans nothing: a slip for
  // "Tidsbegränsningen gäller" (sweep: Tingsryd Norrgatan, Lomma Varvstorget were banned in the limit's hours)
  if (/\bfår (?:fordon|motorfordon|personbil(?:ar)?) parkeras (?:under )?högst\b[^.§]*\.\s*(?:\d+\s*§\s*)?Förbudet gäller(?! inte| ej)/.test(t) && !/(?:inte|ej) (?:stannas|parkeras)|får (?:inte|ej)\b|parkering(?:en)? (?:är |råder )?(?:dock )?förbjuden|förbud (?:att|mot att) (?:stanna|parkera)|parkeringsförbud/i.test(t.replace(/(?:ger|ge) (?:inte|ej) rätt att[^.]*/gi, ''))) t = t.replace(/\bFörbudet gäller(?! inte| ej)/g, 'Tidsbegränsningen gäller');
  // also "inte parkeras under längre tid än 2 timmar vardagar mellan klockan 08.00 – 18.00" and "inte parkeras i längre följd än 15 minuter" (sweep: Vilhelmina,
  // Sollefteå, Laxå, Filipstad, Säter, Lycksele, Lund, Hallstahammar were drawn as bans). A "Förbudet gäller <hours>" after it gives the limit's hours
  // when the text bans nothing else
  { let longest = false;
    t = t.replace(/\bfår (inte |ej )?((?:fordon|motorfordon|personbil(?:ar)?)\s+)(?:(inte|ej)\s+)?parkeras (?:under |i )?längre (?:tid |följd )?än (?=(?:\d+|en|ett|två|tre|fyra|fem|sex|sju|åtta|nio|tio|tolv|femton|tjugo|trettio)\s+(?:\(\d+\)\s*)?(?:tim|min|dygn))/gi, (z, n1, v, n2) => { if (!(n1 || n2)) return z; longest = true; return `får ${v}parkeras under högst `; });
    if (longest && !/(?:inte|ej) (?:stannas|parkeras)|parkering(?:en)? (?:är )?förbjuden|förbud (?:att|mot att) (?:stanna|parkera)/i.test(t.replace(/(?:ger|ge) (?:inte|ej) rätt att[^.]*/gi, ''))) t = t.replace(/\bFörbudet gäller(?! inte| ej)/g, 'Tidsbegränsningen gäller'); }
  // "På 6 markerade platser … får fordon parkeras.. Förbudet gäller under tiden vardag … och under högst 24 tim i följd": a slip for "Tillåtelsen" when
  // the text bans nothing (sweep: Salem Toredalsvägen was banned on weekdays)
  if (/\bFörbudet gäller[^.§]*\bhögst \d+ ?(?:tim|min|dygn)/.test(t) && /får fordon parkeras/i.test(t) && !/(?:inte|ej) (?:stannas|parkeras)|parkering(?:en)? (?:är )?förbjuden|förbud (?:att|mot att) (?:stanna|parkera)/i.test(t.replace(/(?:ger|ge) (?:inte|ej) rätt att[^.]*/gi, ''))) t = t.replace(/\bFörbudet gäller(?=[^.§]*\bhögst \d+ ?(?:tim|min|dygn))/g, 'Tillåtelsen gäller');
  // "mellan klockan 00.00 06.00": the dash between the times was lost (QA 16 Nov round 31: Kalix Köpmannagatan's winter night ban unread)
  t = t.replace(/\b((?:mellan )?(?:klockan|kl\.?)\s*\d{1,2}[.:]\d{2})\s+(\d{1,2}[.:]\d{2})(?![\d.:]*\s*(?:[-–—]|och|till)\s*\d)/gi, '$1 - $2');
  // "får fordon inte parkeras Under tiden 4:e tisdagen … får dock fordon parkeras": the full stop was lost at a line break, so the next
  // sentence's hours were read as the ban's own hours (QA 17 Nov round 32: Helsingborg Kurirgatan banned only on the 4th Tuesday)
  t = t.replace(/\b(parkeras|stannas)\s+(?=(?:Under tiden|Förbudet|Tillåtelsen|Tidsbegränsningen|Villkoret|Reservationen|Avgift|Parkering (?:är|får))\b)/g, '$1. ');
  t = t.replace(/(\d)§/g, '$1 §');
  // "får fordon och fordon som används av boende i området och för vilka särskilt tillstånd utfärdats … parkeras": every vehicle (residents
  // included) gets the permission; the resident clause adds nobody (QA 22 Nov measure: Kalmar Proviantgatan, Ölandsgatan kept the register's Saturday-only limit)
  t = t.replace(/\b([Ff]år (?:fordon|personbil(?:ar)?)) och (?:fordon|personbil(?:ar)?) som (?:används|brukas|nyttjas) av boende\b[^.;]*?\b(?:tillstånd|parkeringstillstånd) (?:har )?(?:utfärdats|meddelats|beviljats)\s+/g, '$1 ');
  // "1 § På den del av Eriksbergsvägen som anges i kartan parkeras under högst 4 tim i följd.": the words "får fordon" were lost when the
  // regulation was written; a place followed straight by "parkeras" is that permission (sweep wave 1: Uppsala Eriksbergsvägen, Råbyvägen)
  t = t.replace(/(^|[.;]\s+|\d\s*§\s+)((?:På|Inom) (?:(?!\b(?:får|inte|ej|ska|skall)\b)[^.;])*?(?:som anges i kartan|enligt (?:markering (?:på|i) )?kartbild(?:en)?))\s+(?=parkeras\b)/g, '$1$2 får fordon ');
  t = t.replace(/\b([Ff]år (?:fordon|personbil(?:ar)?)) stannas (under )?högst\b/g, '$1 parkeras $2högst'); // "får fordon stannas under högst 24 tim i följd": a longest stay for stopping holds for parking too (QA 18 Nov round 37: Gotland Mellangatan had its 24 h limit in the fee hours only)
  t = t.replace(/\b(Förbudet(?: att parkera)?) i paragraf (?=gäller\b)/g, '$1 '); // "Förbudet att parkera i paragraf gäller …": the paragraph number is missing (QA 18 Nov round 35: Uppsala Hällbygatan's night ban unread) // "Tillåtelsen i 1§ gäller …": a glued paragraph sign hid the sentence's subject (QA 14 Nov round 25: Hudiksvall)
  t = t.replace(/\b(får (?:endast )?fordon med resande\b[^.,]*), (?=parkeras\b)/gi, '$1 '); // "får fordon med resande med tåg eller buss, parkeras": keep the group when the comma clause is cut below (Alvesta)
  t = t.replace(/,\s*med avvikelse från ([^.]*?trafikföreskrifter[^.]*?),\s*[A-ZÅÄÖ][a-zåäö]+(?: [A-ZÅÄÖ][a-zåäö]+)?\s+(parkeras|stannas)\b/g, (z, mid, v) => (/\b(?:inte|ej|får)\b/i.test(mid) ? z : ` ${v}`)); // the cited regulation's title ends in the town after a comma: "får fordon, med avvikelse från (0861 2018 : 120) om … förbud att parkera på norra sidan av Kyrkogårdsgatan, Mönsterås parkeras" (QA 27 Nov: Mönsterås Kyrkogårdsgatan drawn as a ban)
  t = t.replace(/,\s*med avvikelse från [^.,]*?trafikföreskrifter\s*\([^)]*\)([^.,]*?)\s(parkeras|stannas)\b/gi, (z, mid, v) => (/\b(?:inte|ej|får)\b/i.test(mid) ? z : ` ${v}`)) /* no comma after the clause: "får fordon, med avvikelse från … (0484 2016 : 211) om område med förbud att parkera parkeras under högst 3 tim" (QA 30 Oct: Eskilstuna) */;
  t = t.replace(/\b(får (?:fordon|motorfordon|motordrivet fordon|motorcyk(?:el|lar)|personbil(?:ar)?)(?: som används (?:av|för) [^.,;]{1,80}?)?) med avvikelse från ((?:[^.,;]|\.(?!\s+[A-ZÅÄÖ]|\s*$))*?(?:trafikföreskrifter|trafikförordningen|\(1998:1276\))(?:[^.,;]|\.(?!\s+[A-ZÅÄÖ]|\s*$))*?)\s(parkeras|stannas)\b/g, (z, f, mid, v) => (/\b(?:inte|ej|får)\b/i.test(mid) ? z : `${f} ${v}`)); // no commas around the clause: "får fordon med avvikelse från kommunens lokala trafikföreskrifter 1981 2004 : 0110 parkeras" (Sala, Åstorp, Alingsås, Mjölby)
  t = t.replace(/,?\s*med avvikelse från [^.]*?,\s*((?:inte |ej )?(?:stannas eller )?(?:parkeras|stannas))\b/gi, ' $1').replace(/\b(får (?:fordon|motorfordon|motordrivet fordon|motorcyk(?:el|lar)|personbil(?:ar)?)(?: som används (?:av|för) [^.,;]{1,80}?)?) med avvikelse från ((?:[^.,;]|\.(?!\s+[A-ZÅÄÖ]|\s*$))*?(?:trafikföreskrifter|trafikförordningen|\(1998:1276\))(?:[^.,;]|\.(?!\s+[A-ZÅÄÖ]|\s*$))*?)\s(parkeras|stannas)\b/g, (z, f, mid, v) => (/\b(?:inte|ej|får)\b/i.test(mid) ? z : `${f} ${v}`)) /* again, now the comma clause is gone: "får fordon med avvikelse från 3 kap. 53 § 2 trafikförordningen (1998:1276), med avvikelse från <area ban, list>, parkeras" (QA 10 Nov round 13: Kalmar Unionsgatan) */ /* the clause names a list of areas or regulations with commas (Kalmar; "…, 1780 2024:00346 om parkering på Norra Klaragatan, 1780 2024:00347 …, inte parkeras", QA 5 Nov: Karlstad) */.replace(/(^|\.\s+(?:\d{1,2}\s*§\s+)?)Med avvikelse från (?:bestämmelser(?:na)?|förbudet|tillåtelsen) i [^,.]{0,40}?,\s*(\p{Ll})/gu, (z, a, c) => `${a}${c.toUpperCase()}`) /* the clause opens the sentence: keep it a sentence of its own (Lerum: "3 § Med avvikelse från bestämmelserna i 1 §, får tung lastbil inte parkeras" swallowed the 4 h limit before it) */.replace(/,?\s*med avvikelse från [^,]*?,/gi, ' ').replace(/\b(får fordon) [^.,]{1,40}, (parkeras)/g, '$1 $2').replace(/\b(får fordon), (parkeras)\b/g, '$1 $2') /* stray comma: "får fordon, parkeras där stannande och parkering är förbjuden …" (QA 9 Nov round 10: Eskilstuna Gredbyvägen drawn as a total ban) */.replace(/\bTrots tillåtelsen i \d+ § får /g, 'Får ').replace(/\bTilllåtelsen\b/g, 'Tillåtelsen').replace(/\bFöbudet\b/g, 'Förbudet') /* typo (Skurup) */.replace(/\bsön- och heldag/g, 'sön- och helgdag') /* typo (Ängelholm) */.replace(/\bvardar\b/g, 'vardagar') /* typo (QA 15 Nov round 26: Lidingö Farkostvägen limit drawn every day) */.replace(/\b((?:klockan|kl\.?) [\d.:]+ (?:och|till|[-–]) [\d.:]+) på (?=vardag|dag före|sön- och helgdag|lördag|söndag)/g, '$1 ') /* "Mellan klockan 9 och 15 på vardagar före sön- och helgdag gäller dock tillåtelsen …" (QA 4 Nov: Ängelholm) */.replace(/\b(dag(?:ar)?) för (sön- och helgdag)/g, '$1 före $2') /* "utom dag för sön- och helgdag" (Kiruna) */.replace(/\binnom\b/g, 'inom').replace(/\b((?:klockan|kl\.?|och)\s*)([01]\d|2[0-4])([0-5]\d)\b(?![.:,]\d)/g, '$1$2.$3') /* "klockan 0800 och 1800" (Värmdö) */.replace(/\b(dag(?:ar)? före) söndag och helgdag/g, '$1 sön- och helgdag').replace(/\bTillåtelsen (?:att parkera )?i paragraf ?\d*\s*§? ?(?=gäller)/g, 'Tillåtelsen ').replace(/\bTillåtelsen att parkera (?:i|enligt) \d+\s*§?\s*(?=gäller)/g, 'Tillåtelsen ').replace(/\b((?:vardag|måndag|tisdag|onsdag|torsdag|fredag|lördag)(?:ar)?), utom ([^,.]*?helgdag(?:ar)?),\s+/g, '$1 utom $2 ') /* "vardagar, utom vardag före sön- och helgdag, mellan …" (Vellinge) */.replace(/personbil klass (?:I|1) (?:och|samt|eller) personbil klass (?:II|2)/gi, 'personbil') /* both classes = any car (Lysekil) */.replace(/(\s)-(?=(?:vardag|sön|lördag|dag|fredag|måndag|tisdag|onsdag|torsdag)\w*)/g, '$1') /* "-vardagar … och -vardag före …" list bullets */.replace(/\b([Ff]år) dock fordon\b/g, '$1 fordon').replace(/\b([Ff]år) ((?:på|inom|i) [^.,]{1,80}?) (fordon) (parkeras)\b/g, (z, f, pl, fo, pa) => (/\b(?:inte|ej|endast|enbart|klass|ton|lastbil|buss|tillstånd|rörelsehindrad\w*)\b/i.test(pl) ? z : `${f} ${fo} ${pa}`)).replace(/\b([Ff]år fordon) ((?:på|inom|i) [^.,]{1,100}?) (parkeras)\b/g, (z, f, pl, pa) => (/\b(?:inte|ej|endast|enbart|klass|ton|lastbil|buss|tillstånd|rörelsehindrad\w*|får)\b/i.test(pl) ? z : `${f} ${pa}`)) /* "får på markerade platser fordon parkeras", "får fordon på markerade platser inom slingan … parkeras" (QA 30 Oct: Bollnäs, Smedjebacken) */.replace(/\bvardag(ar)? dag före sön- och helgdag/g, 'vardag$1 före sön- och helgdag') /* "vardagar utom vardag dag före" (Bollnäs) */.replace(/\b(inte|ej) parkers\./g, '$1 parkeras.') /* typo (QA 6 Nov: Staffanstorp Hjärup) */.replace(/\bfår (?:endast )?(?:lätt lastbil(?:ar)? och personbil(?:ar)?|personbil(?:ar)? och lätt lastbil(?:ar)?) (?=parkeras)/g, 'får fordon ') /* "får lätt lastbil och personbil parkeras": ordinary vehicles (QA 6 Nov: Västerås Skerikesvägen) */.replace(/\s{2,}/g, ' ');
  t = t.replace(/\b(får fordon) (under tiden \d{1,2} [a-zåäö]+ ?[-–] ?\d{1,2} [a-zåäö]+) (parkeras)\b([^.]*)/g, '$1 $3$4 $2'); // "får fordon under tiden 1 oktober - 30 april parkeras mot avgift" (Sundsvall)
  // "personbil klass I" is an ordinary car: a permission for it (alone or listed with mopeds, motorcycles, A-tractors) is a permission
  // for cars, motorhomes excluded ("får moped, motorcykel, personbil klass I och traktor a parkeras", "får personbil klass I stannas eller
  // parkeras", "får enbart personbil klass 1 parkera"; QA 3 Nov: Sigtuna, Oxelösund, Vellinge, Orust)
  { const LV = String.raw`(?:moped(?:er)?(?: klass (?:I|1|II|2))?|motorcykel|motorcyklar|traktor a|a-traktor(?:er)?)`;
    t = t.replace(new RegExp(String.raw`\b([Ff]år)(?: (?:endast|enbart|bara))? (?:${LV},? (?:(?:och|samt|eller) )?)*personbil(?:ar)? klass (?:I|1)\b(?:(?:,|,? (?:och|samt|eller)) ${LV})*(?=,? (?:stannas|parkeras?)\b|,? (?:på|inom|i|under|mellan|med) )`, 'g'), '$1 fordon')
      .replace(/\bTillåtelsen gäller (?:endast |enbart )?(?:för )?personbil(?:ar)? klass (?:I|1)\.(?=\s|$)/g, 'Tillåtelsen gäller endast personbil.'); }
  // "får tvåhjulig motorcykel och moped klass I utan sidvagn(, med avvikelse från …,) parkeras" without "endast": a motorcycle bay, as with
  // "endast" (QA 18 Nov round 35: Knivsta Järnvägstorget, Sigtuna, Eskilstuna showed the bay's 48 h limit for all cars)
  t = t.replace(/\b([Ff]år(?: (?:endast|enbart|bara))?) (?:tvåhjuliga? )?(?:motorcyk(?:el|lar)|moped(?:er)?)(?: klass (?:I|1))?(?:,? (?:och|samt|eller) (?:tvåhjuliga? )?(?:motorcyk(?:el|lar)|moped(?:er)?)(?: klass (?:I|1))?)*(?: utan sidvagn)?(?=,? (?:stannas eller )?parkeras\b)/g, '$1 motorcykel')
    .replace(/\b(får (?:endast )?motorcykel),? med avvikelse från ([^.]*?(?:trafikföreskrifter|\(1998:1276\))[^.]*?),?\s(parkeras)\b/g, (z, f, mid, v) => (/\b(?:inte|ej|får)\b/i.test(mid) ? z : `${f} ${v}`));
  t = t.replace(/\b((?:måndag|tisdag|onsdag|torsdag|fredag|lördag)(?:ar)?) som infaller (?:på )?vardag(?:ar)?\b/g, '$1 vardag'); // "torsdagar som infaller vardagar" (Skellefteå): the weekday when it is not a Sunday or holiday; a Thursday before a holiday is a "vardag" too (sweep wave 15: Maundy Thursday had no ban)
  t = t.replace(/\bklocka(?=\s*\d)/g, 'klockan');
  t = t.replace(/(\d\d),? (och|samt) (sön- och helgdag(?:ar)?)(?=\s*(?:\.(?!\d)|$))/g, '$1 $2 $3 klockan 00.00 - 24.00'); // "… klockan 14.00 - 08.00 och sön- och helgdag.": a day type after the timed ones, with no hours of its own, is the whole day (QA 13 Nov round 20: Vänersborg Torget was free on Sundays) // "mellan klocka 08.00- 17.00": a typo for "klockan" (QA 13 Nov round 20: Gävle Ulvsätersvägen kept the register's limit at the wrong hours)
  t = t.replace(/\b(under tiden|gäller) (\d{1,2}[.:]\d{2}\s*[-–—]\s*\d{1,2}[.:]\d{2})\b/g, '$1 klockan $2'); // "Förbudet gäller under tiden 07:00 - 12:00": hours without "klockan"
  t = t.replace(/\b(\d):(?=\s+(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)en\b)/g, '$1'); // "den 1: måndagen i varje månad" (Kalmar)
  // "får fordon (inte) parkera": the active form, read as "parkeras" (QA 3 Nov: Leksand, Strömstad, Ekerö)
  t = t.replace(/\b([Ff]år (?:(?:inte|ej) )?(?:fordon|motorfordon|personbil(?:ar)?)(?: (?:inte|ej))?) parkera\b(?!s)/g, '$1 parkeras');
  // "… klockan 08.00 – 24.00 Under tisdag klockan 06.00 – 18.00 får fordon inte parkeras": a new sentence without its full stop (QA 3 Nov: Uppsala Svartmangatan lost the Tuesday ban)
  t = t.replace(/(\d)\s+(?=Under (?:tiden )?(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|vardag)(?:ar(?:na)?)?\b)/g, '$1. '); // also "… 06.00 - 00.00 Under tiden måndag - söndag klockan 00.00 - 06.00 får dock fordon inte parkeras" (Ludvika: read as a ban all day)
  t = t.replace(/\bmellan ([01]?\d|2[0-4])((?:[.:][0-5]\d)?) och ([01]?\d|2[0-4])((?:[.:][0-5]\d)?)(?=\s*(?:[.,;]|$|\d{1,2}\s*§\s+[A-ZÅÄÖ]))/g, 'mellan klockan $1$2 och $3$4'); // "vardag … mellan 08 och 18." without "klockan" (Lund): hours, not metres
  t = t.replace(/\b(dag|vardag(?:ar)?) (?:före|för) söndag(?:ar)? och helgdag(?:ar)?/gi, '$1 före sön- och helgdag').replace(/\b(vardag(?:ar)?) för (sön- och helgdag)/gi, '$1 före $2'); // "dag före söndag och helgdag" (Hallstahammar), "vardagar för sön- och helgdag" (Mullsjö): the usual day type, not a Sunday
  t = t.replace(/\b(Förbudet|Tidsbegränsningen|Tillåtelsen|Villkoret) gäller ((?:mellan )?klockan [^.]+?)\.\s*(?:\d+ §\s*)?\1 gäller ((?:under tiden )?(?:vardag|sön- och helgdag|dag före)[^.]*?)\./g, '$1 gäller $3 $2.'); // hours in one sentence, their days in the next ("Förbudet gäller mellan klockan 8 och 12. 3 § Förbudet gäller vardagar, utom …", QA 26 Oct: Katrineholm)
  t = t.replace(/\b((?:vardag|dag)(?:ar)?) före helgdag(?:ar)?\b/g, '$1 före sön- och helgdag').replace(/\b(före sön- och helgdag) (och|samt) helgdag(?:ar)?\b/g, '$1 $2 sön- och helgdag'); // "vardagar utom dag före helgdag kl 08-18 samt dag före helgdag kl 08-15" (Växjö): the usual day types, Saturday included
  t = t.replace(/\b(vardag(?:ar)?),?\s+dock (?:ej|inte)\s+(?=(?:vardag(?:ar)? |dag(?:ar)? )?före sön- och helgdag)/gi, '$1 utom '); // "vardagar, dock ej dag före sön- och helgdag" = "utom" (QA 26 Oct: Hagfors read as Saturdays)
  t = t.replace(/([^.;\s])\s+(?=Tillåtelsen ger inte rätt)/g, '$1. '); // the city text sometimes lacks the full stop before this sentence
  t = t.replace(/([a-zåäö)0-9])\.(?=[A-ZÅÄÖ][a-zåäö])/g, '$1. ').replace(/([a-zåäö)])\.(?=\d{1,2}\s*§\s+[A-ZÅÄÖ])/g, '$1. '); // "… helgdag.2 § Fordon som inte får parkeras …": a glued paragraph (sweep: Hultsfred Koppargatan's disabled bay was open to all cars) // "… i följd.Tillåtelsen", "… 14.00.Tillåtelsen": glued sentences
  t = t.replace(/([^.;\s])\s+(\d{1,2}\s*§\s+)(?=[A-ZÅÄÖ][a-zåäö])/g, '$1. $2');
  t = t.replace(/([^.;\s])\s+(?=(?:Parkering (?:är|får)|Förbudet (?:gäller|ger)|Tillåtelsen (?:att parkera )?(?:gäller|ger)|Tidsbegränsningen gäller|Avgiftsplikten gäller|Avgift ska betalas)\b)/g, '$1. '); // a rule sentence with no full stop before it ("… KF § 119/18 Parkering är dock förbjuden …", Skövde) // "… (1998:1276) 2 § Mellan klockan …": a new paragraph without a full stop before it (Kungsbacka)
  t = t.replace(/\bFörbuden i [\d\s§,och-]+§§? gäller\b/g, 'Förbudet gäller');
  t = t.replace(/\bTillståndet gäller (?=(?:under (?:tiden|perioden) )?(?:den )?\d{1,2}\s*(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—])/g, 'Tillåtelsen gäller '); // "får fordon parkeras under högst 15 min … Tillståndet gäller under tiden 1 september - 31 maj": the permission's season, as "Tillåtelsen gäller" (QA 19 Nov round 40: Halmstad Skolgatan showed summer as free inside the area ban)
  t = t.replace(/\b(Förbudet|Tidsbegränsningen|Tillåtelsen) i (?:paragraf )?\d+ ?§ gäller (?=(?:under tiden )?(?:vardag|dag(?:ar)? före|sön- och helgdag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|mellan klockan|klockan|kl\.? ?\d))/g, '$1 gäller '); // "Tidsbegränsningen i 1 § gäller vardag utom … mellan klockan 08.00- 17.00": the hours of the rule in 1 § (QA 13 Nov round 20: Gävle Ulvsätersvägen) // "Förbuden i 2 § och 3 § gäller onsdagar …" (Norrtälje): the hours of the bans above
  t = t.replace(/(^|[.;]\s+)\d{1,2}\s*§\s+(?=[A-ZÅÄÖ])/g, '$1');
  t = t.replace(/(^|[.;]\s+)\d{1,2}\s*§\s+(?=\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b)/g, '$1Under tiden '); // "… gäller 31 juli - 1 maj. 4 § 1 maj - 31 juli gäller dock …": a paragraph opening with a date is a sentence of its own (QA 28 Oct: Sotenäs merged both seasons into none) // paragraph numbers "2 § Tidsbegränsningen …" (not "13 kap. 8 § trafikförordningen")
  // "får tvåhjulig motorcykel och moped kl. 1 utan sidvagn, med avvikelse från … om förbud att parkera inom område …, parkeras": a motorcycle bay; "kl. 1" ended the
  // sentence and "utan sidvagn" hid the vehicle list, so the line kept the register's ban in the bay's season and was free the rest of the year (sweep findings batch 8:
  // Sundsvall Kyrkogatan, Gävle, Kristianstad, Vaxholm, Borgholm, Örnsköldsvik)
  t = t.replace(/\b(moped(?:er)?) kl\.? ?(1|2|I{1,2})\b/g, '$1 klass $2').replace(/\b((?:motorcyk(?:el|lar)|moped(?:er)?)(?: klass (?:I{1,2}|[12]))?) utan sido?vagn\b/gi, '$1').replace(/\btvåhjulig (?=moped)/gi, '');
  t = t.replace(/\b(kv|ca|nr|resp|fast)\.(?=\s)/gi, '$1§DOT§'); // "parkeringsplats kv. Pilen": an abbreviation, not the end of a sentence
  return t.replace(/(\d)\.(\d)/g, '$1§DOT§$2').split(/(?<=[.;])\s+(?=[A-ZÅÄÖ])/).map((s) => s.replace(/§DOT§/g, '.').trim()).filter(Boolean);
}

const IGNORE = [
  /^Parkering tillåts endast inom (?:skyltad utsträckning|markerade platser)/i, /^Parkeringen vinterunderhålls (?:ej|inte)/i, /^Parkering får endast ske enligt uppsatt skyltning(?: och datumparkering gäller (?:ej|inte))?\.?$/i, /^I övrigt fritt\.?/i, // where to stand or who clears the snow: no rule (sweep: Kiruna, Luleå, Svedala texts stayed unread for these alone)
  /^(?:Personbil klass (?:II|2)|Släpfordon|Husvagn(?:ar)?)(?: och (?:släpfordon|personbil klass (?:II|2)|husvagn(?:ar)?))? får (?:inte|ej) parkeras\.?$/i, // motorhomes and trailers: no rule for cars (Tanum, Gotland)
  /^Avgiftsplikten gäller/i, /^Avgift ska betalas/i, /^(?:Parkeringsskiva|P-skiva)/i, /^Med (boende|fordon|.*avses)/i, /^med stöd av/i,
  /^Koordinatsystem/i, /^Föreskriften (?:skall|ska) utmärkas/i, /^Vägmärkesförordningen/i, /^Denna föreskrift ersätter/i, /^Föreskriften ersätter/i,
  /gäller (?:inte|ej) (?:vid |för )?(?:ambulans|lastbil|(?:skol)?buss|taxi|utryckning|moped|cykel|motorcykel|fordon som används i (?:väg|gatu)arbete)/i, // also "Förbudet gäller inte vid taxi i tjänst", "… inte för skolbuss och taxi": an exemption, no reservation (sweep waves 9–13: Landskrona Eriksgatan, Kristianstad Färlöv shown as taxi-only)
  /^Stockholms kommun föreskriver/i, /trafikförordningen \(1998:1276\) följande/i, /^Publicerat/i, /^beslutade den/i,
  /^Inom tidsangivelsen som anges i \d+ ?§ (?:skall|ska) avgift erläggas/i /* the fee's hours are those of the paragraph it names: a fee detail (sweep wave 3: Haninge Rudsjöterrassen bus bay stayed unread) */, /^Uppställning av fordon sker/i, /^Tillåtelsen ger inte rätt/i, /^Tillåtelsen gäller (?:inte|ej) på särskilt markerad busshållplats/i, /^Villkoren gäller även taxi\b/i, /^För parkering enligt tidsbegränsningen ska parkeringsskiva/i, /^Gäller endast (?:på )?markerade platser\b/i, /^Parkering (?:ska |skall )+ske på avgränsad yta/i, /^Förbudet gäller (?:inte|ej) (?:vid |för )?(?:skolskjuts|renhållningsbil|renhållningsfordon|sopbil)/i,
  // an exemption for loading or for letting passengers off, whatever its own terms ("… under högst 30 minuter", "… av gods, dock längst 5 min", "… inom särskilt markerad ruta",
  // "… under tiden mellan klockan 06.00 – 18.00"): the ban stands for parking (sweep waves 13–27: Gnesta Kullagatan, Vetlanda Storgatan, Töreboda Drottninggatan showed N minutes of free parking, Mönsterås Älgerumsvägen a ban by day only)
  /^Förbudet gäller (?:inte|ej) (?:vid |för )?(?:lastning (?:och|eller) lossning|(?:av|på)- (?:och|eller) (?:av|på)lastning|(?:på|av)- (?:och|eller) (?:av|på)stigning)\b(?![^.]*\bparkering\b)/i,
  // the same for dropping off and fetching children or passengers, with the minutes it may take (sweep findings batch 8: Lekeberg Dammgatan, Tanum Solhöjdsvägen and Rättvik
  // Thunbergs gata showed 10–30 minutes of free parking where the text bans parking)
  /^Parkeringstiden övervakas med\b/i, // "Parkeringstiden övervakas med s.k P-skiva": how the limit is checked (Haparanda Storgatan ×4 stayed grey)
  /^Förbudet gäller (?:inte|ej) vid lämnande (?:och|eller) hämtning\b/i, /^Förbudet (?:i \d+ ?§ )?tillåter (?:av|på)-? ?(?:och|eller) (?:av|på)stigning\b/i, /^Förbudet gäller (?:inte|ej) fordon parkerade för upphämtning av pass\w+/i, /^Tillåtelsen i \d+ ?§ ger ger inte rätt/i, /^Föreskrifterna gäller/i, /^Bestämmelsen gäller/i, /^Detta gäller/i, /^Undantag(?![^.]*(?:klockan|kl\b|\d[.:]?\d* (?:och|-|–) \d|förbud))/i /* not "Undantag från §1 på vardagar … mellan klockan 02 och 04 då parkeringsförbud gäller": a ban (QA 12 Nov round 18: Nynäshamn) */,
  /^Förbudet ger inte rätt/i, /^Parkering (?:ska|skall) ske vinkelrätt|^Parkering sker vinkelrätt/i /* how to stand, no rule (Täby) */, /^För parkering på [^.]* ska avgift erläggas/i /* the fee's season; the fee itself is in the data (Vaxholm) */, /gäller (?:inte|ej) (?:på )?enskild väg/i, /^Tiden, avrundad/i, /anges med parkeringsskiva/i, /^Förbudet gäller alla fordon/i, /^Förbudet gäller om inte annat/i, /gäller inte fordon i linjetrafik/i,
  /^Förbudet gäller (?:inte|ej) (?:heller )?(?:för )?(?:leveransfordon|behörig trafik)\b(?:[^.]|\.(?=\d))*\.?$/i, // exemptions for delivery vehicles / authorised traffic, not for cars (QA 18 Nov round 36: Halmstad innerstad summer ban stayed unread)
  /^Förbudet gäller (?:inte|ej) (?:vid|för) (?:lastning (?:och|eller) lossning(?: av gods)?|(?:på|av)- (?:och|eller) (?:av|på)stigning)\.?$/i, // an exemption for loading or for letting passengers off changes nothing for parking (sweep wave 1: Solna Gustav III:s boulevard kept the register's Mon–Fri where the text bans "vardag", Saturdays too)
  /^Förbudet gäller inte där parkering är tillåten enligt/i, /^Se /i, /^Övrig tid se parkering\.?$/i, /^Parkeringe?ns?regleringen avser (?:inte|ej) uppställning av husvagn(?:ar)?\.?$/i, /^Parkerade fordon får (?:inte|ej) blockera in-? ?(?:och|eller) utfarter[^.]*\.?$/i, /^Parkeringen gäller \d+ (?:parkerings)?platser\.?$/i, /^Förbudet gäller (?:inte|ej) [^.]{0,60}\brenhållningsfordon\.?$/i /* notes and exemptions that are no rule for a parked car (sweep findings batch 9: Mariestad Torsö, Tanum Prästgårdsvägen, Söderhamn Åsgatan, Mölndal Knarrhögsgatan) */ /* a pointer to the sign (QA 10 Nov: Vimmerby) */, /^Tillåtelsen gäller (?:endast )?på särskilt anordnade? parkeringsplats(?:er)?\.?$/i, /\bboendeparkering\b[^.]*(?:tillåte?n?|villkor|bestämmelser)/i, /^särskilda (?:villkor|bestämmelser)/i, /^förbudet gäller (?:inte|ej) fordon med (?:särskilt )?tillstånd/i, /^förbudet gäller (?:inte|ej) [^.]{0,40}\bpersonal(?:en|s)?\b/i, /^första (?:timmen|halvtimmen|(?:två|tre|fyra|\d+) timmarna) är avgiftsfria?/i /* free first hours: a fee detail, no rule (QA 13 Nov round 21: Huddinge Sjödalsvägen) */, /^förbuden i [^.]*ger (?:inte|ej) rätt/i, /^följande (?:gator|vägar) ingår/i, /^om inte annat föreskrivits/i, /^övrig tid får parkering ske utan/i, /^föreskriften träder i kraft/i, /^i området ingår även/i, /^förbudet gäller endast på allmänna platser/i, /^förbudet gäller (?:inte|ej) (?:på )?markerade platser/i, /^förbudet gäller (?:inte|ej) om annat/i, /^\S+ taxa\b[^.]*biljett/i, /^taxa\s*[-–]/i, /^vid parkering enligt \d+\s*§/i, /^\S+ kommuns lokala trafikföreskrifter om\b/i, /^tillåtelsen gäller endast personbil(?:ar)?\.?$/i, /^parkering (?:är )?endast tillåte[nt] för (?:fordon|personbil(?:ar)?) klass (?:I|1)\.?$/i, /^på parkeringsskiva/i, /^vid använ-?dande av parkeringsskiva får parkering ske\b/i /* rounding to the next half hour: no rule (QA 5 Nov: Lomma, Danderyd) */, /^samtliga koordinater/i, /^zon\.?$/i, /^förbudet gäller på (?:gatans|vägens) båda sidor/i, /^tillåtelsen gäller följande sidor\.?$/i, /^(?:med (?:hus)?nr\.? \d+\s*[-–]\s*\d+ gäller (?:\S+ )?\S*sidan?\.?\s*)+$/i /* which side by house number: placement only (QA 8 Nov round 7: Täby Åkerbyvägen lost its night ban) */, /^förbudet gäller (?:inte|ej) (?:för )?(?:skolskjuts|vid på- eller avlastning|vid av- och pålastning)/i, /^avvikelsen avser även/i, /^trf \(/i, /^allmänna lokala trafikföreskrifter\b/i, /^(?:röd|blå|grön|gul|vit|lila) taxa\.?$/i, /^förbudet gäller (?:endast )?(?:under )?skoldagar\.?$/i, /^boende(?:parkering)? zon \S+\.?$/i, /(?:inte|ej) parkeras annat än (?:på|inom) (?:särskilt )?(?:markerad|anordnad)/i, /^vid parkering ska(?:ll)? fordon uppställas/i, /^förbudet gäller (?:inte|ej) (?:inom|på) särskilt (?:anordnad|markerad)/i, /nämnden\b(?![^.]*(?:får|parkeras|gäller|förbjud))/i, /\btaxa\b[^.]*boendeparkering[^.]*gäller/i, /^Instruktioner på parkeringsmätare/i, /^villkor för boendeparkering gäller/i, /^tillåtelsen gäller endast (?:\w+ )?(?:särskilt )?(?:markerade|anvisade|uppmärkta) platser\.?$/i, /^camping är (?:inte|ej) tillåte[nt]/i, /^Digital registrering/i, /^Den första timmen/i, /^För parkering inom .* tas avgift/i,
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
  // exemptions and notes that change nothing for a parked car (sweep findings batch 6: Vellinge Hamnvägen kept its summer ban all year, Salem Tussilagostigen and
  // Katrineholm Hantverkaregatan kept the register's weekly twin of a ban, Norrtälje Minervavägen an all-day limit)
  /^Förbudet gäller (?:inte|ej) (?:för )?varutransporter\.?$/i,
  // what permit holders get on top of a permission for every car, and where the disabled bays are: no reservation of the stretch (sweep findings batch 6: Visby's 2 h streets,
  // Vellinge Esplanaden, Borgholm Verdandi gränd and Uppsala Wallingatan kept the register's "disabled only")
  /^Rörelsehindrade?(?: person(?:er)?)? med parkeringstillstånd\b[^.]*\bfår parkera under högst \d+ (?:tim|timmar|min|minuter)\b/i, /^Tidsbegränsningen gäller (?:inte|ej) på plats(?:er)? reserverade? för rörelsehindrade\.?$/i, /^Tillåtelsen gäller (?:inte|ej) parkeringsplatser för rörelsehindrade\.?$/i, /^För rörelsehindrad med parkeringstillstånd\b[^.]*\bgäller bestämmelserna om avgift/i, /^Gäller endast skyltade platser\.?$/i, /^Parkering är endast tillåten i cykelställ\.?$/i, /^Cyk(?:el|lar) får endast parkeras i cykelställ\.?$/i, /^Parkeringen avser besökande\.?$/i, /^Under samma tid ska föreskrift(?:er|en|erna)? [^.]*(?:inte|ej) tillämpas\b/i, /^Förbudet i \d+ ?§ (?:eller|och) tillåtelsen i \d+ ?§ ger (?:inte|ej) rätt/i,
  /^Tillåtelsen (?:att parkera )?gäller (?:inte|ej) (?:på|för) (?:de )?(?:plats(?:er|en|erna)?|parkeringsplats(?:er|en|erna)?|rutor) (?:som är )?(?:reserverade?|avsedda?) för rörelsehindrade(?: med (?:särskilt )?(?:parkerings)?tillstånd)?\.?$/i, // the disabled bays inside the area have their own regulation (QA 2 Nov: Vellinge)
];

// → { taxa, reserved, purpose, allowOnly, limits, bans, otherAllowed, unread: [sentences we could not interpret] }
// Which special vehicle a "får endast …" / "gäller endast …" sentence reserves the curb for (null = ordinary cars).
const RESERVED = [[/rörelse?hindrad|handikappad|parkeringstillstånd enligt 13 kap\.? ?8 §/, 'rörelsehindrade'], // the disabled-parking permit of 13 kap. 8 § trafikförordningen (QA 6 Nov: Örnsköldsvik, Falun, Hörby)
  [/beskickning/, 'beskickningsfordon'], [/motorcykel/, 'motorcykel'], [/moped/, 'moped'],
  [/buss/, 'buss'], [/utryckning/, 'utryckningsfordon'], [/lastbil/, 'lastbil'], [/taxi/, 'taxi'], [/elfordon|elbil|laddning|laddas externt|laddplats|laddbara fordon/, 'laddning'], [/cyk(?:el|lar)/, 'cykel'],
  [/(?:personbil|fordon) klass (?:ii|2)\b|husbil/, 'husbil'], [/över 3[,.]5 ton/, 'lastbil'], [/med (?:tillkoppla[dt] )?(?:släp|husvagn|båttrailer)|(?<!utan (?:tillkoppla[dt] )?|motor- och )\b(?:släpvagn|släpfordon|båttrailer)(?![^.]{0,20}under 3[,.]5 ton)/, 'fordon med släp'], [/tjänstefordon/, 'tjänstefordon']]; // personbil klass II = motorhomes
const AREA_BAN = /\bmed\s+avvikelse\s+från\s[^.]*?\b(?:förbud\s+att\s+parkera|parkeringsförbud|förbud\s+mot\s+parkering|område\s+med\s+förbud\s+att\s+stanna\s+(?:och|eller)\s+parkera)/i; // also "om område med förbud att stanna och parkera fordon" (sweep findings batch 9: Gävle Slottstorget)
const VEH1 = '(?:(?:tvåhjulig )?motorcyk(?:el|lar)|polisbil(?:ar)?|polisfordon|ambulans(?:er)?|färdtjänstfordon|cyk(?:el|lar)|moped(?:er)?(?: klass (?:i{1,2}|[12])(?: och (?:klass )?(?:i{1,2}|[12]))?)?|(?:turist)?buss(?:ar)?|elbil(?:ar)?|lastbil(?:ar)?)';
const VEHICLE_BAY = new RegExp(`\\bfår (?:endast )?${VEH1}(?:(?:,? (?:och|samt|eller)|,) ${VEH1})*,? (?:stannas eller )?parkeras\\b`);
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

// The text without the sentences that repeal older regulations: their titles ("… om parkering utan avgift på Trädgårdsgatan ska upphöra att
// gälla") say nothing about this one (QA 17 Nov round 32: Växjö)
export function dropRepealSentences(body) {
  return String(body).replace(/\s+/g, ' ').replace(/\bträder i kraft(?:[^.]|\.(?=\d))*?\bupphör(?:a)? att gälla/gi, ' ').replace(/\bupphäv(?:s|as)\b(?:[^.]|\.(?=\d))*/gi, ' ');
}

export function parseRegulation(body) {
  const t = ruleText(body);
  let feeFromConditions = false, feeSeason = null, feeTaxaLetter = null, feeExplicit = false; // fee hours taken from "Villkoret gäller": a later explicit fee sentence replaces them
  const out = { taxa: null, feeWindows: null, reserved: false, reservedSeason: null, reservedWindows: [], purpose: [], allowOnly: [], limits: [], bans: [], dp: [], otherAllowed: null, unread: [] };
  if (!t) { out.unread.push('(no rule text)'); return out; }
  // A permission with hours ("Tillåtelsen gäller vardagar 09–18") only bans parking outside those hours when something else
  // bans it there (an area ban the text deviates from, or a ban in the text). Otherwise the general rules apply then.
  const banContext = /avvikelse från|trots förbudet|förbud att parkera|parkeringsförbud|(?:inte|ej) (?:stannas eller )?parkeras|parkering(?:en)? (?:är |råder )?förbjuden|övrig tid/i.test(body.replace(/(?:ger|ge) (?:inte|ej) rätt att[^.]*/gi, '').replace(/träder i kraft[^§]{0,400}?(?:upphör(?:a)? att gälla|upphävs)/gi, '')); // the title of the regulation this one replaces ("… träder i kraft den …, då … föreskrifter (1275 2016:17) om förbud att parkera på X ska upphöra att gälla") says nothing about this one (sweep: Perstorp Bryggaregatan, Burlöv Hamngatan were closed outside the limit's hours)
  let allowSeason = null; let lastAllow = null, lastLimit = null, lastBan = null, lastDp = false, feeNext = false, permitSeason = null; let seasonFromBan = null; let anySeasonPermit = null; const tillWs = []; const limitAllow = [];
  const unread = (s) => out.unread.push(s);
  // A ban sentence with a season per window ("förbjuden under tiden 1 november - 30 april måndag 00-06 och 1 maj - 31 oktober
  // jämna veckor måndag 09-13", Örebro): one sentence per season, so each window keeps its own season and week parity
  const SEASON_START = /\s+och\s+(?=(?:under tiden\s+)?\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december))/i;
  // "… får fordon inte stanna skoldagar mellan klockan 07.00-17.00, under övrig tid får fordon inte parkeras.": the tail is its own sentence (sweep: Österåker Tunavägen was free in the evening)
  const tailSplit = (s) => { const k = s.search(/,\s+(?:under )?övrig tid får fordon (?:inte|ej) parkeras\.?\s*_*\s*$/i); return k > 0 ? [s.slice(0, k) + '.', 'Övrig tid får fordon inte parkeras.'] : [s]; };
  let list = sentences(t).flatMap(tailSplit).flatMap((s) => {
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
  // "Förbudet gäller årligen mellan lördagen vecka 27 och söndagen vecka 28": one span over the weeks, not the day types of its ends
  // (measure 25 Nov: Vellinge Reuterswärds väg was banned every weekend all year and open Mon–Fri of week 28)
  list = list.flatMap((s) => { const WD = '(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?:en)?';
    const r = s.match(new RegExp(`^(\\s*(?:\\d+\\s*§\\s*)?(?:förbudet|tillåtelsen|tidsbegränsningen) gäller)\\s+(?:årligen\\s+)?(?:under tiden\\s+)?(?:mellan|från(?: och med)?)\\s+${WD}\\s+(?:i\\s+)?(?:v\\.?|vecka)\\s*(\\d{1,2})\\s+(?:och|till(?: och med)?)\\s+${WD}\\s+(?:i\\s+)?(?:v\\.?|vecka)\\s*(\\d{1,2})\\.?\\s*$`, 'i'));
    if (!r) return [s]; const [, hd, w1, n1, w2, n2] = r; const a = +n1, b = +n2; if (!(b > a && b - a <= 8 && b <= 53)) return [s];
    const d1 = w1.toLowerCase(), d2 = w2.toLowerCase();
    return [`${hd} ${d1 === 'söndag' ? 'söndag' : `${d1} - söndag`} vecka ${a}.`, ...Array.from({ length: b - a - 1 }, (_, i) => `${hd} måndag - söndag vecka ${a + 1 + i}.`), `${hd} ${d2 === 'måndag' ? 'måndag' : `måndag - ${d2}`} vecka ${b}.`]; });
  const weekCont = new Set(); // later parts of a week list split above: they add to the rule of the first part
  list = list.flatMap((s) => { const n = (s.match(/(?<![\wåäö])(?:v\.?|vecka)\s*\d{1,2}\b/gi) || []).length; const hd = s.match(/^\s*(?:\d+\s*§\s*)?(förbudet|tillåtelsen|tidsbegränsningen) gäller\s*/i); if (n < 2 || !hd) return [s];
    const H = hd[1][0].toUpperCase() + hd[1].slice(1).toLowerCase(); // also "Tillåtelsen gäller onsdag - söndag vecka 30, måndag - söndag vecka 31 …" (QA 11 Nov round 14: Rättvik Riksvägen limit only in week 30)
    const parts = s.slice(hd[0].length).split(/\s*(?:,|\boch\b|\bsamt\b)\s*(?=(?:måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?:ar)?\b)/i).filter(Boolean);
    if (parts.length < 2) return [s]; const out2 = parts.map((q) => `${H} gäller ${q.replace(/\.$/, '')}.`); out2.slice(1).forEach((q) => weekCont.add(q)); return out2; }); // (QA 8 Nov: Rättvik Classic Car Week)
  // "6 § Tillåtelsen i 1 § och villkoren i 2 § gäller 1 september - 31 maj. 7 § … villkoren i 3 § gäller 1 juni - 31 augusti": each season belongs to the
  // limit of the paragraph it names; when the paragraphs are numbered 1..K, one sentence each, sentence i is paragraph i+1 (QA 18 Nov round 37: Sotenäs Hamngatan's
  // winter 24 h limit held all year because both season sentences went to the last limit)
  const paraNums = [...t.matchAll(/(?:^|[.;]\s+)(\d+)\s*§\s+(?=[A-ZÅÄÖ])/g)].map((r) => +r[1]); const paraAligned = paraNums.length === list.length && paraNums.every((n, i) => n === i + 1);
  const limitPara = new Map(); let sIdx = -1;
  for (let s of list) {
    for (const l of out.limits) if (!limitPara.has(l)) limitPara.set(l, sIdx); sIdx++;
    s = s.replace(/\bunder tiden (\d{1,2}[.:]\d{2}) och (\d{1,2}[.:]\d{2})\b/gi, 'klockan $1 - $2').replace(/\bendast motordriv(?:et|na) fordon\b/gi, 'fordon').replace(/\bsamat\b/gi, 'samt').replace(/\bfår inga fordon (stannas eller )?parkeras\b/gi, 'får fordon inte $1parkeras').replace(/\bunder tider\b/gi, 'under tiden').replace(/^(\s*(?:\d+\s*§\s*)?)förbudet att parkera (på|under) /i, '$1parkering är förbjuden $2 ').replace(/\bunder tiden (?=\d{1,2}[.:]\d{2}\s*[-–—])/gi, 'klockan ') // typos and odd forms (QA 8 Nov: Bjuv)
      .replace(/^(\s*(?:\d+\s*§\s*)?)Parkering(?:en)? är (?:dock )?förbjuden övrig tid(?:en)?\.?$/i, '$1Övrig tid är parkering förbjuden.').replace(/^(\s*(?:\d+\s*§\s*)?)Parkeringsförbud (?:(?:gäller|råder) )?(?:dock )?(?:under )?övrig tid\.?$/i, '$1Övrig tid är parkering förbjuden.') /* "Parkeringsförbud övrig tid.", "Parkeringsförbud gäller övrig tid." (sweep waves 2–3: Täby Djursholmsvägen, Nacka Diligensvägen were free outside the stated hours) */ // word order (QA 10 Nov round 13: Umeå Plangatan drew a ban around the clock over its 15 min bays)
      .replace(/\blördag(?:ar)? (?:och|samt) dag(?:ar)? före (?:sön- och )?helgdag(?:ar)?/gi, 'dag före sön- och helgdag').replace(/\bsöndag(?:ar)? (?:och|samt) helgdag(?:ar)?/gi, 'sön- och helgdag'); // Växjö: pinned to Saturday/Sunday only // "mot avgift under tiden 09.00 och 18.00" (QA 8 Nov: Tanum)
    // "2 § Gäller vardagar mellan kl.11.00-05.00, …": a bare "Gäller" refers to the rule just stated (QA 10 Nov round 12: Växjö Sandgärdsgatan, Klostergatan lost Saturday/Sunday bans)
    if (/^\s*(?:\d+\s*§\s*)?gäller\s+(?:vardag|dag(?:ar)? före|sön|lördag|söndag|måndag|tisdag|onsdag|torsdag|fredag|helgdag)/i.test(s)) {
      const head = lastBan && !lastLimit ? 'Förbudet' : lastLimit ? 'Tidsbegränsningen' : null;
      if (head) s = s.replace(/^(\s*(?:\d+\s*§\s*)?)gäller/i, `$1${head} gäller`);
    }
    // "Tillåtelsen gäller även personbil klass I under högst 2 timmar i följd mellan 16 augusti och 14 juni, …", "Tillåtelsen gäller även
    // 2 tim övriga året mellan …": a second limit period, not a vehicle list (QA 10 Nov round 12: Tanum Fjällbacka had no off-season limit)
    s = s.replace(/^(\s*(?:\d+\s*§\s*)?Tillåtelsen gäller) även (?:personbil(?:ar)?(?: klass (?:I|1))? |fordon )?(?:under )?(?:högst )?(\d+|en|ett|två|tre|fyra) (tim\w*|dygn)(?: övriga året)?/i, '$1 under högst $2 $3');
    s = s.replace(/\bfår (?:motordriv(?:et|na) fordon|motorfordon|bil(?:ar)?) parkeras\b/gi, 'får fordon parkeras') // "får motordrivet fordon / motorfordon / bil parkeras": ordinary cars (sweep: Bjuv, Kiruna, Mönsterås, Ulricehamn stayed unread)
      .replace(/\bfår fordon 3 kap\. 48 § trafikförordningen \(1998:1276\) parkeras\b/gi, 'får fordon parkeras').replace(/^(\s*(?:\d+\s*§\s*)?Tidsbegränsningen) och gäller\b/i, '$1 gäller') // Degerfors
      .replace(/^(\s*(?:\d+\s*§\s*)?)Tidsregleringen gäller\b/i, '$1Tidsbegränsningen gäller') // Mölndal
      .replace(/\b(vardag(?:ar)?|dag) rore (?=sön)/gi, '$1 före ') // "vardag rore sön- och helgdag": a typo (Gotland S:t Hansgatan had its limit on Sundays)
      .replace(/\b(Förbudet gäller vardag(?:ar)?),\s+(?=mellan klockan|klockan|kl\b)/i, '$1 ') // "Förbudet gäller vardagar, mellan klockan 06.00 och 18.00" (Vilhelmina)
      // "Övrig tid 24 timmar.", "Övrigt tid 2 timmar", "Övrig tid gäller parkering max 24 timmar.", "Övrig tid är parkering tillåten under 24 timmar i följd.",
      // "Övrig tid får fordon parkeras 24 tim i följd": a second limit outside the stated hours (sweep waves 13–27: Gnesta ×3, Tanum ×3, Ronneby, Partille, Laholm had no limit then)
      .replace(/^(\s*(?:\d+\s*§\s*)?)Övrigt? tid (?:gäller (?:parkering )?|är parkering(?:en)? tillåten |får fordon parkeras )?(?:under |i )?(?:högst |max(?:imalt)? )?(\d+) ?(tim(?:me|mar|ma)?|dygn|min(?:uter)?)(?: i följd)?\.?\s*$/i, '$1Övrig tid får fordon parkeras under högst $2 $3 i följd.');
    s = s.replace(/\bfår\s*[-–]\s*under högst [^-–.]{3,30}?\s*[-–]\s*endast\b/i, 'får endast'); // "får - under högst 2 timmar i följd - endast sådant fordon parkeras som …" (Vaggeryd)
    // Sweep findings, batch 4 (24 Nov): wordings that left a ban, a limit or the day types unread (each line names the street that showed it)
    s = s.replace(/\b(tis|ons|tors)s+dag/gi, '$1dag') // "Parkering är dock förbjuden onssdag mellan klockan 00.00 och 09.00" (measure 25 Nov: Örebro Toringsgatan was banned every night)
    s = s.replace(/\b(m)el{3,}an\b/gi, '$1ellan') // "melllan klockan 0 och klockan 8" (Vaxholm Rådhusgatan had no Wednesday ban)
      .replace(/\bsön- och\/eller helgdag/gi, 'sön- och helgdag') // Kiruna
      .replace(/\b(vardag(?:ar)?),? dock (?:ej|inte) ((?:vardag|dag)(?:ar)? före)/gi, '$1 utom $2') // "vardagar, dock ej dag före sön- och helgdag" (Hagfors, Sunne)
      .replace(/^(\s*(?:\d+\s*§\s*)?)Förbud att (?:stanna (?:och|eller) )?parkera (?:på [^.,]*? )?(?:gäller|(?:skall|ska) gälla) (?=(?:under tiden |mellan |klockan |kl\.? |vardag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|\d))/i, '$1Parkeringsförbud gäller ') // "Förbud att stanna och parkera på Kastellgatan gäller mellan 21-05 alla dagar" (Karlshamn), "Förbud att parkera skall gälla vardagar mellan klockan 07.00 och 17.00" (Gnosjö)
      .replace(/^(\s*(?:\d+\s*§\s*)?Parkeringsförbud) på (?:sträckan|platsen|ytan|området) (råder|gäller) /i, '$1 $2 ').replace(/,? med undantag för (?:varutransporter|varuleveranser)\b[^.]*/i, '') // "Parkeringsförbud på sträckan råder under tiden klockan 08:00 - 11:00, med undantag för varutransporter" (Falun Sturegatan)
      .replace(/^(\s*(?:\d+\s*§\s*)?Parkeringsförbud gäller) (?:mellan )?(\d{1,2})\s*[-–]\s*(\d{1,2})(?![.:\d])/i, '$1 klockan $2.00 - $3.00') // "gäller mellan 21-05"
      .replace(/\bråder parkeringsförbud (?=vardag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|klockan|kl\b|mellan|under tiden)/gi, 'gäller parkeringsförbud ') // "På Hagagatan … råder parkeringsförbud vardagar kl 07.00 – 16.00" (Ydre)
      .replace(/\bfår (?:inte |ej )?(?:annat|andra) fordon än skolskjuts(?:ar|fordon)?(?: inte| ej)? parkeras,?(?= )/gi, 'får fordon inte parkeras') // "får inte annat fordon än skolskjuts parkeras under vardagar …" (Åsele), "får andra fordon än skolskjutsfordon inte parkeras, vardagar …" (Sunne): a ban for every car
      .replace(/\bfår fordon (?:inte|ej) stanna (?=skoldagar|vardag|måndag|tisdag|onsdag|torsdag|fredag|mellan|klockan|kl\b|under tiden)/gi, 'får fordon inte stannas eller parkeras ') // "får fordon inte stanna skoldagar mellan klockan 07.00-17.00" (Österåker Tunavägen)
      .replace(/(?<!sön- )(?<!söndag )\b(samt|och)\s+helgdag(?:ar)?\s+(?=kl\b|klockan|mellan|\d)/gi, '$1 sön- och helgdag ') // "… dag före helgdag kl 15.00 - 24.00 samt helgdag kl 00.00 - 24.00" (Växjö Linnégatan had Sunday's limit on Saturday)
      .replace(/^(\s*(?:\d+\s*§\s*)?(?:Förbudet|Tidsbegränsningen|Tillåtelsen|Villkoret) gäller )(?:under tiden )?((?:klockan|kl\.?)\s*\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}),\s+((?:vardag|dag(?:ar)? före|sön- och helgdag)[^.\d]*?)\.?\s*$/i, '$1$3 $2.') // "Förbudet gäller under tiden klockan 07.15 - 07.45, vardagar och vardagar före sön- och helgdag." (Hässleholm Järnvägsgatan)
      .replace(/^(\s*(?:\d+\s*§\s*)?)Parkering får som längst ske (\d+ ?(?:min\w*|tim\w*))/i, '$1Tillåtelsen gäller under högst $2') // "Parkering får som längst ske 10 minuter i följd" (Gävle Norra Kungsgatan)
      .replace(/\bfår fordon parkeras,? dock längst (?=\d|en |ett |två )/gi, 'får fordon parkeras under högst ') // "får fordon parkeras, dock längst 30 minuter i följd" (Kiruna Linnéstigen had the limit 00–08 only)
      .replace(/(\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}),\s+(?=\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}\s+och\s+\d{1,2}[.:]\d{2}\s*[-–])/g, '$1 och ') // "klockan 00.00 - 07.00, 09.00 - 14.00 och 17.00 - 24.00": the middle range was dropped (Kungsbacka Gymnasiegatan)
      .replace(/\b((?:klockan|kl\.?)\s*\d{1,2}(?:[.:]\d{2})?\s*(?:och(?: kl\.?| klockan)?|[-–]|till)\s*\d{1,2}),(\d{2})\b/gi, '$1.$2') // "mellan kl 07 och 16,30" (Vellinge Trädgårdsgatan ended at 16.00)
      .replace(/\bgäller (?:vardagar )?(\d{1,2})\s*[-–]\s*(\d{1,2}) på vardagar och (\d{1,2})\s*[-–]\s*(\d{1,2}) på lördagar\b/i, 'gäller vardagar utom dag före sön- och helgdag klockan $1.00 - $2.00 och dag före sön- och helgdag klockan $3.00 - $4.00'); // "Tidsbegränsningen gäller vardagar 8-18 på vardagar och 8-15 på lördagar" (Svedala Storgatan)
    let x = s.toLowerCase();
    if (out.heavyOnly && /^(?:\d+\s*§\s*)?föreskrifte(?:n|rna) gäller (?:inte|ej) (?:på|inom|i|för)(?=\s)/.test(x)) continue; // places exempt from a heavy-vehicle rule ("Föreskriften gäller ej på väg som är enskild", "… på följande platser: 1) …", Kungsbacka)
    // a ban for bicycles and mopeds only ("får cykel och moped klass II inte parkeras", "får cyklar inte parkeras utanför särskilt anordnade cykelställ", "får cykel
    // och moped klass II endast parkeras i särskilt anordnade cykelställ"), or for detached trailers: no rule for cars (sweep: Lund Västra Stationstorget, Helsingborg
    // Kungstorget, Örebro Köpmangatan, Krokom were banned for every car, Varberg resecentrum was a motorcycle bay)
    if (/\bfår (?:dock )?(?:cyk(?:el|lar)|moped(?:er)?(?: klass (?:ii|2))?)(?:,? (?:och|samt|eller) (?:cyk(?:el|lar)|moped(?:er)?(?: klass (?:ii|2))?))*,? (?:(?:inte|ej) (?:stannas eller )?parkeras|endast parkeras i\b[^.]*cykel)|\bfår frånkopplade släp(?:vagnar|fordon)?(?: och redskap)? (?:inte|ej) parkeras|^parkering av cyk(?:el|lar)\b/.test(x) && !/\bfordon (?:inte|ej)|får (?:inte|ej) fordon|personbil|motorcyk/.test(x)) { out.heavyOnly = true; continue; }
    if (/^parkering är förbjuden utanför (?:markerad|markerade|anvisad|anvisade) (?:parkerings)?plats(?:er)?\.?$/.test(x)) continue; // where to stand, not a ban on the place itself (sweep: Karlskrona Ringövägen was banned around the clock)
    if (/^bestämmelserna gäller vardagar och helger samt dag(?:ar)? före helg(?:dag)?\.?$/.test(x)) continue; // every day: no condition (Partille Almas väg had its limit Mon–Fri only)
    // "får fordon inte (stannas eller) parkeras. Tidsbegränsningen gäller fredag klockan 06.00 - 14.00": the hours of that ban, worded as a
    // "time limit" (QA 4 Nov: Borlänge, Burlöv, Klippan, Aneby; the register showed the ban all day or not at all)
    if (/^tidsbegränsningen gäller\b/.test(x) && lastBan && lastBan.provisional && !lastLimit && !lastAllow && !out.limits.length) { s = s.replace(/^Tidsbegränsningen/i, 'Förbudet'); x = s.toLowerCase(); }
    if (!/\b(?:får|gäller|förbjud\w*|tillåt\w*|parker\w*|stann\w*|avgift\w*|högst|klockan|kl|reserver\w*|datum\w*|laddplats\w*|taxiplats\w*)\b|ändamålsplats|\d{1,2}[.:]\d{2}/i.test(s)) continue; // a sentence with no rule word and no hours describes a place ("… Dalviksvägen 750m norr om Tackjärnsgränd, …", Nora)
    if (!/[a-zåäö]{3}/i.test(s)) continue; // stray punctuation (":.", ";") left by the PDF text
    if (/^uppställning av (?:släpfordon|släp(?:vagn(?:ar)?)?|husvagn(?:ar)?|(?:tung(?:a)? )?lastbil(?:ar)?|buss(?:ar)?)\b[^.]*förbjud/.test(x)) { out.heavyOnly = true; continue; } // "Uppställning av släpfordon förbjuden": trailers only, no rule for cars (Tanum Bygdegårdsplan showed a ban)
    if (/^fordon som (?:inte|ej) får parkeras,? får (?:inte|ej) hell(?:er|re) stannas?\b/.test(x)) continue; // boilerplate after a ban: no rule of its own, not a permission
    if (/(?:inte|ej) (?:stannas eller )?parkeras (?:annat än (?:på|inom)|utanför (?:de )?(?:särskilt )?(?:markerade|anvisade|anordnade|uppmärkta))/.test(x)) continue; // "Trots tillåtelsen i 1 § får fordon inte parkeras utanför markerade platser" (Norrköping): where to park, not a ban // "får fordon inte parkeras annat än på särskilt markerad uppställningsplats": where to park, not a ban (Östersund)
    if (/^på \d+ av (?:ovan nämnda |dessa |de |ovanstående )?(?:\d+ )?(?:markerade |ovan nämnda )?(?:platser|platserna|parkeringsplatser|parkeringsplatserna)\b/.test(x) && out.permitted) continue; // (QA 8 Nov: Svedala lot shown as disabled-only)
    if (/^förbudet (?:i (?:paragraf \d+|\d+\s*§) )?gäller endast (?:för )?(?:personbil klass (?:ii|2)|husbil(?:ar)?|husvagn(?:ar)?|släpfordon|släpvagn(?:ar)?|(?:tung )?lastbil(?:ar)?|(?:tung )?buss(?:ar)?|fordonståg)/.test(x) && !/\bpersonbil(?:ar)?\b(?! klass (?:ii|2)\b)/.test(x)) { if (lastBan) { out.bans = out.bans.filter((b) => !lastBan.items.includes(b)); lastBan = null; if (!out.bans.length) out.heavyOnly = true; /* the text's only ban is for those vehicles: the register's ban for every car goes (sweep: Borgholm Sjöstugevägen, Mora Karlsvägen, Kiruna Forvägen, Mariestad Gummerstadsvägen) */ } continue; } // (QA 8 Nov: Sölvesborg night ban is for motorhomes)
    let m = season(s); const p = parity(s), wk = weeks(s);
    // "Förbudet gäller klockan 07.00 - 16.00 11 juni": a ban on one date, not every day (QA 11 Nov round 14: Strängnäs Bataljonsgatan showed the
    // ban all year); without a year it is read as that date every year (the safe side)
    if (!m && /^(?:\d+\s*§\s*)?förbudet gäller\b/.test(x) && !/^(?:\d+\s*§\s*)?förbudet gäller (?:inte|ej)\b/.test(x)) { const ds = [...x.matchAll(/(?<![\d.:])(\d{1,2}) (januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b/g)]; if (ds.length === 1 && !/\d{1,2}\s*[a-zåäö.]+\s*[-–—]\s*\d|\b\d{1,2}\s*(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|okt|nov|dec)\b\.?|\btill och med\b|\bfrån\b/.test(x)) m = [[MONTHS[ds[0][2]], +ds[0][1]], [MONTHS[ds[0][2]], +ds[0][1]]]; }
    const withSP = (w) => clean({ ...w, m, p, wk });
    // "får endast tung lastbil parkeras. Tidsbegränsningen gäller vardag utom … klockan 16.00 - 08.00, …": the hours the curb is kept for that
    // vehicle; at other times the general rules apply (QA 11 Nov round 14: Tyresö Radiovägen reserved around the clock). Not for disabled bays.
    if (/^(?:\d+\s*§\s*)?tillåtelsen gäller (?:under (?:tiden|perioden) )?(?:den )?\d{1,2}(?::[ae])? (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\s*[-–—]\s*(?:den )?\d{1,2}(?::[ae])? (?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\.?$/.test(x) && m && out.reserved && ['lastbil', 'buss', 'motorcykel', 'moped', 'husbil', 'fordon med släp'].includes(out.reservedFor) && !out.reservedWindows.length && !out.reservedSeason && !lastLimit && !lastBan && !out.limits.length && !out.bans.length) { out.reservedSeason = m; continue; } // "får endast motorcykel och moped klass I parkeras. Tillåtelsen gäller 1 april – 31 oktober." (sweep: Upplands-Bro Furuhällsplan)
    if (/^(?:\d+\s*§\s*)?(?:tidsbegränsningen|tillåtelsen|reservationen) gäller (?:under tiden )?(?:vardag|dag(?:ar)? före|sön- och helgdag|lördag|söndag|måndag|tisdag|onsdag|torsdag|fredag|mellan|klockan|kl)/.test(x) && out.reserved && ['lastbil', 'buss', 'motorcykel', 'moped', 'husbil', 'fordon med släp'].includes(out.reservedFor) && !out.reservedWindows.length && !out.reservedSeason && !lastLimit && !lastBan && !out.limits.length && !out.bans.length && !duration(s) && !m && !p && !wk) {
      const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.reservedWindows.push(...ws); if (!AREA_BAN.test(body)) out.otherAllowed = true; /* inside an area parking ban the other hours stay banned (sweep wave 20: Hudiksvall motorcycle bays) */ continue; } }
    const tx = x.match(/taxa\s+(\d+)\b(?!\s*(?:kr|kronor|:-))/); // not "taxa 35 kronor per timme" (Båstad): that is a price
    if (tx && (/avgift/.test(x) || /\benligt taxa \d+,? får fordon parkeras\b/.test(x))) { out.taxa = +tx[1]; } // "enligt kartbild och enligt taxa 1 får fordon parkeras under högst 1 tim": a fee (sweep waves 14–27: Lidköping ×8 shown free)
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
    if (/^tillåtelsen (?:att parkera )?(?:i (?:paragraf )?\d+ ?§? ?)?(?:och villkoren (?:i [\d\s–-]+§§? )?)?gäller (?:endast |enbart )?(?:under (?:tiden|perioden) )?(?:mellan )?(?:den )?\d/.test(x) && m && !windows(s).length && !p && !wk && !out.reserved && !seasonFromBan && !out.bans.some((b) => b.a === 0 && b.b === 1440) /* a night ban on even dates beside it is no obstacle (sweep: Örnsköldsvik Skolgatan was free all summer inside the central parking ban) */ && /\bmed\s+avvikelse\s+från\s[^.]*?\b(?:om\s+)?(?:förbud\s+att\s+parkera|parkeringsförbud|förbud\s+mot\s+parkering)/i.test(body)) { seasonFromBan = m; if (!(out.limits.length || out.feeWindows)) continue; }
    if (/^tillåtelsen (?:att parkera )?(?:i (?:paragraf )?\d+ ?§? ?)?(?:och villkoren (?:i [\d\s–-]+§§? )?)?gäller/.test(x) && !/gäller (?:endast |enbart )?(?:för )?(?:husbil|husvagn|buss|lastbil|motorcyk|moped|personbil(?:ar)? klass (?:ii|2))/.test(x) && m && !windows(s).length && !duration(s) /* "Tillåtelsen gäller under högst 30 dygn i följd under tiden 1 oktober - 31 mars" is a second limit with its own season (sweep: Karlshamn Matvikshamnsvägen) */ && (out.limits.length || out.feeWindows)) { if (!/villkoren/.test(x) && !p && !wk) allowSeason = m; const vp = paraAligned && x.match(/villkoren i (\d+) ?§/); const vpl = vp ? out.limits.filter((l) => limitPara.get(l) === +vp[1] - 1) : []; for (const l of (vpl.length ? vpl : /villkoren/.test(x) && lastLimit ? lastLimit.items : out.limits)) l.m = m; for (const w of out.feeWindows || []) w.m = m; continue; } // "villkoren i 3 §": the season of that paragraph's limit, not the 24 h rule in 2 § (Sotenäs)
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
      if (/(?:\bpersonbil(?:ar|er)? klass (?:i|1)\b|\bpersonbil(?:ar|er)?\b(?! klass))(?! med (?:tillkoppla[dt] )?(?:släp|husvagn|båttrailer))/.test(lst) && !/rörelsehindr|tillstånd|klass (?:ii|2)\b/.test(lst)) { x = x.replace(/får endast .*?\s+(?=(?:stannas eller |stannas|)parkeras)/, 'får fordon '); s = s.replace(/får endast .*?\s+(?=(?:stannas eller |stannas|)parkeras)/i, 'får fordon '); } }
    // "får fordon stannas eller parkeras under högst 3 tim i följd": a permission to stop or park, read like "får fordon parkeras" (Linköping, Söderköping)
    if (/får (?:fordon )?stannas (?:eller|och) parkeras/.test(x) && !/(?:inte|ej) stannas/.test(x)) { x = x.replace(/får (fordon )?stannas (?:eller|och) parkeras/g, 'får $1parkeras').replace(/  +/g, ' '); s = s.replace(/får (fordon )?stannas (?:eller|och) parkeras/gi, 'får $1parkeras'); }
    // Date parking ("udda datum … udda adressnummer"): one side is always allowed — dp windows, not a ban
    // "får fordon inte parkeras 00.00 - 08.00 jämna datum" on one stretch (no address sides): a ban on those dates (QA: Umeå, Gävle)
    if (/udda datum|jämn(?:a|t) datum/.test(x) && !/adressnummer|sida av (?:vägen|gatan)|udda[^.]*jämn|jämn[^.]*udda/.test(x)) { let ws = windows(s); if (halfRead(s, ws) && !ws.length) { unread(s); continue; } if (!ws.length) ws = [{ a: 0, b: 1440 }]; const dd = /udda datum/.test(x) ? 'odd' : 'even'; const items = ws.map((w) => ({ ...withSP(w), dd })); if (lastBan && lastBan.provisional && /^(?:\d+\s*§\s*)?förbudet gäller\b/.test(x)) out.bans = out.bans.filter((b) => !lastBan.items.includes(b)); /* "får fordon inte parkeras. Förbudet gäller på dagar med jämna datum … 00.00-08.00": the terms of the ban just stated (sweep: Bollnäs ×3 kept the plain ban beside it) */ out.bans.push(...items); lastBan = { items, provisional: false }; continue; }
    // "Datumparkering gäller mellan kl 00.00 och kl 08.00.": date parking in those hours (QA 1 Nov: Kiruna)
    if (/^datumparkering gäller\b/.test(x)) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.dp.push(...ws.map(withSP)); lastDp = true; continue; } }
    // "Datumparkering gäller på denna plats.", "Övrig tid gäller datumparkering.", "På Korsängsvägen gäller gatuparkering enligt datumparkering.": the town's
    // own date-parking rule applies here; its hours are in that rule (sweep: Sandviken ×5, Ludvika ×2, Upplands-Bro had no date parking)
    if (/^(?:datumparkering gäller(?: (?:på|för) (?:denna|dessa) (?:plats(?:er)?|sträck(?:a|or)))?|övrig tid gäller datumparkering|på [^.]{3,80}? gäller (?:gatuparkering enligt )?datumparkering)[\s._]*$/.test(x)) { if (!out.dp.length) out.dp.push({ a: 0, b: 1440, ref: 1 }); lastDp = true; continue; }
    if (/udda datum|jämn(?:a|t) datum/.test(x)) { let ws = windows(s); if (!ws.length) ws = [{ a: 0, b: 1440 }]; out.dp.push(...ws.map(withSP)); lastDp = true; continue; }
    if (/^förbudet (?:att (?:parkera|stanna)[^ ]* )?(?:i (?:första stycket|paragraf \d+|\d+\s*§) )?gäller/.test(x) && lastDp && !lastBan) { const ws = windows(s); if (ws.length && !halfRead(s, ws)) { out.dp = ws.map(withSP); continue; } }
    // "Parkering är dock förbjuden enligt … lokala trafikföreskrifter om datumparkering": a reference to another regulation
    if (/förbjud[^.]*enligt (?:bestämmelserna i )?[^.]*trafikföreskrifter/.test(x)) { if (/datumparkering/.test(x) && !out.dp.length) out.dp.push({ a: 0, b: 1440, ref: 1 }); continue; }
    // "får endast fordon som används av boende i området och för vilka särskilt tillstånd utfärdats parkeras", "får endast sådana fordon parkeras för vars ägare särskilt
    // boendeparkeringstillstånd utfärdats", "Tillåtelsen gäller endast fordon som används av boende i området och för vilka särskilt tillstånd utfärdats", "Tillåtelsen gäller
    // endast boende med särskilt parkeringstillstånd": the text lets nobody else park, so the place is reserved (sweep findings batch 7: about 45 resident bays in Lysekil, Orust,
    // Sotenäs, Vaxholm, Danderyd and Mölndal were grey). Without "endast" ("får fordon som används av boende … parkeras mot avgift": Västerås, where the same bays also have a
    // regulation for every car) the text says nothing about other cars and is skipped below, as before.
    if ((/\bfår (?:endast|enbart) (?:sådana? )?fordon\b[^.]*\bboende/.test(x) || /^tillåtelsen (?:i \d+ ?§ )?gäller (?:dock )?(?:endast|enbart) (?:för )?(?:fordon som (?:används|brukas|nyttjas) av )?boende\b/.test(x)) && /tillstånd/.test(x) && !/förbjud|(?:inte|ej) (?:stannas eller )?parkeras|(?:inte|ej) (?:endast|enbart)/.test(x)) { out.reserved = true; out.reservedFor = null; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    // "Tillåtelsen gäller (endast) fordon med särskilt tillstånd": the permission above is for permit holders only (Upplands-Bro, Valdemarsvik, Arboga)
    // "Tillåtelsen gäller endast fordon med giltigt parkeringsbiljett som hämtas från fastighet på Stationsgatan 2": a ticket handed out by one property is a permit,
    // the place is for its visitors (sweep findings batch 9: Laholm Stationsgatan was drawn as a ban 09–18 and free at night, inside an area ban)
    if (/^tillåtelsen gäller (?:endast|enbart) (?:för )?fordon med giltig[at]? parkeringsbiljett som (?:hämtas|utfärdas|erhålls) (?:från|av|hos)\b/.test(x) && !out.bans.length) { out.reserved = true; out.reservedFor = null; continue; }
    // "Tillåtelsen att parkera gäller husbil under tiden 17 maj- 30 september" after a permission that departs from an area parking ban: a motorhome bay in that season
    // and the area ban the rest of the year, so never a place for a car (sweep findings batch 9: Sundsvall Heffners Allé was banned in summer and free in winter)
    if (/^tillåtelsen (?:att parkera )?gäller (?:endast |enbart )?(?:för )?husbil(?:ar)? under (?:tiden|perioden) /.test(x) && m && !windows(s).length && !out.reserved && !out.bans.length && !out.limits.length && AREA_BAN.test(body)) { out.reserved = true; out.reservedFor = 'husbil'; continue; }
    if (/^tillåtelsen (?:i \d+ ?§ )?gäller (?:dock )?(?:(?:endast|enbart) )?(?:för )?fordon med (?:särskilt |giltigt )?(?:parkerings)?tillstånd\b/.test(x) && !/\bboende|rörelse?hindrad|13 kap|(?:klockan|kl\.?)\s*\d|(?:inte|ej) /.test(x) && !out.reserved && !out.bans.length) { out.reserved = true; out.reservedFor = null; continue; }
    if (/^tillåtelsen gäller även|boendeparkeringskort|boendeparkeringstillstånd/.test(x)) continue;
    if ((/\bboende\b[^.]*tillstånd|tillstånd[^.]*\bboende\b/.test(x)) && !/förbjud|(?:inte|ej) (?:stannas eller )?parkeras/.test(x.replace(/gäller (?:inte|ej) boende/, ''))) continue; // rules for residents with a permit ("Boende med särskilt tillstånd … högst 7 dygn", "Tidsbegränsningen gäller inte boende …"): not for visitors, and no resident permits outside the big three (QA: Kalmar, Hallsberg) // resident permits are out of scope outside the big three
    // "… högst 15 min i följd under tiden … 03.00 - 22.00. Övrig tid ska den markerade sträckan vara ändamålsplats för uppställning av fordon i taxitrafik",
    // "Övrig tid gäller Taxiplats enligt föreskrift …": outside the limit's hours the place is a taxi stand, no car may park (sweep: Kungsbacka Västergatan, Skövde Stationsgatan were free at night)
    if (/^övrig tid\b/.test(x) && /\btaxi/.test(x) && /ändamålsplats|taxiplats/.test(x) && !/(?:klockan|kl\.?)\s*\d/.test(x) && lastLimit && !lastLimit.items.some((w) => w.w || w.m || w.p || w.wk || w.dm || w.nw || w.dd || !(w.a < w.b))) { const o = outsideHours(lastLimit.items); if (o && o.length) { out.bans.push(...o); lastBan = { items: o, provisional: false }; continue; } unread(s); continue; }
    if (/ändamålsplats/.test(x)) { out.purpose.push(...windows(s).map(withSP)); continue; }
    if (/^övrig tid får endast/.test(x) && reservedFor(x) && lastAllow) { out.otherAllowed = false; out.allowOnly.push(...lastAllow.filter((w) => !out.allowOnly.includes(w))); continue; } // "Övrig tid får endast tung lastbil parkeras"
    if (/\bfår (?:endast )?fordon med resande\b[^.]*\bparkeras\b/.test(x) && !/(?:inte|ej) parkeras|får (?:inte|ej)\b/.test(x)) { out.reserved = true; out.reservedFor = null; const d = duration(s); if (d) { const items = [clean({ a: 0, b: 1440, max: d, m, p, wk })]; out.limits.push(...items); lastLimit = { max: d, items }; } continue; }
    if (/vändplats med förbud att (?:stanna och |stanna eller )?parkera/.test(x)) { const items = [{ a: 0, b: 1440 }]; out.bans.push(...items); lastBan = { items, provisional: true }; continue; }
    // "motorcyk(?:lar|el)" below: the old "motorcykl(?:ar|el)" never matched "motorcykel" (QA 9 Nov: Uppsala S:t Persgatan MC bay was open to all cars)
    // "Övrig tid får motorcykel parkeras" after a motorcycle bay: the bay's other hours, still for motorcycles
    if (/^övrig tid får (?:tung |tungt )?(?:buss(?:ar)?|lastbil(?:ar)?|släpfordon)(?:,? (?:och|samt|eller) (?:tung |tungt )?(?:buss(?:ar)?|lastbil(?:ar)?|släpfordon|släpvagn(?:ar)?|släpkärr(?:a|or)))* parkeras\.?$/.test(x) && out.reserved && ['lastbil', 'buss', 'fordon med släp'].includes(out.reservedFor)) continue; // "Övrig tid får tung lastbil och släpkärra parkeras": the bay's other hours, still for those vehicles, without the limit (QA 19 Nov round 39: Uppsala Tycho Hedéns väg)
    if (/^övrig tid får (?:motorcyk(?:lar|el)|moped(?:er)?) parkeras(?: under högst \d+ (?:tim\w*|dygn) i följd)?\.?$/.test(x) && out.reserved && (out.reservedFor === 'motorcykel' || out.reservedFor === 'moped')) { out.reservedWindows = []; continue; }
    // also "får utryckningsfordon parkeras", "får taxi i tjänst parkeras", "får buss i linjetrafik parkeras", "får laddbara fordon parkeras" without
    // "endast": the sign shows the vehicle under the P, so no other vehicle may park (sweep waves 1, 9, 10, 14: Sollentuna Tingsvägen and Växjö
    // Drottninggatan gave every car the bay's limit)
    // also "får beskickningsfordon parkeras" without "endast": a diplomatic bay; a limit after it is the bay's (QA 4 Nov: Sigtuna showed a 3 h limit for all cars)
    if (/^(?:på|inom|i|från) [^.]*? får (?:endast )?(?:taxi(?:fordon)?(?: i tjänst)?|utryckningsfordon|laddbara fordon|buss(?:ar)? i linjetrafik|beskickningsfordon|endast (?:food ?trucks?|servicefordon|skolskjuts(?:fordon)?|trafikskolefordon|polis(?:myndighetens|ens)? fordon|polisfordon)|(?:motordrivet fordon|motorfordon|fordon|personbil(?:ar)?|bil(?:ar)?) med (?:tillkoppla[dt] )?(?:släpfordon|släpvagn|släp|husvagn)|(?:tung |tungt )?(?:buss(?:ar)?|lastbil(?:ar)?|släpfordon)(?:,? (?:och|samt|eller) (?:tung |tungt )?(?:buss(?:ar)?|lastbil(?:ar)?|släpfordon|släpvagn(?:ar)?|släpkärr(?:a|or)))*|motorcyk(?:lar|el)|moped(?:er)?) parkeras/.test(x) && !/(?:inte|ej) parkeras|får (?:inte|ej)/.test(x)) { out.reserved = true; out.reservedFor = reservedFor(x); if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); { const d = duration(s); if (d) { let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s); ws = ws.map(withSP); const items = ws.length ? ws.map((w) => ({ ...w, max: d })) : [clean({ a: 0, b: 1440, max: d, m, p, wk })]; out.limits.push(...items); lastLimit = { max: d, items }; } } continue; } // "får endast motordrivet fordon med tillkopplat släpfordon … parkeras högst 6 timmar i följd": a trailer bay with the bay's own limit (QA 15 Nov round 28: Umeå Strandpromenaden showed 6 h for all cars)
    // "får motorcykel och moped klass I, parkeras", "får moped klass I och moped klass II parkeras", "får bussar parkeras i högst 24 timmar",
    // "får turistbussar stannas eller parkeras", "får elbilar parkeras": the same bays with a list of vehicles, a comma before the verb or an
    // abbreviation's full stop before "får" (sweep waves 13–27: Karlskrona Drottninggatan, Gotland Österväg, Mjölby Mantorp, Gnesta Mejerigatan,
    // Söderköping Margaretagatan, Orust gave every car the bay's limit)
    // a bicycle rack ("i särskilt anordnade cykelställ … får cykel parkeras", "får cykel och moped klass II parkeras under högst 24 tim i följd"): no place for a car, shown as
    // a bay for bicycles (sweep findings batch 7: Uppsala's central racks ×19 lines, Oxelösund Järntorget, Laholm, Tanum were grey). When another sentence of the text lets
    // cars park (one part for cars, one for bicycles: Härnösand Trädgårdsgatan), the bicycle part says nothing about the line.
    const bikesBesideCars = VEHICLE_BAY.test(x) && /\bcyk(?:el|lar)\b/.test(x.match(VEHICLE_BAY)[0]) && list.some((q) => q !== s && /\bfår (?:endast )?(?:fordon|personbil(?:ar)?|motorfordon)\b[^.]*\bparkeras?\b/i.test(q) && !/\b(?:inte|ej)\b/i.test(q));
    if (VEHICLE_BAY.test(x) && !bikesBesideCars && !/(?:inte|ej) (?:stannas eller )?parkeras|får (?:inte|ej)/.test(x) && !/^övrig tid/.test(x)) { out.reserved = true; out.reservedFor = reservedFor(x.match(VEHICLE_BAY)[0]); if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); { const d = duration(s); if (d) { let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s); ws = ws.map(withSP); const items = ws.length ? ws.map((w) => ({ ...w, max: d })) : [clean({ a: 0, b: 1440, max: d, m, p, wk })]; out.limits.push(...items); lastLimit = { max: d, items }; } } continue; }
    // "… enligt markering i kartbild ska vara laddplats": a charging bay, for cars being charged only (QA 8 Nov round 7: Helsingborg, Växjö, Kalmar, Trollhättan showed them open to all cars)
    // "På laddplatsen får fordon som kan laddas externt med elektrisk energi … parkeras", with or without "endast": only cars being charged
    if (/\bfår (?:endast )?(?:fordon|personbil(?:ar)?|elfordon) som (?:kan )?laddas externt\b/.test(x) && /parkeras/.test(x) && !/\b(?:inte|ej) parkeras|får (?:inte|ej)\b/.test(x)) { out.reserved = true; out.reservedFor = 'laddning'; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    // after a charging bay: "Tillåtelsen … gäller parkering enbart under den tid som laddning pågår", "Parkering är endast tillåten vid laddning av elfordon": the bay's own terms
    if (out.reservedFor === 'laddning' && /\bladdning\b/.test(x) && !/\b(?:inte|ej)\b/.test(x) && !/(?:klockan|kl\.?)\s*\d/.test(x)) continue;
    // also "ska de särskilt anordnade platserna inom det område som anges i kartan vara laddplatser" (QA 16 Nov round 30: Söderköping Kanal Väst was open to all cars)
    if (/\b(?:ska|skall)\b(?:[^.]{0,160}?\s)?vara (?:en )?laddplats(?:er)?\b/.test(x) && !/\b(?:inte|ej)\b/.test(x)) { out.reserved = true; out.reservedFor = 'laddning'; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    // "får personbil klass II parkeras …": a motorhome spot, whether or not it says "endast"
    if (/personbil klass (?:ii|2)\b/.test(x) && /parkeras/.test(x) && !/får (?:inte|ej)\b|(?:inte|ej) (?:stannas eller )?parkeras/.test(x) && !/personbil klass (?:i|1)\b/.test(x)) { out.reserved = true; out.reservedFor = 'husbil'; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    // "får husvagnar parkeras högst 24 timmar i följd", "får husbilar och husvagnar parkeras …": bays for motorhomes and caravans, whether or not
    // it says "endast"; a car gets no permission there (QA 20 Nov: Gnesta Mejerigatan, Vaxholm Västerhamn, Vaggeryd Artillerigatan gave all cars 24 h).
    // A lot where only some bays are for caravans ("På övriga platser får fordon parkeras …") stays unread.
    if (/\bfår (?:endast )?(?:husbil(?:ar(?:na)?)?|husvagn(?:ar(?:na)?)?)(?: (?:och|samt|eller) (?:husbil(?:ar)?|husvagn(?:ar)?))? (?:parkeras|uppställas)\b/.test(x) && !/får (?:inte|ej)\b|inte parkeras/.test(x) && !/övriga platser/i.test(t)) { out.reserved = true; out.reservedFor = 'husbil'; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; }
    // "får fordon som används av rörelsehindrade med särskilt tillstånd parkeras (under högst 2 tim …)" without "endast": a disabled bay; the text
    // gives other cars no permission, so it is reserved at all hours and its limits are for the disabled (QA 31 Oct: Ronneby showed a 2 h limit for all cars);
    // also "får fordon med rörelsehindrade som är innehavare av parkeringstillstånd … parkeras" (QA 15 Nov round 26: Uppsala, Örebro, Alingsås drawn open to all cars)
    if (/^(?!övrig tid).*?\bfår fordon (?:som används (?:av|för) (?:befordran av )?|med )rörelsehindrade?\b(?:[^.]|\.\s*(?=\d))*\bparkeras\b/.test(x) && !/(?:inte|ej) (?:stannas eller )?parkeras|får (?:inte|ej)\b|\bendast\b/.test(x) && !out.permitted && !out.limits.length && !out.bans.length && !out.reserved) {
      if (m) { unread(s); continue; }
      out.reserved = true; out.reservedFor = 'rörelsehindrade'; continue;
    }
    if (/^övrig tid får fordon (?:som används (?:av|för) (?:befordran av )?|med )rörelsehindrade?\b(?:[^.]|\.\s*(?=\d))*\bparkeras\b/.test(x) && out.reservedFor === 'rörelsehindrade' && !/(?:inte|ej) parkeras/.test(x)) continue; // the bay's other hours, still for the disabled
    // "får inte andra fordon parkeras än sådana som används för befordran av rörelsehindrade med särskilt tillstånd": a reserved bay, not a ban
    // for everyone (QA 2 Nov: Nynäshamn); an unnamed group ("servicefordon till kvarteret") stays a ban
    { const ao = x.match(/får (?:inte|ej) andra fordon (?:parkeras |stannas |stannas eller parkeras )?än (.*)$/); const who = ao && reservedFor(ao[1]);
      if (who) { out.reserved = true; out.reservedFor = who; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; } }
    // "Parkeringen får endast användas av fordon med särskilt tillstånd, - vuxenpsykiatri landstinget": a bay for permit holders only; a limit
    // read before it is theirs (QA 22 Nov measure: Falun Tingshusgatan gave every car 1 h)
    if (/^(?:parkering(?:en|splatse(?:n|rna))?|plats(?:en|erna)?|ytan) får endast (?:användas|nyttjas|utnyttjas) (?:av|för) (?:fordon|bil(?:ar)?)\b[^.]*\b(?:tillstånd|tillståndshavare)\b/.test(x) && !/\bboende\b|(?:inte|ej) parkeras|förbjud/.test(x) && !windows(s).length) { out.reserved = true; out.reservedFor = reservedFor(x); if (m) out.reservedSeason = m; continue; }
    // "får fordon parkeras högst 2 timmar i följd för rörelsehindrade personer med tillstånd": a disabled bay with its own limit (sweep: Växjö Kungsgatan gave every car 2 h)
    if (/\bfår fordon parkeras\b[^.]*\bför rörelsehindrade(?: personer)? med (?:särskilt )?(?:parkerings)?tillstånd\b/.test(x) && !/(?:inte|ej) parkeras/.test(x) && !out.reserved) { out.reserved = true; out.reservedFor = 'rörelsehindrade'; if (m) out.reservedSeason = m; continue; }
    // "Tillåtelsen gäller endast besökare till Kungsgatan 6.", "Tillåtelsen gäller dock endast för personal med erforderligt tillstånd": the permission
    // above is for a named group only (sweep waves 19, 24: Söderhamn Kungsgatan, Tanum Nestorsvägen showed the limit for every car)
    if (/^tillåtelsen (?:i \d+ ?§ )?gäller (?:dock )?(?:endast|enbart) (?:för )?(?:besök(?:are|ande)|personal)\b/.test(x) && !/\bboende\b|(?:klockan|kl\.?)\s*\d/.test(x) && !out.reserved) { out.reserved = true; out.reservedFor = null; continue; }
    // bays for travellers: "får fordon med resande med tåg eller buss, parkeras under högst 24 tim i följd" (Alvesta Moheda), "Endast resenärer i samband med långtidsresor … får
    // parkera" after the permission (Gällivare): a named group, no place for other cars; the limit is the bay's (sweep waves 14–27, findings batch 8)
    if (/^endast (?:resenärer|resande)\b[^.]*\bfår parkera\.?$/.test(x) && !/(?:klockan|kl\.?)\s*\d/.test(x)) { out.reserved = true; out.reservedFor = null; continue; }
    // "får husvagnar parkeras måndagar - fredagar högst 24 timmar i följd. För övrig parkering gäller ingen tidsbegränsning.": a car park open to all where only caravans
    // have a limit: no rule for cars (sweep findings batch 8: Kiruna's lay-bys at Abisko, Bergfors, Krokvik and Rensjön showed the caravans' 24 h for every car)
    if (/^för övrig parkering gäller ingen tidsbegränsning\.?$/.test(x) && out.reserved && out.reservedFor === 'husbil' && !out.bans.length) { out.reserved = false; out.reservedFor = null; out.reservedWindows = []; out.limits = []; lastLimit = null; out.permitted = true; continue; }
    if (out.reserved && /^parkering endast mot avgift\.?$/.test(x)) continue; // a reserved bay's fee: nothing for other cars
    // "får fordon endast parkeras med stöd av parkeringstillstånd enligt 13 kap. 8 §": a disabled bay (QA 6 Nov: Örnsköldsvik Läroverksgatan showed a 3 h limit for all cars)
    if (/\bfår fordon endast parkeras med stöd av (?:särskilt )?parkeringstillstånd enligt 13 kap\.? ?8 §/.test(x)) { x = x.replace(/\bfår fordon endast parkeras/, 'får endast fordon parkeras'); s = s.replace(/\bfår fordon endast parkeras/i, 'får endast fordon parkeras'); }
    if (/får endast\b/.test(x) && /parkeras|stannas|får endast [^.]*?\b(?:stanna|parkera)\b/.test(x)) { // also the infinitive: "får endast bussar stanna eller parkera i högst 15 minuter" (QA 10 Nov round 13: Kiruna Malmvägen showed 15 min for all cars)
      const who = reservedFor(x);
      if (who) { out.reserved = true; out.reservedFor = who; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; } // the hours stated here are the hours it is reserved ("…parkeras mot avgift vardagar 07.00 - 19.00")
      // "får endast fordon med tillstånd parkeras", "får endast besökare till MVC parkeras", "får endast fordon för biblioteksverksamhet parkeras",
      // "får endast lastning och lossning av gods … parkeras": a bay for a named group, no permission for other cars; the hours stated are the hours
      // it is reserved. Residents' permits stay with the register (the app shows those zones itself). (sweep waves 13–27: Burlöv, Orust, Lysekil, Mönsterås, Tanum)
      // "får endast fordon tillhörande polismyndigheten parkeras", "får endast sådana fordon parkeras som används av polismyndigheten", "får endast fordon som tillhör <company>
      // parkeras", "får endast fordon med Farligt gods parkeras", "får endast fordon i linjetrafik parkeras", "får endast fordon som har ärende till förskolan parkera",
      // "får endast fordon som används av distriktsköterskor … parkeras": bays for a named owner or errand; no other car may park (sweep findings batch 8: Osby, Hultsfred,
      // Karlskrona, Åsele, Partille, Kil, Mönsterås, Burlöv were grey)
      if (/\bfår endast (?:sådana? )?fordon (?:tillhör(?:ande|iga)\b|som (?:tillhör|används av|har ärende till)\b|med farligt gods\b|i linjetrafik\b)[^.]*\b(?:parkeras|parkera)\b|\bfår endast sådana? fordon parkeras som (?:tillhör|används av)\b/.test(x) && !/\bboende\b|rörelse?hindrad|(?:inte|ej) parkeras|(?:klockan|kl\.?)\s*\d/.test(x)) { out.reserved = true; out.reservedFor = null; continue; }
      { const subj = x.match(/får endast (.*?),? (?:stannas eller )?(?:parkeras|parkera\b)/);
        if (subj && !/\bboende|^(?:personbil(?:ar)?(?: klass (?:i|1)\b)?|fordon|motordrivna fordon|motorfordon)$/.test(subj[1].trim()) && /\b(?:tillstånd|besök(?:are|ande)|personal|kunder|\S*verksamhet|lastning (?:och|eller) lossning)\b/.test(subj[1]) && !/(?:inte|ej) parkeras/.test(x)) { out.reserved = true; out.reservedFor = null; if (m) out.reservedSeason = m; out.reservedWindows.push(...windows(s).map(withSP)); continue; } }
      // "får endast personbil parkeras …": ordinary cars may park; read the rest of the sentence as usual
      x = x.replace(/får endast (?:personbil(?:ar)?(?: klass (?:i|1)\b)?|fordon)\s*/, 'får fordon '); s = s.replace(/får endast (?:personbil(?:ar)?(?: klass (?:I|1)\b)?|fordon)\s*/i, 'får fordon ');
    }
    if (/^övrig(?:a)? (?:del(?:en)? av året|tid(?:en)? av året) (?:gäller|råder|är det) (?:parkeringsförbud|förbud att parkera|förbjudet att parkera)/.test(x)) { // "… högst 24 tim i följd under tiden 1 juli – 30 september. Övrig del av året gäller parkeringsförbud." (QA 9 Nov: Kiruna read as an all-year ban)
      const ms = lastLimit && lastLimit.items.length && lastLimit.items.every((w) => w.m && JSON.stringify(w.m) === JSON.stringify(lastLimit.items[0].m)) ? lastLimit.items[0].m : !lastLimit ? permitSeason : null;
      if (ms && !windows(s).length) { const items = [{ a: 0, b: 1440, m: complement(ms) }]; out.bans.push(...items); lastBan = { items, provisional: false }; continue; }
      unread(s); continue;
    }
    if (/^övrig tid (?:får (?:fordon inte|inte fordon) parkeras|(?:är |råder )?parkering(?:en)? förbjuden|är det förbjudet att (?:stanna (?:eller|och) )?parkera|(?:(?:råder|gäller) )?parkeringsförbud|(?:(?:råder|gäller) )?förbud (?:att|mot att) parkera(?! mot färdriktningen)|råder förbud mot parkering|får fordon (?:inte|ej) stannas)/.test(x)) { // also "Övrig tid gäller parkeringsförbud" (Ekerö, Nynäshamn), bare "Övrig tid parkeringsförbud." (QA 9 Nov: Danderyd), "Övrig tid gäller förbud mot att parkera fordon" (Eskilstuna) // outside the stated hours: not allowed
      if (!lastAllow && lastBan && !lastBan.items.some((b) => b.w || b.m || b.p || b.dm || b.nw || b.dd)) { const o = outsideHours(lastBan.items); if (o && o.length) { out.bans.push(...o); continue; } } // a stopping ban at set hours, "Övrig tid får fordon inte parkeras" (Huddinge): no parking at other times either
      // after a time-limited permission with set hours and no "Tillåtelsen gäller …" ("… högst 1 tim i följd. Tidsbegränsningen gäller vardag …
      // 10.00 - 14.00. Övrig tid får fordon inte parkeras."): no parking outside the limit's hours (QA 30 Oct: Danderyd, Täby showed free parking)
      if (!lastAllow && lastLimit && !lastLimit.items.some((w) => w.m || w.p || w.wk || w.dm || w.nw || w.dd || !(w.a < w.b))) { const o = outsideHoursW(lastLimit.items); /* also a limit on named weekdays ("Tidsbegränsningen gäller måndag - fredag 07-17. Övrig tid råder parkeringsförbud": sweep wave 1, Solna Kristinelundsvägen was free at night) */ if (o && o.length) { out.bans.push(...o); lastBan = { items: o, provisional: false }; continue; } }
      // "… får endast personbil klass II parkeras mellan klockan 09.00 - 20.00. Övrig tid får fordon inte parkeras." (Halmstad): banned outside the reserved hours
      if (!lastAllow && !lastLimit && out.reserved && out.reservedWindows.length && !out.reservedWindows.some((w) => w.w || w.m || w.p || w.wk || w.dm || w.nw || w.dd || !(w.a < w.b))) { const o = outsideHours(out.reservedWindows); if (o && o.length) { out.bans.push(...o); lastBan = { items: o, provisional: false }; continue; } }
      if (!lastAllow && !lastLimit && permitSeason && !windows(s).length) { const items = [{ a: 0, b: 1440, m: complement(permitSeason) }]; out.bans.push(...items); lastBan = { items, provisional: false }; continue; } // "… parkeras 15 april – 15 oktober. Övrig tid får fordon inte parkeras": banned the rest of the year (Knivsta, Karlskoga)
      // "får fordon inte stannas eller parkeras. Förbudet gäller onsdag 08-16 och 15 november - 15 maj. Parkeringsförbud gäller övrig tid.": a stopping
      // ban on a weekday in a season, and no parking at any other time: parking is never allowed (sweep wave 3: Nacka Diligensvägen)
      if (!lastAllow && !lastLimit && lastBan && !lastBan.provisional && lastBan.items.length && !out.limits.length && !out.permitted && !out.reserved && !out.purpose.length && !windows(s).length && !m && !p && !wk) { const items = [{ a: 0, b: 1440 }]; out.bans.push(...items); continue; }
      // "… parkeras under högst 4 tim i följd. Tillåtelsen gäller 1 april - 31 oktober. Övrig tid får fordon inte parkeras.": the limit's season is
      // the permission's; the rest of the year is banned (sweep wave 1: Uppsala Eriksbergsvägen was free in winter)
      const limSeason = allowSeason || (lastLimit && lastLimit.items.length && lastLimit.items[0].m) || null; // also "Villkoret gäller 1 juni - 31 augusti. Övrig tid parkeringsförbud …" (sweep: Karlshamn Matvikshamnsvägen was free outside the summer)
      if (!lastAllow && lastLimit && limSeason && !windows(s).length && lastLimit.items.every((w) => w.a === 0 && w.b === 1440 && !w.w && !w.dt && !w.p && !w.wk && !w.dm && !w.nw && !w.dd && JSON.stringify(w.m) === JSON.stringify(limSeason))) { const items = [{ a: 0, b: 1440, m: complement(limSeason) }]; out.bans.push(...items); lastBan = { items, provisional: false }; continue; }
      if (!lastAllow) { unread(s); continue; }
      out.otherAllowed = false; out.allowOnly.push(...lastAllow.filter((w) => !out.allowOnly.includes(w)));
      // "… parkeras … mellan klockan 08.00 - 20.00. Tillåtelsen gäller 30 april - 30 september. Övrig tid får fordon inte parkeras.": the rest of the year is banned too (QA 15 Nov round 28: Kalmar Kalmarsundsparken was open 08–20 all year)
      if (allowSeason && !windows(s).length && lastAllow.every((w) => !w.m)) { const items = [{ a: 0, b: 1440, m: complement(allowSeason) }]; out.bans.push(...items); lastBan = { items, provisional: false }; }
      continue;
    }
    if (/^övrig tid (?:fri parkering|får (?:fordon|personbil(?:ar)?(?! klass (?:ii|2)\b)) (?:stannas eller )?parkeras|är parkering(?:en)? tillåten\b|får parkering ske (?!utan)(?=[^.]*högst))/.test(x)) { // also "Övrig tid är parkeringen tillåten …" (sweep wave 1: Uppsala Götgatan) // also "Övrig tid får parkering ske högst 8h i följd" (QA 17 Nov round 33: Upplands Väsby Ryttargatan showed no limit outside 07–17) // also "Övrig tid får personbil parkeras" after a klass I permission (QA 12 Nov round 17: Helsingborg Palmqvistgatan) // also "Övrig tid är parkering tillåten under högst 5 minuter i följd" (QA 9 Nov: Uppsala S:t Johannesgatan, Ronneby) // "…other times vehicles may park": the permission hours are not the only hours
      out.otherAllowed = true; out.allowOnly = out.allowOnly.filter((w) => !tillWs.includes(w));
      if (m && out.reserved && out.reservedSeason) out.openSeason = m; // "Övrig tid får fordon parkeras under 17 september - 14 maj" after a bay reserved 15 maj - 15 september: the open season is the one the text names, not the day after the reserved one (batch 7 check: Orust Wunschevägen was open on 16 September)
      // "… parkeras under högst 4 tim i följd mot avgift. Avgiftsplikten gäller vardagar 09.00 - 17.00. Övrig tid är parkering tillåten utan avgift
      // och tidsbegränsning": the limit holds in the fee hours only (sweep wave 3: Danderyd Brovägen)
      if (/utan avgift och (?:utan )?tidsbegränsning|utan tidsbegränsning och (?:utan )?avgift/.test(x) && lastLimit && lastLimit.items.length === 1 && lastLimit.items[0].a === 0 && lastLimit.items[0].b === 1440 && Object.keys(lastLimit.items[0]).length === 3 && out.feeWindows && out.feeWindows.length && feeExplicit && !duration(s)) { out.limits = out.limits.filter((l) => !lastLimit.items.includes(l)); const items = out.feeWindows.map((w) => ({ ...w, max: lastLimit.max })); out.limits.push(...items); lastLimit = { max: lastLimit.max, items }; continue; }
      if (/mot avgift/.test(x) && lastLimit && !out.feeWindows) {
        let items = lastLimit.items; const ws5 = new Set(items.map((w) => w.w)); // "måndag - fredag 07-17" was expanded per weekday: Mon–Fri is the vardag day type
        if (items.every((w) => w.w >= 1 && w.w <= 5 && w.a === items[0].a && w.b === items[0].b && !w.m && !w.p) && ws5.size === 5) items = [{ dt: ['vardag'], a: items[0].a, b: items[0].b }];
        const o = outsideHours(items); if (o && o.length) out.feeWindows = o.map(withSP);
      } // "Övrig tid får fordon parkeras mot avgift": the fee only outside the limit's hours (QA 8 Nov: Solna Ankdammsgatan charged around the clock)
      const d = duration(s);
      if (d) { // "Övrig tid får fordon parkeras under högst 4 tim i följd": a limit in the hours outside the limit just stated
        let o = lastLimit ? outsideHours(lastLimit.items) : null;
        // "… ska vara ändamålsplats för lastning … vardagar 07.00 - 19.00. Övrig tid får fordon parkeras under högst 3 tim i följd.": the limit holds
        // outside the loading hours (sweep waves 1–8: Stockholm Perstorpsvägen, Mäster Samuelsgatan, Trollesundsvägen showed no limit)
        if (!lastLimit && !lastAllow && out.purpose.length && !out.reserved && !windows(s).length && !/vardag|helgdag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag/.test(x)) o = outsideHoursW(out.purpose);
        // "Tillåtelsen gäller under tiden vardag … 18.00 – 07.00 … Övrig tid är parkering tillåten under högst 5 minuter i följd": the limit holds outside the permission's hours (QA 9 Nov: Uppsala S:t Johannesgatan)
        if (!lastLimit && lastAllow && tillWs.length && lastAllow.every((w) => tillWs.includes(w) && !w.w && !w.m && !w.p && !w.wk && !w.dm && !w.nw && !w.dd)) o = outsideHours(lastAllow);
        // a limit in a season ("… högst 20 min i följd. Tidsbegränsningen gäller under tiden 15 augusti - 15 juni. Övrig tid får fordon parkeras
        // under högst 2 timmar i följd."): other hours of that season, and the whole rest of the year (QA 29 Oct: Kil, Hjo, Ljusdal, Tranemo)
        const sm = lastLimit && lastLimit.items[0].m;
        if (!o && sm && lastLimit.items.every((w) => JSON.stringify(w.m) === JSON.stringify(sm) && !w.w && !w.p && !w.wk && !w.dm && !w.nw && !w.dd) && !windows(s).length && !/vardag|helgdag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag/.test(x)) {
          const inSeason = outsideHours(lastLimit.items.map(({ m: _m, ...w }) => w)) || [];
          o = [...inSeason.map((w) => ({ ...w, m: sm })), { a: 0, b: 1440, m: complement(sm) }];
        }
        // "Förbudet gäller torsdag 07.00 - 16.00. Övrig tid får fordon parkeras under högst 7 dygn i följd och mot avgift under tiden vardagar … 09.00 - 16.00": the hours
        // are the fee's, a limit of days holds at all hours (sweep findings batch 9: Karlskrona Alamedan had the 7 days inside the fee hours only)
        if (!o && d >= 1440 && lastBan && /under högst \d+ dygn i följd (?:och|samt) mot avgift under tiden /.test(x)) { const fw = windows(s); const items = [{ a: 0, b: 1440, max: d }]; out.limits.push(...items); lastLimit = { max: d, items }; if (fw.length && !out.feeWindows) out.feeWindows = fw.map(withSP); continue; }
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
    if (/^förbudet (?:att parkera )?(?:i (?:paragraf \d+|\d+ §) )?gäller/.test(x) && lastBan && NTH.test(s) && !/(?:klockan|kl\.?)\s*\d/.test(x)) { const n = NTH.exec(s); for (const b of lastBan.items) { b.w = WEEKDAYS[n[3].toLowerCase()]; b.nw = NTH_N[n[1].toLowerCase()]; if (n[2]) b.nh = 1; delete b.dt; } continue; }
    // "Tillåtelsen gäller inte personbil klass II …": a rule for motorhomes only; ordinary cars are not affected (Visby)
    if (/^tillåtelsen(?: att parkera)?(?: (?:enligt|i) (?:§\s*\d+|\d+\s*§))? gäller (?:inte|ej) (?:för |vid )?pe(?:rs|r|s)onbil klass (?:ii|2)\b/.test(x)) continue; // also "Tillåtelsen enligt §1 gäller inte peronbil klass 2" (QA 18 Nov round 35: Sotenäs Smögen kept the register's all-year fee)
    if (/^(?:\d+\s*§\s*)?tillåtelsen gäller (?:inte|ej) (?:för )?(?:husbil(?:ar)?|husvagn(?:ar)?)(?:,? (?:och|samt|eller) (?:för )?(?:husbil(?:ar)?|husvagn(?:ar)?|släpvagn(?:ar)?|släpfordon))?\.?$/.test(x)) continue; // "Tillåtelsen gäller inte husbilar och husvagnar": a rule for motorhomes and caravans only (QA 16 Nov round 30: Borgholm Hamnvägen drew an all-day ban) // also "Tillåtelsen gäller inte vid personbil klass II under tiden … 22.00 - 08.00" (QA 16 Nov round 29: Falkenberg Läroverksgatan showed a night ban for all cars) // the hours of a heavy-vehicle ban (Norrtälje 0188 2020-00111)
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
        // "Förbudet gäller inte under tiden onsdag klockan 08.00 - 16.00" after a plain all-day ban: parking is allowed only in those hours, like
        // "Parkering är dock tillåten …" (sweep wave 17: Nyköping Rosenkällavägen showed the ban on Wednesdays 08–16 only, free otherwise)
        { const ews = windows(s); if (lastBan && ews.length && !halfRead(s, ews) && !m && !p && !wk && /^(?:fordon )?(?:under tiden )?(?:(?:vardag|dag(?:ar)? före|sön- och helgdag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)[^.]*?)?(?:mellan )?(?:klockan|kl\.?)\s*\d/.test(ex) && ews.every((w) => Object.keys(w).every((k) => ['a', 'b', 'dt', 'w'].includes(k))) && lastBan.items.length && lastBan.items.every((w) => w.a === 0 && w.b === 1440 && Object.keys(w).length === 2) && !out.reserved && !out.purpose.length) {
          out.bans = out.bans.filter((w) => !lastBan.items.includes(w)); out.allowOnly.push(...ews); out.otherAllowed = false; lastBan = null; lastAllow = ews; continue; } }
        unread(s); continue;
      }
      // "Förbudet gäller endast (fordon) vardagar" after a ban with its own hours: the days of that ban, not a new all-day ban (QA 27 Oct: Skellefteå)
      if (lastBan && !lastBan.provisional && /^förbudet gäller (?:endast|enbart|bara) (?:fordon )?(?:under )?(?:vardag|vardagar|helgfri)[^.]*$/.test(x.replace(/\.$/, '')) && !windows(s).length) {
        const d = dayOnlyWindows(s); if (d.length === 1 && d[0].dt && !d[0].w) { for (const b of lastBan.items) b.dt = (b.dt || ['vardag', 'fore', 'helgdag']).filter((k) => d[0].dt.includes(k)); continue; }
      }
      // "Förbudet gäller klockan 06.00 - 18.30 20 augusti - 23 december samt klockan 06.00 - 18.30 7 januari - 14 juni": each range has its own season (sweep: Stenungsund Timmerviksvägen had the first season twice)
      { const parts = s.split(/\s+(?:samt|och)\s+(?=(?:under tiden\s+)?(?:klockan|kl\.?)\s*\d)/i);
        if (parts.length > 1 && allSeasons(s).length === parts.length && !p && !wk && parts.every((q) => allSeasons(q).length === 1 && windows(q).length && !halfRead(q, windows(q)))) {
          const items = parts.flatMap((q) => windows(q).map((w) => clean({ ...w, m: allSeasons(q)[0] })));
          if (lastBan) out.bans = out.bans.filter((b) => !lastBan.items.includes(b)); out.bans.push(...items); lastBan = { items, provisional: false }; continue; } }
      let ws = windows(s); if (!ws.length) ws = dayOnlyWindows(s);
      if (!ws.length && m && /(?:klockan|kl\.?)\s*\d/.test(x)) { unread(s); continue; } // "Förbudet gäller måndag mellan klockan 08.12 under tiden 1 december - 30 april": the hours were not read, so not a whole-season ban (QA 19 Nov round 39: Lidingö Islinge Hamnväg showed the ban every day)
      if (!ws.length && m) { // "Förbudet gäller 1 december - 31 mars": the season of the ban just stated, or a whole-season ban
        if (lastBan && allSeasons(s).length > 1 && !p && lastBan.items.every((b) => !b.m)) { const items = lastBan.items.flatMap((b) => allSeasons(s).map((mm) => ({ ...b, m: mm }))); out.bans = out.bans.filter((b) => !lastBan.items.includes(b)); out.bans.push(...items); lastBan = { items, provisional: false }; continue; } // "Förbudet gäller under tiden 14 september - 5 oktober och 30 november - 21 december": one ban per period (sweep: Örebro Kungsgatan had only the first)
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
    if (/får (?:dock )?(?:(?:motorredskap|traktor|tung lastbil|lastbil|tung buss|buss|personbil klass (?:ii|2)|(?:tungt )?släpfordon|släpvagn|fordonståg)[^.]*?)(?:inte|ej) (?:heller )?(?:stannas eller )?parkeras/.test(x) && !/\bfordon (?:inte|ej)|får (?:inte|ej) fordon|personbil(?! klass (?:ii|2))|bruttovikt över/.test(x)) { if (!out.reserved || !/får dock/.test(x)) out.heavyOnly = true; continue; }
    // "I Kungsbacka stad får buss, lastbil, motorredskap, släpfordon och traktor parkeras under högst 2 tim i följd under tiden klockan 22.00 - 06.00": a longest stay
    // for heavy vehicles only, no rule for cars (QA 27 Nov: Kungsbacka Storgatan carried a 2 h night limit for every car)
    { const H = '(?:tung(?:a|t)? )?(?:buss(?:ar)?|lastbil(?:ar)?|motorredskap|traktor(?:er)?|släpfordon|släpvagn(?:ar)?|fordonståg|terrängmotorfordon|terrängsläp)';
      if (new RegExp(`(?:^|\\s)får ${H}(?:,? (?:och|samt|eller) ${H}|, ${H})* parkeras (?:under )?högst\\b`).test(x) && !out.reserved) { out.heavyOnly = true; continue; } }
    // a ban only for motorhomes and trailers ("Parkering är dock förbjuden för personbil klass II och släpkärra under tiden …", "Personbil klass II
    // får ej parkeras", "… får dock personbil klass II inte parkeras"): ordinary cars may park (QA 30 Oct: Landskrona, Karlskrona, Ulricehamn showed a ban)
    { const V = '(?:personbil(?:ar)? klass (?:ii|2)|släpkärr(?:a|or)|släpfordon|släpvagn(?:ar)?|husvagn(?:ar)?|husbil(?:ar)?)', L = `${V}(?:,? (?:och|samt|eller) (?:för )?${V})*`;
      if (new RegExp(`(?:^|\\s)(?:parkering(?:en)? (?:är |råder )?(?:dock )?förbjuden för ${L}(?=\\s+(?:under|mellan|klockan|kl|vardag|dag|sön|\\d)|\\.?$)|^${L} får (?:dock )?(?:inte|ej) (?:stannas eller )?parkeras|får dock ${L} (?:inte|ej) (?:stannas eller )?parkeras)`).test(x)) { if (!out.reserved) out.heavyOnly = true; continue; } } // a motorhome bay's other hours (Simrishamn) stay a reservation
    if (/(?:fordon(?:ståg)? )?med (?:en )?(?:brutto|total)vikt över [\d,.]+ ton (?:inte|ej) parkeras|frikopplat släpfordon/.test(x)) { out.heavyOnly = true; continue; } // also "får med totalvikt över 3,5 ton inte parkeras" (word lost, Burlöv)
    if (/får (?:inte|ej) (?:tung |tungt )?(?:lastbil(?:ar)?|buss(?:ar)?|släpvagn(?:ar)?|släpfordon|fordonståg|motordrivet fordon med tillkopplad)\b/.test(x) && !/får (?:inte|ej) fordon\b/.test(x)) { out.heavyOnly = true; continue; } // "får inte lastbil och motordrivet fordon med tillkopplad släpvagn … parkeras" (Alingsås)
    if (/förbjud|gäller (?:dock )?(?:förbud (?:att|mot att) parkera|parkeringsförbud)\b|^(?:stannande- och )?parkeringsförbud (?:gäller|råder) (?:dock )?(?:under tiden |mellan |klockan |kl\.? |alla dagar |dagligen |vardag|måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag|dag(?:ar)? före|sön- och)|får (?:dock )?(?:fordon |motorfordon |bil(?:ar)? |personbil(?:ar)? )?(?:inte|ej) (?:stannas eller )?parkeras|får (?:inte|ej) (?:fordon|motorfordon) (?:stannas eller )?parkeras|får (?:fordon|motorfordon) (?:inte|ej) stannas\b|får (?:inte|ej) (?:fordon|motorfordon) stannas\b|råder (?:det )?förbud (?:mot )?att (?:stanna (?:eller|och) )?parkera\b(?! mot färdriktningen)/.test(x)) { // also a plain stopping ban "får fordon inte stannas" and "råder förbud mot att stanna eller parkera fordon" (sweep waves 9–13: Bräcke Norrlandsgatan, Kristianstad Färlöv) // "gäller dock förbud att parkera onsdagar kl 00.00-06.00" (QA 8 Nov: Örebro), "På torsdagar gäller parkeringsförbud klockan 05.00-16.00" (Nässjö)
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
    if (/^tillåtelsen gäller (?:endast|enbart) (?:för )?[^.]*\bpersonbil(?:ar)?\b(?! klass (?:ii|2)\b| med\b| som\b)/.test(x) && !/rörelse?hindrad|tillstånd|boende|släp|husvagn/.test(x)) continue; // "Tillåtelsen gäller endast lätt lastbil och personbil klass I": ordinary cars are among them, no bay for trucks (sweep: Västerås Lögarängsvägen ×3 answered NO to cars)
    if (/^(?:tillåtelsen |föreskriften |föreskrifterna |bestämmelsen )?gäller (?:endast|enbart) (?:för )?(?!under\b|mellan\b|klockan\b|vardag|dag\b|sön)/.test(x) && reservedFor(x)) { /* also a bare "Gäller endast buss." / "Föreskriften gäller endast motorcykel." after the permission (QA 11 Nov round 15: Växjö Kvarnvägen showed 24 h for all cars) */ out.reserved = true; out.reservedFor = reservedFor(x); continue; }
    // "2 § Tillåtelsen gäller buss i linjetrafik.": the permission above is for that vehicle only (sweep wave 9: Sundsvall Hamngatan gave every car 2 h)
    if (/^tillåtelsen gäller (?:för )?(?:buss(?:ar)?(?: i linjetrafik)?|taxi(?:fordon)?(?: i tjänst)?|utryckningsfordon|motorcyk(?:el|lar))\.?$/.test(x) && !out.reserved) { out.reserved = true; out.reservedFor = reservedFor(x); continue; }
    // "Gäller alla bussar för på- och avstigning." after a bus bay: who the bay is for, no rule for cars (sweep wave 3: Värmdö Gustavsbergs allé)
    if (/^gäller (?:alla|samtliga) buss(?:ar)?\b/.test(x) && out.reserved && out.reservedFor === 'buss' && !/(?:klockan|kl\.?)\s*\d|inte|ej\b/.test(x)) continue;
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
      // "… parkeras under högst 2 tim i följd vardag klockan 08.00 - 18.00. Tidsbegränsningen gäller vardag utom dag före sön- och helgdag.": the days of the
      // hours just given, not a limit around the clock (sweep: Tingsryd Torggatan, Storgatan were limited at night)
      if (!windows(s).length && ws.length && ws.every((w) => w.a === 0 && w.b === 1440 && w.dt && !w.w && !w.m) && lastLimit.items.length === 1 && !(lastLimit.items[0].a === 0 && lastLimit.items[0].b === 1440) && !lastLimit.items[0].w && !lastLimit.items[0].nw && !lastLimit.items[0].dm && !m) { const { max: mx0, ...base } = lastLimit.items[0]; ws = ws.map((w) => ({ ...base, dt: w.dt })); }
      if (/^(?:\d+\s*§\s*)?(?:tidsbegränsningen|villkoret) gäller alla dagar\.?$/.test(x) && lastLimit.items.every((l) => !l.dt && !l.w)) continue; // "2 § Tidsbegränsningen gäller mellan klockan 08.00 - 22.00. … 4 § Tidsbegränsningen gäller alla dagar.": the days of the hours just given, not a limit around the clock (sweep: Huddinge Lammholmsbacken)
      if (!ws.length && m) { for (const l of lastLimit.items) l.m = m; continue; } // "Tidsbegränsningen gäller under tiden 1 maj - 30 september": the limit's season (QA: Vänersborg, Tanum)
      // "Tillåtelsen gäller under tiden vardag utom dag före sön- och helgdag och under högst 2 tim i följd. Tidsbegränsningen gäller under tiden
      // klockan 08.00 - 16.00.": hours with no days of their own keep the day type the limit was stated with (sweep wave 1: Upplands Väsby Holmvägen had the limit on Saturdays and Sundays too)
      if (ws.length && !halfRead(s, ws) && ws.every((w) => !w.dt && !w.w && !w.nw && !w.dm) && !DAY_WORD_RE.test(s.replace(ALL_DAYS_RE, ' ')) && lastLimit.items.length === 1 && lastLimit.items[0].a === 0 && lastLimit.items[0].b === 1440 && lastLimit.items[0].dt && lastLimit.items[0].dt.length < 3 && !lastLimit.items[0].w) ws = ws.map((w) => ({ ...w, dt: lastLimit.items[0].dt }));
      if (ws.length && !halfRead(s, ws)) { out.limits = out.limits.filter((l) => !lastLimit.items.includes(l)); const keepM = lastLimit.items.length && lastLimit.items.every((l) => l.m && JSON.stringify(l.m) === JSON.stringify(lastLimit.items[0].m)) ? lastLimit.items[0].m : null; /* the season the limit was stated with stays when its hours follow (sweep: Askersund Hamngatan had the summer season on Mon–Fri only) */ const items = ws.map(withSP).map((w) => (keepM && !w.m ? { ...w, m: keepM } : w)).map((w) => ({ ...w, max: lastLimit.max })); out.limits.push(...items); lastLimit = { max: lastLimit.max, items }; if (feeNext && !out.feeWindows && /^villkoret/.test(x)) { out.feeWindows = ws.map(withSP); feeFromConditions = true; } continue; } // "… parkeras mot avgift. Tillåtelsen gäller under högst 2 timmar. Villkoret gäller <hours>": the conditions, fee included, hold in those hours (Uddevalla)
      unread(s); continue;
    }
    // "Tillåtelsen gäller inte husvagn och husbil att parkera under tiden … 20.00 - 06.00": a night ban for caravans and motorhomes only (sweep: Höganäs Klötesvägen)
    if (/^tillåtelsen (?:att parkera )?gäller (?:inte|ej) (?:för )?(?:husvagn(?:ar)?|husbil(?:ar)?|personbil(?:ar)? klass (?:ii|2)|släpfordon|släpvagn(?:ar)?|(?:tung )?lastbil(?:ar)?|(?:tung )?buss(?:ar)?)\b/.test(x) && !/\bpersonbil(?:ar)?\b(?! klass (?:ii|2)\b)/.test(x)) continue;
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
      // "… får fordon, med avvikelse från … parkeringsförbudszon, parkeras. Tillåtelsen att parkera i 1 § gäller dock högst 1 tim i följd. villkoret gäller
      // under tiden vardagar … 09.00 - 16.00" / "… gäller dock högst 24 timmar i följd, vardagar utom vardag före söndag och helgdag": the permission was
      // given without hours and "dock högst N" only limits it, so the hours are the limit's; outside them parking stays allowed, without the limit
      // (sweep waves 14–27: 33 Hudiksvall regulations answered NO in the evening and at weekends)
      if (d && /gäller dock (?:under )?högst/.test(x) && !/övrig tid|\b(?:inte|ej)\b/.test(x.replace(/(?:ger|ge) (?:inte|ej) rätt att[^.]*/g, ''))) { const items = ws.map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items }; continue; }
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
      // the same day type twice with overlapping hours ("vardag utom vardag före sön- och helgdag klockan 09.00 - 18.00 och vardag utom vardag före sön- och helgdag klockan 09.00 - 15.00"): a slip in the text, the sign decides (QA 16 Nov round 30: Hässleholm Tredje Avenyen, Helsingborg Gasverksgatan)
      if (ws.some((w, i) => ws.some((v, j) => j > i && !w.w && !v.w && !w.nw && !v.nw && !w.dm && !v.dm && w.dt && v.dt && JSON.stringify(w.dt) === JSON.stringify(v.dt) && JSON.stringify(w.m || null) === JSON.stringify(v.m || null) && w.a < w.b && v.a < v.b && w.a < v.b && v.a < w.b)) && sameDayPhraseTwice(s)) out.textSlip = true; // the slip is flagged (rdt-reparse greys the line) and the sentence is still read with both ranges, the stricter reading: leaving it unread dropped the limit where a city has no rule of its own to fall back on (Stockholm, main pull request #9: 6 of 60 texts judged wrong)
      // "får fordon inte parkeras. Parkering är dock tillåten mot avgift onsdag klockan 07.00 - 19.00 och vardag före sön- och helgdag
      // klockan 11.00 - 17.00": the all-day ban has exceptions, parking is allowed only in those hours (QA 8 Nov: Nacka Becksjudarvägen showed a ban all week). Only plain hours and days: 'den 4:e tisdagen i månaden' as allowed-only hours is left to the ban (safe side)
      // "får fordon inte parkeras. Parkering är dock tillåten april - november.": the ban holds the rest of the year (sweep: six Ulricehamn streets were banned all year)
      if (/^parkering (?:är )?dock tillåten\b/.test(x) && !ws.length && !d && m && !p && m.length === 2 && lastBan && lastBan.items.length === 1 && lastBan.items[0].a === 0 && lastBan.items[0].b === 1440 && Object.keys(lastBan.items[0]).length === 2 && !out.reserved && !out.purpose.length && !/mot avgift|endast/.test(x)) {
        const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; const [[m1, d1], [m2, d2]] = m;
        const next = d2 >= dim[m2 - 1] ? [m2 % 12 + 1, 1] : [m2, d2 + 1], prev = d1 <= 1 ? [(m1 + 10) % 12 + 1, dim[(m1 + 10) % 12]] : [m1, d1 - 1];
        lastBan.items[0].m = [next, prev]; lastBan = null; continue;
      }
      // "får fordon inte parkeras. Parkering är dock tillåten under högst 2 tim mellan klockan 06.00 – 22.00": parking is allowed in those hours, with the limit, and
      // banned outside them; without hours it is a plain limit and no ban (sweep: Värnamo Bangårdsgatan, Mjölby Norra Strandvägen, Forshaga Sandviksvägen were banned
      // at all hours). Only plain hours and day types: a named weekday or an n-th weekday as the only allowed time is left to the ban (safe side)
      if (/^parkering (?:är )?dock tillåten\b/.test(x) && d && !m && !p && ws.every((w) => w.a < w.b && Object.keys(w).every((k) => ['a', 'b', 'dt'].includes(k))) && lastBan && lastBan.items.length === 1 && lastBan.items[0].a === 0 && lastBan.items[0].b === 1440 && Object.keys(lastBan.items[0]).length === 2 && !out.reserved && !out.purpose.length && !/mot avgift|endast|övrig tid|markera|plats|parkeringsyt|sträck|lastning|lossning|stigning/.test(x) && !/förutom på markerade platser/i.test(body)) { // an exception for marked bays only ("… dock tillåten på särskilt markerade platser") leaves the street's ban
        out.bans = out.bans.filter((w) => !lastBan.items.includes(w)); lastBan = null;
        const items = (ws.length ? ws : [{ a: 0, b: 1440 }]).map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items };
        if (ws.length) { out.allowOnly.push(...ws); out.otherAllowed = false; lastAllow = ws; }
        continue;
      }
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
      // "får fordon parkeras högst 2 dygn i följd mot avgift, zon 2, vardagar utom dag före helgdag kl 09.00 - 18.00 samt dag före helgdag kl 09.00 - 14.00":
      // the hours after the fee zone are the hours the fee is charged (sweep waves 9–12: Växjö Norra Esplanaden and 18 more showed a fee around the clock)
      if (/mot avgift ?,? zon \S+,? /.test(x) && ws.length && !out.feeWindows) out.feeWindows = ws.map((w) => ({ ...w }));
      // "högst 10 dygn i följd och mot avgift vardagar … 09.00 - 18.00", "högst 24 timmar i följd mot avgift, zon 1, vardagar … kl 09.00 - 18.00": the hours after
      // "mot avgift" are the fee's; a limit of a day or more holds at all hours (sweep waves 13–27: Västervik Skeppsbron, Växjö Kungsgatan had the limit inside the fee hours only)
      const feeHoursOnly = d >= 1440 && ws.length > 0 && ws.every((w) => w.a < w.b) && /högst [^.,]*?i följd,? (?:och |samt )?mot avgift\b/.test(x) && !/övrig tid/.test(x);
      if (d) { const items = (ws.length && !feeHoursOnly ? ws : [feeHoursOnly ? clean({ a: 0, b: 1440, p }) : clean({ a: 0, b: 1440, m, p })]).map((w) => ({ ...w, max: d })); out.limits.push(...items); lastLimit = { max: d, items }; }
      if (/parkeras endast (?:under tiden |mellan |klockan |kl\.? )/.test(x) && ws.length && !d) { out.allowOnly.push(...ws); out.otherAllowed = false; } // "får fordon parkeras endast under tiden klockan 06.00 – 18.00" (QA 8 Nov: Bjuv)
      // Inside an area parking ban the text departs from ("får fordon, med avvikelse från … om förbud att parkera i Almby, parkeras under tiden vardag … 06.00 - 18.00",
      // "… parkeras under högst 8 dygn i följd mot avgift under tiden 15 juni - 15 augusti"): the permission's own hours or season are all it gives, the area ban holds
      // the rest of the time (sweep: Örebro Almbyvägen was open at night, Lysekil Fiskebäckskil all winter)
      if (AREA_BAN.test(body) && !out.reserved && !out.purpose.length) {
        if (ws.length && !d && !/mot avgift|i följd|övrig tid/.test(x) && /\bfår (?:fordon|personbil)\b/.test(x) && ws.every((w) => !w.m && !w.p && !w.wk && !w.dm && !w.nw) && !out.allowOnly.length) { out.allowOnly.push(...ws); out.otherAllowed = false; }
        if (!ws.length && d && m && !p && !seasonFromBan && /\bfår (?:fordon|personbil)\b/.test(x) && !/^parkering\b|\bdock\b/.test(x) && /i följd(?: mot avgift)? under (?:tiden|perioden) \d/.test(x)) seasonFromBan = m;
      }
      lastAllow = ws.length ? ws : null; permitSeason = !ws.length && !d && m ? m : null; if (permitSeason && /får (?:fordon|personbil) parkeras (?:under (?:tiden|perioden) |under )?(?:mellan )?(?:den )?(?:\d|(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december)\b)/.test(x)) anySeasonPermit = permitSeason; if (permitSeason && !seasonFromBan && !out.reserved && /\bmed\s+avvikelse\s+från\s[^.]*?\b(?:om\s+)?(?:förbud\s+att\s+parkera|parkeringsförbud|förbud\s+mot\s+parkering)/i.test(body)) seasonFromBan = permitSeason; // "får fordon, med avvikelse från … om förbud att parkera i Centrum, under tiden 1 oktober - 30 april parkeras mot avgift": the area ban holds the rest of the year (QA 12 Nov round 19: Sundsvall winter-only streets) // "får fordon parkeras 15 april – 15 oktober": a permission for a season (Knivsta)
      continue;
    }
    if (IGNORE.some((r) => r.test(s))) continue;
    if (tx) continue;
    unread(s);
  }
  // "Avgift mot klockan 09.00 - 24.00. Tillåtelsen gäller under tiden vardag utom dag före sön- och helgdag. Övrig tid får fordon
  // parkeras": the fee has the permission's days (QA 8 Nov: Uppsala Bruno Liljeforsgatan charged on Sundays)
  if (out.feeWindows && out.feeWindows.every((w) => !w.dt) && out.limits.length && out.limits.every((w) => w.dt && JSON.stringify(w.dt) === JSON.stringify(out.limits[0].dt)) && /övrig tid får fordon parkeras/i.test(body)) out.feeWindows = out.feeWindows.map((w) => ({ ...w, dt: out.limits[0].dt }));
  // A bay for one kind of vehicle whose own sentence gives the hours or the season ("får endast motorcykel och moped parkeras under tiden 1 april - 30 september",
  // "får endast moped klass I och moped klass II parkeras under vardag … mellan klockan 07.00 - 17.00", "Tillåtelsen gäller 1 april – 31 oktober"): it is reserved
  // then and says nothing about other times, exactly as when the hours stand in a "Tillåtelsen gäller" sentence of their own. Not inside an area parking ban,
  // not disabled or permit bays, and not when the text also holds a limit (the hours may be the limit's) (sweep: Vänersborg, Simrishamn, Sigtuna, Mjölby,
  // Trelleborg, Årjäng, Skellefteå, Upplands-Bro were reserved around the clock, all year)
  if (out.reserved && out.otherAllowed == null && ['lastbil', 'buss', 'motorcykel', 'moped', 'husbil', 'fordon med släp'].includes(out.reservedFor) && !out.purpose.length && !out.limits.length && !out.allowOnly.length && !out.unread.length && !AREA_BAN.test(body) && !/övrig tid|\bhögst\b|avgift|(?:inte|ej) (?:stannas eller )?parkeras/i.test(t.replace(/(?:ger|ge) (?:inte|ej) rätt att[^.]*/gi, '')) && /får endast/i.test(t) // only with "endast", and never when the hours may belong to a limit or a fee or the text bans something
    && (out.reservedSeason ? out.reservedWindows.every((w) => !w.w && !w.p && !w.wk && !w.dm && !w.nw) : (out.reservedWindows.length && (outsideHours(out.reservedWindows) || []).length > 0))) out.otherAllowed = true;
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
  // A seasonal all-day ban that departs from an area parking ban ("får fordon, med avvikelse från … om förbud att parkera inom ett område …,
  // inte stannas eller parkeras. … Förbudet gäller under tiden 1 juni - 31 augusti"): it only tightens the area ban in that season, the
  // area ban still holds the rest of the year (QA 18 Nov round 36: Halmstad innerstad would have been free outside the summer).
  // Only an area ban ("förbud att parkera inom ett område"), never a date-parking zone (Sundsvall "datumzon") or a street ban
  if (/med avvikelse från[^.]*?förbud (?:att|mot att) parkera (?:fordon )?inom (?:ett |det )?område(?![^.]*datum)[^.]*?,\s*(?:inte|ej) (?:stannas eller )?parkeras\b/i.test(t) && !/får (?:dock )?(?:fordon|personbil)[^.]{0,80}? parkeras(?! [^.]*inte)/i.test(t.replace(/[^.]*(?:inte|ej) (?:stannas eller )?parkeras[^.]*/gi, '')) && out.bans.length && out.bans.every((b) => b.a === 0 && b.b === 1440 && b.m && Object.keys(b).length === 3) && !out.limits.length && !out.allowOnly.length && !out.reserved && !out.taxa && !out.feeWindows && !out.purpose.length) out.bans = [{ a: 0, b: 1440 }];
  // A disabled bay reserved at stated hours whose text opens it to everyone at other times in so many words ("… får endast sådant fordon parkeras som används för
  // befordran av rörelsehindrad … Tillåtelsen gäller under tiden vardagar … 07.00 - 21.00. Övrig tid får fordon parkeras.", "… övrig tid är det allmän parkering"):
  // the reserved hours are kept so the line can be opened outside them. Never from "Parkering är dock tillåten under högst N tim" (the bay stays reserved), never
  // inside an area ban (sweep findings batch 6: Söderhamn Norra Hamngatan, Laholm Stortorget, Sundbyberg Löfströms allé, Karlskrona Vallgatan were reserved around the clock)
  if (out.reserved && out.reservedFor === 'rörelsehindrade' && !out.reservedSeason && !out.purpose.length && !out.bans.length && !out.unread.length && !AREA_BAN.test(body)
    && /(?:^|[\s,])övrig tid får fordon (?:stannas (?:och|eller) )?parkeras\b|[\s,]övrig tid är det allmän parkering\b|\bunder övrigt? tid f[åö]r fordon par?keras\b/i.test(t)) {
    if (!out.reservedWindows.length) { const hs = list.filter((q) => /^(?:tillåtelsen(?: i (?:paragraf|\d+ ?§))?|denna föreskrift) gäller\b/i.test(q) && !/\b(?:inte|ej)\b/i.test(q)).map((q) => q.replace(/,? övrig tid\b.*$/i, '.')); const ws = hs.length === 1 ? windows(hs[0]) : []; if (ws.length && !halfRead(hs[0], ws)) out.reservedWindows.push(...ws); }
    if (out.reservedWindows.length && out.reservedWindows.every((w) => !w.m && !w.p && !w.wk && !w.dm && !w.nw && !w.w) && (outsideHours(out.reservedWindows) || []).length) out.reservedOpenOutside = true;
  }
  // "1 § … får fordon parkeras. 2 § Övrig tid får fordon inte stannas. 3 § Tillåtelsen gäller <hours>": the "other time" ban stands before the hours it refers to, so it
  // was left unread and the line kept the register's inverted ban (sweep findings batch 9: Gislaved Smålandsstenar). The hours are the only hours parking is allowed.
  if (out.allowOnly.length && !out.bans.length && !out.limits.length && !out.reserved && out.unread.length && out.unread.every((u) => /^(?:\d+\s*§\s*)?övrig tid får fordon (?:inte|ej) (?:stannas eller parkeras|stannas|parkeras)\.?(?:\s*\d+\s*§\.?)?$/i.test(u.trim()))) { out.unread = []; out.otherAllowed = false; }
  if (!banContext && out.otherAllowed !== false) out.allowOnly = []; // outside the stated hours the general rules apply, not a ban
  return out;
}

const DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const nextDay = ([m, d]) => (d >= DIM[m - 1] ? [m % 12 + 1, 1] : [m, d + 1]);
const prevDay = ([m, d]) => (d <= 1 ? [m === 1 ? 12 : m - 1, DIM[(m + 10) % 12]] : [m, d - 1]);
// The hours outside a reserved spot's reserved hours, as car-allowed windows { dt, a, b } (null when the hours can't be read safely).
// Fee windows per weekday ("Avgiftsplikten gäller måndag - lördag klockan 22.00 - 06.00 samt söndag …") as day types, so the fee table can hold
// them: Monday–Friday with the same hours → vardag, Saturday → fore, Sunday → helgdag. Anything else stays as it was (QA 19 Nov round 40: Haninge Vega allé
// charged only Saturday nights and Sundays)
export function weekdaysAsDayTypes(ws) {
  if (!ws || !ws.some((w) => w.w)) return ws;
  const key = (w) => JSON.stringify([w.a, w.b, w.m || null]);
  const byW = new Map(); for (const w of ws) if (w.w) { if (w.dt || w.p || w.dm || w.nw || w.dd || w.wk || byW.has(w.w)) return ws; byW.set(w.w, w); }
  const wk = [1, 2, 3, 4, 5].map((d) => byW.get(d));
  if (wk.some((w) => !w) || new Set(wk.map(key)).size !== 1) return ws;
  const out = ws.filter((w) => !w.w);
  const { w: _w1, ...base } = wk[0]; out.push({ ...base, dt: ['vardag'] });
  for (const [d, dt] of [[6, 'fore'], [7, 'helgdag']]) if (byW.has(d)) { const { w: _w, ...x } = byW.get(d); out.push({ ...x, dt: [dt] }); }
  return out;
}
// The register drew "vardagar, utom (vardag|dag) före sön- och helgdag" as Saturdays only (it read the day after "utom"). When the text names
// that day type only after "utom", a register rule on 'fore' alone is a rule for ordinary weekdays: 'vardag'. A weekday before "utom"
// ("tisdagar, utom vardag före …") can't be drawn from day types: 'weekday' (the line goes grey). null: the text names Saturdays itself.
// (QA 19 Nov round 40: Sandviken Skogsfruvägen, Timrå, Härnösand, Simrishamn)
const UTOM_FORE = /utom,? (?:vardag(?:ar)? |dag(?:ar)? )?före sön- och helgdag/gi;
export function utomForeOnly(body) {
  const b = body.replace(/\s+/g, ' ');
  if (!new RegExp(UTOM_FORE.source, 'i').test(b) || /(?:vardag|dag)(?:ar)? före sön/i.test(b.replace(UTOM_FORE, ' '))) return null;
  return /\b(?:måndag|tisdag|onsdag|torsdag|fredag)(?:ar(?:na)?|en)?,? utom,? (?:vardag(?:ar)? |dag(?:ar)? )?före sön/i.test(b) ? 'weekday' : 'vardag';
}

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
// outsideHours, also for windows on named weekdays only ("måndag - fredag 07-17", "onsdag 07-15"): the gaps of each named weekday and
// the whole of the other weekdays, as weekday windows. null when weekdays and day types are mixed or a window has other conditions.
export function outsideHoursW(ws) {
  const o = outsideHours(ws); if (o) return o;
  if (!ws.length || ws.some((w) => !w.w || w.dt || w.m || w.p || w.wk || w.dm || w.nw || w.dd || w.a == null || w.b == null)) return null;
  const out = [];
  for (let d = 1; d <= 7; d++) {
    const iv = ws.filter((w) => w.w === d).flatMap((w) => (w.a > w.b ? [[w.a, 1440], [0, w.b]] : [[w.a, w.b]])).sort((x, y) => x[0] - y[0]);
    let at = 0;
    for (const [a, b] of iv) { if (a > at) out.push({ w: d, a: at, b: a }); at = Math.max(at, b); }
    if (at < 1440) out.push({ w: d, a: at, b: 1440 });
  }
  return out;
}
export const complement = (m) => [nextDay(m[1]), prevDay(m[0])];

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
    if (r.otherAllowed && r.reservedSeason) { seg.o = [{ a: 0, b: 1440, m: complement(r.reservedSeason) }]; seg.rx = 1; }
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
