import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegulation, weekdaysAsDayTypes, utomForeOnly, applyRegulation, samePlaceExceptions, dropFreeFirstHours, dropGeneralRuleQuote, datedPeriodEnd, dropRepealSentences, STOPPING, outsideHoursW } from '../regulation.js';
const wrap = (s) => `Stockholms kommun föreskriver med stöd av 10 kap. 1 § trafikförordningen (1998:1276) följande. ${s} Denna författning träder i kraft den 1 maj 2026.`;

test('time limit in the main sentence + "Övrig tid får fordon parkeras" + winter ban', () => {
  const r = parseRegulation(wrap('På markerad sträcka på Pendlargatans västra sida enligt kartbild får fordon parkeras under högst 2 tim i följd vardag utom vardag före sön- och helgdag klockan 09.00 - 19.00. Parkeringsskiva eller motsvarande ska användas. Parkering är dock förbjuden fredag klockan 08.00 - 16.00 under tiden 1 november - 15 maj. Övrig tid får fordon parkeras.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1140, max: 120 }]);
  assert.deepEqual(r.bans, [{ w: 5, a: 480, b: 960, m: [[11, 1], [5, 15]] }]);
  assert.equal(r.otherAllowed, true); assert.deepEqual(r.allowOnly, []); assert.deepEqual(r.unread, []);
});

test('"Tillåtelsen att parkera gäller" → the limit then; outside those hours the general rules apply (no ban in the text)', () => {
  const r = parseRegulation(wrap('På Toffelbackens nordöstra sida på den sträcka som anges på kartan får fordon parkeras. Tillåtelsen att parkera gäller vardagar utom vardag före sön- och helgdag klockan 08.00 - 18.00 under högst 1 tim i följd.'));
  assert.deepEqual(r.allowOnly, []);
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 60 }]);
  assert.deepEqual(r.unread, []);
});

test('two windows + "Övrig tid får fordon inte parkeras"', () => {
  const r = parseRegulation(wrap('På Harpsundsvägen får fordon parkeras under högst 15 min i följd vardagar utom vardag före sön- och helgdag klockan 07.00 - 22.00 och vardag före sön- och helgdag klockan 07.00 - 22.00. Övrig tid får fordon inte parkeras.'));
  assert.equal(r.allowOnly.length, 2); assert.deepEqual(r.allowOnly[1], { dt: ['fore'], a: 420, b: 1320 });
  assert.equal(r.limits[0].max, 15); assert.equal(r.otherAllowed, false);
});

test('loading zone with fee and night ban', () => {
  const r = parseRegulation(wrap('Markerad sträcka mellan 0 och 15 meter på Banérgatans östra sida enligt kartbild ska vara ändamålsplats för lastning eller lossning av tungt eller skrymmande gods vardag utom vardag före sön- och helgdag klockan 07.00 - 19.00. Övrig tid får fordon parkeras mot avgift vardag före sön- och helgdag klockan 11.00 - 17.00. Under tiden måndag klockan 00.00 - 06.00 får dock fordon inte parkeras. Avgift enligt taxa 3, 14 § allmänna lokala trafikföreskrifter.'));
  assert.deepEqual(r.purpose, [{ dt: ['vardag'], a: 420, b: 1140 }]);
  assert.deepEqual(r.bans, [{ w: 1, a: 0, b: 360 }]);
  assert.equal(r.otherAllowed, true); assert.equal(r.taxa, 3);
});

test('whole-season ban and reserved spot', () => {
  const r = parseRegulation(wrap('På Lillåvägen får fordon parkeras. Parkering är förbjuden under tiden 1 november - 15 maj.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[11, 1], [5, 15]] }]);
  const q = parseRegulation(wrap('På Atlasgatans norra sida på de 4 meter som anges på kartan får endast cykel och moped klass II parkeras.'));
  assert.equal(q.reserved, true);
});

test('limit without hours is a limit at all hours; direction-of-parking sentence is ignored', () => {
  const body = 'x följande. På Teststigen får fordon parkeras. Tillåtelsen att parkera gäller parkering under högst 3 tim i följd. Uppställning av fordon sker mot färdriktningen. Denna författning träder i kraft den 1 januari 2020.';
  const r = parseRegulation(body);
  assert.deepEqual(r.unread, []);
  assert.equal(r.limits.length, 1);
  assert.equal(r.limits[0].max, 180);
  assert.equal(r.limits[0].a, 0);
});

test('motorcycle spot with a season: cars may park outside the season', () => {
  const body = 'x följande. På Teststigen får endast tvåhjulig motorcykel parkeras under tiden 1 april - 30 september. Övrig tid får fordon parkeras. Denna författning träder i kraft den 1 januari 2020.';
  const seg = applyRegulation({ t: 2, v: 'motorcykel' }, { body, to: null }, '2026-10-04');
  assert.ok(seg.o && seg.o[0].m);
  assert.deepEqual(seg.o[0].m, [[10, 1], [3, 31]]);
  // the open window needs hours too: the app's engine skips a window without a and b (sweep 21 Nov: 37 Stockholm
  // motorcycle bays answered "reserved" all winter)
  assert.equal(seg.o[0].a, 0); assert.equal(seg.o[0].b, 1440);
});

test('"Övrig tid får fordon parkeras" does not make the limit hours allowed-only; two hour ranges are both read', () => {
  const body = 'x följande. På Teststigen får fordon parkeras. Tillåtelsen gäller vardag utom vardag före sön- och helgdag klockan 07.00 - 10.00 och 15.00 - 18.00 under högst 30 min i följd. Övrig tid får fordon parkeras. Denna författning träder i kraft den 1 januari 2020.';
  const r = parseRegulation(body);
  assert.equal(r.allowOnly.length, 0);
  assert.equal(r.limits.length, 2);
  const r2 = parseRegulation(body.replace('Övrig tid får fordon parkeras', 'Övrig tid får fordon inte parkeras'));
  assert.equal(r2.allowOnly.length, 2);
});

test('"får endast beskickningsfordon parkeras" reserves the curb even when the city data has no vehicle', () => {
  const body = 'följande.\n\nPå markerad sträcka mellan 0 och 6 meter på Strandvägens norra sida enligt kartbild\nfår endast beskickningsfordon parkeras.\n\nDenna författning träder i kraft den 6 oktober 2014.';
  const r = parseRegulation(body);
  assert.equal(r.reserved, true);
  assert.equal(r.reservedFor, 'beskickningsfordon');
  const seg = applyRegulation({ n: 'Strandvägen', t: 0 }, { c: 'x', body, from: '2014-10-06', to: null }, '2026-10-06');
  assert.equal(seg.v, 'beskickningsfordon');
});

test('"får endast personbil parkeras" is not a reserved spot; "Övrig tid får endast tung lastbil" limits cars to the stated hours', () => {
  const body = 'följande. På Finspångsgatans nordöstra sida på den sträcka som anges på kartan får endast personbil parkeras. Tillåtelsen gäller vardagar utom vardag före sön- och helgdag klockan 07.00 - 20.00. Övrig tid får endast tung lastbil parkeras. Denna författning träder i kraft';
  const r = parseRegulation(body);
  assert.equal(r.reserved, false);
  assert.equal(r.otherAllowed, false);
  assert.equal(r.allowOnly.length, 1);
});

test('QA 2026-10-13: "utom under tiden …" ban exceptions are complemented, not applied as the ban', () => {
  const a = parseRegulation(wrap('På Teststigen får fordon parkeras. Parkering är dock förbjuden onsdag klockan 09.00 - 14.00 utom under tiden jämna veckor 1 maj - 31 oktober.'));
  assert.deepEqual(a.bans, [{ w: 3, a: 540, b: 840, m: [[5, 1], [10, 31]], p: 'odd' }, { w: 3, a: 540, b: 840, m: [[11, 1], [4, 30]] }]);
  const b = parseRegulation(wrap('På Teststigen får fordon parkeras. Parkering är dock förbjuden tisdag klockan 08.00 - 12.00 utom under tiden 15 juni - 15 augusti.'));
  assert.deepEqual(b.bans, [{ w: 2, a: 480, b: 720, m: [[8, 16], [6, 14]] }]);
  const c = parseRegulation(wrap('På Teststigen får fordon parkeras. Parkering är dock förbjuden fredag klockan 08.00 - 12.00 utom udda veckor.'));
  assert.deepEqual(c.bans, [{ w: 5, a: 480, b: 720, p: 'even' }]);
});

test('QA 2026-10-13: "vardag utom dag före sön- och helgdag" is weekdays only; "personbil" (singular) limits are read', () => {
  const r = parseRegulation(wrap('På Teststigen får fordon parkeras. Parkering är dock förbjuden vardag utom dag före sön- och helgdag klockan 00.00 - 06.00, vardag före sön- och helgdag klockan 00.00 - 06.00 och sön- och helgdag klockan 00.00 - 06.00.'));
  assert.deepEqual(r.bans.map((w) => w.dt), [['vardag'], ['fore'], ['helgdag']]);
  const l = parseRegulation(wrap('På Vindkraftsvägens norra sida får endast personbil parkeras under högst 2 tim i följd vardagar utom vardag före sön- och helgdag klockan 07.00 - 21.00.'));
  assert.deepEqual(l.limits, [{ dt: ['vardag'], a: 420, b: 1260, max: 120 }]);
  const n = parseRegulation(wrap('På Solkraftsvägens västra sida får endast personbil parkeras under högst 2 tim i följd.'));
  assert.deepEqual(n.limits, [{ a: 0, b: 1440, max: 120 }]);
});

test('QA 2026-10-13: a missing full stop before "Tillåtelsen ger inte rätt" does not turn the limit sentence into a ban', () => {
  const r = parseRegulation(wrap('På Teststigen får fordon parkeras under högst 2 tim i följd vardag klockan 09.00 - 18.00 Tillåtelsen ger inte rätt att parkera längre än tillåten tid.'));
  assert.equal(r.bans.length, 0);
  assert.equal(r.limits.length, 1);
});

// Phrasings from other municipalities (RDT texts fetched 18 Oct 2026)
const wrapK = (s, k = 'Alingsås kommun') => `${k} föreskriver med stöd av 10 kap. 1 § andra stycket 16 och 17 och 3 § första stycket trafikförordningen (1998:1276) följande. ${s} Denna författning träder i kraft den 1 januari 2020. På samhällsbyggnadsnämndens vägnar. Anna Andersson`;

test('RDT: a limit "under vardag utom dag före sön- och helgdag" without hours keeps the day type', () => {
  const r = parseRegulation(wrapK('1 § På västra sidan av Kungegårdsgatan i Alingsås 1 , på uppställningsplatsen utanför fastigheten Kungsängen 3 mellan Kungsängsgatan och Smålandsgatan, får fordon parkeras under högst 30 min i följd under vardag utom dag före sön- och helgdag.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 30 }]); assert.deepEqual(r.unread, []);
});

test('RDT: "måndag - söndag klockan 06.00 - 20.00" is every day; "måndag - fredag" is five weekday windows', () => {
  const r = parseRegulation(wrapK('1 § På Kvarnbacken i Alingsås 1 på angivna uppställningsplatser får fordon parkeras under högst 4 tim i följd under måndag - söndag klockan 06.00 - 20.00.'));
  assert.deepEqual(r.limits, [{ a: 360, b: 1200, max: 240 }]); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('På Storgatan får fordon inte parkeras måndag - fredag klockan 07.00 - 09.00.'));
  assert.deepEqual(q.bans, [1, 2, 3, 4, 5].map((w) => ({ w, a: 420, b: 540 }))); assert.deepEqual(q.unread, []);
});

test('RDT: a ban without hours is all day; a following "Förbudet gäller …" gives its hours; "enskild väg" is ignored', () => {
  const r = parseRegulation(wrapK('På markerade sträckor på Ekekullsvägen enligt kartbild får fordon inte parkeras.', 'Ale kommun'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('Inom vändplatsen på Rådjursvägen får inte fordon stannas eller parkeras. Förbudet i första stycket gäller inte enskild väg.', 'Botkyrka kommun'));
  assert.deepEqual(q.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(q.unread, []);
  const b = parseRegulation(wrapK('På samtliga vägar inom det område som markerats på kartbilaga får fordon inte parkeras. Förbudet att parkera gäller under tiden klockan 00.00 - 16.00.', 'Borlänge kommun'));
  assert.deepEqual(b.bans, [{ a: 0, b: 960 }]); assert.deepEqual(b.unread, []);
});

test('RDT: "Tidsbegränsningen gäller …" sets the hours of the limit; a "2 §" paragraph number is not a sentence', () => {
  const r = parseRegulation(wrapK('1 § På parkeringen vid Gamla Vänersborgsvägen enligt markering på kartbild får fordon parkeras högst 24 timmar i följd. 2 § Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('På markerad sträcka på Lyckgatan enligt kartbild får fordon parkeras under högst 2 tim i följd. Tidsbegränsningen gäller under tiden vardag utom vardag före sön- och helgdag klockan 09.00 - 18.00 och vardag före sön- och helgdag klockan 09.00 - 15.00.', 'Ängelholms kommun'));
  assert.deepEqual(q.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 120 }, { dt: ['fore'], a: 540, b: 900, max: 120 }]); assert.deepEqual(q.unread, []);
});

test('RDT: personbil klass II is a motorhome spot (reserved); klass I / "Endast parkering tillåten för personbil klass 1" is ordinary cars', () => {
  const r = parseRegulation(wrapK('På parkeringen enligt markering på kartbild får endast personbil klass II parkeras högst 24 timmar i följd.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'husbil');
  const q = parseRegulation(wrapK('På markerad parkeringsficka på Klippanvägen enligt kartbild får fordon parkeras under högst 30 min i följd. Endast parkering tillåten för personbil klass 1.', 'Ängelholms kommun'));
  assert.equal(q.reserved, false); assert.deepEqual(q.limits, [{ a: 0, b: 1440, max: 30 }]); assert.deepEqual(q.unread, []);
  const b = parseRegulation(wrapK('På markerad plats på Tivoliplatsen enligt kartbild får endast buss parkeras under högst 3 tim i följd. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Parkeringsskiva eller motsvarande ska användas.', 'Arvika kommun'));
  assert.equal(b.reservedFor, 'buss'); assert.deepEqual(b.unread, []);
});

test('RDT: a day word the parser did not place makes the sentence unread, never a wider rule', () => {
  const r = parseRegulation(wrapK('På Storgatan får fordon parkeras under högst 2 tim i följd lördag, söndag och helgdag samt klämdag.'));
  assert.equal(r.unread.length, 1); assert.deepEqual(r.limits, []);
  const q = parseRegulation(wrapK('På Storgatan får fordon inte parkeras utom lördag klockan 08.00 - 12.00.'));
  assert.equal(q.unread.length, 1); assert.deepEqual(q.bans, []);
});

test('RDT: "med avvikelse från …" asides and glued sentences are handled; signatures end the rule text', () => {
  const r = parseRegulation(wrapK('På markerade sträckor på Kristinegatan enligt kartbild får fordon, med avvikelse från Falu kommuns lokala trafikföreskrifter 2080 2025:00259 om stannande och parkering, parkeras mot avgift under tiden vardagar klockan 08.00 - 18.00.', 'Falu kommun'));
  assert.deepEqual(r.unread, []); assert.deepEqual(r.bans, []);
  const q = parseRegulation(wrapK('1 § På Våggatan, enligt bifogad karta, får fordon parkeras under högst 3 tim i följd.Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276).', 'Åmåls kommun'));
  assert.deepEqual(q.limits, [{ a: 0, b: 1440, max: 180 }]); assert.deepEqual(q.unread, []);
});

test('RDT: "Övrig tid får fordon parkeras under högst 4 tim" is a limit outside the stated hours; boilerplate glued to a ban is not a second ban', () => {
  const r = parseRegulation(wrapK('På markerade sträckor på Vitklövergatan enligt kartbild får fordon parkeras under högst 20 min i följd. Tidsbegränsningen gäller under tiden klockan 07.00 - 18.00. Övrig tid får fordon parkeras under högst 4 tim i följd.', 'Ale kommun'));
  assert.deepEqual(r.limits, [{ a: 420, b: 1080, max: 20 }, { dt: ['vardag', 'fore', 'helgdag'], a: 0, b: 420, max: 240 }, { dt: ['vardag', 'fore', 'helgdag'], a: 1080, b: 1440, max: 240 }]); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('1 § På i kartbild med röd linje markerad sträcka på Sparvvägen får fordon inte parkeras.Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276).', 'Ale kommun'));
  assert.deepEqual(q.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(q.unread, []);
});

test('RDT: "mellan klockan 8 och 18", "sön - och helgdag", "1:a december - 31:a mars", "motorfordon"', () => {
  const r = parseRegulation(wrapK('På Storgatan får fordon parkeras under högst 2 tim i följd. Tidsbegränsningen gäller vardagar utom vardag dag före sön - och helgdag mellan klockan 8 och 18 och vardag före sön - och helgdag mellan klockan 8 och 14.', 'Åmåls kommun'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 120 }, { dt: ['fore'], a: 480, b: 840, max: 120 }]); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('På Fågeldammsvägen i Surte får motorfordon inte parkeras. Förbudet gäller 1:a december - 31:a mars.', 'Ale kommun'));
  assert.deepEqual(q.bans, [{ a: 0, b: 1440, m: [[12, 1], [3, 31]] }]); assert.deepEqual(q.unread, []);
  const b = parseRegulation(wrapK('På markerade parkeringsplatser på samtliga gator enligt kartbild får fordon inte parkeras mellan kl 23:00 och 04:00, förbudet gäller alla dagar.', 'Arvika kommun'));
  assert.deepEqual(b.bans, [{ a: 1380, b: 240 }]); assert.deepEqual(b.unread, []);
});

test('RDT: a sentence that mentions a parking disc but carries a rule is not silently ignored', () => {
  const r = parseRegulation(wrapK('På markerad sträcka på östra sidan av Sandvångsgatan enligt kartbild får fordon parkeras under högst 24 tim i följd. Vardagar utom vardag före sön- och helgdag klockan 09.00 – 18.00 gäller dock tillåtelsen att parkera mot att avgift erläggs eller högst 1 timme i följd mot användande av parkeringsskiva eller motsvarande. Avgift enligt taxa zon 2.', 'Ängelholms kommun'));
  assert.deepEqual(r.unread, []); assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }]); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 1440 }]); // pay, or 1 h with a disc: the fee hours; no 1 h limit for payers
  const q = parseRegulation(wrapK('På Storgatan får fordon parkeras under högst 1 tim i följd. Parkeringsskiva eller motsvarande ska användas.'));
  assert.deepEqual(q.limits, [{ a: 0, b: 1440, max: 60 }]); assert.deepEqual(q.unread, []);
});

test('RDT: "Övrig tid parkering förbjuden" means allowed only in the stated hours; "Förbudet att parkera gäller <season>" dates the ban just stated', () => {
  const r = parseRegulation(wrapK('På Myrgatans västra sida i särskild anordnad parkerinsficka får fordon parkeras högst 1 timme i följd alla dagar mellan klockan 06.00 – 21.00. Övrig tid parkering förbjuden enligt beslut om parkeringsförbudzon.', 'Avesta kommun'));
  assert.deepEqual(r.bans, []); assert.deepEqual(r.allowOnly, [{ a: 360, b: 1260 }]); assert.deepEqual(r.limits, [{ a: 360, b: 1260, max: 60 }]); assert.equal(r.otherAllowed, false); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('På markerade sträckor på Konstvaktaregatan enligt kartbild får fordon inte parkeras under tiden onsdag klockan 09.00 - 15.00. Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Förbudet att parkera gäller 1 december - 31 maj.', 'Falu kommun'));
  assert.deepEqual(q.bans, [{ w: 3, a: 540, b: 900, m: [[12, 1], [5, 31]] }]); assert.deepEqual(q.unread, []);
});

test('RDT: handikappad = disabled permit; vändplats med förbud; "får taxi parkeras"; resident-permit sentences ignored', () => {
  assert.equal(parseRegulation(wrapK('På 1 markerad parkeringsplats på Badhusgatans sydvästra sida får endast sådant fordon parkeras som används för befordran av handikappad med särskilt parkeringstillstånd.', 'Enköpings kommun')).reservedFor, 'rörelsehindrade');
  const q = parseRegulation(wrapK('I norra änden av Hökgatan i Eskilstuna skall den för ändamålet särskilt anlagda ytan vara vändplats med förbud att parkera.', 'Eskilstuna kommun'));
  assert.deepEqual(q.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(q.unread, []);
  const t = parseRegulation(wrapK('På markerade sträckor på Hälsingetorget enligt kartbild får taxi parkeras.', 'Falu kommun'));
  assert.equal(t.reservedFor, 'taxi'); assert.deepEqual(t.unread, []);
  const r = parseRegulation(wrapK('På Hantverksgatan får fordon parkeras under högst 2 tim i följd. Tillåtelsen gäller även fordon med boendeparkeringskort C.', 'Falkenbergs kommun'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 120 }]); assert.deepEqual(r.unread, []);
});

test('RDT: day-of-month bans, "Trots tillåtelsen", and heavy-vehicle-only rules (no rule for cars)', () => {
  const r = parseRegulation(wrapK('På Drottninggatan får fordon parkeras under högst 24 tim i följd. Trots tillåtelsen i 1 § får fordon inte parkeras den 10:e dagen i månaden klockan 09.00 - 12.00 (gäller vardag utom vardag före sön- och helgdag).', 'Norrköpings kommun'));
  assert.deepEqual(r.bans, [{ dm: 10, dt: ['vardag'], a: 540, b: 720 }]); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.unread, []);
  const h = parseRegulation(wrapK('På väg som är inte enskild inom tättbebyggt område i Järfälla kommun får motorredskap, traktor, tung lastbil, personbil klass II och tung buss inte parkeras. Dessutom får inte heller frikopplat släpfordon med en längd som överstiger 3 meter parkeras annat än på anvisade platser för sådana fordonsslag. Tidsbegränsningen gäller under tiden måndag - söndag klockan 22.00 - 06.00', 'Järfälla kommun'));
  assert.equal(h.heavyOnly, true); assert.deepEqual(h.bans, []); assert.deepEqual(h.limits, []);
  const n = parseRegulation(wrapK('På samtliga vägar som inte är enskilda inom det tättbebyggda området i Norrtälje stad får fordon och fordonståg med bruttovikt över 3,5 ton inte parkeras.', 'Norrtälje kommun'));
  assert.equal(n.heavyOnly, true); assert.deepEqual(n.bans, []);
  const c = parseRegulation(wrapK('På Storgatan får fordon inte parkeras.'));
  assert.deepEqual(c.bans, [{ a: 0, b: 1440 }]); assert.equal(c.heavyOnly, undefined);
});

test('RDT round 2: "Med avvikelse från bestämmelserna i 1 §", "till och med", "den 6 i månaden", "Förbudet gäller inte <day types>", lorry bays', () => {
  const r = parseRegulation(wrapK('På Storgatan får fordon parkeras under högst 24 tim i följd. Med avvikelse från bestämmelserna i 1 § får fordon på sträckan inte parkeras på onsdagar mellan klockan 10 och 15 under tiden 1 oktober till och med 30 april.', 'Linköpings kommun'));
  assert.deepEqual(r.bans, [{ w: 3, a: 600, b: 900, m: [[10, 1], [4, 30]] }]); assert.deepEqual(r.unread, []);
  const d = parseRegulation(wrapK('På Storgatan får fordon parkeras. Med avvikelse från bestämmelserna i 1 § får fordon på sträckan inte parkeras den 6 i månaden mellan klockan 10 och 15 under tiden 1 oktober till och med 30 april.', 'Linköpings kommun'));
  assert.deepEqual(d.bans, [{ dm: 6, a: 600, b: 900, m: [[10, 1], [4, 30]] }]); assert.deepEqual(d.unread, []);
  const e = parseRegulation(wrapK('På Drottninggatan får fordon inte parkeras klockan 08.00 - 10.00. Förbudet gäller inte vardag före sön- och helgdag samt sön- och helgdag. Förbudet gäller alla fordon.', 'Norrköpings kommun'));
  assert.deepEqual(e.bans, [{ dt: ['vardag'], a: 480, b: 600 }]); assert.deepEqual(e.unread, []);
  const f = parseRegulation(wrapK('På Vägen får fordon inte parkeras klockan 08.00 - 10.00. Förbudet gäller ej vardag före sön - helgdag samt sön - helgdag.', 'Norrköpings kommun'));
  assert.deepEqual(f.bans, [{ dt: ['vardag'], a: 480, b: 600 }]); assert.deepEqual(f.unread, []);
  const l = parseRegulation(wrapK('Från Saldovägens vändplats till en punkt 97 meter därom i sydvästlig riktning får tungt släpfordon och tung lastbil parkeras. Författningen ersätter Järfälla kommuns lokala trafikföreskrift 0123 2013:00383. Denna föreskrift gäller ej där annat föreskrives och skyltas på platsen.', 'Järfälla kommun'));
  assert.equal(l.reservedFor, 'lastbil'); assert.deepEqual(l.unread, []);
  const t = parseRegulation(wrapK('På Gatan får fordon parkeras. Tillåtelsen i 1 § gäller högst 3 timmar i följd under tiden - vardagar utom vardag före sön- och helgdag klockan 08.00 - 20.00, - vardag före sön- och helgdag klockan 08.00 - 15.00. Tillåtelsen att parkera i 1 § gäller dock mot avgift.', 'Örebro kommun'));
  assert.deepEqual(t.limits, [{ dt: ['vardag'], a: 480, b: 1200, max: 180 }, { dt: ['fore'], a: 480, b: 900, max: 180 }]); assert.deepEqual(t.unread, []);
});

test('glued "14.00.Tillåtelsen ger inte rätt … förbjudet" is not a ban; a 10 min limit stays a limit', () => {
  const r = parseRegulation('följande. 1 § På södra sidan av Hantverkaregatan får fordon parkeras under högst 10 min i följd under tiden vardag utom vardag före sön- och helgdag mellan klockan 09.00 – 18.00 och vardagar före sön- och helgdag mellan klockan 10.00 – 14.00.Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Parkering är dock förbjuden torsdag mellan klockan 08.00 – 10.00. Denna författning träder i kraft den 1 maj 2017.');
  assert.deepEqual(r.bans, [{ w: 4, a: 480, b: 600 }]);
  assert.ok(r.limits.some((l) => l.max === 10 && l.a === 540));
});
test('"Tillåtelsen i §1 ger inte rätt …" is boilerplate, not an all-day ban', () => {
  const r = parseRegulation('följande. 1 § På norra sidan av Stenhuggaregatan får fordon parkeras under högst 24 tim i följd. 2 § Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag. 3 § Tillåtelsen i §1 ger inte rätt att parkera där det enligt trafikförordningen (1998:1276) är förbjudet att stanna eller parkera. 4 § Stannande eller parkering är dock förbjuden under onsdag mellan klockan 06.00 - 15.00 jämna veckor under vecka 1 - 52. Dessa föreskrifter träder i kraft den 18 maj 2022.');
  assert.ok(!r.bans.some((b) => b.a === 0 && b.b === 1440));
});
test('date parking sentence becomes dp, not a ban', () => {
  const r = parseRegulation('följande. 1 § På Holmsundsallén får fordon inte parkeras. 2 § Förbudet gäller vardag klockan 08.00 - 18.00. 3 § Övrig tid får inte fordon parkeras på dagar med udda datum på den sida av gatan som har udda adressnummer och på dagar med jämnt datum på den sida av gatan som har jämna adressnummer, mellan klockan 00.00 - 08.00. Denna författning träder i kraft den 1 maj 2024.');
  assert.equal(r.dp.length, 1);
  assert.ok(r.bans.every((b) => b.a === 480));
});
test('a permission with hours and no ban context does not ban parking outside the hours', () => {
  const r = parseRegulation('följande. 1 § På Vallgatan får fordon parkeras under högst 48 tim i följd mot avgift. 2 § Tillåtelsen gäller under vardagar utom vardag före sön- och helgdag mellan klockan 09.00 – 18.00. 3 § Avgift enligt taxa zon 2. Denna författning träder i kraft den 20 mars 2017.');
  assert.deepEqual(r.allowOnly, []);
  assert.ok(r.limits.some((l) => l.max === 2880));
});
test('"vardag samt sön- och helgdag" is two day types', () => {
  const r = parseRegulation('följande. 1 § På Kvarnvägens södra sida får fordon parkeras högst 24 timmar i följd. 2 § Tidsbegränsningen gäller vardag samt sön- och helgdag. Denna författning träder i kraft den 16 december 2022.');
  assert.deepEqual(r.limits[0].dt, ['vardag', 'fore', 'helgdag'].filter((k) => k !== 'fore').concat([]).length ? r.limits[0].dt : []);
  assert.ok(r.limits[0].dt.includes('vardag') && r.limits[0].dt.includes('helgdag'));
});
test('a ban "enligt … trafikföreskrifter om datumparkering" refers to date parking, not an all-day ban', () => {
  const r = parseRegulation('följande. 1 § På Skomakargatan får fordon parkeras. 2 § Parkering är dock förbjuden enligt bestämmelserna i Gävle kommuns lokala trafikföreskrifter om datumparkering. Denna författning träder i kraft den 1 maj 2024.');
  assert.deepEqual(r.bans, []);
  assert.equal(r.dp.length, 1);
});
test('date parking hours from the following "Förbudet gäller"', () => {
  const r = parseRegulation('följande. Inom ett område för Datumparkering får fordon inte parkeras på dagar med udda datum på den sida av vägen som har udda adressnummer och på dagar med jämnt datum på den sida av vägen som har jämna adressnummer. Förbudet gäller klockan 00.00 - 16.00. Denna författning träder i kraft den 1 maj 2019.');
  assert.deepEqual(r.bans, []);
  assert.deepEqual(r.dp, [{ a: 0, b: 960 }]);
});
test('QA 19 Oct: a day-type window without "klockan" after "och" is kept (Saturday hours)', () => {
  const r = parseRegulation('följande. 1 § På Gjuterigatan får fordon parkeras under högst 1 tim i följd mot avgift under vardag utom vardag före sön- och helgdag mellan klockan 09.00 - 18.00 och vardag före sön- och helgdag 09.00 - 15.00.');
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 60 }, { dt: ['fore'], a: 540, b: 900, max: 60 }]);
});
test('QA 19 Oct: "vardagar, utom vardag före …" with a comma is one day type', () => {
  const r = parseRegulation('följande. 1 § På Arlagatan får fordon inte stannas eller parkeras. 2 § Förbudet gäller vardagar, utom vardag före sön- och helgdag mellan klockan 16 och 18 och vardag före sön- och helgdag mellan klockan 10 och 13.');
  assert.deepEqual(r.bans.map((b) => [b.dt, b.a, b.b]), [[['vardag'], 960, 1080], [['fore'], 600, 780]]);
});
test('QA 19 Oct: "19:e dagen i månaden" is a day-of-month ban', () => {
  const r = parseRegulation('följande. På Älvgatan får fordon parkeras. Parkering är dock förbjuden 19:e dagen i månaden klockan 09.00 - 12.00.');
  assert.equal(r.bans[0].dm, 19);
});
test('QA 19 Oct: a limit followed by "Tillåtelsen gäller <hours>" holds in those hours only', () => {
  const r = parseRegulation('följande. På Älvgatan får fordon parkeras under högst 2 tim i följd. Tillåtelsen gäller under tiden vardag utom dag före sön- och helgdag klockan 08.00 - 18.00 och vardag före sön- och helgdag klockan 08.00 - 14.00. Övrig tid får fordon parkeras.');
  assert.deepEqual(r.limits.map((l) => [l.dt, l.a, l.b, l.max]), [[['vardag'], 480, 1080, 120], [['fore'], 480, 840, 120]]);
});
test('QA 19 Oct: fee hours from an "Avgift …" sentence', () => {
  const r = parseRegulation('följande. 1 § På X får fordon parkeras under högst 48 tim i följd. 2 § Avgift enligt Taxa Zon 2 under vardagar utom vardag före sön- och helgdag mellan klockan 09.00 - 18.00.');
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }]);
});
test('QA 22 Oct: "1:a tisdagen i månaden" and a d/m season in "Villkoret gäller under tiden 1/9- 30/12"', () => {
  const r = parseRegulation('följande. På Idrottsgatan får fordon inte stannas eller parkeras. Förbudet gäller under tiden 1:a tisdagen i månaden klockan 08.00 -12.00. Villkoret gäller under tiden 1/9- 30/12.');
  assert.deepEqual(r.bans, [{ w: 2, nw: 1, a: 480, b: 720, m: [[9, 1], [12, 30]] }]);
});
test('"Tillåtelsen gäller inte den 1 måndagen i månaden 07–10" is a ban then (Ystad)', () => {
  const r = parseRegulation('följande. 1 § På Västra Vallgatan får fordon parkeras. 2 § Tillåtelsen gäller inte den 1 måndagen i månaden mellan klockan 07.00 - 10.00.');
  assert.deepEqual(r.bans, [{ w: 1, nw: 1, a: 420, b: 600 }]); assert.deepEqual(r.allowOnly, []);
});
test('QA 22 Oct: hours before the day type (Kungsbacka) and seasons covering the year (Tyresö)', () => {
  const r = parseRegulation('följande. 1 § På Diabasvägen får fordon parkeras. 2 § Mellan klockan 8 och 22 vardagar utom vardag före sön- och helgdag och mellan klockan 8 och 22 vardag före sön- och helgdag gäller dock tillåtelsen att parkera i 1 § mot att avgift betalas.');
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 480, b: 1320 }, { dt: ['fore'], a: 480, b: 1320 }]);
  const y = parseRegulation('följande. 1 § På Beryllvägen får fordon parkeras. 2 § Parkering är dock förbjuden onsdag mellan klockan 07.00 - 16.00 under tiden 1 april - 31 oktober samt under tiden 1 november - 31 mars.');
  assert.deepEqual(y.bans, [{ w: 3, a: 420, b: 960 }]);
});
test('QA 22 Oct: a paragraph without a full stop before it, and "parkeras där stannande och parkering är förbjuden" is a permission', () => {
  const r = parseRegulation('följande. 1 § På Östra Storgatan får fordon parkeras där stannande och parkering är förbjuden enligt 3 kap. 52§ andra stycket trafikförordningen (1998:1278) 2 § Avgift enligt taxa B1 skall erläggas under vardag utom vardag före sön- och helgdag mellan klockan 08.00 – 20.00.');
  assert.deepEqual(r.bans, []); assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 480, b: 1200 }]);
});
test('QA 22 Oct: month seasons, Mon–Sun without a dash, one-sided date bans, weekday with a day type, Saturday listed apart', () => {
  assert.deepEqual(parseRegulation('följande. På Vintervägen får fordon parkeras. Parkering är dock förbjuden torsdag mellan klockan 10.00 - 14.00 jämna veckor under augusti - juni.').bans, [{ w: 4, a: 600, b: 840, p: 'even', m: [[8, 1], [6, 30]] }]);
  assert.deepEqual(parseRegulation('följande. På X får fordon inte parkeras på dagar med udda datum på den sida av vägen som har udda adressnummer och på dagar med jämnt datum på den sida av vägen som har jämna adressnummer under tiden måndag söndag klockan 00.00 - 08.00.').dp, [{ a: 0, b: 480 }]);
  assert.deepEqual(parseRegulation('följande. På X får fordon parkeras. Parkering är dock förbjuden klockan 00.00 - 08.00 jämna datum.').bans, [{ a: 0, b: 480, dd: 'even' }]);
  assert.deepEqual(parseRegulation('följande. 1 § På X får fordon parkeras. 2 § Trots tillåtelsen i 1 § får fordon inte parkeras på måndagar klockan 08.00 - 11.00 (gäller vardag utom vardag före sön- och helgdag).').bans, [{ w: 1, a: 480, b: 660, dt: ['vardag'] }]);
  assert.deepEqual(parseRegulation('följande. 1 § På Jaktvägen får fordon parkeras högst 2 timmar i följd. 2 § Tidsbegränsningen gäller vardag klockan 08.00 - 18.00 samt vardag före sön- och helgdag klockan 08.00 - 15.00.').limits.map((l) => l.dt), [['vardag'], ['fore']]);
});
test('QA 22 Oct: limit seasons, inverted permission hours with a limit, permission seasons, "gäller inte personbil klass I"', () => {
  assert.deepEqual(parseRegulation('följande. På Parkgatan får fordon parkeras. Tillåtelsen att parkera gäller under högst 3 tim i följd. Villkoret gäller vardagar utom vardag före sön- och helgdag klockan 10.00 - 20.00. Tidsbegränsningen gäller under tiden 1 maj - 30 september.').limits, [{ dt: ['vardag'], a: 600, b: 1200, max: 180, m: [[5, 1], [9, 30]] }]);
  const r = parseRegulation('följande. 1 § På Idrottsvägen får fordon parkeras. 2 § Mellan klockan 09.00 och 18.00 gäller dock tillåtelsen i 1 § högst 5 timmar i följd mot avgift eller högst en timma i följd mot användande av parkeringsskiva. 5 § Tillåtelsen i paragraf 1 och villkoren i 2 § gäller mellan 15 juni och 15 augusti.');
  assert.deepEqual(r.limits, [{ a: 540, b: 1080, max: 300, m: [[6, 15], [8, 15]] }]); assert.deepEqual(r.feeWindows, [{ a: 540, b: 1080, m: [[6, 15], [8, 15]] }]);
  assert.equal(parseRegulation('följande. 1 § På Hamnvägen får fordon parkeras högst 2 timmar. 2 § Tillåtelsen gäller inte personbil klass I.').reserved, true);
});
test('QA 22 Oct round 4: "första helgfria måndagen varje månad", motorhome-only exceptions, permissions flagged', () => {
  assert.deepEqual(parseRegulation('följande. 1 § På Kanalgatan får fordon inte parkeras mellan klockan 05.00 – 08.00. 2 § Förbudet gäller endast under den första helgfria måndagen varje månad.').bans, [{ a: 300, b: 480, w: 1, nw: 1, nh: 1 }]);
  assert.deepEqual(parseRegulation('följande. 1 § På Yttre Hamnen får fordon parkeras under högst 24 tim i följd. 2 § Tillåtelsen gäller inte personbil klass II under tiden vardagar mellan klockan 23.00 - 07.00.').bans, []);
  assert.equal(parseRegulation('följande. På Brogatan får fordon, med avvikelse från X om förbud att parkera inom ett område, parkeras. Avgift ska betalas.').permitted, true);
});
test('QA round 5 leftovers: seasons per window, week ranges, resident-permit sentences, "med avvikelse" lists', () => {
  const r = parseRegulation('följande. Inom X får fordon parkeras under högst 3 tim i följd. Parkering är dock förbjuden under tiden 1 november - 30 april måndag klockan 00:00 - 06:00 och 1 maj - 31 oktober jämna veckor måndag klockan 09.00 - 13.00.');
  assert.deepEqual(r.bans, [{ w: 1, a: 0, b: 360, m: [[11, 1], [4, 30]] }, { w: 1, a: 540, b: 780, m: [[5, 1], [10, 31]], p: 'even' }]);
  assert.deepEqual(parseRegulation('följande. Inom X får fordon inte parkeras på dagar med udda datum på den sida av vägen som har udda adressnummer och på dagar med jämnt datum på den sida av vägen som har jämna adressnummer under tiden klockan 00.00 - 17.00 vecka 42 - 18.').dp, [{ a: 0, b: 1020, wk: [42, 18] }]);
  assert.deepEqual(parseRegulation('följande. På X får fordon parkeras under högst 24 tim i följd. Tidsbegränsningen gäller inte boende i område SM som innehar särskilt tillstånd. Boende med särskilt tillstånd får parkeras under högst 7 dygn i följd.').limits, [{ a: 0, b: 1440, max: 1440 }]);
  assert.equal(parseRegulation('följande. 1 § På X får fordon, med avvikelse från Y om område med förbud att parkera fordon på A, B och C , parkeras. 2 § Parkering är dock tillåten under högst 24 tim i följd.').unread.length, 0);
});
test('QA 500 part 3: trailing whole-day day types, "kl. … och kl. …", "får dock fordon", paragraph seasons', () => {
  assert.deepEqual(parseRegulation('följande. 1 § På X får fordon parkeras. 2 § Parkering är dock förbjuden vardag mellan klockan 18.00 - 06.00, vardag före sön- och helgdag samt sön- och helgdag.').bans, [{ dt: ['vardag'], a: 1080, b: 360 }, { dt: ['fore', 'helgdag'], a: 0, b: 1440 }]);
  assert.deepEqual(parseRegulation('följande. På X får fordon parkeras högst 3 timmar vardagar mellan kl. 08.00 och kl. 17.00.').limits, [{ dt: ['vardag', 'fore'], a: 480, b: 1020, max: 180 }]);
  const r = parseRegulation('följande. 1 § På X får fordon parkeras. 2 § Trots tillåtelsen i 1 § får dock fordon parkeras högst 24 timmar i följd vardagar utom vardagar före sön- och helgdag. 3 § Mellan klockan 8 och 20 gäller tillåtelsen i 1 § högst 3 timmar i följd mot avgift. 4 § Tillåtelsen i 1 § och villkoren i 3 § gäller mellan 1 juni och 31 augusti.');
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }, { a: 480, b: 1200, max: 180, m: [[6, 1], [8, 31]] }]);
});
test('QA 500 parts 1–2: bare time ranges, "vardagar, utom …, mellan", both car classes, marked-bay wording, Övrig tid after a ban, villkoret fee hours', () => {
  assert.deepEqual(parseRegulation('följande. På Långgatan får fordon inte stannas eller parkeras 21.00 - 03.00.').bans, [{ a: 1260, b: 180 }]);
  assert.deepEqual(parseRegulation('följande. På X får fordon inte parkeras. Förbudet gäller vardagar, utom vardag före sön- och helgdag, mellan klockan 07:00 och 17:00.').bans, [{ dt: ['vardag'], a: 420, b: 1020 }]);
  assert.equal(parseRegulation('följande. På X får endast personbil klass 1 och personbil klass 2 parkeras, högst 8 dygn i följd.').reserved, false);
  assert.deepEqual(parseRegulation('följande. Vid parkering inom avgränsat parkeringsområde, får fordon inte parkeras annat än på särskilt markerad uppställningsplats.').bans, []);
  const l = parseRegulation('följande. På Vändgatan får fordon inte parkeras. Förbudet gäller tisdag klockan 08.00 - 12.00. Övrig tid får fordon parkeras under högst 24 tim i följd vardag.');
  assert.deepEqual(l.bans, [{ w: 2, a: 480, b: 720 }]); assert.equal(l.limits[0].max, 1440);
  assert.deepEqual(parseRegulation('följande. På X får fordon parkeras. Tillåtelsen gäller dock mot avgift. Villkoret gäller -vardagar utom vardag före sön- och helgdag klockan 09.00 - 18.00 och -vardag före sön- och helgdag klockan 09.00 - 15.00.').feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }, { dt: ['fore'], a: 540, b: 900 }]);
});
test('QA-500b: "taxa 35 kronor" is a price, combined limit+fee season, heavy-only wordings, "2:a i månaden", colour notes', () => {
  const r = parseRegulation('följande. På Strandpromenaden får fordon parkeras under högst 4 tim i följd. Avgift enligt taxa 35 kronor per timme under tiden klockan 10.00 - 06.00. Tidsbegränsningen och avgiftsplikten gäller under tiden 1 juni - 31 augusti.');
  assert.equal(r.taxa, null); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 240, m: [[6, 1], [8, 31]] }]); assert.deepEqual(r.feeWindows, [{ a: 600, b: 360, m: [[6, 1], [8, 31]] }]);
  assert.equal(parseRegulation('följande. 1 § På Malmgatan får inte lastbil och motordrivet fordon med tillkopplad släpvagn parkeras.').heavyOnly, true);
  assert.equal(parseRegulation('följande. På X får fordon med totalvikt över 3,5 ton inte parkeras klockan 22.00 - 08.00.').heavyOnly, true);
  assert.deepEqual(parseRegulation('följande. På X får fordon parkeras. Parkering är dock förbjuden 2:a i månaden klockan 09.00 - 12.00. Förbudet gäller inte vardag före sön – helgdag samt sön – helgdag.').bans, [{ dm: 2, a: 540, b: 720, dt: ['vardag'] }]);
});
test('lone unread sentences that blocked whole regulations (24 Oct)', () => {
  assert.deepEqual(parseRegulation('följande. På samtliga vägar inom ett område får fordon inte stannas eller parkeras under tiden vardag utom vardag före sön- och helgdag klockan 11.00 - 09.00, vardag före sön- och helgdag klockan 00.00 - 24.00 och sön- och helgdag klockan 00.00 - 24.00. Förbudet gäller inte ambulans och utryckningsfordon.').unread, []);
  assert.equal(parseRegulation('följande. 1 § På X får fordon parkeras. 2 § Tillåtelsen gäller 4 tim i följd.').limits[0].max, 240);
  assert.equal(parseRegulation('följande. 1 § På X får fordon inte parkeras under vardagar utom vardag före sön- och helgdag mellan klockan 00.00 – 09.00. 2 § Tidsbegränsningen gäller 15 november – 15 april.').bans[0].m.length, 2);
  assert.equal(parseRegulation('följande. På X får fordon parkeras högst 3 timmar i följd. Tidsbegränsningen gäller vardagar mellan kl. 06.00-18.00. Övrig tid fri parkering.').unread.length, 0);
});
test('fee hours when the rate is in another regulation; an explicit fee sentence beats "Villkoret gäller" (24 Oct)', () => {
  const r = parseRegulation('följande. 1 § På Torggatans östra sida enligt kartbild får fordon parkeras. 2 § Avgift ska betalas för parkering enligt 1 §. Avgiftsplikten gäller vardag utom vardag före sön- och helgdag klockan 08.00 - 20.00 samt vardag före sön- och helgdag klockan 08.00 - 15.00. 3 § Avgiften i 2 § är enligt taxa City-P 4 § Röd taxa. 4 § Trots tillåtelsen i 1 § får fordon inte parkeras på onsdagar klockan 08.00 - 11.00 (gäller vardagar utom vardag före sön- och helgdag).');
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 480, b: 1200 }, { dt: ['fore'], a: 480, b: 900 }]);
  assert.deepEqual(r.bans, [{ w: 3, a: 480, b: 660, dt: ['vardag'] }]);
  const s = parseRegulation('följande. 1 § På Sjögatan får fordon parkeras mot avgift. 2 § Tillåtelsen gäller under högst 2 timmar i följd. Villkoret gäller vardag utom vardag före sön- och helgdag klockan 08.00 - 19.00. 3 § Avgift ska betalas för parkering enligt 1 §. Avgiftsplikten gäller klockan 00.00 - 24.00.');
  assert.deepEqual(s.feeWindows, [{ a: 0, b: 1440 }]);
});
test('limits written in words, permissions to "stannas eller parkeras", glued "Tillåtelsen att parkera gäller" (25 Oct)', () => {
  const r = parseRegulation('följande. 1 § På parkeringsplatsen inom Kv X får fordon parkeras under högst två timmar i följd. 2 § Tidsbegränsningen gäller vardagar utom dag före sön- och helgdag mellan klockan 9 och 18 och dag före sön- och helgdag mellan klockan 9 och 15.');
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 120 }, { dt: ['fore'], a: 540, b: 900, max: 120 }]);
  assert.equal(parseRegulation('följande. På X får fordon parkeras under högst en timma.').limits[0].max, 60);
  assert.equal(parseRegulation('följande. På X får fordon parkeras högst sju (7) dygn i följd.').limits[0].max, 10080);
  assert.equal(parseRegulation('följande. På X får fordon parkeras under högt 3 timmar i följd.').limits[0].max, 180);
  const s = parseRegulation('följande. 1 § På den del av Vintervadsplan som anges i kartan får fordon stannas eller parkeras under högst 4 tim i följd under vardagar utom vardag före sön- och helgdag mellan klockan 06.00 - 18.00 och vardagar före sön- och helgdag 08.00 - 14.00.');
  assert.deepEqual(s.limits, [{ dt: ['vardag'], a: 360, b: 1080, max: 240 }, { dt: ['fore'], a: 480, b: 840, max: 240 }]); assert.equal(s.unread.length, 0);
  assert.equal(parseRegulation('följande. På X får fordon inte stannas eller parkeras.').bans.length, 1);
  const g = parseRegulation('följande. På Ekillavägen får fordon parkeras Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Under tiden klockan 00.00 - 06.00 får dock fordon inte parkeras Tillåtelsen att parkera gäller under högst 4 tim i följd. Villkoret gäller vardagar utom vardag före sön- och helgdag klockan 06.00 - 24.00.');
  assert.deepEqual(g.limits, [{ dt: ['vardag'], a: 360, b: 1440, max: 240 }]); assert.deepEqual(g.bans, [{ a: 0, b: 360 }]); assert.equal(g.unread.length, 0);
});
test('a weekday ban that does not apply on the day before a holiday or on holidays (25 Oct)', () => {
  const r = parseRegulation('följande. På Skepparegatan får fordon parkeras mot avgift. Parkering är dock förbjuden onsdag klockan 08.00 - 11.00. Förbudet gäller inte vardag före sön- och helgdag samt sön- och helgdag.');
  assert.deepEqual(r.bans, [{ w: 3, a: 480, b: 660, dt: ['vardag'] }]); assert.equal(r.unread.length, 0);
});
test('"dag före söndag och helgdag" and "vardagar för sön- och helgdag" are the usual day types (25 Oct)', () => {
  const r = parseRegulation('följande. På Skolgatan får fordon parkeras högst två timmar i följd, vardagar utom dag före söndag och helgdag mellan klockan 08.00-18.00 samt vardag före söndag och helgdag mellan klockan 08.00- 15.00.');
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 120 }, { dt: ['fore'], a: 480, b: 900, max: 120 }]);
  const s = parseRegulation('följande. På parkeringsplatsen får fordon parkeras under högst en timma. Tidsbegränsningen gäller vardagar utom vardagar för sön- och helgdag mellan klockan 08.00 – 18.00 och vardag före sön- och helgdag mellan klockan 08.00 – 13.00.');
  assert.deepEqual(s.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 60 }, { dt: ['fore'], a: 480, b: 780, max: 60 }]);
});
test('hours written "mellan 08 och 18" without "klockan" (25 Oct)', () => {
  const r = parseRegulation('följande. På Klangvägen, på markerade platser, får fordon parkeras under högst 2 timmar. Tidsbegränsningen gäller vardag, utom vardag före söndag och helgdag, mellan 08 och 18.');
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 120 }]);
  assert.equal(parseRegulation('följande. Trots förbudet får fordon parkeras på Värtavägens nordöstra sida mellan 28 och 52 meter nordväst om Järnvägsallén.').limits.length, 0);
});
test('"vardagar, utom vardag före …" in a days-only sentence is Mon–Fri, not Saturday (26 Oct)', () => {
  const r = parseRegulation('följande. 1 § På Propellergatans östra sida enligt kartbild får fordon parkeras. 2 § Tillåtelsen i 1 § anger inte rätt att parkera fordon i strid mot 3 kap. 49 a § trafikförordningen (1998:1276): På allmän plats inom tättbebyggt område får fordon parkeras högst 24 timmar i följd på vardagar, utom vardag före sön- och helgdag.');
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }]);
});
test('a comma before the hours and a leading "och" keep their day types (26 Oct)', () => {
  const r = parseRegulation('följande. 1 § På Dragongatan södra sidan, får fordon inte parkeras. 2 § Förbudet gäller vardagar, utom dag före sön- och helgdag, mellan klockan 07 och 16, och vardag före sön- och helgdag och sön- och helgdag mellan kl 00 och 24.');
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 420, b: 960 }, { dt: ['fore', 'helgdag'], a: 0, b: 1440 }]);
});
test('"Tillåtelsen ger rätt att parkera på ett sådant sätt som är förbjudet …" is not a ban (26 Oct)', () => {
  const r = parseRegulation('följande. På markerad sträcka på Idrottsvägens norra sida enligt kartbild får fordon, med avvikelse från Hallsbergs kommuns lokala trafikföreskrifter 1861 2022:0022 om förbud att parkera på Idrottsvägen, parkeras. Tillåtelsen ger rätt att parkera på ett sådant sätt som är förbjudet enligt trafikförordning (1998:1276) 3 kap. 52 § stycke 2.');
  assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
});
test('hours in one sentence and their days in the next form one ban (26 Oct)', () => {
  const r = parseRegulation('följande. 1 § På Storgatan får fordon inte parkeras. 2 § Förbudet gäller mellan klockan 8 och 12. 3 § Förbudet gäller vardagar, utom vardag före sön- och helgdag.');
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 480, b: 720 }]);
});
test('"vardagar, dock ej dag före sön- och helgdag" means Mon–Fri (26 Oct)', () => {
  const r = parseRegulation('följande. På Skolgatan får fordon parkeras under högst 1 timme i följd vardagar, dock ej dag före sön- och helgdag, mellan kl 08.00 och kl 18.00 samt dag före sön- och helgdag och sön- och helgdag mellan kl 08.00 och 14.00.');
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 60 }, { dt: ['fore', 'helgdag'], a: 480, b: 840, max: 60 }]);
});
test('"Förbudet gäller inte (fordon) 1 juni - 30 september" puts the ban in the rest of the year; "gäller endast vardag" narrows its days (27 Oct)', () => {
  const r = parseRegulation('följande. På Löftesgränds södra sida får fordon inte parkeras. Förbudet gäller under tiden tisdag klockan 07.00 - 12.00. Förbudet gäller endast fordon vardag. Förbudet gäller inte fordon 1:a juni - 30:e september Denna författning träder i kraft den 1 juni 2011.');
  assert.deepEqual(r.bans, [{ w: 2, a: 420, b: 720, dt: ['vardag', 'fore'], m: [[10, 1], [5, 31]] }]); assert.deepEqual(r.unread, []);
  const v = parseRegulation('följande. På Vellingevägen får fordon inte parkeras. Förbudet gäller vardagar utom vardag före sön- och helgdag mellan klockan 7 och 17. Förbudet gäller inte 15 juni - 15 augusti.');
  assert.deepEqual(v.bans, [{ dt: ['vardag'], a: 420, b: 1020, m: [[8, 16], [6, 14]] }]);
});
test('"Avgiftsplikten gäller (endast under perioden) 1 juni - 15 augusti" is the fee season, before or after the fee hours (27 Oct)', () => {
  const r = parseRegulation('följande. 1 § På Smyge strandväg får endast personbil klass I parkeras mot avgift. 2 § Avgift ska betalas för parkering enligt vit taxa. Avgiftsplikten gäller vardagar utom vardag före sön- och helgdag mellan klockan 08.00 - 20.00 och sön- och helgdagar 08.00 - 20.00. 3 § Avgiftsplikten gäller endast under perioden 1 juni-15 augusti. Dessa föreskrifter träder i kraft den 8 juli 2025.');
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 480, b: 1200, m: [[6, 1], [8, 15]] }, { dt: ['helgdag'], a: 480, b: 1200, m: [[6, 1], [8, 15]] }]);
  const h = parseRegulation('följande. 1 § På Odinsvägen får fordon parkeras mot avgift. 2 § Avgift ska betalas för parkering enligt 1 §. Avgiftsplikten gäller 1 juni - 31 augusti. 3 § Avgiften enligt taxa E.');
  assert.deepEqual(h.feeWindows, [{ a: 0, b: 1440, m: [[6, 1], [8, 31]] }]);
});
test('"parkeras mot avgift vardagar utom … klockan 08.00 - 21.00" gives the fee hours (27 Oct)', () => {
  const r = parseRegulation('följande. På markerad sträcka på Löfströms allés sydvästra sida enligt kartbild får fordon parkeras mot avgift vardagar utom vardag före sön- och helgdag klockan 08.00 - 21.00.');
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 480, b: 1260 }]);
});
test('"får fordon parkeras och mot avgift" is a permission with fee hours and no other rule (reparse lifts grey, 27 Oct)', () => {
  const r = parseRegulation('följande. 1 § På Valhallagatan enligt markering på bifogad kartbild, får fordon parkeras och mot avgift.Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Avgift ska betalas för parkering enligt Uppsala kommuns lokala trafikföreskrifter om parkering. Avgiftsplikten gäller under tiden vardagar utom vardag före sön- och helgdag mellan klockan 08.00 – 24.00 och vardag före sön- och helgdag mellan klockan 08.00 – 24.00.');
  assert.equal(r.permitted, true); assert.deepEqual([r.bans, r.limits, r.allowOnly, r.unread], [[], [], [], []]);
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 480, b: 1440 }, { dt: ['fore'], a: 480, b: 1440 }]);
});
test('"… parkeras … mot avgift. Tillåtelsen gäller under vardagar … 09.00 – 18.00" gives the fee hours (28 Oct)', () => {
  const r = parseRegulation('följande. 1 § På södra sidan av Södra Esplanaden i Växjö får fordon parkeras under högst 3 tim i följd mot avgift.Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Tillåtelsen gäller under vardagar utom vardag före sön- och helgdag mellan klockan 09.00 – 18.00. 3 § Avgift enligt taxa zon 2.');
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }]);
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 180 }]); assert.deepEqual(r.unread, []);
  const n = parseRegulation('följande. 1 § På Storgatan får fordon parkeras under högst 3 tim i följd. 2 § Tillåtelsen gäller under vardagar mellan klockan 09.00 – 18.00.');
  assert.equal(n.feeWindows, null); // no fee in the text: no fee hours
});
test('"Mellan klockan 0 och 24 gäller dock tillåtelsen … högst 24 timmar i följd vardag, utom …" and a paragraph opening with a date (28 Oct)', () => {
  const r = parseRegulation('följande. 1 § På det område vid Lökholmsvägen får endast personbil klass I parkeras. 2 § Mellan klockan 0 och 24 gäller dock tillåtelsen i 1 § högst 24 timmar i följd vardag, utom vardag före sön- och helgdag. 3 § Tillåtelsen i 1 § och villkoren i 2 § gäller 31 juli - 1 maj. 4 § 1 maj - 31 juli gäller dock parkering tillåten endast för personbil klass I högst 28 dagar i följd.');
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, dt: ['vardag'], max: 1440, m: [[7, 31], [5, 1]] }, { a: 0, b: 1440, m: [[5, 1], [7, 31]], max: 40320 }]);
  assert.deepEqual(r.unread, []);
});
test('placement-only sentences do not leave a text unread (29 Oct)', () => {
  const a = parseRegulation('följande. 1 § På östra sidan av Lingsgatan får fordon parkeras under högst 4 tim i följd vardag utom vardag före sön- och helgdag mellan klockan 09.00 – 18.00. Tillåtelsen gäller endast särskilt markerade platser.');
  assert.deepEqual(a.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 240 }]); assert.deepEqual(a.unread, []);
  const b = parseRegulation('följande. 1 § På Kvarngatan får fordon parkeras endast mot avgift. 4 § Parkering är dock förbjuden under 1:a helgfria tisdagen i månaden mellan klockan 08.00 - 12.00. 5 § Parkeringen är endast tillåten på markerade platser.');
  assert.deepEqual(b.unread, []);
  const c = parseRegulation('följande. På Schéelegatan får fordon inte parkeras. Förbudet gäller båda sidor.');
  assert.deepEqual([c.bans, c.unread], [[{ a: 0, b: 1440 }], []]);
  for (const s of ['Parkeringsplatsernas läge framgår av till beslutet hörande karta.', 'Vid parkering av motorcykel eller moped klass 1 krävs inte parkeringsskiva.']) assert.deepEqual(parseRegulation(`följande. På Torget får fordon parkeras under högst 2 tim i följd. ${s}`).unread, []);
  // a sentence about both sides that also carries a time is not placement-only
  assert.notDeepEqual(parseRegulation('följande. På Gatan får fordon inte parkeras. Förbudet gäller båda sidor vardagar klockan 08.00 - 12.00.').bans, [{ a: 0, b: 1440 }]);
});
test('"Övrig tid får fordon parkeras högst …" after a seasonal limit: rest of the season and the rest of the year (29 Oct)', () => {
  const r = parseRegulation('följande. På parkeringsplats vid Strandvägen får fordon parkeras under högst 20 min i följd. Tidsbegränsningen gäller under tiden 15 augusti - 15 juni. Övrig tid får fordon parkeras under högst 2 timmar i följd.');
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 20, m: [[8, 15], [6, 15]] }, { a: 0, b: 1440, m: [[6, 16], [8, 14]], max: 120 }]); assert.deepEqual(r.unread, []);
  const h = parseRegulation('följande. På Torget får fordon parkeras under högst 3 tim i följd klockan 08.00 - 18.00 under tiden 1 juli - 31 augusti. Övrig tid får fordon parkeras högst 3 dygn i följd.');
  assert.deepEqual(h.limits.slice(-1), [{ a: 0, b: 1440, m: [[9, 1], [6, 30]], max: 4320 }]);
  assert.ok(h.limits.some((l) => l.a === 1080 && l.b === 1440 && l.max === 4320 && l.m)); assert.deepEqual(h.unread, []);
});
test('"Övrig tid får fordon inte parkeras" after a time limit with set hours: banned outside them (30 Oct)', () => {
  const r = parseRegulation('följande. På Vendevägens nordvästra sida enligt kartbild får fordon parkeras under högst 1 tim i följd. Tidsbegränsningen gäller under tiden vardag utom vardag före sön- och helgdag klockan 10.00 - 14.00. Övrig tid får fordon inte parkeras. Parkeringsskiva eller motsvarande ska användas.');
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 600, b: 840, max: 60 }]);
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 0, b: 600 }, { dt: ['vardag'], a: 840, b: 1440 }, { dt: ['fore', 'helgdag'], a: 0, b: 1440 }]); assert.deepEqual(r.unread, []);
  const h = parseRegulation('följande. 1 § På Rådjursvägens parkeringsplats enligt kartbild får endast personbil klass II parkeras mellan klockan 09.00 - 20.00. 2§ Övrig tid får fordon inte parkeras.');
  assert.equal(h.reserved, true); assert.deepEqual(h.bans, [{ dt: ['vardag', 'fore', 'helgdag'], a: 0, b: 540 }, { dt: ['vardag', 'fore', 'helgdag'], a: 1200, b: 1440 }]);
  // a limit with no hours: nothing to take the complement of, still unread
  assert.equal(parseRegulation('följande. På Torget får fordon parkeras under högst 1 tim i följd. Övrig tid får fordon inte parkeras.').unread.length, 1);
});
test('a place phrase inside "får … fordon … parkeras" and a deviation clause without a closing comma (30 Oct)', () => {
  const a = parseRegulation('följande. 1 § På Bondegatans västra sidan får på markerade platser fordon parkeras under högst 1 timme i följd. 2 § Tidsbegränsningen gäller vardagar utom vardag dag före sön- och helgdag mellan klockan 08 och 18 och vardag före sön- och helgdag mellan klockan 08 och 14.');
  assert.deepEqual(a.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 60 }, { dt: ['fore'], a: 480, b: 840, max: 60 }]); assert.deepEqual(a.unread, []);
  const b = parseRegulation('följande. 1 § Med avvikelse från de lokala trafikföreskrifterna 2061 2012:034 om förbud att parkera fordon inom centrum i Smedjebacken får fordon på markerade platser inom slingan med parkeringsplatser på Johan Ahlbäcks plats parkeras högst 30 minuter i följd. 2 § Tidsbegränsningen gäller vardagar utom vardag före sön- och helgdag mellan klockan 8 och 18 och vardag före sön- och helgdag mellan klockan 8 och 15.');
  assert.deepEqual(b.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 30 }, { dt: ['fore'], a: 480, b: 900, max: 30 }]); assert.deepEqual(b.unread, []);
  const c = parseRegulation('följande. 1 § På västra sidan av Köpmangatan får fordon, med avvikelse från Eskilstuna kommuns lokala trafikföreskrifter (0484 2016 : 211) om område med förbud att parkera parkeras under högst 3 tim i följd. 3 § Tidsbegränsningen gäller under tiden vardag utom vardag före sön- och helgdag klockan 08.00 - 20.00.');
  assert.deepEqual(c.limits, [{ dt: ['vardag'], a: 480, b: 1200, max: 180 }]); assert.deepEqual(c.unread, []);
  // a "not" inside the skipped phrase is never dropped
  assert.equal(parseRegulation('följande. På Gatan får fordon på markerade platser inte parkeras.').permitted, undefined);
  assert.equal(parseRegulation('följande. På Gatan får fordon, med avvikelse från X kommuns lokala trafikföreskrifter (1234 2016:1) om parkering inte parkeras.').permitted, undefined);
});
test('a ban only for motorhomes and trailers is not a ban for cars (30 Oct)', () => {
  const a = parseRegulation('följande. På markerade sträckor på Selma Lagerlöfs vägs norra ände enligt kartbild får fordon parkeras. Parkering är dock förbjuden för personbil klass 2 och släpkärra under tiden vardagar utom vardag före sön- och helgdag mellan klockan 22.00 - 08.00, vardag före sön- och helgdag mellan klockan 22.00 - 08.00 och sön- och helgdag mellan klockan 22.00 - 08.00.');
  assert.deepEqual([a.bans, a.unread, a.heavyOnly, a.permitted], [[], [], true, true]);
  const b = parseRegulation('följande. 1 § På den del av Ågatan som anges i kartan får endast personbil parkeras under högst 24 tim i följd. 2 § Personbil klass II får ej parkeras.');
  assert.deepEqual([b.bans, b.limits], [[], [{ a: 0, b: 1440, max: 1440 }]]);
  // a motorhome bay's other hours stay a reservation, not a heavy-only text
  const c = parseRegulation('följande. På två markerade ytor vid Rörumsstrandsvägen får endast personbil klass II parkeras under tiden klockan 09.00 - 16.00. Under tiden klockan 16.00 - 09.00 får dock personbil klass II inte parkeras.');
  assert.deepEqual([c.reserved, c.heavyOnly], [true, undefined]);
  // "fordon" or ordinary cars in the ban: still a ban
  assert.deepEqual(parseRegulation('följande. På Gatan är parkering förbjuden för fordon och släpkärra.').bans.length, 1);
});
test('a two-column "DennaPublicerat på webbplatsen författning …" footer ends the rule text (31 Oct)', () => {
  const a = parseRegulation('följande. 1 § Inom rödmarkerade ytor på Bromsplan får fordon parkeras. 2 § Avgift ska betalas för parkering enligt 1 §. 5 § Parkering är dock förbjuden torsdag mellan klockan 00.00 och 09.00.\n\fDennaPublicerat på webbplatsen\n        författning träder i kraftSvensk\n   den 21 trafikföreskriftssamling den 9 juli\n juli 2025 då Örebro kommuns  2025 lokala trafikföreskrifter 1880 2021:00581 om parkering på Bromsplan skall upphöra att gälla.');
  assert.deepEqual([a.bans, a.unread], [[{ w: 4, a: 0, b: 540 }], []]);
});
test('a deviation clause with no commas: "får fordon med avvikelse från kommunens lokala trafikföreskrifter 1277 2008 : 00261 parkeras" (31 Oct)', () => {
  const a = parseRegulation('följande. 1 § På Fjällvägen får fordon med avvikelse från kommunens lokala trafikföreskrifter 1277 2008 : 00261 parkeras under högst 24 tim i följd. Tidsbegränsningen gäller vardag utom dag före sön- och helgdag.');
  assert.deepEqual([a.limits, a.unread], [[{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }], []]);
  const b = parseRegulation('följande. På Gatan får fordon med avvikelse från 3 kap. 55 § 3 trafikförordningen (1998:1276) parkeras under högst 5 min i följd.');
  assert.deepEqual([b.limits, b.unread], [[{ a: 0, b: 1440, max: 5 }], []]);
  // a "not" inside the clause is never dropped
  assert.equal(parseRegulation('följande. På Gatan får fordon med avvikelse från kommunens lokala trafikföreskrifter 1234 2008 : 1 inte parkeras.').permitted, undefined);
});
test('"får fordon som används av rörelsehindrade … parkeras" without "endast" is a disabled bay at all hours (31 Oct)', () => {
  const a = parseRegulation('följande. På markerad plats på Östra Torggatan enligt kartbild får fordon som används av rörelsehindrade med särskilt tillstånd med avvikelse från kommunens lokala trafikföreskrifter 1081 2009-00116 parkeras under högst 2 tim i följd under tiden vardag utom dag före sön- och helgdag klockan 09.00 - 18.00. Övrig tid får fordon som används av rörelsehindrade med särskilt tillstånd parkeras under högst 24 tim i följd.');
  assert.deepEqual([a.reserved, a.reservedFor, a.reservedWindows, a.limits, a.unread], [true, 'rörelsehindrade', [], [], []]);
  // after a permission for all cars it is not a reservation; in a season it stays unread
  assert.equal(parseRegulation('följande. På Gatan får fordon parkeras under högst 2 tim i följd. Där får fordon som används av rörelsehindrade med särskilt tillstånd parkeras under högst 24 tim i följd.').reserved, false);
  assert.equal(parseRegulation('följande. På Gatan får fordon som används av rörelsehindrade med särskilt tillstånd parkeras under tiden 1 maj - 30 september.').unread.length, 1);
});
test('Falun "Villkoret gäller ej mellan datumen 15/12-30/4 Torsdagar kl 09:00-15:00" after a deviating permission is a seasonal ban (1 Nov)', () => {
  const a = parseRegulation('följande. På markerade sträckor på Blindgatan enligt kartbild får fordon, med avvikelse från Falu kommuns lokala trafikföreskrifter 2080 2025:00259 om stannande och parkering, parkeras under högst 24 tim i följd Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag Villkoret gäller ej mellan datumen 15/12-30/4 Torsdagar 09:00 - 15:00 Denna författning träder i kraft den 11 december 2025.');
  assert.deepEqual([a.limits, a.bans, a.unread], [[{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }], [{ w: 4, a: 540, b: 900, m: [[12, 15], [4, 30]] }], []]);
  // without a deviation clause the sentence is left unread
  assert.equal(parseRegulation('följande. På Gatan får fordon inte parkeras. Villkoret gäller ej mellan datumen 15/12-30/4 Torsdagar kl 09:00-15:00').unread.length, 1);
});
test('"Föbudet" typo and "Förbudet gäller inte parkering på markerade platser" are read (1 Nov)', () => {
  const a = parseRegulation('följande. På väg eller gata inom tättbebyggt område i Skurup får motorredskap, släpfordon, traktor, tung buss och tung lastbil med totalvikt över 3,5 ton inte parkeras under tiden vardagar utom vardag före sön- och helgdag klockan 22.00 - 06.00. Föbudet gäller inte på följande gator enligt kartbild: Östra Olstorpsgatan och Götgatan.');
  assert.deepEqual([a.heavyOnly, a.unread], [true, []]);
  const b = parseRegulation('följande. På samtliga delar av Västgötagatan enligt kartbild får fordon inte parkeras. Förbudet gäller inte parkering på markerade platser.');
  assert.deepEqual([b.bans, b.unread], [[{ a: 0, b: 1440 }], []]);
});
test('"Datumparkering gäller mellan kl 00.00 och kl 08.00" and the "dag för sön- och helgdag" typo (1 Nov, Kiruna)', () => {
  const a = parseRegulation('följande. På Lars Janssonsgatans östra sida får fordon parkeras högst 2 timmar vardagar utom dag för sön- och helgdag mellan kl 09.00 och kl 18.00. Datumparkering gäller mellan kl 00.00 och kl 08.00.');
  assert.deepEqual([a.limits, a.dp, a.unread], [[{ dt: ['vardag'], a: 540, b: 1080, max: 120 }], [{ a: 0, b: 480 }], []]);
  // a sentence about where date parking ends is not read as hours
  assert.equal(parseRegulation('följande. På Gatan får fordon parkeras. Datumparkering gäller ej efter denna sträcka.').unread.length, 1);
});
test('hours joined by "till" ("klockan 7 till 9", "mellan klockan 08:00 till 18:00") and "under perioden april till november" (2 Nov)', () => {
  const a = parseRegulation('följande. På Källvägen får fordon inte parkeras. Med avvikelse från bestämmelserna i 1 § får fordon parkeras på anordnade platser. Tillåtelsen i 2 § gäller parkering i högst 2 timmar i följd. Villkoret gäller vardagar, utom vardag före sön- och helgdag, mellan klockan 08:00 till 18:00.');
  assert.deepEqual([a.limits, a.unread], [[{ dt: ['vardag'], a: 480, b: 1080, max: 120 }], []]);
  const b = parseRegulation('följande. På rödmarkerade sträckor på Godhemsgatan enligt kartbild får fordon inte parkeras. Förbudet att parkera gäller första tisdagen i månaden klockan 7 till 9 under perioden april till november.');
  assert.deepEqual([b.bans, b.unread], [[{ w: 2, nw: 1, a: 420, b: 540, m: [[4, 1], [11, 30]] }], []]);
  // "Föreskriften gäller <hours> <days>" after a limit and nothing else: the limit's hours (Gällivare)
  const c = parseRegulation('följande. På västra sidan av Östra Kyrkoallén är parkering tillåten högst 2 timmar i följd. Föreskriften gäller klockan 08.00 till 20.00 vardagar samt dag före söndag och helgdag. Övrig tid är inte tidsbegränsad.');
  assert.deepEqual([c.limits, c.unread], [[{ dt: ['vardag', 'fore'], a: 480, b: 1200, max: 120 }], []]);
});
test('"Villkoret gäller under tiden vardag utom …" after permission hours: those hours on those days, all day on the others (2 Nov, Karlstad)', () => {
  const a = parseRegulation('följande. På Lagerhusgatans södra sida får fordon, med avvikelse från Karlstads kommuns lokala trafikföreskrifter 1780 2023:00065 om förbud att parkera på del av Tullholmen, parkeras. Tillåtelsen att parkera gäller under tiden klockan 00.00 - 06.00 och 10.00 - 24.00. Villkoret gäller under tiden vardag utom vardag före sön- och helgdag. Avgift enligt taxa 3, grön zon. Avgiftsplikten gäller under tiden vardagar utom vardag före sön- och helgdag klockan 10.00 - 18.00.');
  assert.deepEqual([a.allowOnly, a.unread], [[{ a: 0, b: 360, dt: ['vardag'] }, { a: 600, b: 1440, dt: ['vardag'] }, { dt: ['fore', 'helgdag'], a: 0, b: 1440 }], []]);
});
test('"får inte andra fordon parkeras än … rörelsehindrade" is a reserved bay; disabled-bay placement and weeks are read (2 Nov)', () => {
  const a = parseRegulation('följande: På en särskilt markerad parkeringsplats vid Fredsgatan nr 10 får inte andra fordon parkeras än sådana som används för befordran av rörelsehindrade med särskilt tillstånd. Fordon som inte får parkeras får heller inte stannas för annat än av- och påstigning.');
  assert.deepEqual([a.reserved, a.reservedFor, a.bans, a.unread], [true, 'rörelsehindrade', [], []]);
  // an unnamed group is not guessed
  assert.equal(parseRegulation('följande. På Västra Storgatan får inte andra fordon än servicefordon till kvarteret Predikanten parkeras.').reserved, false);
  const b = parseRegulation('följande. 1 § På Stortorget får fordon parkeras under högst 2 tim i följd 2 § Tillåtelsen gäller under vardag utom vardag före sön- och helgdag mellan klockan 08.00 – 18.00. 3 § Tillåtelsen gäller inte på plats reserverad för rörelsehindrade med parkeringstillstånd.');
  assert.deepEqual([b.limits, b.bans, b.unread], [[{ dt: ['vardag'], a: 480, b: 1080, max: 120 }], [], []]);
  assert.deepEqual(parseRegulation('följande. På Gatan får fordon parkeras. Tillåtelsen gäller under högst 2 veckor i följd.').limits, [{ a: 0, b: 1440, max: 20160 }]);
});
test('"personbil klass I" (alone or in a list of light vehicles) is an ordinary car; motorhome rules unchanged (3 Nov)', () => {
  const a = parseRegulation('följande. På markerade sträckor på Dalgatans västra sida enligt kartbild får moped, motorcykel, personbil klass I och traktor a parkeras under högst 4 tim i följd under tiden vardag utom vardag före sön- och helgdag klockan 08.00 - 18.00.');
  assert.deepEqual([a.limits, a.reserved, a.unread], [[{ dt: ['vardag'], a: 480, b: 1080, max: 240 }], false, []]);
  const b = parseRegulation('följande. På parkeringen vid Sjögatan 28 (se kartan) får personbil klass I stannas eller parkeras.');
  assert.deepEqual([b.permitted, b.reserved, b.bans, b.unread], [true, false, [], []]);
  assert.deepEqual(parseRegulation('följande. På Badhyttsvägen får personbil klass I, motorcykel och moped klass I parkeras. Tillåtelsen gäller endast personbil klass I.').unread, []);
  // a ban for ordinary cars still reserves the place for motorhomes (Vellinge)
  const c = parseRegulation('följande. På X får fordon inte parkeras. Tillåtelsen gäller inte personbil klass I.');
  assert.deepEqual([c.reserved, c.reservedFor], [true, 'husbil']);
  // personbil klass II stays a motorhome spot
  assert.equal(parseRegulation('följande. På X får endast personbil klass II parkeras.').reservedFor, 'husbil');
});
test('"får fordon parkera", "högst 1 (timme)", "under två timmar i följd" and a sentence opening "Under tisdag klockan" without a full stop (3 Nov)', () => {
  const a = parseRegulation('följande. Inom Konumparkeringen får fordon parkera högst 2 timmar i följd. Tidsbegränsningen gäller vardagar utom vardag före sön- och helgdag mellan klockan 08 och 18.');
  assert.deepEqual([a.limits, a.unread], [[{ dt: ['vardag'], a: 480, b: 1080, max: 120 }], []]);
  assert.deepEqual(parseRegulation('följande. På Våggatan får fordon parkeras under högst 1 (timme) i följd.').limits, [{ a: 0, b: 1440, max: 60 }]);
  assert.deepEqual(parseRegulation('följande. På Storgatan får fordon parkeras under två timmar i följd.').limits, [{ a: 0, b: 1440, max: 120 }]);
  const b = parseRegulation('följande. På Svartmangatans södra sida, får fordon parkeras under högst 24 tim i följd och mot avgift under tiden vardag klockan 08.00 – 24.00 Under tisdag klockan 06.00 – 18.00 får fordon inte parkeras. 2 § Tidsbegränsningen gäller under tiden vardag utom vardag före sön- och helgdag. 3 § Övrig tid får fordon parkeras.');
  assert.deepEqual([b.bans, b.limits, b.unread], [[{ w: 2, a: 360, b: 1080 }], [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }], []]);
});
test('a span over several days ("mellan fredag klockan 22.00-söndag klockan 04.00") and an unread day of the month stay honest (3 Nov)', () => {
  const a = parseRegulation('följande. På Stortorget får fordon inte stannas eller parkeras under onsdag klockan 05.00-18.00 och mellan fredag klockan 22.00-söndag klockan 04.00.');
  assert.deepEqual([a.bans, a.unread], [[{ w: 3, a: 300, b: 1080 }, { w: 5, a: 1320, b: 1440 }, { w: 6, a: 0, b: 1440 }, { w: 7, a: 0, b: 240 }], []]);
  // "den 15 varje månad" is not read as every weekday
  const b = parseRegulation('följande. På västra sidan Dragaregatan får inte fordon parkera måndag-fredag mellan kl 08.00-12.00 den 15 varje månad.');
  assert.deepEqual([b.bans, b.unread.length], [[], 1]);
});
test('"vardagar utom dag före helgdag" is Monday to Friday (3 Nov, Växjö)', () => {
  assert.deepEqual(parseRegulation('följande. På Billavägen får fordon parkera högst 10 minuter i följd utan avgift, gäller vardagar utom dag före helgdag kl. 06.00-19.00.').limits, [{ dt: ['vardag'], a: 360, b: 1140, max: 10 }]);
});
test('"dag före helgdag" is Saturday as in "dag före sön- och helgdag" (3 Nov, Växjö Linnégatan)', () => {
  assert.deepEqual(parseRegulation('följande. På Norrgatan får fordon parkeras högst 10 minuter i följd, Gäller vardagar utom dag före helgdag kl 00.00 - 08.00 och kl 11.00 - 24.00 samt dag före helgdag och helgdag kl 00.00 - 24.00.').limits[2], { dt: ['fore', 'helgdag'], a: 0, b: 1440, max: 10 });
  assert.deepEqual(parseRegulation('följande. 1 § På Linnégatan i Växjö, östra sidan från Sandgärdsgatan till Storgatan, vardagar utom dag före helgdag kl 08.00-18.00 samt dag före helgdag kl 08.00-15.00. får inte fordon parkeras.').bans, [{ dt: ['vardag'], a: 480, b: 1080 }, { dt: ['fore'], a: 480, b: 900 }]);
});
test('"Mellan klockan 9 och 15 på vardagar före sön- och helgdag gäller dock tillåtelsen …" and the "heldag" typo (4 Nov, Ängelholm)', () => {
  const r = parseRegulation('följande. På Storgatan får fordon parkeras. Mellan klockan 9 och 18 vardagar utom vardag före sön- och heldag gäller dock tillåtelsen att parkera i högst 3 timmar i följd mot att avgift erläggs eller högst 1 timme i följd mot användande av parkeringsskiva eller motsvarande. Mellan klockan 9 och 15 på vardagar före sön- och helgdag gäller dock tillåtelsen att parkera i högst 3 timmar i följd.');
  assert.deepEqual([r.limits, r.unread], [[{ dt: ['vardag'], a: 540, b: 1080, max: 180 }, { dt: ['fore'], a: 540, b: 900, max: 180 }], []]);
});
test('"får beskickningsfordon parkeras" without "endast" is a diplomatic bay, its limit is not for all cars (4 Nov, Sigtuna)', () => {
  const r = parseRegulation('följande. På särskilt markerade platser längs väg U 21 enligt kartbild får beskickningsfordon parkeras. Parkering är dock tillåten under högst 3 tim i följd.');
  assert.deepEqual([r.reserved, r.reservedFor, r.unread], [true, 'beskickningsfordon', []]);
});
test('"Tidsbegränsningen gäller …" in a text that never states the limit is flagged unknown, not read as free (4 Nov, Tyresö)', () => {
  const r = parseRegulation('följande. 1 § På Radiovägens östra sida enligt kartbild får endast personbil parkeras. 2 § Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag klockan 08.00 - 16.00.');
  assert.deepEqual([r.limitUnknown, r.unread.length, r.limits], [true, 1, []]);
  // a limit stated in the text keeps the usual reading
  const b = parseRegulation('följande. På Radiovägen får fordon parkeras under högst 2 tim i följd. Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag klockan 08.00 - 16.00.');
  assert.deepEqual([b.limitUnknown, b.limits], [undefined, [{ dt: ['vardag'], a: 480, b: 960, max: 120 }]]);
});
test('a ban departing from a comma-separated list of regulations is read (5 Nov, Karlstad Norra Klaragatan)', () => {
  const r = parseRegulation('följande. 1 § På Norra Klaragatan, enligt kartan till dessa föreskrifter, får fordon, med avvikelse från Karlstads kommuns lokala trafikföreskrifter 1780 2024:00346 om parkering på Norra Klaragatan, 1780 2024:00347 om parkering på Norra Klaragatan, inte parkeras. Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Förbudet gäller onsdag klockan 10.00 - 12.00 udda veckor.');
  assert.deepEqual([r.bans, r.unread], [[{ w: 3, a: 600, b: 720, p: 'odd' }], []]);
});
test('the parking-disc rounding sentence carries no rule (5 Nov, Lomma)', () => {
  const r = parseRegulation('följande. 1 § På 5 markerade platser på Kajgatans södra sida enligt kartbild får fordon parkeras under högst 1 timme i följd. 2 § Tidsbegränsningen gäller vardagar utom dag före sön- och helgdag mellan klockan 0900 och 1700, vardagar före sön- och helgdag mellan klockan 0900 och 1700 samt sön- och helgdag mellan klockan 0900 och 1700. 3 § Tiden då parkeringen påbörjas skall anges med parkeringsskiva eller på annat tydligt sätt. Vid användande av parkeringsskiva får parkering ske från den tidpunkt då fordonet parkeras till närmast följande hel eller halvtimme samt under den tid som anges i 1 §.');
  assert.deepEqual([r.limits.length, r.limits[0], r.unread], [3, { dt: ['vardag'], a: 540, b: 1020, max: 60 }, []]);
});
test('"får fordon endast parkeras med stöd av parkeringstillstånd enligt 13 kap. 8 §" is a disabled bay, its limit not for all cars (6 Nov, Örnsköldsvik)', () => {
  const r = parseRegulation('följande. 1 § På Läroverksgatans norra sida på sträckan som anges på kartan, med avvikelse från Örnsköldsviks kommuns lokala trafikföreskrifter 2284 2023:00077 om förbud att parkera i centrala Örnsköldsvik, får fordon endast parkeras med stöd av parkeringstillstånd enligt 13 kap. 8 § trafikförordningen (1998:1276) eller utländska parkeringstillstånd som ger samma rätt att parkera. Tillåtelsen att parkera enligt 1 § gäller dock högst 3 timmar i följd.');
  assert.deepEqual([r.reserved, r.reservedFor, r.unread], [true, 'rörelsehindrade', []]);
});
test('"tisdag - onsdag mellan klockan 12.00 - 12.00" is one span from Tuesday noon to Wednesday noon; the deviation sentence carries no rule (6 Nov, Gällivare)', () => {
  const r = parseRegulation('följande. 1 § På norra sidan av Klockaregatan får fordon inte parkeras. 2 § Förbudet att parkera i paragraf 1 gäller under tiden tisdag - onsdag mellan klockan 12.00 - 12.00, torsdag - fredag 12.00 - 12.00 och söndag - måndag klockan 12.00 - 12.00. 3 § Föreskriften gäller med avvikelse från bestämmelserna i Gällivare kommuns lokala trafikföreskrifter (2523 2010:001) om datumparkering inom tättbebyggt område.');
  assert.deepEqual([r.bans, r.unread], [[{ w: 2, a: 720, b: 1440 }, { w: 3, a: 0, b: 720 }, { w: 4, a: 720, b: 1440 }, { w: 5, a: 0, b: 720 }, { w: 7, a: 720, b: 1440 }, { w: 1, a: 0, b: 720 }], []]);
  // different hours keep the per-day reading
  assert.deepEqual(parseRegulation('följande. På Storgatan får fordon inte parkeras måndag - tisdag klockan 08.00 - 10.00.').bans, [{ w: 1, a: 480, b: 600 }, { w: 2, a: 480, b: 600 }]);
});
test('"får lätt lastbil och personbil parkeras" is ordinary parking; "parkers" typo (6 Nov, Västerås, Staffanstorp)', () => {
  const r = parseRegulation('följande. På med rött markerade sträckor på Skerikesvägen enligt kartbild får lätt lastbil och personbil parkeras under högst 4 tim i följd under tiden vardagar utom vardag före sön- och helgdag klockan 07.00 - 22.00.');
  assert.deepEqual([r.limits, r.unread, r.reserved], [[{ dt: ['vardag'], a: 420, b: 1320, max: 240 }], [], false]);
  assert.deepEqual(parseRegulation('följande. 1 $ På samtliga vägar inom ett område i Hjärup får fordon inte parkers.').bans, [{ a: 0, b: 1440 }]);
});
test('a later ban outside the hours of "Tillåtelsen gäller högst 3 timmar … under tiden 06–22" shows those are the limit\'s hours, not the permission\'s; "2 §Tillåtelsen" (6 Nov, Örebro)', () => {
  const r = parseRegulation('följande. 1 § På Fredsgatan, med avvikelse från Örebro kommuns lokala trafikföreskrifter 1880 2025:00098 om förbud att parkera i Örebro centrum, får fordon endast parkeras med stöd av parkeringstillstånd enligt 13 kap. 8 § trafikförordningen (1998:1276). 2 §Tillåtelsen i 1 § gäller högst 3 timmar i följd under tiden - vardagar utom vardag före sön- och helgdag klockan 06.00 - 22.00, - vardag före sön- och helgdag klockan 06.00 - 22.00 och - sön- och helgdag klockan 06.00 - 22.00. 3 § Parkering är dock förbjuden jämna datum klockan 00.00 - 06.00.');
  assert.deepEqual([r.reservedFor, r.limits.length, r.allowOnly, r.bans, r.unread], ['rörelsehindrade', 3, [], [{ a: 0, b: 360, dd: 'even' }], []]);
  // without such a ban the permission hours stay
  assert.equal(parseRegulation('följande. 1 § På Fredsgatan, med avvikelse från Örebro kommuns lokala trafikföreskrifter 1880 2025:00098 om förbud att parkera i Örebro centrum, får fordon parkeras. 2 § Tillåtelsen gäller högst 3 timmar i följd under tiden vardagar klockan 06.00 - 22.00.').allowOnly.length, 1);
});
test('"Trots tillåtelsen i 1 § får fordon inte parkeras den 21:a dagen …" names no place: one rule set for all of 1 § (7 Nov, Norrköping City-P)', () => {
  const t = 'följande. 1 § På Blomstergatans norra sida mellan Hagagatan och Norralundsgatan, Rågångens västra sida mellan Hagalundsgatan och Norralundsgatan enligt kartbild får fordon parkeras. 2 § Avgift ska betalas för parkering enligt 1 §. Avgiftsplikten gäller vardag utom vardag före sön- och helgdag klockan 08.00 - 20.00 samt vardag före sön- och helgdag klockan 08.00 - 15.00. 4 § Trots tillåtelsen i 1 § får fordon inte parkeras den 21:a dagen i månaden klockan 09.00 - 12.00 (gäller vardag utom vardag före sön- och helgdag).';
  assert.equal(samePlaceExceptions(t), 1);
  assert.deepEqual(parseRegulation(t).bans, [{ dm: 21, dt: ['vardag'], a: 540, b: 720 }]);
  assert.equal(samePlaceExceptions('följande. 4 § Trots tillåtelsen i 1 § får fordon inte parkeras på torsdagar klockan 08.00 - 12.00.'), 1);
  // an exception that names its own place is another rule set
  assert.equal(samePlaceExceptions('följande. 3 § Trots tillåtelsen i 1 § får fordon inte parkeras - på Esplanadens sydöstra sida mellan Ö Promenaden och Nygatan.'), 0);
});
test('"under tiden 15 maj - 15 augusti och 08.00 - 18.00": the hours belong to the season (7 Nov, Tanum)', () => {
  const r = parseRegulation('följande. 1 § På Sjövägen i Havstenssund enligt markering i Kartbilaga 1 får fordon parkeras under högst 2 tim i följd under tiden 15 maj - 15 augusti och 08.00 - 18.00.');
  assert.deepEqual([r.limits, r.unread], [[{ a: 480, b: 1080, m: [[5, 15], [8, 15]], max: 120 }], []]);
});
test('QA 8 Nov: "måndag söndag" summer limit, seasons joined by "samt", "gäller även" fee day, "på 2 av platserna", fee days from the permission', () => {
  const a = parseRegulation('följande. 1 § På Skogen får fordon parkeras under högst 24 tim i följd under vardag utom dag före sön- och helgdag. 2 § Parkering är dock tillåten under högst 2 tim i följd under tiden den 15 juni - 15 augusti och måndag söndag klockan 08.00 - 18.00.');
  assert.deepEqual(a.limits[1], { a: 480, b: 1080, m: [[6, 15], [8, 15]], max: 120 });
  const b = parseRegulation('följande. 1 § På Lagmansbacken får fordon parkeras högst 3 tim i följd. 4 § Parkering är dock förbjuden onsdag mellan klockan 07.00 - 13.00 under tiden 1 november - 30 april samt onsdag mellan klockan 07.00 - 10.00 under tiden 1 maj - 30 oktober.');
  assert.deepEqual(b.bans, [{ w: 3, a: 420, b: 780, m: [[11, 1], [4, 30]] }, { w: 3, a: 420, b: 600, m: [[5, 1], [10, 30]] }]);
  const c = parseRegulation('följande. 1 § På Redargatan får fordon parkeras. 2 § Avgift ska betalas. 3 § Avgiftsplikten gäller vardag utom vardag före sön- och helgdag mellan klockan 09 - 18. 5 § Avgiftsplikten gäller även vardag före sön- och helgdag mellan klockan 09 - 15.');
  assert.deepEqual(c.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }, { dt: ['fore'], a: 540, b: 900 }]);
  const d = parseRegulation('följande. 1 § På parkeringsplatsen vid Bökebergsgatan får fordon parkeras på 132 markerade platser. 2 § På 2 av ovan nämnda 132 markerade platser, får endast fordon som används av rörelsehindrad med parkeringstillstånd parkeras.');
  assert.equal(d.reserved, false);
  const e = parseRegulation('följande. 1 § På Bruno Liljeforsgatan får fordon parkeras under högst 24 timmar i följd. Avgift mot klockan 09.00 - 24.00. 2 § Tillåtelsen gäller under tiden vardag utom dag före sön- och helgdag. Övrig tid får fordon parkeras.');
  assert.deepEqual(e.feeWindows, [{ a: 540, b: 1440, dt: ['vardag'] }]);
});
test('QA 8 Nov round 2: fee only "övrig tid", weekday hours without "klockan", disabled bay open to all in stated hours', () => {
  const a = parseRegulation('följande. 1 § På Ankdammsgatan får fordon parkeras under högst 30 min i följd. 2 § Tidsbegränsningen gäller under tiden måndag - fredag klockan 07:00 - 17:00. 3 § Övrig tid får fordon parkeras mot avgift. 5 § Avgift enligt taxa A och Boende Solna.');
  assert.deepEqual(a.feeWindows, [{ dt: ['vardag'], a: 0, b: 420 }, { dt: ['vardag'], a: 1020, b: 1440 }, { dt: ['fore', 'helgdag'], a: 0, b: 1440 }]);
  const b = parseRegulation('följande. På Hindergårdsgatan får fordon parkeras under högst 24 tim i följd. Parkering är dock förbjuden under tiden 1:a maj - 31:a oktober udda veckor onsdag klockan 09.00 - 13.00 och 1:a november - 30:e april onsdagar 00.00 - 06.00.');
  assert.deepEqual(b.bans[1], { w: 3, a: 0, b: 360, m: [[11, 1], [4, 30]] });
  const c = parseRegulation('följande. På Esplanadens östra sida får endast sådant fordon parkeras som används för befordran av rörelsehindrad med parkeringstillstånd enligt 13 kap. 8 § trafikförordningen (1998:1276). Parkering är dock tillåten under högst 2 tim i följd under tiden vardagar utom vardag före sön- och helgdag klockan 08.00 - 21.00.');
  assert.equal(c.reserved, true); assert.equal(c.limits[0].max, 120); // the bay stays reserved: the limit is the permit holders'
  const d = parseRegulation('följande. På östra sidan av Medborgargatan får Parkering ske, under högst 10 min i följd, vardag, vardag före sön- och helgdag och sön- och helgdag.');
  assert.deepEqual(d.limits, [{ dt: ['vardag', 'fore', 'helgdag'], a: 0, b: 1440, max: 10 }]);
});
test('QA 8 Nov round 4: "jämn vecka 05-07", "24.00 - 08.00", motorhome-only ban, fee hours in the permission + fee day types', () => {
  assert.deepEqual(parseRegulation('följande. På Kungsgatans norra sida får fordon inte parkeras. Förbudet gäller Torsdagar jämn vecka 05-07.').bans, [{ w: 4, a: 300, b: 420, p: 'even' }]);
  assert.deepEqual(parseRegulation('följande. 1 § Inom det område får fordon parkeras. 2 § Parkering är dock förbjuden under tiden vardag mellan klockan 24.00 - 08.00.').bans, [{ dt: ['vardag', 'fore'], a: 0, b: 480 }]);
  assert.deepEqual(parseRegulation('följande. 1 § Inom det område får fordon parkeras under högst 24 tim i följd. 2 § Parkering är dock förbjuden under tiden vardag mellan klockan 24.00 - 08.00. 3 § Förbudet i paragraf 2 gäller endast personbil klass II.').bans, []);
  assert.deepEqual(parseRegulation('följande. På Järnvägsgatans norra sida får fordon parkeras mot avgift klockan 16.00 - 19.00. Avgiftsplikten gäller vardag utom vardag före sön- och helgdag. Avgift enligt taxa för zon C.').feeWindows, [{ a: 960, b: 1140, dt: ['vardag'] }]);
});
test('QA 8 Nov round 5: "Parkering är dock tillåten <hours>" after a ban, season dash at a line break', () => {
  const a = parseRegulation('följande. På markerad sträcka på Becksjudarvägen enligt kartbild får fordon inte parkeras. Parkering är dock tillåten mot avgift onsdag klockan 07.00 - 19.00 och vardag före sön- och helgdag klockan 11.00 - 17.00. Avgift enligt taxa 1.');
  assert.deepEqual(a.bans, []); assert.deepEqual(a.allowOnly, [{ w: 3, a: 420, b: 1140 }, { dt: ['fore'], a: 660, b: 1020 }]); assert.deepEqual(a.feeWindows, a.allowOnly);
  const b = parseRegulation('följande. På Becksjudarvägen får fordon inte stannas eller parkeras under tiden vardag utom vardag före sön- och helgdag klockan 07.00 - 19.00. Parkering är dock tillåten mot avgift under onsdag klockan 07.00 - 19.00 och vardag före sön- och helgdag klockan 11.00 - 19.00.');
  assert.deepEqual(b.bans.map((w) => w.w), [1, 2, 4, 5]); assert.ok(b.bans.every((w) => w.a === 420 && w.b === 1140));
  const c = parseRegulation('följande. På Gamla Värmdövägen får fordon inte parkeras under tiden vardag utom vardag före sön- och helgdag klockan 07.00 - 19.00. Parkering är dock tillåten mot avgift under tiden onsdag klockan 07.00 - 19.00 och vardag utom vardag före sön- och helgdag klockan 11.00 - 17.00.');
  assert.equal(c.unread.length, 0); assert.ok(!c.bans.some((w) => w.w === 3)); // an exception on exactly the ban's own day types cuts it (QA 11 Nov round 14; was grey since round 5)
  const d = parseRegulation('följande. På Gustav III:s boulevard får fordon parkeras mot avgift.\n\nParkering är dock förbjuden fredag klockan 10.00 - 14.00 udda veckor under augusti -\njuni.');
  assert.deepEqual(d.bans, [{ w: 5, a: 600, b: 840, m: [[8, 1], [6, 30]], p: 'odd' }]);
});
test('QA 8 Nov round 5: an exception on "4 tisdagen i månaden" leaves the all-day ban (allowed-only hours stay plain)', () => {
  assert.deepEqual(parseRegulation('följande. På Rosenbergsgatans sydvästra sida får fordon inte parkeras. Parkering är dock tillåten under tiden 4 tisdagen i månaden klockan 08.00 - 18.00.').bans, [{ a: 0, b: 1440 }]);
});
test('QA 8 Nov round 6: "vardagar 07.00 till 17.00 utom dag före …", heavy subject with the word lost', () => {
  assert.deepEqual(parseRegulation('följande. 1 § På Stenhamraskolans vändplan får fordon inte parkeras. 2 § Förbudet gäller vardagar 07.00 till 17.00 utom dag före sön- och helgdag.').bans, [{ dt: ['vardag'], a: 420, b: 1020 }]);
  assert.equal(parseRegulation('följande. 1 § På Kärleksgatan får med totalvikt över 3,5 ton inte parkeras. 2 § Förbudet gäller vardag utom vardag före sön- och helgdag mellan klockan 00.00 – 06.00.').heavyOnly, true);
});
test('QA 8 Nov round 7: charging bays are reserved, placement-only house-number sentences are ignored', () => {
  const a = parseRegulation('följande. 1 § På Mellersta Stenbocksgatan, parkering vid idrottens hus enligt markering i kartbild ska vara laddplats. 2 § Under vardagar utom vardag före sön- och helgdag mellan klockan 08.00 - 22.00 får fordon parkeras endast mot avgift.');
  assert.equal(a.reserved, true); assert.equal(a.reservedFor, 'laddning');
  const b = parseRegulation('följande. 1 § De markerade platser väster om Biblioteksgatan ska vara laddplats. 2 § På laddplatsen får fordon som kan laddas externt med elektrisk energi för fordonets framdrivning parkeras. 3 § Tillåtelsen i 2§ gäller parkering enbart under den tid som laddning pågår.');
  assert.equal(b.reservedFor, 'laddning'); assert.deepEqual(b.unread, []);
  const c = parseRegulation('följande. På Stationsplan enligt kartbild får endast fordon som kan laddas externt med elektrisk energi parkeras.');
  assert.equal(c.reservedFor, 'laddning');
  assert.equal(parseRegulation('följande. På Storgatan får fordon inte parkeras. Förbudet gäller inte laddplatser.').reserved, false);
  const d = parseRegulation('följande. På Åkerbyvägen får fordon parkeras under högst 3 tim i följd. Tillåtelsen gäller följande sidor. Med husnr 362-382 gäller hussidan. med nr 320-330 gäller södra sidan. Tidsbegränsningen gäller under tiden vardag utom vardag före sön- och helgdag klockan 06.00 - 22.00, vardag före sön- och helgdag klockan 06.00 - 22.00 och sön- och helgdag klockan 06.00 - 22.00. Övrig tid får fordon inte parkeras.');
  assert.deepEqual(d.unread, []); assert.equal(d.bans.length, 2);
});
test('QA 9 Nov round 8: bare "Övrig tid parkeringsförbud." bans the hours outside the limit; "06.00 - 06.00" is round the clock', () => {
  const a = parseRegulation('följande. På markerade sträckor på Klockargårdsvägen enligt kartbild får fordon parkeras under högst 4 tim i följd. Tidsbegränsningen gäller under tiden vardag utom vardag före sön- och helgdag klockan 08.00 - 22.00, vardag före sön- och helgdag klockan 08.00 - 22.00 och sön- och helgdag klockan 08.00 - 22.00. Övrig tid parkeringsförbud.');
  assert.deepEqual(a.unread, []); assert.ok(a.bans.length > 0);
  assert.ok(a.bans.every((b) => !(b.a < 1320 && b.b > 480 && b.a < b.b)));
  const b = parseRegulation('följande. 1 § På Kärrvägen får fordon inte stannas eller parkeras. 2 § Förbudet gäller klockan 06.00 - 06.00 8 juni - 30 juni.');
  assert.equal(b.bans.length, 1); assert.equal(b.bans[0].a, 0); assert.equal(b.bans[0].b, 1440);
});
test('QA 9 Nov round 8: "Övrig del av året gäller parkeringsförbud" bans the rest of the year only', () => {
  const r = parseRegulation('följande. På Gruvvägen får fordon parkeras under högst 24 tim i följd under tiden 1 juli – 30 september. Övrig del av året gäller parkeringsförbud.');
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[10, 1], [6, 30]] }]); assert.deepEqual(r.unread, []);
});
test('QA 9 Nov round 9: a weekly ban outside the limit hours means parking is otherwise allowed (no allowed-only hours)', () => {
  const r = parseRegulation('följande. 1 § På rödmarkerad sträcka på Sörbyvägen enligt kartbilaga 1 får fordon, med avvikelse från Örebro kommuns lokala trafikföreskrifter 1880 2026:01207 om förbud att parkera på Tamarinden, parkeras. 5 § Tillåtelsen i 1 § gäller högst 3 timmar i följd under tiden - vardagar utom vardag före sön- och helgdag mellan klockan 08.00 och 20.00. 6 § Parkering är dock förbjuden torsdag mellan klockan 00.00 och 09.00.');
  assert.deepEqual(r.allowOnly, []); assert.equal(r.limits.length, 1); assert.deepEqual(r.bans, [{ w: 4, a: 0, b: 540 }]);
});
test('QA 9 Nov round 9: "Övrig tid är parkering tillåten under högst 5 minuter" after permission hours over midnight', () => {
  const r = parseRegulation('följande. 1 § På S:t Johannesgatan enligt kartbilaga får fordon, med avvikelse från Uppsala kommuns lokala trafikföreskrifter (0380 2018 : 118) om parkering inom centrala Uppsala, parkeras. 2 § Tillåtelsen gäller under tiden vardag utom vardag före sön- och helgdag mellan klockan 18.00 – 07.00, vardag före sön- och helgdag mellan klockan 00.00 – 24.00 och sön- och helgdag mellan klockan 00.00 – 24.00. 3 § Övrig tid är parkering tillåten under högst 5 minuter i följd.');
  assert.deepEqual(r.allowOnly, []); assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 420, b: 1080, max: 5 }]); assert.deepEqual(r.unread, []);
});
test('QA 9 Nov round 9: "får motorcykel parkeras" is a motorcycle bay; Ystad placement sentence ignored', () => {
  const r = parseRegulation('följande. På markerad sträcka av 5 meter på S:t Persgatans sydöstra sida enligt kartbild får motorcykel parkeras under högst 24 tim i följd vardag utom dag före sön- och helgdag. Övrig tid får motorcykel parkeras.');
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'motorcykel'); assert.deepEqual(r.unread, []);
  const y = parseRegulation('följande. 1 § På Stortorget får endast sådant fordon parkeras som används för befordran av rörelsehindrad med parkeringstillstånd enligt 13 kap. 8 § trafikförordningen (1998:1276). 2 § Tillåtelsen gäller under tiden vardag utom vardag före sön- och helgdag mellan klockan 08.00 - 18.00 och vardag före sön- och helgdag mellan klockan 08.00 - 15.00 under högst 3 tim i följd. 3 § Tillåtelsen gäller på särskilt anordnad parkeringsplats.');
  assert.deepEqual(y.unread, []); assert.ok(y.limits.every((w) => w.dt));
});

test('"får fordon, parkeras där stannande och parkering är förbjuden": a stray comma, still a fee permission, not a ban (QA 9 Nov round 10: Eskilstuna Gredbyvägen)', () => {
  const r = parseRegulation(wrap('1 § Inom ett område (På sydvästra sidan av Gredbyvägen på den anlagda ytan utanför körbanan i särskilt markerade parkeringsfickor) får fordon, parkeras där stannande och parkering är förbjuden enligt trafikförordningen (1998:1276) 3 kap 52§ andra stycket. 2 § Avgift ska betalas för parkering enligt taxa gällande för biljettområde CN1. Avgiftsplikten gäller vardag utom vardag före sön- och helgdag mellan klockan 08.00 - 20.00 och vardag före sön- och helgdag 08.00 - 15.00.'));
  assert.equal(r.permitted, true); assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 480, b: 1200 }, { dt: ['fore'], a: 480, b: 900 }]);
});

test('season "1/12 till 31/3" (slash dates with "till") limits the ban to the season (QA 10 Nov: Vimmerby Rönnbärsgatan night ban drawn all year)', () => {
  const r = parseRegulation(wrap('1 § På Rönnbärsgatans norra sida får fordon inte parkeras mellan klockan 22.00 och 08.00 alla dagar under tiden 1/12 till 31/3 årligen.'));
  assert.deepEqual(r.bans, [{ a: 1320, b: 480, m: [[12, 1], [3, 31]] }]);
});

test('a second "Avgift enligt taxa F …" sentence adds its hours to taxa G\'s (QA 10 Nov: Örebro Drottninggatan had no fee on Saturday evenings)', () => {
  const r = parseRegulation(wrap('På Drottninggatan får fordon parkeras mot avgift. Avgift enligt taxa G på vardagar utom dag före sön- och helgdag mellan klockan 08.00 och klockan 18.00 samt på vardagar före sön- och helgdag mellan klockan 09.00 och klockan 13.00. Avgift enligt taxa F på vardagar före sön och helgdag mellan klockan 18.00 och klockan 22.00.'));
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 480, b: 1080 }, { dt: ['fore'], a: 540, b: 780 }, { dt: ['fore'], a: 1080, b: 1320 }]);
  assert.deepEqual(r.unread, []);
});

test('"Övrig tid se parkering." is a pointer to the sign, not an unread rule (QA 10 Nov: Vimmerby)', () => {
  const r = parseRegulation(wrap('1 § På Xgatan får fordon inte parkeras mellan klockan 22.00 och 08.00 alla dagar under tiden 1/12 till 31/3. Övrig tid se parkering.'));
  assert.deepEqual(r.unread, []); assert.deepEqual(r.bans, [{ a: 1320, b: 480, m: [[12, 1], [3, 31]] }]);
});

test('bare "Gäller <days>" after a ban or a limit refers to it (QA 10 Nov round 12: Växjö)', () => {
  const r = parseRegulation('följande. 1 § På Sandgärdsgatan i Växjö får fordon inte stannas eller parkeras. 2 § Gäller vardagar mellan kl.11.00-05.00, lördag och dag före helgdag kl. 09.00-05.00 samt söndag och helgdag kl. 00.00-24.00.');
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 660, b: 300 }, { dt: ['fore'], a: 540, b: 300 }, { dt: ['helgdag'], a: 0, b: 1440 }]);
  assert.deepEqual(r.unread, []);
  const l = parseRegulation('följande. 1 § På X i Växjö får fordon parkeras under högst 2 tim i följd. 2 § Gäller vardagar utom dag före helgdag kl 09.00-18.00 samt dag före helgdag kl 09.00-14.00.');
  assert.deepEqual(l.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 120 }, { dt: ['fore'], a: 540, b: 840, max: 120 }]);
});

test('"Tillåtelsen gäller även personbil klass I under högst N timmar … mellan <date> och <date>" adds a limit period (QA 10 Nov round 12: Tanum)', () => {
  const r = parseRegulation('följande. 1 § På Coop parkeringen får personbil klass I parkeras. 2 § Tillåtelsen i 1 § gäller mellan 15 juni och 15 augusti under tiden 09.00 och 18.00 under högst 2 timmar i följd mot avgift. 3 § Avgiften i i 2 § är 20 kronor per timme. 5 § Tillåtelsen gäller även personbil klass I under högst 2 timmar i följd mellan 16 augusti och 14 juni, under tiden 08.00-20.00 och utan avgift.');
  assert.deepEqual(r.limits, [{ a: 540, b: 1080, m: [[6, 15], [8, 15]], max: 120 }, { a: 480, b: 1200, m: [[8, 16], [6, 14]], max: 120 }]);
  assert.equal(parseRegulation('följande. På X får fordon parkeras. Tillåtelsen gäller även fordon som används av boende i området.').limits.length, 0);
});

test('"jämn måndag" is a Monday of even weeks (QA 10 Nov round 12: Örebro Södra Lindhult)', () => {
  const r = parseRegulation('följande. På X får fordon parkeras. Parkering är dock förbjuden under tiden 1:a maj - 31:a oktober jämn måndag klockan 09.00 - 13.00 och 1:a november - 30:e april måndag klockan 00.00 - 06.00.');
  assert.deepEqual(r.bans, [{ w: 1, a: 540, b: 780, m: [[5, 1], [10, 31]], p: 'even' }, { w: 1, a: 0, b: 360, m: [[11, 1], [4, 30]] }]);
});

test('"får fordon med avvikelse från <TF> (1998:1276), med avvikelse från <area ban list>, parkeras" is read (QA 10 Nov round 13: Kalmar Unionsgatan)', () => {
  const r = parseRegulation('följande. 1 § På X får fordon med avvikelse från 3 kap. 53 § 2 trafikförordningen (1998:1276) ), med avvikelse från Kalmar kommuns lokala trafikföreskrifter ( 0880 2017 : 17 ) om område med förbud att parkera fordon på A, B och C, parkeras under högst 24 tim i följd under tiden vardagar utom vardag före sön- och helgdag. 2 § Parkering är dock tillåten endast mot avgift under tiden vardagar och vardag före sön- och helgdag mellan klockan 09.00 - 18.00. 4 § Avgiften är enligt Taxa 3, enligt bestämmelserna om avgifter för parkering i Kalmar kommuns lokala trafikföreskrifter.');
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }]);
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag', 'fore'], a: 540, b: 1080 }]);
});

test('"Förbudet gäller onsdag - söndag v 30, måndag - söndag v 31 och måndag v 32" keeps week 31 (QA 10 Nov round 13: Rättvik Pilgatan)', () => {
  const r = parseRegulation('följande. 1 § På X får fordon inte stannas eller parkeras. 2 § Förbudet gäller onsdag - söndag v 30, måndag - söndag v 31 och måndag v 32.');
  assert.ok(r.bans.some((b) => !b.w && b.wk && b.wk[0] === 31 && b.a === 0 && b.b === 1440));
  assert.equal(r.bans.length, 7);
});

test('"får endast bussar stanna eller parkera" reserves the curb (QA 10 Nov round 13: Kiruna Malmvägen)', () => {
  const r = parseRegulation('följande. På X får endast bussar stanna eller parkera i högst 15 minuter.');
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'buss'); assert.deepEqual(r.limits, []);
});

test('"Parkering är förbjuden övrig tid" after a limit with hours bans only outside them (QA 10 Nov round 13: Umeå Plangatan)', () => {
  const r = parseRegulation('följande. 1 § På X får fordon parkeras högst 15 minuter i följd. 2 § Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag klockan 09.00 - 18.00 samt vardag före sön- och helgdag klockan 09.00 - 15.00. 3 § Parkering är förbjuden övrig tid.');
  assert.ok(!r.bans.some((b) => !b.dt && b.a === 0 && b.b === 1440));
  assert.deepEqual(r.bans.find((b) => b.dt && b.dt.includes('helgdag')), { dt: ['helgdag'], a: 0, b: 1440 });
});

test('"förbjuden under tiden 1:a november och 30:e april" is a season (QA 11 Nov round 14: Örebro Hagagatan)', () => {
  const r = parseRegulation('följande. 1 § På X får fordon parkeras. 6 § Parkering är dock förbjuden under tiden 1:a november och 30:e april.');
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[11, 1], [4, 30]] }]);
});

test('an exception on the same day types as the ban cuts it (QA 11 Nov round 14: Nacka Gamla Värmdövägen)', () => {
  const r = parseRegulation('följande. På X får fordon inte parkeras under tiden vardag utom vardag före sön- och helgdag klockan 07.00 - 19.00. Parkering är dock tillåten mot avgift under tiden onsdag klockan 07.00 - 19.00 och vardag utom vardag före sön- och helgdag klockan 11.00 - 17.00. Avgift enligt taxa 1.');
  assert.deepEqual(r.unread, []);
  assert.ok(!r.bans.some((b) => b.w === 3));
  assert.deepEqual(r.bans.filter((b) => b.w === 1), [{ w: 1, a: 420, b: 660 }, { w: 1, a: 1020, b: 1140 }]);
});

test('a day-type exception that does not match the ban\'s day types stays grey', () => {
  const r = parseRegulation('följande. På X får fordon inte parkeras klockan 07.00 - 19.00. Parkering är dock tillåten vardag utom vardag före sön- och helgdag klockan 11.00 - 17.00.');
  assert.ok(r.unread.length > 0);
});

test('"Avgiftsplikten gäller vardagar 09.00 - 18.00 och …" without "klockan" gives the fee hours (QA 11 Nov round 14: Visby Schweitzergränd)', () => {
  const r = parseRegulation('följande. 1§ För parkering på markerade platser vid X ska avgift erläggas. 2§ Fordon får parkeras högst 24 timmar i följd. 3§ Avgiftsplikten gäller vardagar 09.00 - 18.00 och vardag före sön- och helgdag 09.00-14.00. 4§ Avgiften är enligt taxa A.');
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }, { dt: ['fore'], a: 540, b: 840 }]);
});

test('weeks at the end of a ban list belong to every part (QA 11 Nov round 14: Rättvik Knihsgatan)', () => {
  const r = parseRegulation('följande. 1 § På X får inte fordon stannas eller parkeras. 2 § Förbudet gäller torsdag klockan 07.00 - 24.00, fredag och lördag klockan 08.00 - 12.00 och söndag klockan 00.00 - 17.30 vecka 18 och vecka 40.');
  assert.equal(r.bans.length, 8);
  assert.ok(r.bans.every((b) => b.wk && (b.wk[0] === 18 || b.wk[0] === 40)));
  assert.deepEqual(r.bans.find((b) => b.w === 5 && b.wk[0] === 40), { w: 5, a: 480, b: 720, wk: [40, 40] });
});

test('"Förbudet gäller klockan 07.00 - 16.00 11 juni" is a ban on that date only (QA 11 Nov round 14: Strängnäs Bataljonsgatan)', () => {
  const r = parseRegulation('följande. 1 § Inom X får fordon inte stannas eller parkeras. 2 § Förbudet gäller klockan 07.00 - 16.00 11 juni.');
  assert.deepEqual(r.bans, [{ a: 420, b: 960, m: [[6, 11], [6, 11]] }]);
});

test('hours after "får endast tung lastbil parkeras" are the reserved hours; other times are open (QA 11 Nov round 14: Tyresö Radiovägen)', () => {
  const r = parseRegulation('följande. 1 § På X får endast tung lastbil parkeras. 2 § Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag klockan 16.00 - 08.00, vardag före sön- och helgdag klockan 00.00 - 24.00 samt sön- och helgdag klockan 00.00 - 24.00.');
  assert.equal(r.reserved, true); assert.equal(r.otherAllowed, true);
  assert.deepEqual(r.reservedWindows[0], { dt: ['vardag'], a: 960, b: 480 });
});

test('a disabled bay with hours stays reserved around the clock', () => {
  const r = parseRegulation('följande. 1 § På X får endast fordon som används för befordran av rörelsehindrad med parkeringstillstånd parkeras. 2 § Tillåtelsen gäller vardag klockan 08.00 - 18.00.');
  assert.notEqual(r.otherAllowed, true);
});

test('"Förbudet gäller under tiden 1 sept – 1 juni" is a season, not 1 June (QA 11 Nov round 14: Sollefteå Kyrkvägen)', () => {
  const r = parseRegulation('följande. På X får fordon inte stannas eller parkeras. Förbudet gäller under tiden 1 sept – 1 juni.');
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[9, 1], [6, 1]] }]);
});

test('hours after a seasonal ban stay inside the season (QA 11 Nov round 14: Sundbyberg Oskarsvägen)', () => {
  const r = parseRegulation('följande. På X får fordon inte stannas eller parkeras under tiden 13 oktober och 8 december. Förbudet gäller under tiden vardagar utom vardag före sön- och helgdag klockan 15.00 - 20.00.');
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 900, b: 1200, m: [[10, 13], [12, 8]] }]);
});

test('"RT90 2.5 gon V 0:-15" is not week 0 (QA 11 Nov round 14: Västervik Hallströmsgatan)', () => {
  const r = parseRegulation('följande. 1 § På X i koordinatsystemet RT90 2.5 gon V 0:-15 (mellan A och B får fordon parkeras vardag utom dag före sön- och helgdag högst 24 tim i följd.)');
  assert.ok(r.limits.length && r.limits.every((l) => !l.wk));
});

test('a comma before the week list: "söndag klockan 00.00 - 19.00, vecka 18 och vecka 40" (QA 11 Nov round 14: Rättvik Kvarngatan)', () => {
  const r = parseRegulation('följande. 1 § På X får fordon inte stannas eller parkeras. 2 § Förbudet gäller fredag klockan 07.00 - 24.00, lördag klockan 00.00 - 24.00, söndag klockan 00.00 - 19.00, vecka 18 och vecka 40.');
  assert.equal(r.bans.length, 6); assert.ok(r.bans.every((b) => b.wk));
});

test('"Tillåtelsen gäller onsdag - söndag vecka 30, måndag - söndag vecka 31 och måndag vecka 32" limits every listed week (QA 11 Nov round 14: Rättvik Riksvägen)', () => {
  const r = parseRegulation('följande. 1 § Inom X får fordon parkeras under högst 2 tim i följd. 2 § Tillåtelsen gäller onsdag - söndag vecka 30, måndag - söndag vecka 31 och måndag vecka 32.');
  assert.equal(r.limits.length, 7);
  assert.ok(r.limits.some((l) => !l.w && l.wk[0] === 31 && l.max === 120));
  assert.ok(r.limits.some((l) => l.w === 1 && l.wk[0] === 32));
});

test('a bare "Gäller endast buss." after a permission reserves the curb, also joined by a comma (QA 11 Nov round 15: Växjö Kvarnvägen)', () => {
  let r = parseRegulation(wrap('1 § På Kvarnvägen inom följande område i Åby, vändplatsen i dess norra ände, får fordon parkeras högst 24 timmar i följd, Gäller endast buss.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'buss'); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § På Torggatan får fordon parkeras. Föreskriften gäller endast motorcykel.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'motorcykel');
  r = parseRegulation(wrap('1 § På Torggatan får fordon parkeras högst 2 tim. Gäller endast personbil.'));
  assert.equal(r.reserved, false); assert.equal(r.limits[0].max, 120);
});

test('"får motordrivet fordon med tillkopplat släpfordon parkeras" is a bay for cars with trailers (QA 11 Nov round 15: Lysekil Fiskebäckskil)', () => {
  const r = parseRegulation(wrap('1 § På Fiskebäckskilsvägen inom följande område i Fiskebäckskil (inom fastigheten Skaftö-Fiskebäck 1:383 enligt kartbilaga) får motordrivet fordon med tillkopplat släpfordon parkeras under högst 8 dygn i följd mot avgift under tiden 15 juni - 15 augusti.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'fordon med släp'); assert.deepEqual(r.reservedSeason, [[6, 15], [8, 15]]); assert.deepEqual(r.unread, []);
});

test('"Övrig tid får personbil parkeras" after a klass I night permission: cars may park at all times (QA 12 Nov round 17: Helsingborg Palmqvistgatan)', () => {
  const r = parseRegulation(wrap('1 § På parkeringsområdet på Palmqvistsgatan enligt kartbild får endast personbil klass I parkeras. 2 § Tillåtelsen gäller under tiden vardag utom vardag före sön- och helgdag mellan klockan 22.00 - 06.00, vardagar före sön- och helgdag mellan klockan 22.00 – 06.00 och sön- och helgdag mellan klockan 22.00 – 06.00. 3 § Övrig tid får personbil parkeras.'));
  assert.deepEqual(r.allowOnly, []); assert.equal(r.otherAllowed, true); assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
});

test('"Förbudet gäller endast under perioden … mellan kl. …" after an odd-date ban: the hours and season of that ban (QA 12 Nov round 17: Östersund Torgbrinken)', () => {
  const r = parseRegulation(wrap('På Torgbrinkens nordvästra sida mellan Rådhusgatan och Brunflovägen får fordon inte parkeras under udda datum. Förbudet gäller endast under perioden 1 oktober till 31 maj mellan kl. 00.00-07.00.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 420, dd: 'odd', m: [[10, 1], [5, 31]] }]); assert.deepEqual(r.unread, []);
});

test('old decision form without "föreskriver följande" ("Föreskrift … § 1 På … § 2 …"): the rules are read from § 1 (QA 12 Nov round 18: Svedala Svetsaregatan)', () => {
  const r = parseRegulation('Beslut om Lokal Trafikföreskrift inom Svedala kommun Beslutsdatum 2007-02-05 Plats SVETSAREGATAN Föreskrift FÖRBUD ATT PARKERA FORDON § 1 På Svetsaregatan, södra sidan från Norra Ellenborgsgatan och 85 m österut får fordon inte parkeras. § 2 Förbudet gäller vardagar, utom dag före sön- och helgdag mellan kl 07.00 och 16.00. Ikraftträdande 2007-02-19 Giltig tom Lagrum 10 kap. 1 § andra stycket 12');
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 420, b: 960 }]); assert.deepEqual(r.unread, []);
});

test('a "Villkoret gäller - … klockan 09.00-15.00" list without a full stop does not run into the next sentence (QA 12 Nov round 18: Örnsköldsvik Lasarettsgatan)', () => {
  const r = parseRegulation(wrap('1 § På Lasarettsgatans västra sida får fordon, med avvikelse från Örnsköldsviks kommuns lokala trafikföreskrifter 2284 2023:00077 om förbud att parkera i centrala Örnsköldsvik, parkeras. 2 § Tillåtelsen att parkera i 1 § gäller dock högst 3 timmar i följd och mot avgift. Villkoret gäller -vardagar utom vardag före sön- och helgdag klockan 09.00-18.00 och -vardag före sön- och helgdag klockan 09.00-15.00 Avgiften i 2 § är enligt taxa 2 enligt bestämmelserna om avgifter för parkering i Örnsköldsviks kommuns lokala trafikföreskrifter (2284 2023:00078) Med avvikelse från bestämmelserna i 1 § får fordon på sträckan inte parkeras vardagar utom vardag före sön- och helgdag klockan 02.00- 08.00, vardag före sön- och helgdag klockan 02.00- 08.00 och sön- och helgdag klockan 02.00- 08.00 och udda datum'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 180 }, { dt: ['fore'], a: 540, b: 900, max: 180 }]);
  assert.ok(r.bans.every((b) => b.a === 120 && b.b === 480 && b.dd === 'odd')); assert.equal(r.bans.length, 3); assert.deepEqual(r.unread, []);
});

test('"Undantag från §1 … mellan klockan 02 och 04 då parkeringsförbud gäller" is a ban, not an ignorable remark: left unread (QA 12 Nov round 18: Nynäshamn Nickstabadsvägen)', () => {
  const r = parseRegulation(wrap('1 § På parkeringsytan öster om Nickstabadsvägen får fordon parkeras. 2 § Undantag från 1 § på vardagar utom vardag före sön- och helgdag mellan klockan 02 och 04 då parkeringsförbud gäller.'));
  assert.equal(r.unread.length, 1);
});

test('hours written without "klockan" ("vardagar 8-18 på vardagar och 8-15 på lördagar") are read as Mon–Fri and Saturday hours (QA 12 Nov round 18 left them unread; sweep batch 4: Svedala Storgatan)', () => {
  const r = parseRegulation(wrap('1 § På Storgatan får fordon parkeras under högst 1 timme. 2 § Tidsbegränsningen gäller vardagar 8-18 på vardagar och 8-15 på lördagar. I övrigt fritt.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 60 }, { dt: ['fore'], a: 480, b: 900, max: 60 }]); assert.deepEqual(r.unread, []);
});

test('seasonal permission departing from an area ban: banned the rest of the year (QA 12 Nov round 19: Sundsvall Storgatan)', () => {
  const r = parseRegulation(wrap('1 § På Storgatans södra sida, enligt markering på kartbild, får fordon , med avvikelse från Sundsvalls kommuns lokala trafikföreskrifter (2281 2010-00002) om förbud att parkera i\nCentrum, under tiden 1 oktober - 30 april parkeras mot avgift. 2 § Tillåtelsen gäller under högst 2 tim i följd. 4 § Parkering är dock förbjuden onsdag klockan 00.00 - 07.00.'));
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.bans, [{ w: 3, a: 0, b: 420 }, { a: 0, b: 1440, m: [[5, 1], [9, 30]] }]);
  const q = parseRegulation(wrap('På Storgatan får fordon parkeras mot avgift under tiden 1 oktober - 30 april.'));
  assert.deepEqual(q.bans, []); // no area ban named: outside the season the general rules apply
});

test('"Tidsbegränsningen i 1 § gäller vardag utom … mellan klocka 08.00- 17.00": the hours of the 1 § limit, "klocka" a typo (QA 13 Nov round 20: Gävle Ulvsätersvägen)', () => {
  const r = parseRegulation(wrap('1 § På Ulvsätersvägen får fordon parkeras högst 20 minuter i följd. 2 § Tidsbegränsningen i 1 § gäller vardag utom vardag före sön- och helgdag mellan klocka 08.00- 17.00.'));
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1020, max: 20 }]);
  const q = parseRegulation(wrap('1 § På Storgatan får fordon inte parkeras. 2 § Förbudet i 1 § gäller inte enskild väg.'));
  assert.deepEqual(q.bans, [{ a: 0, b: 1440 }]); // not a time: untouched
});

test('which side by house number ("Tillåtelsen gäller följande sidor: Vid husnr 271-291 avses västra sidan.") is where, not when (QA 13 Nov round 20: Täby Marknadsvägen)', () => {
  const r = parseRegulation(wrap('1 § På Marknadsvägen får fordon parkeras under högst 1 timme. Tidsbegränsningen gäller klockan 06.00 - 22.00. Tillåtelsen gäller följande sidor: Vid husnr 271-291 avses västra sidan. Vid husnr 31- 49 avses östra sidan. Övrig tid får fordon inte parkeras.'));
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.bans.map((b) => [b.a, b.b]), [[0, 360], [1320, 1440]]);
});

test('"förbjuden … vardag före sön- och helgdag klockan 14.00 - 08.00 och sön- och helgdag.": the last day type without hours is banned all day (QA 13 Nov round 20: Vänersborg Torget)', () => {
  const r = parseRegulation(wrap('På Torget får fordon parkeras under högst 3 tim i följd. Tidsbegränsningen gäller under tiden vardag utom vardag före sön- och helgdag klockan 08.00 - 20.00 och vardag före sön- och helgdag klockan 08.00 - 14.00. Parkering är dock förbjuden under tiden vardag utom vardag före sön- och helgdag klockan 20.00 - 08.00, vardag före sön- och helgdag klockan 14.00 - 08.00 och sön- och helgdag.'));
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 1200, b: 480 }, { dt: ['fore'], a: 840, b: 480 }, { dt: ['helgdag'], a: 0, b: 1440 }]);
});

test('"Första två timmarna är avgiftsfria med elektronisk biljett" is a fee discount: read, and not taken as free parking (QA 13 Nov round 21: Huddinge Sjödalsvägen)', () => {
  const body = '1 § På Sjödalsvägen enligt markering på kartbild får fordon, med avvikelse från Huddinge kommuns lokala trafikföreskrifter (0126 2022:54) om förbud att parkera inom ett område i centrala Huddinge, parkeras mot avgift. 2 § Avgift ska betalas för parkering enligt 1 §. Avgiftsplikten gäller vardag utom vardag före sön- och helgdag mellan klockan 08.00 - 17.00. 4 § Första två timmarna är avgiftsfria med elektronisk biljett från betalautomat eller telefonbetalning.';
  const r = parseRegulation(wrap(body));
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.bans, []);
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 480, b: 1020 }]);
  assert.ok(!/avgiftsfri/i.test(dropFreeFirstHours(body)));
  assert.ok(!/avgiftsfri/i.test(dropFreeFirstHours('Den första timmen är avgiftsfri och kan nyttjas en gång per kalenderdygn.')));
  assert.ok(/avgiftsfri/i.test(dropFreeFirstHours('Parkeringen är avgiftsfri.')));
});

test('"Avgiftsplikten gäller …" after "mot avgift under tiden <hours>" gives the fee hours (QA 13 Nov round 22: Nacka Tor Boijes gata)', () => {
  const r = parseRegulation(wrap('På markerad sträcka på Tor Boijes gata enligt kartbild får fordon parkeras under högst 4 tim i följd mot avgift under tiden vardag före sön- och helgdag klockan 07.00 - 21.00, vardag utom vardag före sön- och helgdag klockan 07.00 - 21.00 och sön- och helgdag klockan 07.00 - 21.00. Parkering är dock förbjuden under tiden måndag klockan 08.00 - 12.00. Avgiftsplikten gäller under tiden vardag utom vardag före sön- och helgdag klockan 07.00 - 19.00 och vardag före sön- och helgdag klockan 11.00 - 17.00. Avgift enligt taxa 1, 2 § allmänna föreskrifter taxor.'));
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 420, b: 1140 }, { dt: ['fore'], a: 660, b: 1020 }]);
  assert.equal(r.limits.length, 3);
});

test('"Avgiften är enligt Taxa 2, vardag utom vardag före sön- och helgdag, enligt …": the fee\'s days (QA 13 Nov round 22: Värnamo)', () => {
  const r = parseRegulation(wrap('På den del av parkeringen (markerade platser) väster om Järnvägsgatan som anges i kartan i bilagan till dessa föreskrifter får fordon parkeras mot avgift. 2 § Avgiften är enligt Taxa 2, vardag utom vardag före sön- och helgdag, enligt bestämmelserna om avgifter för parkering i Värnamo kommuns lokala trafikföreskrifter ( 0683 2025 : 31 ) om parkeringstaxor i Värnamo.'));
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.feeWindows, [{ a: 0, b: 1440, dt: ['vardag'], daysOnly: true }]);
  assert.equal(r.taxa, 2);
});

test('"Förbudet gäller under tiden jämna veckor." after a ban: that week parity only (QA 14 Nov round 23: Falun)', () => {
  const r = parseRegulation(wrap('På Zinkstigens södra sida på blåmarkerad sträcka enligt kartbild får fordon inte parkeras. Förbudet gäller under tiden jämna veckor.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, p: 'even' }]); assert.deepEqual(r.unread, []);
});

test('a seasonal "Tillåtelsen i 1 § … gäller mellan <date> och <date>" departing from an area ban: banned the rest of the year (QA 14 Nov round 23: Sotenäs)', () => {
  const r = parseRegulation(wrap('1 § Med avvikelse från Sotenäs kommuns lokala trafikföreskrifter (1427 2010:00116) om förbud att parkera fordon i området Smögen får fordon parkeras på Kyrkogatan. 2 § Trots tillåtelsen i 1 § får dock fordon parkeras på Kyrkogatan högst 24 timmar i följd vardagar utom vardagar före sön- och helgdag. 3 § Tillåtelsen i 1 § och villkoren i 2 § gäller mellan 1 september och 31 maj.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440, m: [[9, 1], [5, 31]] }]);
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[6, 1], [8, 31]] }]); assert.deepEqual(r.unread, []);
  const r2 = parseRegulation(wrap('På Kyrkogatan får fordon parkeras. Tillåtelsen gäller mellan 1 september och 31 maj.'));
  assert.deepEqual(r2.bans, []); // no area ban to fall back on: nothing invented
});

test('quoted 3 kap. 49 a § 24-hour rule: Mon–Fri limit, and not a second rule set (Norrköping)', () => {
  const q = 'Tillåtelsen i 1 § anger inte rätt att parkera fordon i strid mot 3 kap. 49 a § trafikförordningen (1998:1276): På allmän plats inom tättbebyggt område där kommunen är huvudman för hållande av allmänna platser och inom vägområde för allmän väg får fordon parkeras högst 24 timmar i följd på vardagar, utom vardag före sön- och helgdag.';
  const body = wrap(`1 § På Eternellvägens nordvästra sida mellan 81 meter och 29 meter nordöst om Finspångsvägen samt Stensvängens norra sida mellan Pildammsvägen och Lagersbergsvägen enligt kartbild får fordon parkeras. 2 § ${q}`);
  const r = parseRegulation(body);
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.unread, []);
  const t = dropGeneralRuleQuote(body);
  assert.ok(!/49 a/.test(t) && /får fordon parkeras\. 2 §/.test(t));
  assert.equal((t.match(/får fordon/g) || []).length, 1);
});

test('dated periods with a year: the last day, so an ended temporary rule counts as expired', () => {
  assert.equal(datedPeriodEnd(wrap('På Nya torg och Storgatan får fordon inte stannas eller parkeras under 27 april 2026 - 30 april 2026 mellan klockan 21.00 - 06.00 samt 4 maj 2026 - 8 maj 2026 21.00 - 06.00.')), '2026-05-08');
  assert.equal(datedPeriodEnd(wrap('1 § På Älvängsvägen, Kalix får fordon inte parkeras Förbudet gäller 20 mars 2019.')), '2019-03-20');
  assert.equal(datedPeriodEnd(wrap('På Lilla Norregatan får fordon inte stannas eller parkeras. Förbudet gäller under tiden 20 november 2023 - 25 november 2023.')), '2023-11-25');
  assert.equal(datedPeriodEnd(wrap('1 § På Folkskolegatan får fordon inte stannas eller parkeras vardag utom vardag före sön- och helgdag mellan klockan 06.00 – 17.00 2 § Förbudet gäller under tiden 2 december 2016 – 23 december 2016 och 2 januari 2017 – 27 januari 2017.')), '2017-01-27');
  assert.equal(datedPeriodEnd(wrap('På Kyrkogatan får fordon inte parkeras under tiden 1 juni - 31 augusti.')), null); // yearly season, no year
  assert.equal(datedPeriodEnd('Föreskriften träder i kraft den 15 september 2000. ' + wrap('På Torget får fordon parkeras högst 2 tim.')), null);
});

test('limit with the hours before the day types, and a glued paragraph sign ("Tillåtelsen i 1§ gäller dock …")', () => {
  let r = parseRegulation(wrap('1 § På parkeringsplatsen får fordon parkeras. 2 § Tillåtelsen i 1§ gäller dock högst 4 timmar i följd mellan klockan 9-16, vardagar utom vardag före söndag och helgdag. 3 § Parkeringsskiva eller motsvarande ska användas.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 960, max: 240 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På parkeringsplatsen får fordon parkeras under högst 4 timmar i följd mellan klockan 8 och 18 vardagar utom dag före sön- och helgdag och mellan klockan 8 och 15 vardag före sön- och helgdag. Parkeringsskiva eller motsvarande ska användas.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 240 }, { dt: ['fore'], a: 480, b: 900, max: 240 }]);
});

test('a permission for one season with nothing about the rest of the year is flagged seasonOnly (the line goes grey)', () => {
  let r = parseRegulation(wrap('1 § På Hörnellgatan enligt kartbilaga får fordon parkeras under tiden 1 oktober - 30 april. 2 § Avgift ska betalas för parkering enligt 1 §. 3 § Parkering är dock förbjuden onsdag mellan klockan 00.00 - 07.00 under tiden 1 oktober - 30 april.'));
  assert.deepEqual(r.seasonOnly, [[10, 1], [4, 30]]);
  r = parseRegulation(wrap('På gatan får fordon parkeras 15 april – 15 oktober. Övrig tid får fordon inte parkeras.'));
  assert.equal(r.seasonOnly, undefined); // the rest of the year is stated: a ban
  r = parseRegulation(wrap('1 § På Sjövägen får fordon parkeras under högst 2 tim i följd under tiden 15 maj - 15 augusti och 08.00 - 18.00. 2 § Under tiden 16 augusti-14 juni får fordon parkeras 24 timmar.'));
  assert.equal(r.seasonOnly, undefined); // both seasons have rules
});

test('"får fordon med rörelsehindrade som är innehavare av parkeringstillstånd enligt 13 kap. 8 § … parkeras" is a disabled bay (QA round 26: Uppsala, Örebro)', () => {
  let r = parseRegulation(wrap('På 2 markerade platser på Torsgatans lokalkörbana enligt kartbild får fordon med rörelsehindrade som är innehavare av parkeringstillstånd enligt 13 kap. 8 § trafikförordningen (1998:1276) parkeras under högst 4 tim i följd. Fordon som inte får parkeras får inte heller stannas annat än för på- och avstigning.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'rörelsehindrade'); assert.deepEqual(r.limits, []); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På Fotbollsgatan enligt kartbild får fordon med rörelsehindrade som är innehavare av parkeringstillstånd enligt 13 kap. 8 § trafikförordningen (1998:1276), med avvikelse från Örebro kommuns lokala trafikföreskrifter 1880 2024:00584 om förbud att parkera i Heden, parkeras under högst 3 tim i följd. Tidsbegränsningen gäller under tiden vardag utom vardag före sön- och helgdag klockan 08.00 - 21.00. Parkering är dock förbjuden under tiden 1:a november - 30:e april onsdag klockan 00:00 - 06:00.'));
  assert.equal(r.reservedFor, 'rörelsehindrade'); assert.deepEqual(r.bans, [{ w: 3, a: 0, b: 360, m: [[11, 1], [4, 30]] }]);
});

test('typo "vardar" reads as vardagar (QA round 26: Lidingö)', () => {
  const r = parseRegulation(wrap('1 § På Farkostvägen får fordon parkeras högst 30 minuter i följd. Tidsbegränsningen gäller vardar mellan kl. 07.00–10.00 och mellan kl. 15.00–18.00.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore'], a: 420, b: 600, max: 30 }, { dt: ['vardag', 'fore'], a: 900, b: 1080, max: 30 }]);
});

test('"får endast motordrivet fordon med tillkopplat släpfordon, med avvikelse från …, parkeras högst 6 timmar" is a trailer bay with its own limit (QA round 28: Umeå)', () => {
  const r = parseRegulation(wrap('1 § På Strandpromenadens västra sida enligt röd markering på kartbild får endast motordrivet fordon med tillkopplat släpfordon, med avvikelse från Umeå kommuns lokala trafikföreskrifter (2480 2020:48) om parkeringsförbud, område i centrala Umeå, parkeras högst 6 timmar i följd .'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'fordon med släp'); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 360 }]); assert.deepEqual(r.unread, []);
});

test('"Tillåtelsen gäller 30 april - 30 september. Övrig tid får fordon inte parkeras." bans the rest of the year (QA round 28: Kalmar)', () => {
  const r = parseRegulation(wrap('1 § På östra sidan av Kalmarsundsparken får endast personbil parkeras under högst 6 tim i följd under vardagar, vardagar före sön- och helgdag och sön- och helgdag mellan klockan 08.00 - 20.00. 2 § Tillåtelsen gäller 30 april - 30 september. 3 § Övrig tid får fordon inte parkeras.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[10, 1], [4, 29]] }]);
  assert.deepEqual(r.allowOnly, [{ dt: ['vardag', 'fore', 'helgdag'], a: 480, b: 1200 }]);
});

test('"Tillåtelsen gäller inte vid personbil klass II under tiden …" is a motorhome rule, not a night ban for all cars (QA 16 Nov round 29: Falkenberg)', () => {
  const r = parseRegulation(wrap('På markerade sträckor på Läroverksgatan enligt kartbild får fordon parkeras. Tillåtelsen gäller inte vid personbil klass II under tiden vardag klockan 22.00 - 08.00, vardag före sön- och helgdag klockan 22.00 - 08.00 och sön- och helgdag klockan 22.00 - 08.00.'));
  assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
});

test('"ska de särskilt anordnade platserna … vara laddplatser" is a charging bay (QA 16 Nov round 30: Söderköping)', () => {
  const r = parseRegulation(wrap('1 § På parkeringsplats Kanal Väst ska de särskilt anordnade platserna inom det område som anges i kartan vara laddplatser. 2 § På laddplatserna får endast fordon som kan laddas externt med elektrisk energi för fordonets framdrivning parkeras. 3 § Mellan klockan 08-22.00 alla dagar är parkering tillåten högst 4 tim i följd.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'laddning'); assert.deepEqual(r.unread, []);
});

test('"Tillåtelsen gäller inte husbilar och husvagnar" is a motorhome rule (QA 16 Nov round 30: Borgholm)', () => {
  const r = parseRegulation(wrap('1 § På Hamnvägen i Borgholm, inom zonen Yttre hamnen, på platser utmärkta med författningsenliga vägmärken, får personbil klass I parkeras. 2 § Tillåtelsen gäller inte husbilar och husvagnar.'));
  assert.deepEqual(r.bans, []); assert.equal(r.reserved, false); assert.deepEqual(r.unread, []);
});

test('"får inga fordon parkeras" is a parking ban (QA 16 Nov round 30: Laxå)', () => {
  const r = parseRegulation(wrap('På Smedjegatans båda sidor, får inga fordon parkeras.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(r.unread, []);
});

test('"får fordon parkeras under maj - september" with nothing about the rest of the year is season-only (QA 16 Nov round 30: Boden)', () => {
  const r = parseRegulation(wrap('1 § På södra sidan av Kvarngatan i Boden får fordon parkeras under maj - september. 2 § Avgift ska betalas för parkering enligt 1§.'));
  assert.deepEqual(r.seasonOnly, [[5, 1], [9, 30]]);
});

test('the same day type twice with overlapping hours is a slip in the text: flagged, both ranges read (QA 16 Nov round 30: Hässleholm, Helsingborg)', () => {
  const r = parseRegulation(wrap('På markerade sträckor på Tredje Avenyen enligt kartbild får fordon parkeras under högst 2 tim i följd mot avgift under tiden vardag utom vardag före sön- och helgdag klockan 09.00 - 18.00 och vardag utom vardag före sön- och helgdag klockan 09.00 - 15.00.'));
  assert.equal(r.textSlip, true); assert.deepEqual(r.unread, []); assert.equal(r.limits.length, 2); // flagged as a slip (the line goes grey in rdt-reparse) and still read with both ranges, the stricter reading (21 Nov: left unread, Stockholm lost the limit)
  const ok = parseRegulation(wrap('På Storgatan får fordon parkeras under högst 2 tim i följd under tiden vardag utom vardag före sön- och helgdag klockan 07.00 - 09.00 och vardag utom vardag före sön- och helgdag klockan 16.00 - 18.00.'));
  assert.equal(ok.textSlip, undefined); assert.equal(ok.limits.length, 2);
});

test('"får fordon inte parkeras längre än 12 timmar" is a longest stay, not a ban (QA 16 Nov round 31: Lidingö Kalvhagsvägen)', () => {
  const r = parseRegulation(wrap('1 § På parkeringsplatsen vid Kalvhagsvägen 2A får fordon inte parkeras längre än 12 timmar. Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276).'));
  assert.deepEqual(r.bans, []); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 720 }]);
  const r2 = parseRegulation(wrap('Utanför skolan får inte fordon parkeras längre tid än 15 minuter.'));
  assert.deepEqual(r2.bans, []); assert.equal(r2.limits[0].max, 15);
});

test('"mellan klockan 00.00 06.00" with the dash lost is still a time range (QA 16 Nov round 31: Kalix Köpmannagatan)', () => {
  const r = parseRegulation(wrap('1 § På norra sidan av Köpmannagatan får fordon parkeras under högst 3 tim i följd vardag utom vardag före sön- och helgdag mellan klockan 09.00 – 18.00. 2 § Parkering är dock förbjuden under 1 oktober – 30 april mellan klockan 00.00 06.00.'));
  assert.deepEqual(r.unread, []); assert.deepEqual(r.bans, [{ a: 0, b: 360, m: [[10, 1], [4, 30]] }]);
});

test('"<days> klockan 09.00 – 18.00 gäller dock tillåtelsen att parkera mot att avgift erläggs eller högst 1 timme … parkeringsskiva": fee hours, no limit for whoever pays (QA 16 Nov round 31: Ängelholm, reparse drops the register\'s limit)', () => {
  const r = parseRegulation(wrap('Inom rödmarkerat område på Södra Vägen enligt kartbild får fordon parkeras. Vardagar utom vardag före sön- och helgdag klockan 09.00 – 18.00 gäller dock tillåtelsen att parkera mot att avgift erläggs eller högst 1 timme i följd mot användande av parkeringsskiva eller motsvarande. Avgift enligt taxa zon 2.'));
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }]); assert.deepEqual(r.limits, []); assert.deepEqual(r.unread, []);
});

test('"får fordon inte parkeras Under tiden 4:e tisdagen … får dock fordon parkeras" with the full stop lost: the ban holds all the time, not only in the exception\'s hours (QA 17 Nov round 32: Helsingborg Kurirgatan)', () => {
  const r = parseRegulation(wrap('På Kurirgatans västra sida enligt kartbild får fordon inte parkeras Under tiden 4:e tisdagen i månaden klockan 08.00 - 18.00 får dock fordon parkeras.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(r.unread, []);
  const r2 = parseRegulation(wrap('På Allévägens södra sida enligt kartbild får fordon inte parkeras Förbudet gäller inte buss i linjetrafik.'));
  assert.deepEqual(r2.bans, [{ a: 0, b: 1440 }]);
});

test('a fee named only in the repealed regulation\'s title is no fee (QA 17 Nov round 32: Växjö Trädgårdsgatan 5 min bay)', () => {
  const body = 'Växjö kommun föreskriver följande. På norra sidan av Trädgårdsgatan i Växjö får fordon parkeras under högst 5 min i följd. Denna författning träder i kraft den 1 juli 2021 då Växjö kommuns lokala trafikföreskrifter (0780 2009:00663) om parkering utan avgift på Trädgårdsgatan i Växjö ska upphöra att gälla.';
  assert.equal(/avgift/i.test(dropRepealSentences(body)), false);
  assert.match(dropRepealSentences('På Storgatan får fordon parkeras mot avgift. Denna författning träder i kraft den 1 maj 2020.'), /mot avgift/);
});

test('a fee rule named in a deviation clause is not a repealed title (dropRepealSentences keeps it)', () => {
  assert.match(dropRepealSentences('1 § Vid Hamngatan 2 får endast MC, med avvikelse från lokala trafikföreskrifter (0484 2017 : 176) om parkering mot avgift parkeras där stannande är förbjudet enligt trafikförordningen (1998:1276) Denna författning träder i kraft den 1 maj 2017.'), /mot avgift/);
  assert.doesNotMatch(dropRepealSentences('Fordon får parkeras högst 2 tim. Genom denna författning upphävs lokala trafikföreskrifter (0980 2012 : 81) om avgiftsbelagd parkering på Ryska gränd.'), /avgift/);
});

test('"Övrig tid får parkering ske högst 8h i följd" is a limit outside the stated hours (QA 17 Nov round 33: Upplands Väsby Ryttargatan)', () => {
  const r = parseRegulation(wrap('1 § Inom Ryttargatan enligt markering på kartbild får fordon parkeras högst 15 minuter i följd. 2 § Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag klockan 07.00 - 17.00. 3 § Parkeringsskiva eller motsvarande ska användas. 4 § Övrig tid får parkering ske högst 8h i följd.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 420, b: 1020, max: 15 }, { dt: ['vardag'], a: 0, b: 420, max: 480 }, { dt: ['vardag'], a: 1020, b: 1440, max: 480 }, { dt: ['fore', 'helgdag'], a: 0, b: 1440, max: 480 }]);
  const r2 = parseRegulation(wrap('På Storgatan får fordon parkeras högst 15 minuter i följd vardagar klockan 07.00 - 17.00. Övrig tid får parkering ske utan tidsbegränsning.'));
  assert.equal(r2.limits.length, 1);
});

test('"klockan 09,00- 18.00" and "bestämmelserna i § 1" (QA 17 Nov round 33: Örnsköldsvik Apoteksgränd)', () => {
  const r = parseRegulation(wrap('1 § På Apoteksgränds norra sida får fordon, med avvikelse från Örnsköldsviks kommuns lokala trafikföreskrifter 2284 2023:00077 om förbud att parkera i centrala Örnsköldsvik, parkeras. 2 § Tillåtelsen att parkera i 1 § gäller dock högst 3 timmar i följd och mot avgift. Villkoret gäller - vardagar utom vardag före sön- och helgdag mellan klockan 09,00- 18.00, och - vardag före sön- och helgdag mellan klockan 09.00- 15.00. Avgiften i 2 § är enligt taxa 2. Med avvikelse från bestämmelserna i § 1 får fordon på sträckan inte parkeras vardagar utom vardag före sön- och helgdag klockan 02.00 - 08.00, vardag före sön- och helgdag klockan 02.00 - 08.00, sön- och helgdag klockan 02.00 - 08.00 och jämna datum.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 180 }, { dt: ['fore'], a: 540, b: 900, max: 180 }]);
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }, { dt: ['fore'], a: 540, b: 900 }]);
  assert.equal(r.bans.length, 3);
});

test('"får tungt släpfordon inte parkeras" concerns heavy trailers only (QA 17 Nov round 34: Bjuv Idrottsvägen)', () => {
  const r = parseRegulation(wrap('På 2:a körfältet från körbanans sydvästra sida på Idrottsvägen ( på särskilt markerade sträckor ) får tungt släpfordon inte parkeras. Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276).'));
  assert.equal(r.heavyOnly, true);
  assert.deepEqual(r.bans, []);
  assert.deepEqual(r.unread, []);
});

test('"På vardagar … får dock fordon inte parkeras" is the same place\'s hours, not a second place (QA 17 Nov round 34: Täby Östra Banvägen; multiPart in rdt-reparse.mjs)', () => {
  const r = parseRegulation(wrap('På parkeringsplatsen på Östra Banvägen mellan Centralvägen, Ytterby grindväg och Näsbylundsvägen får fordon parkeras. På vardagar utom vardag före sön- och helgdag klockan 02.00 - 05.00 får dock fordon inte parkeras'));
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 120, b: 300 }]);
  assert.equal(r.permitted, true);
  assert.deepEqual(r.unread, []);
});

test('"får tvåhjulig motorcykel och moped klass I utan sidvagn, med avvikelse från …, parkeras" is a motorcycle bay (QA 18 Nov round 35: Knivsta Järnvägstorget)', () => {
  const r = parseRegulation(wrap('1 § På pendlarparkering Järnvägstorget, på markerad plats inom område som framgår av blå markering i kartbilaga, får tvåhjulig motorcykel och moped klass I utan sidvagn, med avvikelse från Knivsta kommuns lokala trafikföreskrifter (0330 2019 : 052) om förbud att parkera på gator i centrala Knivsta, parkeras.Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Parkering är dock tillåten under högst 48 tim i följd. 3 § Avgift behöver ej erläggas.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'motorcykel');
  assert.deepEqual(r.unread, []);
  const r2 = parseRegulation(wrap('På Storgatan får moped, motorcykel, personbil klass I och traktor a parkeras under högst 2 tim i följd.'));
  assert.equal(r2.reserved, false);
});

test('"får endast foodtrucks / servicefordon parkeras" reserves the curb (QA 18 Nov round 35: Gotland Holmen showed a 3 h limit for all cars)', () => {
  const r = parseRegulation(wrap('1 § På del av Holmen i Visby får endast foodtrucks parkeras under högst 3 tim i följd.'));
  assert.equal(r.reserved, true); assert.deepEqual(r.unread, []);
  const r2 = parseRegulation(wrap('På parkeringsområde vid Kvarngatan, enligt plats som framgår av blå markering i kartbilaga, får endast servicefordon parkeras.'));
  assert.equal(r2.reserved, true); assert.deepEqual(r2.unread, []);
});

test('"Tillåtelsen enligt §1 gäller inte peronbil klass 2" is a motorhome rule (QA 18 Nov round 35: Sotenäs Smögen)', () => {
  const r = parseRegulation(wrap('1 § Med avvikelse från Sotenäs kommuns lokala trafikföreskrifter (1427 2010:00116) om förbud att parkera fordon i området Smögen får fordon parkeras på Klevenvägen inom det område som markerats med rött på kartan i bilagan till dessa föreskrifter. 2 § Mellan klockan 0 och 24 gäller dock tillåtelsen i 1 § mot avgift. 4 § Avgiften i 2 § är 35 kronor per timma. 5 § Tillåtelsen enligt §1 gäller inte peronbil klass 2 mellan 00-06. 6 § Tillåtelsen i 1 § och villkoren i 2-5 §§ gäller mellan 1 juni och 31 augusti.'));
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[9, 1], [5, 31]] }]);
});

test('"Förbudet att parkera i paragraf gäller vardagar mellan klockan 24.00 - 07.00, …": no paragraph number (QA 18 Nov round 35: Uppsala Hällbygatan)', () => {
  const r = parseRegulation(wrap('1 § På Hällbygatan inom markerat område enligt bifogad kartbild, får fordon inte parkeras. 2 § Förbudet att parkera i paragraf gäller vardagar mellan klockan 24.00 - 07.00, vardag före sön- och helgdag 24.00 - 07.00 och sön- och helgdag 24.00 - 07.00.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 0, b: 420 }, { dt: ['fore'], a: 0, b: 420 }, { dt: ['helgdag'], a: 0, b: 420 }]);
  assert.deepEqual(r.unread, []);
});

test('a stopping ban in the active voice "får fordon inte stanna" and "får inte heller stannas" (QA 18 Nov round 36: Storfors Rörverksgatan had no stopping ban)', () => {
  assert.ok(STOPPING.test('att från och med 2010-07-01 får fordon inte stanna längs Rörverksgatan.'));
  assert.ok(STOPPING.test('får fordon inte parkeras, får inte heller stannas annat än för på- och avstigning'));
  assert.ok(!STOPPING.test('Förbudet ger inte rätt att parkera där det är förbjudet enligt trafikförordningen.'));
});

test('a seasonal stopping ban that departs from an area parking ban keeps the area ban the rest of the year; delivery/authorised-traffic exemptions are not car rules (QA 18 Nov round 36: Halmstad innerstad)', () => {
  const r = parseRegulation(wrap('På samtliga vägar och torg inom området Halmstads innerstad enligt kartbild får fordon, med avvikelse från Halmstads kommuns lokala trafikföreskrifter 1380 2021:00106 om förbud att parkera inom ett område i Innerstaden i Halmstad, inte stannas eller parkeras. Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Förbudet gäller under tiden 1:a juni - 31:a augusti. Förbudet gäller inte leveransfordon klockan 03.00-11.00 alla dagar. Förbudet gäller inte heller behörig trafik.'));
  assert.deepEqual(r.unread, []);
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]);
  const r2 = parseRegulation(wrap('På Storgatan får fordon inte parkeras. Förbudet gäller under tiden 1 juni - 31 augusti. Förbudet gäller inte leveransfordon.'));
  assert.deepEqual(r2.bans, [{ a: 0, b: 1440, m: [[6, 1], [8, 31]] }]);
  const r3 = parseRegulation(wrap('1 § På Albäcksgatan får fordon, med avvikelse från Sundsvalls kommuns lokala trafikföreskrifter (2281 2010-00850) om förbud att parkera fordon (datumzon) i Sundsvall, inte parkeras under tiden 1 december - 30 april.'));
  assert.deepEqual(r3.bans, [{ a: 0, b: 1440, m: [[12, 1], [4, 30]] }]);
  const r4 = parseRegulation(wrap('1 § På Repslagarevägens norra sida enligt markering på kartbild får fordon, med avvikelse från Sundsvalls kommuns lokala trafikföreskrifter (2281 2024:483) om förbud att parkera inom område Alliero, parkeras. 2 § Parkering är dock förbjuden 1 december - 30 april.'));
  assert.deepEqual(r4.bans, [{ a: 0, b: 1440, m: [[12, 1], [4, 30]] }]);
});

test('"Tillåtelsen i 1 § och villkoren i 2 § gäller …" + "… villkoren i 3 § gäller …": each season goes to the paragraph it names (QA 18 Nov round 37: Sotenäs Hamngatan)', () => {
  const r = parseRegulation(wrap('1 § På anvisade parkeringsplatser väster om Hamngatan får fordon parkeras. 2 § Trots tillåtelsen i 1 § får dock fordon parkeras högst 24 timmar i följd vardagar utom vardagar före sön- och helgdag. 3 § Mellan klockan 8 och 20 gäller dock tillåtelsen i 1 § högst 3 timmar i följd mot avgift eller högst en timma i följd mot användande av parkeringsskiva eller motsvarande. 4 § Avgiften i 3 § är 35 kronor per timma. 5 § Tillåtelsen i 1 § och villkoren i 2 § gäller mellan 1 september och 31 maj. 6 § Tillåtelsen i 1 § och villkoren i 3 § gäller mellan 1 juni och 31 augusti.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440, m: [[9, 1], [5, 31]] }, { a: 480, b: 1200, max: 180, m: [[6, 1], [8, 31]] }]);
  assert.deepEqual(r.feeWindows, [{ a: 480, b: 1200, m: [[6, 1], [8, 31]] }]);
});

test('"får fordon stannas under högst 24 tim i följd" is a longest stay at all times (QA 18 Nov round 37: Gotland Mellangatan)', () => {
  const r = parseRegulation(wrap('1 § På Mellangatan i Visby får fordon stannas under högst 24 tim i följd. 2 § Avgift enligt Taxa A under tiden vardagar mellan klockan 09.00 – 18.00 och vardagar före sön- och helgdag mellan klockan 09.00 – 14.00.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.unread, []);
  assert.equal(r.feeWindows.length, 2);
});

test('"På samtliga gator inom markerat område gäller dock förbud att parkera onsdagar …" is the same area\'s ban, not a second place (QA 18 Nov round 37: Örebro Älvtomta; multiPart in rdt-reparse.mjs)', () => {
  const r = parseRegulation(wrap('På samtliga gator och vägar inom området Älvtomta enligt kartbild får fordon parkeras under högst 3 tim i följd under tiden vardagar utom vardag före sön- och helgdag klockan 08.00 - 20.00. På samtliga gator inom markerat område gäller dock förbud att parkera onsdagar kl 00.00-06.00.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1200, max: 180 }]);
  assert.deepEqual(r.bans, [{ w: 3, a: 0, b: 360 }]);
  assert.deepEqual(r.unread, []);
});

test('"får lastbil och släpvagn / buss och lastbil parkeras under högst N" is a truck or bus bay with its own limit (QA 19 Nov round 38: Helsingborg Maskinistgatan showed the 7-day truck limit for all cars)', () => {
  const r = parseRegulation(wrap('På Maskinistgatans nordvästra sida enligt kartbild får lastbil och släpvagn parkeras under högst 7 dygn i följd.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'lastbil');
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 10080 }]); assert.deepEqual(r.unread, []);
  const b = parseRegulation(wrap('På markerad sträcka på Prästgatan enligt kartbild får buss och lastbil parkeras under högst 30 min i följd.'));
  assert.equal(b.reserved, true); assert.equal(b.reservedFor, 'buss');
  const f = parseRegulation(wrap('På Storgatan får fordon parkeras under högst 2 tim i följd.'));
  assert.equal(f.reserved, false);
});

test('round 39: "2 § § Tidsbegränsningen och avgiftsplikten gäller …" — a doubled paragraph sign still gives the limit and fee hours', () => {
  const r = parseRegulation(wrap('1 § På Stortorget får fordon parkeras under högst 4 tim i följd och mot avgift. 2 § § Tidsbegränsningen och avgiftsplikten gäller under vardag utom vardag före sön- och helgdag mellan klockan 09.00 - 16.00 och vardag före sön- och helgdag mellan klockan 10.00 - 14.00. 3 § Övrig tid får fordon parkeras.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 960, max: 240 }, { dt: ['fore'], a: 600, b: 840, max: 240 }]);
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 960 }, { dt: ['fore'], a: 600, b: 840 }]);
  assert.deepEqual(r.unread, []);
});

test('round 39: "Förbudet gäller måndag mellan klockan 08.12 under tiden …" — unread hours are not a whole-season ban', () => {
  const r = parseRegulation(wrap('På Islinge Hamnväg får fordon inte parkeras. Förbudet gäller måndag mellan klockan 08.12 under tiden 1 december - 30 april.'));
  assert.equal(r.unread.length, 1);
  assert.ok(!r.bans.some((b) => b.m && !b.w));
});

test('round 39: "får tung lastbil och släpkärra parkeras under högst 24 tim … Övrig tid får tung lastbil och släpkärra parkeras" is a truck bay', () => {
  const r = parseRegulation(wrap('1 § På Tycho Hedéns väg får tung lastbil och släpkärra parkeras under högst 24 tim i följd under vardagar utom vardag före sön- och helgdag. 2 § Övrig tid får tung lastbil och släpkärra parkeras.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'lastbil'); assert.deepEqual(r.unread, []);
});

test('round 40: "Tillståndet gäller under tiden 1 september - 31 maj" is the permission\'s season (area ban the rest of the year)', () => {
  const r = parseRegulation(wrap('På markerad sträcka på Skolgatans östra sida enligt kartbild med avvikelse från Halmstads kommuns lokala trafikföreskrifter 1380 2021:00106 om förbud att parkera inom ett område i innerstaden i Halmstad får fordon parkeras under högst 15 min i följd. Tillståndet gäller under tiden 1 september - 31 maj.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 15, m: [[9, 1], [5, 31]] }]);
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[6, 1], [8, 31]] }]);
  assert.deepEqual(r.unread, []);
});

test('round 40: fee windows per weekday become day types (måndag - lördag 22-06 samt söndag)', () => {
  const r = parseRegulation(wrap('1 § På Vega allé får fordon parkeras mot avgift. 2 § Avgift ska betalas för parkering enligt 1 §. Avgiftsplikten gäller måndag - lördag klockan 22.00 - 06.00 samt söndag klockan 00.00 - 24.00.'));
  assert.deepEqual(weekdaysAsDayTypes(r.feeWindows), [{ a: 1320, b: 360, dt: ['vardag'] }, { a: 1320, b: 360, dt: ['fore'] }, { a: 0, b: 1440, dt: ['helgdag'] }]);
  const partial = [{ w: 1, a: 480, b: 600 }, { w: 3, a: 480, b: 600 }];
  assert.deepEqual(weekdaysAsDayTypes(partial), partial); // not every weekday: left as it is
});

test('round 40: "vardagar, utom dag före sön- och helgdag" names Mon–Fri; a weekday before "utom" can\'t be drawn', () => {
  assert.equal(utomForeOnly('3 § Parkeringsförbuden gäller vardagar, utom dag före sön- och helgdag, mellan klockan 7 och 17'), 'vardag');
  assert.equal(utomForeOnly('3 § Förbuden gäller tisdagar, utom vardag före sön- och helgdag, mellan klockan 7 och 16'), 'weekday');
  assert.equal(utomForeOnly('vardagar utom vardag före sön- och helgdag 8-18 och vardag före sön- och helgdag 8-14'), null);
  assert.equal(utomForeOnly('Förbudet gäller vardagar klockan 8-18'), null);
});

test('QA 20 Nov: "får husvagnar/husbilar parkeras högst 24 timmar" is a bay for them, not a 24 h limit for every car; a lot with "övriga platser" stays unread', () => {
  let r = parseRegulation(wrap('På Mejerigatan norr om och längs med gatan 2st platser, får husvagnar parkeras högst 24 timmar i följd.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'husbil'); assert.deepEqual(r.limits, []); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På Artillerigatan på tre rödmarkerade platser enligt kartbilaga får husbilar och husvagnar parkeras under högst 24 tim i följd.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'husbil');
  r = parseRegulation(wrap('På parkeringsplatsen invid Sofielundsvägen 1 får endast husvagnar parkeras på de två nordligaste platserna, under tre månader i följd. På övriga platser får fordon parkeras under högst sju dygn i följd.'));
  assert.equal(r.reserved, false); assert.equal(r.unread.length, 1);
});

test('QA 20 Nov: the typo "kockan" reads as "klockan" (Sala: "högst 2 tim i följd kockan 09.00-19.00. Övrig tid får inte fordon parkeras")', () => {
  const r = parseRegulation(wrap('På Bråstagatan får fordon parkeras. Parkering är dock tillåten under högst 2 tim i följd kockan 09.00-19.00. Övrig tid får inte fordon parkeras.'));
  assert.deepEqual(r.limits, [{ a: 540, b: 1140, max: 120 }]); assert.deepEqual(r.allowOnly, [{ a: 540, b: 1140 }]); assert.deepEqual(r.unread, []);
});

test('QA 20 Nov round 2: "Övrig tid förbud att parkera" / "Övrig tid råder förbud mot parkering" ban the hours outside the permission (Lidingö Pyrolavägen showed free nights)', () => {
  let r = parseRegulation(wrap('På Pyrolavägen delen 75 meter norr om Almvägen-Linnéavägen får fordon parkeras högst 15 minuter alla dagar klockan 8-24. Övrig tid förbud att parkera.'));
  assert.deepEqual(r.limits, [{ a: 480, b: 1440, max: 15 }]); assert.deepEqual(r.allowOnly, [{ a: 480, b: 1440 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På markerad sträcka på Köpmangatan enligt kartbild får fordon parkeras under högst 15 min i följd under tiden vardag klockan 07.00 - 21.00, vardag före sön- och helgdag klockan 07.00 - 21.00 och sön- och helgdagar klockan 07.00 - 21.00. Övrig tid råder förbud mot parkering inom zon.'));
  assert.equal(r.allowOnly.length, 3); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På Ekvägen får fordon parkeras högst 15 minuter klockan 07.30 - 08.30. All övrig tid råder förbud att parkera mot färdriktningen.'));
  assert.deepEqual(r.allowOnly, []); // a ban against the driving direction only: not a ban on the other hours
});

test('QA 20 Nov round 2: "vardagar mellan klockan 8-19 och dag före sön- och helgdag 8-15" gives Saturday its own hours (Vaggeryd)', () => {
  const r = parseRegulation(wrap('På Järnvägsgatan får fordon parkeras under högst 1 timme i följd vardagar mellan klockan 8-19 och dag före sön- och helgdag 8-15.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1140, max: 60 }, { dt: ['fore'], a: 480, b: 900, max: 60 }]);
});

test('QA 20 Nov round 3: one time range with its day type after it closes the sentence ("ändamålsplats … mellan klockan 09-18 under vardagar utom vardag före …", Gävle Norra Köpmangatan)', () => {
  let r = parseRegulation(wrap('1 § På Norra Köpmangatans västra sida enligt markering på kartbild ska det vara ändamålsplats för lastning eller lossning av tungt eller skrymmande gods mellan klockan 09-18 under vardagar utom vardag före sön- och helgdag. 2 § Övrig tid får fordon parkeras.'));
  assert.deepEqual(r.purpose, [{ dt: ['vardag'], a: 540, b: 1080 }]);
  r = parseRegulation(wrap('På Ågatan får fordon inte parkeras mellan klockan 09-18 under vardagar utom vardag före sön- och helgdag.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 540, b: 1080 }]);
});

test('sweep waves 1–8: "Övrig tid får fordon parkeras under högst N tim" after a loading zone is a limit outside the loading hours (Stockholm Perstorpsvägen, Mäster Samuelsgatan, Trollesundsvägen)', () => {
  let r = parseRegulation(wrap('På Perstorpsvägens västra sida mellan Åbrovägen och Ekebergabacken på de 15 meter som anges på kartan ska vara ändamålsplats för lastning och lossning vardagar utom vardag före sön- och helgdag klockan 07.00 - 19.00. Övrig tid får fordon parkeras under högst 3 tim i följd.'));
  assert.deepEqual(r.purpose, [{ dt: ['vardag'], a: 420, b: 1140 }]);
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 420, max: 180 }, { dt: ['vardag'], a: 1140, b: 1440, max: 180 }, { dt: ['fore', 'helgdag'], a: 0, b: 1440, max: 180 }]);
  assert.deepEqual(r.unread, []); assert.equal(r.otherAllowed, true);
  // with a fee and a night ban after it
  r = parseRegulation(wrap('Markerad sträcka mellan 0 och 15 meter på Mäster Samuelsgatans norra sida mellan Drottninggatan och Klara Norra Kyrkogata enligt kartbild ska vara ändamålsplats för lastning eller lossning av tungt eller skrymmande gods vardag utom vardag före sön- och helgdag klockan 07.00 - 17.00. Övrig tid får fordon parkeras under högst 1 tim i följd mot avgift. Under tiden fredag klockan 00.00 - 06.00 får dock fordon inte parkeras. Avgift enligt taxa 1, 14 § allmänna lokala trafikföreskrifter.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 420, max: 60 }, { dt: ['vardag'], a: 1020, b: 1440, max: 60 }, { dt: ['fore', 'helgdag'], a: 0, b: 1440, max: 60 }]);
  assert.deepEqual(r.bans, [{ w: 5, a: 0, b: 360 }]); assert.equal(r.taxa, 1); assert.deepEqual(r.unread, []);
  // loading hours on one named weekday: the rest of that day and every other day
  r = parseRegulation(wrap('Mellan 0 och 8 meter på Trollesundsvägens sydvästra sida på den sträcka som anges på kartan ska vara ändamålsplats för lastning eller lossning av tungt eller skrymmande gods onsdag klockan 07.00 - 15.00. Övrig tid får fordon parkeras under högst 15 min i följd.'));
  assert.deepEqual(r.limits.filter((w) => w.w === 3), [{ w: 3, a: 0, b: 420, max: 15 }, { w: 3, a: 900, b: 1440, max: 15 }]);
  assert.equal(r.limits.length, 8); assert.ok(r.limits.every((w) => w.max === 15)); assert.deepEqual(r.unread, []);
  // the segment keeps its loading hours and gets the limit
  const seg = applyRegulation({ t: 0 }, { body: wrap('På Perstorpsvägens västra sida på de 15 meter som anges på kartan ska vara ändamålsplats för lastning och lossning vardagar utom vardag före sön- och helgdag klockan 07.00 - 19.00. Övrig tid får fordon parkeras under högst 3 tim i följd.') });
  assert.deepEqual(seg.k, [{ dt: ['vardag'], a: 420, b: 1140 }]); assert.equal(seg.l.length, 3); assert.equal(seg.ko, 1);
  // a loading zone without the sentence gets no limit; "Övrig tid får fordon parkeras." alone neither
  r = parseRegulation(wrap('På Perstorpsvägens västra sida på de 15 meter som anges på kartan ska vara ändamålsplats för lastning och lossning vardagar utom vardag före sön- och helgdag klockan 07.00 - 19.00. Övrig tid får fordon parkeras.'));
  assert.deepEqual(r.limits, []); assert.deepEqual(r.unread, []);
});

test('sweep wave 1: "Övrig tid råder parkeringsförbud" after a limit on named weekdays bans the other hours and days (Solna Kristinelundsvägen was free at night)', () => {
  const r = parseRegulation(wrap('1 § På Kristinelundsvägen enligt markering på kartbild får fordon parkeras högst 15 minuter i följd . Tillåtelsen ger inte rätt att parkera där det enligt trafikförordningen (1998:1276) är förbjudet att stanna och parkera. 2 § Tidsbegränsningen gäller måndag - fredag mellan klockan 07.00 - 17.00. 3 § Övrig tid råder parkeringsförbud.'));
  assert.equal(r.limits.length, 5); assert.ok(r.limits.every((w) => w.a === 420 && w.b === 1020 && w.max === 15));
  assert.deepEqual(r.bans.filter((w) => w.w === 1), [{ w: 1, a: 0, b: 420 }, { w: 1, a: 1020, b: 1440 }]);
  assert.deepEqual(r.bans.filter((w) => w.w >= 6), [{ w: 6, a: 0, b: 1440 }, { w: 7, a: 0, b: 1440 }]);
  assert.equal(r.bans.length, 12); assert.deepEqual(r.unread, []);
  // weekdays mixed with day types cannot be turned around: unread, as before
  assert.equal(outsideHoursW([{ w: 1, a: 420, b: 1020 }, { dt: ['fore'], a: 420, b: 900 }]), null);
  assert.deepEqual(outsideHoursW([{ dt: ['vardag'], a: 420, b: 1020 }]), [{ dt: ['vardag'], a: 0, b: 420 }, { dt: ['vardag'], a: 1020, b: 1440 }, { dt: ['fore', 'helgdag'], a: 0, b: 1440 }]);
});

test('sweep wave 1: "Förbudet gäller inte vid lastning och lossning av gods" is an exemption that leaves the text fully read (Solna Gustav III:s boulevard: "vardag" 09–12 is Saturdays too)', () => {
  let r = parseRegulation(wrap('På markerade sträckor på Gustav III:s boulevard enligt kartbild får inte fordon stannas eller parkeras under tiden vardag klockan 09.00 - 12.00. Förbudet gäller inte vid lastning och lossning av gods.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag', 'fore'], a: 540, b: 720 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('Inom en zon om ca 30 m rundkörningsslinga på Studievägen får fordon inte stannas eller parkeras mellan kl 07.30 och 08.30. Förbudet gäller inte för på- och avstigning.'));
  assert.deepEqual(r.bans, [{ a: 450, b: 510 }]); assert.deepEqual(r.unread, []);
  // an exemption for loading with its own terms leaves the ban standing too (project 0 batch 3, 22 Nov: Gnesta Kullagatan showed 30 min of free parking)
  r = parseRegulation(wrap('På Kullagatans östra sida får fordon inte stannas eller parkeras. Förbudet gäller ej för lastning och lossning under högst 30 minuter.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(r.unread, []);
  // an exemption for parking is still unread
  r = parseRegulation(wrap('På Kullagatans östra sida får fordon inte stannas eller parkeras. Förbudet gäller inte fordon med nyttoparkeringskort under högst 30 minuter.'));
  assert.equal(r.unread.length, 1);
});

// ---- project 0, sweep findings batch 2 (21 Nov 2026) ----
test('sweep wave 1: "uddda veckor" is a typo for odd weeks (Solna Ankdammsgatan banned every Friday)', () => {
  const r = parseRegulation(wrap('På markerade sträckor på Ankdammsgatan enligt kartbild får fordon parkeras under högst 15 min i följd. Parkering är dock förbjuden fredag klockan 10.00 - 14.00 uddda veckor.'));
  assert.deepEqual(r.bans, [{ w: 5, a: 600, b: 840, p: 'odd' }]); assert.deepEqual(r.unread, []);
});

test('sweep wave 2: "högst15 min" without a space is still a limit (Danderyd Mörbyhöjden lost its morning limit)', () => {
  const r = parseRegulation(wrap('På Mörbyhöjden på de 6 allmänna vinkelräta parkeringsplatserna enligt kartbild får fordon parkeras. Parkering får ske högst15 min i följd vardagar utom dag före sön- och helgdag mellan kl 07.30 - 09.00 Parkering får ske högst 2 timmar i följd vardagar utom dag före sön- och helgdag mellan kl 09.00 - 17.00 då parkeringsskiva skall användas Övrig tid råder fri parkering.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 450, b: 540, max: 15 }, { dt: ['vardag'], a: 540, b: 1020, max: 120 }]); assert.deepEqual(r.unread, []);
});

test('sweep wave 1: a place followed straight by "parkeras" has lost "får fordon"; a seasonal limit with "Övrig tid får fordon inte parkeras" bans the rest of the year (Uppsala Eriksbergsvägen was free in winter)', () => {
  let r = parseRegulation(wrap('1 § På den del av Eriksbergsvägen som anges i kartan parkeras under högst 4 tim i följd. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Tillåtelsen gäller 1 april - 31 oktober. 3 § Övrig tid får fordon inte parkeras.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 240, m: [[4, 1], [10, 31]] }]); assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[11, 1], [3, 31]] }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På markerade sträckor på Tre kronors väg enligt kartbild parkeras under högst 30 min i följd mot avgift under tiden vardag utom vardag före sön- och helgdag klockan 07.00 - 19.00 och vardag före sön- och helgdag klockan 11.00 - 17.00.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 420, b: 1140, max: 30 }, { dt: ['fore'], a: 660, b: 1020, max: 30 }]); assert.equal(r.permitted, true); assert.deepEqual(r.unread, []);
  // a ban or an instruction is not turned into a permission
  r = parseRegulation(wrap('På den del av Storgatan som anges i kartan får fordon inte parkeras.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(r.limits, []);
});

test('sweep wave 1: hours first, each with its day types after a comma (Solna Bagartorpsringen charged Mon–Fri around the clock)', () => {
  const r = parseRegulation(wrap('På markerade sträckor på Bagartorpsringen enligt kartbild får fordon parkeras mot avgift under tiden klockan 18.00 - 07.00, vardag utom dag före sön- och helgdag, klockan 00.00 - 24.00, vardag före sön- och helgdag och sön- och helgdag. Avgift enligt taxa A.'));
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 1080, b: 420 }, { dt: ['fore', 'helgdag'], a: 0, b: 1440 }]); assert.deepEqual(r.unread, []);
});

test('sweep waves 1 and 3: a second hour range keeps the weekdays of the first; "klockan 7-10 samt 15-18" (Upplands Väsby Ryttargatan, Lidingö Kalvhagsvägen, Södertälje Högåsavägen)', () => {
  const wd = (a, b, x = {}) => [1, 2, 3, 4, 5].map((w) => ({ w, a, b, ...x }));
  let r = parseRegulation(wrap('1 § På Ryttargatan enligt markering på kartbild får fordon parkeras högst 30 minuter i följd. 2 § Tidsbegränsningen gäller måndag - fredag mellan klockan 08.00 - 10.00 och 15.00 - 17.00.'));
  assert.deepEqual(r.limits, [...wd(480, 600, { max: 30 }), ...wd(900, 1020, { max: 30 })]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § På parkeringsplatsen vid Kalvhagsvägen 2A får fordon parkeras högst 30 minuter, på måndag till fredag, klockan 7-10 samt 15-18.'));
  assert.deepEqual(r.limits, [...wd(420, 600, { max: 30 }), ...wd(900, 1080, { max: 30 })]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § På Högåsavägen får fordon inte stannas eller parkeras. 2 § Förbudet gäller måndag - fredag klockan 07.30 - 09.00 och 14.00 - 16.30.'));
  assert.deepEqual(r.bans, [...wd(450, 540), ...wd(840, 990)]);
  // a day type before the second range is its own
  r = parseRegulation(wrap('På Storgatan får fordon inte parkeras måndag klockan 08.00 - 10.00 och sön- och helgdag klockan 15.00 - 17.00.'));
  assert.deepEqual(r.bans, [{ w: 1, a: 480, b: 600 }, { dt: ['helgdag'], a: 900, b: 1020 }]);
});

test('sweep waves 1, 9, 10, 14: a permission for one kind of vehicle without "endast" is a bay for that vehicle (Sollentuna Tingsvägen, Växjö Drottninggatan, Uppsala Söderhällbygatan, Eslöv, Sundsvall Hamngatan)', () => {
  let r = parseRegulation(wrap('1 § På västra sidan av Tingsvägen, på två markerade platser vid adressnummer 7, får utryckningsfordon parkeras. 2 § Tillåtelsen gäller under högst 24 tim i följd.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'utryckningsfordon'); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § På Drottninggatan i Växjö, norra sidan, sträckor markerade med rött i kartbild, får taxi i tjänst parkeras under högst 30 min i följd.'));
  assert.equal(r.reservedFor, 'taxi'); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 30 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § På sydvästra sidan av Söderhällbygatan, enligt markering i kartbilagan, får buss i linjetrafik parkeras. 2 § Tillåtelsen gäller 30 min i följd.'));
  assert.equal(r.reservedFor, 'buss'); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § På södra delen av Medborgarhusets parkering i Eslöv, på 2 platser öster om Storgatan, får laddbara fordon parkeras. 2 § Parkering är dock tillåten under högst 4 tim i följd mot avgift.'));
  assert.equal(r.reservedFor, 'laddning'); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § På Hamngatans norra sida enligt markering på kartbild får fordon parkeras högst 2 timmar i följd. 2 § Tillåtelsen gäller buss i linjetrafik.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'buss'); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § Inom parkeringsficka utmed Gustavsbergs allé enligt markering på kartbild får endast buss parkeras högst 15 minuter i följd. 2 § Gäller alla bussar för på,- och avstigning.'));
  assert.equal(r.reservedFor, 'buss'); assert.deepEqual(r.unread, []);
  // "även" adds a vehicle to a permission for all: no reservation
  r = parseRegulation(wrap('På Storgatan får fordon parkeras under högst 2 tim i följd.'));
  assert.equal(r.reserved, false);
});

test('sweep waves 1–3: "Parkeringsförbud övrig tid", "Parkeringsförbud gäller övrig tid", "Stannande- och parkeringsförbud gäller dock måndagar - fredagar …" (Täby Djursholmsvägen, Nacka Diligensvägen, Upplands Väsby)', () => {
  let r = parseRegulation(wrap('På markerad sträcka på Djursholmsvägen enligt kartbild får fordon parkeras under högst 30 min i följd under tiden vardag utom vardag före sön- och helgdag klockan 07.00 - 22.00, vardag före sön- och helgdag klockan 07.00 - 22.00 och sön- och helgdag klockan 07.00 - 22.00. Parkeringsförbud övrig tid.'));
  assert.equal(r.otherAllowed, false); assert.deepEqual(r.allowOnly, [{ dt: ['vardag'], a: 420, b: 1320 }, { dt: ['fore'], a: 420, b: 1320 }, { dt: ['helgdag'], a: 420, b: 1320 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På med rött markerad sträcka på Diligensvägen enligt kartbild får fordon inte stannas eller parkeras. Förbudet gäller under tiden onsdag klockan 08.00 - 16.00 och 15 november - 15 maj. Parkeringsförbud gäller övrig tid.'));
  assert.deepEqual(r.bans, [{ w: 3, a: 480, b: 960, m: [[11, 15], [5, 15]] }, { a: 0, b: 1440 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § Enligt markering på kartbild får fordon parkeras mot avgift. 2 § Avgiftsplikten gäller vardag före sön- och helgdag klockan 10.00 - 15.00. 4 § Stannande- och parkeringsförbud gäller dock måndagar - fredagar mellan klockan 06.00 - 18.00.'));
  assert.deepEqual(r.bans, [1, 2, 3, 4, 5].map((w) => ({ w, a: 360, b: 1080 }))); assert.deepEqual(r.unread, []);
  // "förbud att parkera mot färdriktningen" is about direction, not a ban
  r = parseRegulation(wrap('På markerade sträckor på Lindalsvägens västra sida enligt kartbild får fordon parkeras under högst 15 min i följd under tiden klockan 07.30 - 08.30. All övrig tid råder förbud att parkera mot färdriktningen'));
  assert.deepEqual(r.bans, []); assert.equal(r.unread.length, 1);
});

test('sweep wave 1: "Övrig tid är parkeringen tillåten under högst 5 minuter" after permission hours (Uppsala Götgatan had 5 min around the clock)', () => {
  const r = parseRegulation(wrap('1 § På Götgatan, på markerad sträcka mellan Torsgatan och Skolgatan, får fordon parkeras. 2 § Tillåtelsen gäller under tiden vardag utom vardag före sön- och helgdag mellan klockan 18.00 – 07.00, vardag före sön- och helgdag mellan klockan 18.00 – 07.00 och sön- och helgdagar mellan klockan 18.00 – 07.00. 3 § Övrig tid är parkeringen tillåten under högst 5 minuter i följd.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore', 'helgdag'], a: 420, b: 1080, max: 5 }]); assert.deepEqual(r.allowOnly, []); assert.deepEqual(r.unread, []);
});

test('sweep wave 3: "Övrig tid är parkering tillåten utan avgift och tidsbegränsning": the limit holds in the fee hours only (Danderyd Brovägen)', () => {
  const r = parseRegulation(wrap('På Brovägen på 16 markerade platser får fordon parkeras under högst 4 tim i följd mot avgift. Avgiftsplikten gäller under tiden vardagar klockan 09.00 - 17.00. Övrig tid är parkering tillåten utan avgift och tidsbegränsning'));
  assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore'], a: 540, b: 1020, max: 240 }]); assert.deepEqual(r.feeWindows, [{ dt: ['vardag', 'fore'], a: 540, b: 1020 }]); assert.deepEqual(r.unread, []);
});

test('sweep wave 1: hours of a limit that was stated with a day type keep that day type (Upplands Väsby Holmvägen limited Saturdays and Sundays too)', () => {
  let r = parseRegulation(wrap('På markerade sträckor på Holmvägen enligt kartbild får fordon parkeras. Tillåtelsen gäller under tiden vardag utom dag före sön- och helgdag och under högst 2 tim iföljd. Tidsbegränsningen gäller under tiden klockan 08.00 - 16.00.'));
  assert.deepEqual(r.limits, [{ a: 480, b: 960, dt: ['vardag'], max: 120 }]); assert.deepEqual(r.unread, []);
  // hours with their own days replace the days
  r = parseRegulation(wrap('På markerade sträckor på Holmvägen enligt kartbild får fordon parkeras under högst 2 tim i följd. Tidsbegränsningen gäller under tiden vardag klockan 08.00 - 16.00.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore'], a: 480, b: 960, max: 120 }]);
});

test('sweep waves 9–13: a plain stopping ban and "råder förbud mot att stanna eller parkera fordon" are bans; exemptions for taxis and school buses reserve nothing (Bräcke, Kristianstad, Landskrona shown as taxi-only)', () => {
  let r = parseRegulation(wrap('1 § På Norrlandsgatans östra sida längs busshållplatsen nedanför Bräcke skola får fordon inte stannas. Förbudet gäller inte taxi, buss eller fordon i linjetrafik. 2 § Förbudet gäller vardagar mellan klockan 07:00 – 15:00.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag', 'fore'], a: 420, b: 900 }]); assert.equal(r.reserved, false); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På Tre Gretors väg i Färlöv, utmed vägens södra sida i den markerade skolbusshållplatsen råder förbud mot att stanna eller parkera fordon. Förbudet gäller under vardagar utom lördag och dag före söndag och helgdag mellan klockan 07 och 16. Förbudet gäller inte för skolbuss och taxi.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 420, b: 960 }]); assert.equal(r.reserved, false); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På markerade sträckor på Eriksgatans västra sida enligt kartbild får inte fordon stannas eller parkeras. Förbudet gäller under tiden vardag utom dag före sön- och helgdag klockan 22.00 - 05.00, vardag före sön- och helgdag klockan 22.00 - 05.00 och sön- och helgdag klockan 22.00 - 05.00. Förbudet gäller inte vid taxi i tjänst. Övrig tid får fordon parkeras under högst 10 min i följd.'));
  assert.equal(r.reserved, false); assert.equal(r.bans.length, 3); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På Storgatan i Valdemarsvik västra sidan mellan Hamngatan och Trädgårdsgatan får inte fordon stannas.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(r.unread, []);
});

test('sweep wave 3: a fee sentence that points at another paragraph\'s hours leaves a bus bay fully read (Haninge Rudsjöterrassen was open to all cars)', () => {
  const r = parseRegulation(wrap('1 § På Rudsjöterrassen enligt markering på kartbild får endast buss parkeras . 2 § Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag klockan 17.00 - 07.00, vardag före sön- och helgdag klockan 00.00 - 24.00 samt sön- och helgdag klockan 00.00 - 24.00. 3 § Inom tidsangivelsen som anges i 2§ skall avgift erläggas enligt taxa taxa A; Haninge kommuns lokala trafikföreskrifter om parkeringsavgifter.'));
  assert.equal(r.reservedFor, 'buss'); assert.deepEqual(r.unread, []);
});

test('sweep waves 9–12: "mot avgift, zon 2, vardagar utom dag före helgdag kl 09.00 - 18.00 samt dag före helgdag kl 09.00 - 14.00": the fee hours (Växjö Norra Esplanaden showed a fee around the clock)', () => {
  let r = parseRegulation(wrap('1 § På Norra Esplanaden i Växjö, norra körbanan, södra sidan får fordon parkeras högst 2 dygn i följd mot avgift, zon 2, vardagar utom dag före helgdag kl 09.00 - 18.00 samt dag före helgdag kl 09.00 - 14.00'));
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }, { dt: ['fore'], a: 540, b: 840 }]); assert.deepEqual(r.unread, []);
  // without a fee zone the hours stay the limit's
  r = parseRegulation(wrap('På Storgatan får fordon parkeras högst 2 tim i följd vardagar utom dag före helgdag kl 09.00 - 18.00.'));
  assert.equal(r.feeWindows, null);
});

test('QA 22 Nov measure: "Parkeringen får endast användas av fordon med särskilt tillstånd": a permit bay, the limit is the bay\'s (Falun Tingshusgatan gave every car 1 h)', () => {
  let r = parseRegulation(wrap('På Tingshusgatan på blåmarkerad sträcka enligt kartbild får fordon parkeras under högst 1 tim i följd. Parkeringen får endast användas av fordon med särskilt tillstånd, - vuxenpsykiatri landstinget.'));
  assert.equal(r.reserved, true); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 60 }]); assert.deepEqual(r.unread, []);
  // a resident permit is not a reservation: the sentence stays as before
  r = parseRegulation(wrap('På Storgatan får fordon parkeras under högst 1 tim i följd. Parkeringen får endast användas av fordon med särskilt tillstånd för boende.'));
  assert.equal(r.reserved, false);
});

test('QA 22 Nov measure: "får fordon och fordon som används av boende … för vilka särskilt tillstånd utfärdats … parkeras": a permission for every vehicle (Kalmar Proviantgatan)', () => {
  const r = parseRegulation(wrap('På Proviantgatan, västra sidan mellan Fiskaregatan och Södra Kanalgatan (6 platser) får fordon och fordon som används av boende i området och för vilka särskilt tillstånd utfärdats med avvikelse från kommunens lokala trafikföreskrifter 0880 2010:79 parkeras under högst 24 tim i följd endast mot avgift vardag och vardag före sön- och helgdag klockan 09.00 - 15.00. Övrig tid får fordon parkeras.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore'], a: 540, b: 900, max: 1440 }]);
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag', 'fore'], a: 540, b: 900 }]); assert.equal(r.otherAllowed, true); assert.deepEqual(r.unread, []);
});

// ---- project 0, sweep findings batch 3 (22 Nov 2026): the loose rows of all waves, read again ----
test('sweep batch 3: bays for one kind of vehicle or a named group are reserved, not a limit for every car', () => {
  const res = (s) => { const r = parseRegulation(wrap(s)); assert.deepEqual(r.unread, [], s); return [r.reserved, r.reservedFor ?? null]; };
  assert.deepEqual(res('Inom ett område i Ulricehamn som motsvarar den västra delen av parkeringsplatsen på Fiskaregatan får endast släpvagnar parkeras under högst 24 tim i följd.'), [true, 'fordon med släp']);
  assert.deepEqual(res('På Nibbleplan, på 5 markerade parkeringsplatser, på parkeringens östra sida, får endast personbil med tillkopplat släpvagn parkeras.'), [true, 'fordon med släp']);
  assert.deepEqual(res('På västra sidan av Fraktvägen i Trelleborg får endast motorfordon över 3,5 ton, traktor, motorredskap och släpfordon parkeras under högst 24 tim i följd vardagar utom vardag före sön- och helgdag.'), [true, 'lastbil']);
  assert.deepEqual(res('På Tuvesvik i Ellös på angiven uppställningsyta får endast fordon klass II parkeras under högst 2 dygn i följd.'), [true, 'husbil']);
  assert.deepEqual(res('På västra sidan av Drottninggatan 21D i Karlskrona får motorcykel och moped klass I, parkeras under högst 24 tim i följd.'), [true, 'motorcykel']);
  assert.deepEqual(res('På den del av Mantorps Resecentrum som anges i kartan får moped klass I och moped klass II parkeras under högst 24 tim i följd vardag utom vardag före sön- och helgdag.'), [true, 'moped']);
  assert.deepEqual(res('På Mejerigatan norr om och längs med gatan 3 st. platser, får bussar parkeras i högst 24 timmar i följd.'), [true, 'buss']);
  assert.deepEqual(res('På Margaretagatan i Söderköping får turistbussar stannas eller parkeras under högst 2 tim i följd.'), [true, 'buss']);
  assert.deepEqual(res('På Åvägen i Henån, på angivna parkeringsplatser, får elbilar parkeras under högst 3 tim i följd måndag – söndag.'), [true, 'laddning']);
  assert.deepEqual(res('Det rödmarkerade område som framgår av kartbilaga ska vara laddplats.'), [true, 'laddning']);
  assert.deepEqual(res('Inom följande område i Arlöv får endast fordon med tillstånd parkeras under högst 24 tim i följd.'), [true, null]);
  assert.deepEqual(res('På västra sidan av Apoteksgatan i Lysekil får endast fordon för biblioteksverksamhet parkeras under högst 24 tim i följd under tiden vardag utom vardag före sön- och helgdag'), [true, null]);
  assert.deepEqual(res('På södra sidan av Kungsgatan i Söderhamn får fordon parkeras under högst 1 tim i följd. Tillåtelsen gäller endast besökare till Kungsgatan 6.'), [true, null]);
  assert.deepEqual(res('På en markerad parkeringsplats framför Kungsgatan 29 får endast sådant fordon parkeras som används för befordran av rörelshindrad med särskilt parkeringstillstånd, dock högst 2 timmar i följd.'), [true, 'rörelsehindrade']);
  assert.deepEqual(res('På 1 markerad parkeringsplats på Viktoriagatans nordöstra sida får - under högst 2 timmar i följd - endast sådant fordon parkeras som används för befordran av handikappad med särskilt parkeringstillstånd.'), [true, 'rörelsehindrade']);
  assert.deepEqual(res('På Kungsgatan i Växjö, västra sidan, 2 markerade platser, får fordon parkeras högst 2 timmar i följd för rörelsehindrade personer med tillstånd.'), [true, 'rörelsehindrade']);
  assert.deepEqual(res('På Koppargatans norra ände i Hultsfred på en särskild markerad plats får fordon som används av rörelsehindrade med särskilt tillstånd parkeras under högst 24 timmar i följd vardag utom dag före sön- och helgdag.2 § Fordon som inte får parkeras får inte heller stannas annat än för på- och avstigning'), [true, 'rörelsehindrade']);
  assert.deepEqual(res('På Kyrkogatans östra sida får buss parkeras under högst 5 minuter. Tillåtelsen gäller inte på särskilt markerad busshållplats för fordon i linjetrafik.'), [true, 'buss']);
  // the visitors' hours are the hours the bay is reserved; other times are open
  let r = parseRegulation(wrap('På östra sidan av Södra Strandvägen får endast besökare till MVC parkeras under högst 1 tim i följd under vardag utom vardag före sön- och helgdag mellan klockan 08.00 – 17.00. Övrig tid får fordon parkeras.'));
  assert.equal(r.reserved, true); assert.deepEqual(r.reservedWindows, [{ dt: ['vardag'], a: 480, b: 1020 }]); assert.equal(r.otherAllowed, true);
  // ordinary cars stay ordinary: light vehicles, residents' permits (left to the register)
  r = parseRegulation(wrap('På södra sidan av Mångatan i Arlöv får endast motor- och släpfordon under 3,5 ton parkeras.')); assert.equal(r.reserved, false);
  r = parseRegulation(wrap('På Storgatan får endast personbil utan släpvagn parkeras under högst 2 tim i följd.')); assert.equal(r.reserved, false);
  // (until batch 7 this was left to the register, which holds no resident zones outside the three big cities, so the line stayed grey; the text lets nobody else park)
  r = parseRegulation(wrap('På Storgatan får endast fordon med särskilt boendeparkeringstillstånd parkeras.')); assert.equal(r.reserved, true); assert.equal(r.reservedFor, null);
  // inside an area parking ban a motorcycle bay's hours do not open the other hours to cars (Hudiksvall)
  r = parseRegulation(wrap('Med avvikelse från Hudiksvalls kommuns lokala trafikföreskrifter 2184 2024:78 om område för parkeringsförbud, får tvåhjulig motorcykel och moped klass I utan sidvagn parkeras på de platser som rödmarkerats i kartbilaga 1. Tillåtelsen gäller vardagar klockan 05.00 - 24.00.'));
  assert.equal(r.reserved, true); assert.notEqual(r.otherAllowed, true);
});
test('sweep batch 3: a second limit for the other hours, however it is worded', () => {
  for (const tail of ['Övrig tid 24 timmar.', 'Övrig tid gäller parkering max 24 timmar.', 'Övrig tid är parkering tillåten under 24 timmar i följd.', 'Övrig tid får fordon parkeras 24 tim i följd.']) {
    const r = parseRegulation(wrap('På Torggatans södra sida får fordon parkeras under högst 2 timmar i följd vardag mellan kl. 08.00 till 19.00. ' + tail));
    assert.deepEqual(r.unread, [], tail);
    assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore'], a: 480, b: 1140, max: 120 }, { dt: ['vardag', 'fore'], a: 0, b: 480, max: 1440 }, { dt: ['vardag', 'fore'], a: 1140, b: 1440, max: 1440 }, { dt: ['helgdag'], a: 0, b: 1440, max: 1440 }], tail);
  }
  const r = parseRegulation(wrap('På Skolvägen i Hamburgsund får fordon parkeras under högst 12 tim i följd under tiden 15 juni - 15 augusti. Övrig tid får fordon parkeras 24 tim i följd.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, m: [[6, 15], [8, 15]], max: 720 }, { a: 0, b: 1440, m: [[8, 16], [6, 14]], max: 1440 }]);
});
test('sweep batch 3: an exemption from an all-day ban at stated hours leaves parking allowed only then', () => {
  let r = parseRegulation(wrap('På blåmarkerad sträcka på Rosenkällavägens norra sida enligt kartbild får fordon inte parkeras. Förbudet gäller inte under tiden onsdag klockan 08.00 - 16.00.'));
  assert.deepEqual(r.bans, []); assert.deepEqual(r.allowOnly, [{ w: 3, a: 480, b: 960 }]); assert.deepEqual(r.unread, []);
  // an n-th weekday exemption is not read: the reparse greys the line when the register has turned it into the ban
  r = parseRegulation(wrap('På norra sidan av F M Franzéns gata får fordon inte parkeras. Förbudet gäller inte 3:e måndagen i månaden mellan klockan 8-18.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]); assert.equal(r.unread.length, 1);
  // exemptions for loading, refuse trucks and school transport change nothing for parking
  for (const ex of ['Förbudet gäller inte av- och pålastning av gods, dock längst 5 min.', 'Förbudet gäller inte lastning och lossning under tiden mellan klockan 06.00 – 18.00.', 'Förbudet gäller inte renhållningsbil under tiden vardagar utom vardag före sön- och helgdag mellan klockan 06.00 - 14.00.', 'Förbudet gäller inte vid skolskjuts.']) {
    r = parseRegulation(wrap('På Storgatans södra sida får fordon inte stannas eller parkeras. ' + ex)); assert.deepEqual(r.bans, [{ a: 0, b: 1440 }], ex); assert.deepEqual(r.unread, [], ex);
  }
});
test('sweep batch 3: a limit of a day or more before "mot avgift <hours>" holds at all hours; the hours are the fee\'s', () => {
  let r = parseRegulation(wrap('På Skeppsbron i Västervik får fordon parkeras under högst 10 dygn i följd och mot avgift vardagar utom vardag före sön- och helgdag mellan klockan 09.00 - 18.00.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 14400 }]); assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }]);
  r = parseRegulation(wrap('På Kungsgatan i Växjö får fordon parkeras högst 24 timmar i följd mot avgift, zon 1, vardagar utom dag före helgdag kl 09.00 - 18.00 samt dag före helgdag kl 09.00 - 14.00.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }, { dt: ['fore'], a: 540, b: 840 }]);
  // a short limit keeps the hours
  r = parseRegulation(wrap('På Storgatan får fordon parkeras under högst 1 tim i följd och mot avgift under tiden vardag utom vardag före sön- och helgdag klockan 09.00 - 18.00.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 60 }]);
});
test('sweep batch 3: day types and small shapes', () => {
  let r = parseRegulation(wrap('På sydvästra sidan av Kaptensgatan får fordon parkeras vardagar utom sön- och helgdagar under högst 24 tim i följd.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore'], a: 0, b: 1440, max: 1440 }]);
  r = parseRegulation(wrap('På markerade parkeringsplatser vid St Hansgatan får fordon parkeras högst 2 timmar i följd. Tidsbegränsningen gäller vardagar utom vardag rore sön- och helgdag mellan klockan 09 och 18 och vardag före sön- och helgdag mellan klockan 09 och 14.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 120 }, { dt: ['fore'], a: 540, b: 840, max: 120 }]);
  r = parseRegulation(wrap('På Tallåsvägens västra sida får fordon inte parkeras. Förbudet gäller vardagar, mellan klockan 06.00 och 18.00'));
  assert.deepEqual(r.bans, [{ dt: ['vardag', 'fore'], a: 360, b: 1080 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På Katja Geigers gata i Ekeby får motordrivet fordon parkeras under högst 15 min i följd under tiden vardagar mellan klockan 07.00 - 17.00.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore'], a: 420, b: 1020, max: 15 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På södra sidan av Prytzgatan får fordon parkeras högst 2 timmar i följd. Tidsregleringen gäller vardagar och sön- och helgdagar.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore', 'helgdag'], a: 0, b: 1440, max: 120 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På markerade sträckor på Sveagatan enligt kartbild och enligt taxa 1 får fordon parkeras under högst 1 tim i följd. Tillåtelsen gäller under tiden vardag utom dag före sön- och helgdag klockan 08.00 - 18.00.'));
  assert.equal(r.taxa, 1);
});

test('sweep findings batch 4: bans, second periods, date parking and day types that were left unread', () => {
  // a second dated period after "och" (Örebro Kungsgatan had only the first)
  let r = parseRegulation(wrap('På markerad yta på Kungsgatans östra sida får fordon inte stannas eller parkeras. Förbudet gäller under tiden 14 september - 5 oktober och 30 november - 21 december.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[9, 14], [10, 5]] }, { a: 0, b: 1440, m: [[11, 30], [12, 21]] }]);
  // each hour range with its own season (Stenungsund Timmerviksvägen)
  r = parseRegulation(wrap('1 § På de södra parkeringsplatserna får fordon inte parkeras. 2 § Förbudet gäller klockan 06.00 - 18.30 20 augusti - 23 december samt klockan 06.00 - 18.30 7 januari - 14 juni.'));
  assert.deepEqual(r.bans, [{ a: 360, b: 1110, m: [[8, 20], [12, 23]] }, { a: 360, b: 1110, m: [[1, 7], [6, 14]] }]);
  // three hour ranges, the middle one after a comma (Kungsbacka Gymnasiegatan)
  r = parseRegulation(wrap('På rödmarkerade sträckor på Gymnasiegatan får fordon parkeras under högst 15 min i följd. Tidsbegränsningen gäller under tiden vardag utom vardag före sön- och helgdag klockan 00.00 - 07.00, 09.00 - 14.00 och 17.00 - 24.00.'));
  assert.deepEqual(r.limits.map((w) => [w.a, w.b]), [[0, 420], [540, 840], [1020, 1440]]);
  // "16,30" (Vellinge Trädgårdsgatan)
  r = parseRegulation(wrap('1 § På Trädgårdsgatans bussficka får fordon inte stannas eller parkeras. 2 § Förbudet gäller under vardagar utom dag före sön- och helgdag mellan kl 07 och 16,30.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 420, b: 990 }]);
  // a ban sentence of its own after a limit (Karlshamn Kastellgatan, Falun Sturegatan, Vaxholm Rådhusgatan)
  r = parseRegulation(wrap('På markerad sträcka på Kastellgatan får fordon parkeras under högst 1 tim i följd. Förbud att stanna och parkera på Kastellgatan gäller mellan 21-05 alla dagar. Förbudet gäller ej lastning och lossning.'));
  assert.deepEqual(r.bans, [{ a: 1260, b: 300 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På Sturegatan på blåmarkerad sträcka får fordon parkeras under högst 15 min i följd. Parkeringsförbud på sträckan råder under tiden klockan 08:00 - 11:00, med undantag för varutransporter.'));
  assert.deepEqual(r.bans, [{ a: 480, b: 660 }]); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 15 }]);
  r = parseRegulation(wrap('1 § På Rådhusgatans sydöstra sida får fordon parkeras högst 2 timmar i följd. 5 § Fordon får dock inte parkeras onsdag melllan klockan 0 och klockan 8 under perioden 1 november - 15 maj.'));
  assert.deepEqual(r.bans, [{ w: 3, a: 0, b: 480, m: [[11, 1], [5, 15]] }]);
  // school-transport bays and plain "vardagar" bans (Åsele, Sunne, Ydre, Gnosjö): Mon–Sat, or Mon–Fri with "dock ej dag före"
  r = parseRegulation(wrap('På Storgatans norra sida, på iordningställd skolskjutsparkering får inte annat fordon än skolskjuts parkeras under vardagar mellan kl 07.00 och 18.00.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag', 'fore'], a: 420, b: 1080 }]);
  r = parseRegulation(wrap('På Bergvägen, västra sidan, får andra fordon än skolskjutsfordon inte parkeras, vardagar dock ej dag före sön- och helgdag mellan kl 08.00 och kl 16.00.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 480, b: 960 }]);
  r = parseRegulation(wrap('På Hagagatan på stannandeficka avsedd för skoltransporter vid Ydreskolan råder parkeringsförbud vardagar kl 07.00 – 16.00.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag', 'fore'], a: 420, b: 960 }]);
  r = parseRegulation(wrap('På Regeringsgatans västra sida skall vara lastzon. Förbud att parkera skall gälla vardagar mellan klockan 07.00 och 17.00'));
  assert.deepEqual(r.bans, [{ dt: ['vardag', 'fore'], a: 420, b: 1020 }]);
  // a stopping ban at set hours and "under övrig tid får fordon inte parkeras" in one sentence (Österåker Tunavägen): never free
  r = parseRegulation(wrap('På Tunavägen, mellan Borgvägen och Generalsvägen får fordon inte stanna skoldagar mellan klockan 07.00-17.00, under övrig tid får fordon inte parkeras.'));
  assert.equal(r.bans.length, 3); assert.deepEqual(r.bans[0], { a: 420, b: 1020 }); assert.deepEqual(r.unread, []);
  // "Övrig tid parkeringsförbud" after "Villkoret gäller <season>" (Karlshamn Matvikshamnsvägen)
  r = parseRegulation(wrap('På markerat område får endast personbil parkeras. Tillåtelsen att parkera gäller under högst 30 dygn i följd. Villkoret gäller 1 juni - 31 augusti. Övrig tid parkeringsförbud och platsen disponseras som uppläggningsplats.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[9, 1], [5, 31]] }]);
  // two limits, each with its own season (Karlshamn)
  r = parseRegulation(wrap('1 § På markerad parkeringsplats får endast personbil parkeras. 2 § Tillåtelsen gäller under högst 7 dygn i följd under tiden 1 april - 30 september. 3 § Tillåtelsen gäller under högst 30 dygn i följd under tiden 1 oktober - 31 mars.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, m: [[4, 1], [9, 30]], max: 10080 }, { a: 0, b: 1440, m: [[10, 1], [3, 31]], max: 43200 }]);
  // a taxi stand outside the limit's hours (Kungsbacka Västergatan, Skövde Stationsgatan): no parking then
  r = parseRegulation(wrap('På den markerade sträckan på Västergatan får fordon parkeras under högst 15 min i följd under tiden vardag utom vardag före sön- och helgdag klockan 03.00 - 22.00, vardag före sön- och helgdag klockan 03.00 - 22.00 och sön- och helgdag klockan 03.00 - 22.00. Övrig tid ska den markerade sträckan vara ändamålsplats för uppställning av fordon i taxitrafik.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag', 'fore', 'helgdag'], a: 0, b: 180 }, { dt: ['vardag', 'fore', 'helgdag'], a: 1320, b: 1440 }]);
  // date parking by reference to the town's rule (Sandviken, Ludvika, Upplands-Bro)
  r = parseRegulation(wrap('1 § På särskilt utmärkta platser på Hyttgatan får fordon parkeras under högst två timmar i följd. 2 § Tidsbegränsningen gäller vardagar utom dag före sön- och helgdag mellan klockan 9 och 18. 3 § Datumparkering gäller på denna plats.'));
  assert.deepEqual(r.dp, [{ a: 0, b: 1440, ref: 1 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På markerad sträcka på Vasagatans södra sida får fordon parkeras under högst 30 min i följd. Tidsbegränsningen gäller under tiden vardagar klockan 06.30 - 19.00. Övrig tid gäller datumparkering.'));
  assert.deepEqual(r.dp, [{ a: 0, b: 1440, ref: 1 }]); assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore'], a: 390, b: 1140, max: 30 }]);
  // "dock längst 30 minuter" is the limit, date parking has its own hours (Kiruna Linnéstigen)
  r = parseRegulation(wrap('På ca 3 anordnade platser på Linnéstigens norra sida får fordon parkeras, dock längst 30 minuter i följd. Parkering tillåts endast inom skyltad utsträckning. Datumparkering gäller mellan kl 00.00-08.00.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 30 }]); assert.deepEqual(r.dp, [{ a: 0, b: 480 }]); assert.deepEqual(r.unread, []);
  // day types
  r = parseRegulation(wrap('På Stapelvägens södra sida på torsdagar som infaller vardagar får fordon inte parkeras. Förbudet gäller under tiden 07:00 - 12:00'));
  assert.deepEqual(r.bans, [{ w: 4, a: 420, b: 720, dt: ['vardag', 'fore'] }]); // a Thursday before a holiday is a "vardag"
  r = parseRegulation(wrap('1 § På Linnégatan får fordon parkeras högst 24 timmar i följd, Gäller vardagar utom dag före helgdag kl 18.00 - 24.00, dag före helgdag kl 15.00 - 24.00 samt helgdag kl 00.00 - 24.00.'));
  assert.deepEqual(r.limits.map((w) => w.dt[0]), ['vardag', 'fore', 'helgdag']);
  r = parseRegulation(wrap('På markerad sträcka på Järnvägsgatan får fordon inte stannas eller parkeras. Förbudet gäller under tiden klockan 07.15 - 07.45, vardagar och vardagar före sön- och helgdag.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag', 'fore'], a: 435, b: 465 }]);
  r = parseRegulation(wrap('På markerade sträckor på Almas väg får fordon parkeras under högst 2 tim i följd. Bestämmelserna gäller vardagar och helger samt dag före helg.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 120 }]); assert.deepEqual(r.unread, []);
});

test('sweep findings batch 5: a limit\'s hours are not the only hours parking is allowed', () => {
  // "gäller dock högst N … villkoret gäller <hours>" after a plain permission inside a parking-ban zone (Hudiksvall ×33)
  let r = parseRegulation(wrap('1 § På östra sidan av Drottninggatan får fordon, med avvikelse från Hudiksvalls kommuns lokala trafikföreskrifter ( 2184 2010 : 0002 ) om stannande och parkering, parkeringsförbudszon, i Hudiksvall, parkeras. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Tillåtelsen att parkera i paragraf 1§ gäller dock högst 1 tim i följd. villkoret gäller under tiden vardagar utom vardag före sön- och helgdag mellan klockan 09.00 - 16.00. 3 § Parkeringsskiva eller motsvarande ska användas.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 960, max: 60 }]); assert.deepEqual(r.allowOnly, []); assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § Med avvikelse från Hudiksvalls kommuns lokala trafikföreskrifter 2184 2025:133 om område för parkeringsförbud på Kattvikskajen, Hudiksvall, får fordon parkeras på de platser som rödmarkerats på kartbilaga 1. 2 § Tillåtelsen att parkera i 1§ gäller dock högst 1 timme i följd, vardagar utom vardag före söndag och helgdag mellan klockan 9 och 16.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 960, max: 60 }]); assert.deepEqual(r.allowOnly, []);
  // Kalmar Oxhagen (no "dock"): unchanged; a disabled bay stays reserved (Uppsala)
  r = parseRegulation(wrap('1 § På nordvästra sidan av Gustaf Adolfs väg får endast personbil, med avvikelse från Kalmar kommuns lokala trafikföreskrifter ( 0880 2025 : 48 ) om område med förbud att parkera i Oxhagen, parkeras. 2 § Tillåtelsen gäller vardagar utom vardag före sön- och helgdag under högst 24 tim i följd.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.allowOnly, [{ dt: ['vardag'], a: 0, b: 1440 }]); // without "dock" inside an area ban the stricter reading is kept (the independent check did not confirm the looser one)
  r = parseRegulation(wrap('På 1 markerad plats på Almqvistgatan enligt kartbild får fordon som används av rörelsehindrade med särskilt tillstånd parkeras. Tillåtelsen gäller under tiden vardag utom dag före sön- och helgdag under högst 24 tim iföljd. Övrig tid får fordon som används av rörelsehindrade med särskilt tillstånd parkeras.'));
  assert.equal(r.reserved, true);
  // with "Övrig tid får fordon inte parkeras" the hours stay the only allowed ones (Täby Näsbylundsvägen)
  r = parseRegulation(wrap('1 § På Näsbylundsvägen får fordon inte stannas eller parkeras. 2 § Trots förbudet i 1 § får dock fordon parkeras på norra sidan vardagar utom vardag före sön- och helgdag mellan klockan 7 och 17. Tillåtelsen gäller i högst 15 minuter i följd. Övrig tid får fordon inte parkeras på sträckan.'));
  assert.ok(r.allowOnly.length > 0 || r.bans.length > 0);
  // the title of the regulation this one replaces is not a ban context (Perstorp Bryggaregatan, Burlöv Hamngatan)
  r = parseRegulation('Perstorps kommun föreskriver med stöd av 10 kap. 1 § trafikförordningen (1998:1276) följande. 1 § På sydöstra sidan av Bryggaregatan i Perstorp får fordon parkeras under högst 4 tim i följd. 2 § Tillåtelsen att parkera i paragraf gäller under vardag utom vardag före sön- och helgdag mellan klockan 09.00 - 18.00 och vardag före sön- och helgdag 09.00 - 14.00. Dessa föreskrifter träder i kraft den 16 december 2021, då Perstorps kommuns lokala trafikföreskrifter (1275 2016:17) om förbud att parkera på Bryggaregatan, Perstorp ska upphöra att gälla.');
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 240 }, { dt: ['fore'], a: 540, b: 840, max: 240 }]); assert.deepEqual(r.allowOnly, []);
});

test('sweep findings batch 5: "not parked longer than N" is a limit, with the hours a "Förbudet gäller" sentence gives it', () => {
  let r = parseRegulation(wrap('På parkeringsplatsen framför Hembygdsmuséet i Vilhelmina får fordon inte parkeras under längre tid än 2 timmar vardagar mellan klockan 08.00 – 18.00.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore'], a: 480, b: 1080, max: 120 }]); assert.deepEqual(r.bans, []);
  r = parseRegulation(wrap('På Järnvägsgatans västra sida, på utmärkt parkeringsruta vid Järnvägsgatan 3, får fordon inte parkeras i längre följd än 15 minuter.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 15 }]); assert.deepEqual(r.bans, []);
  r = parseRegulation(wrap('1 § På Postgatans parkeringsplatser får fordon inte parkeras längre tid än 2 timmar i följd. 2 § Förbudet gäller - vardagar, utom vardag före sön- och helgdag, mellan klockan 08.00 och 18.00, - vardagar före sön- och helgdag mellan klockan 08.00 och 15.00.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 120 }, { dt: ['fore'], a: 480, b: 900, max: 120 }]); assert.deepEqual(r.bans, []);
  // a real ban elsewhere in the text keeps "Förbudet gäller" a ban sentence (Jokkmokk Föreningsgatan)
  r = parseRegulation(wrap('På Föreningsgatan, båda sidorna, mellan Köpmangatan och Berggatan får fordon inte parkeras under längre tid än två timmar. På Föreningsgatans norra sida mellan Berggatan och Klippgatan får fordon inte parkeras.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 120 }]); assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]);
  // "Förbudet gäller" as a slip for the limit's or the permission's hours in a text that bans nothing (Tingsryd, Lomma, Salem)
  r = parseRegulation(wrap('På västra sidan av Norrgatan i Tingsryd får fordon parkeras under högst 5 min i följd. Förbudet gäller vardag klockan 07.00 - 17.00.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag', 'fore'], a: 420, b: 1020, max: 5 }]); assert.deepEqual(r.bans, []);
  r = parseRegulation(wrap('På 6 markerade platser på Toredalsvägens vändplan får fordon parkeras.. Förbudet gäller under tiden vardag utom vardag före sön- och helgdag och under högst 24 tim iföljd.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.bans, []); assert.deepEqual(r.allowOnly, []);
});

test('sweep findings batch 5: exceptions to an all-day ban', () => {
  // a season: the ban holds the rest of the year (Ulricehamn ×6)
  let r = parseRegulation(wrap('1 § På nordöstra sidan av Gråalsgatan i Ulricehamn får fordon inte parkeras. Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Parkering är dock tillåten april - november.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[12, 1], [3, 31]] }]);
  // a limit with hours: allowed then, banned outside (Värnamo Bangårdsgatan); without hours a plain limit (Forshaga)
  r = parseRegulation(wrap('1 § På Bangårdsgatan i Värnamo, sträckan mellan Åkaregatan och Fabriksgatan, får fordon inte parkeras. 2 § Parkering är dock tillåten under högst 2 tim mellan klockan 06.00 – 22.00.'));
  assert.deepEqual(r.bans, []); assert.deepEqual(r.limits, [{ a: 360, b: 1320, max: 120 }]); assert.deepEqual(r.allowOnly, [{ a: 360, b: 1320 }]); assert.equal(r.otherAllowed, false);
  r = parseRegulation(wrap('På norra sidan av Sandviksvägen i Forshaga får inte fordon parkeras. Parkering är dock tillåten under högst 15 min.'));
  assert.deepEqual(r.bans, []); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 15 }]);
  r = parseRegulation(wrap('1 § På Sjövägen, hamn- och vändplats i Havstenssund får fordon inte parkeras. 2 § Parkering är dock tillåten under högst 5 minuter i följd för i och urlastning.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]); // only for loading: the ban stays (Tanum)
  // an exception for marked bays only, or on one named weekday, leaves the street's ban (Båstad Paulins väg, Nyköping Vallarvägen)
  r = parseRegulation(wrap('Inom markerat område på Paulins väg enligt kartbild får fordon inte parkeras. Parkering är dock tillåten på särskilt markerade platser under högst 24 timmar i följd.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]);
  r = parseRegulation(wrap('På markerad sträcka på Vallarvägens södra sida enligt kartbild, får fordon inte parkeras. Parkering är dock tillåten under högst 2 tim i följd under tiden onsdag klockan 08.00 - 16.00.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]);
  // a disabled bay with "Parkering är dock tillåten under högst N tim" stays reserved
  r = parseRegulation(wrap('På markerad sträcka på Trollgatan enligt kartbild får endast sådant fordon parkeras som används för befordran av rörelsehindrad med parkeringstillstånd enligt 13 kap. 8 § trafikförordningen (1998:1276) eller utländskt parkeringstillstånd som ger samma rätt att parkera. Parkering är dock tillåten under högst 4 tim i följd under tiden vardag utom vardag före sön- och helgdag klockan 09.00 - 19.00.'));
  assert.equal(r.reserved, true); assert.notEqual(r.otherAllowed, true);
});

test('sweep findings batch 5: a bay for one kind of vehicle with its own hours or season is open at other times', () => {
  let r = parseRegulation(wrap('På markerad sträcka vid Hamngatan enligt kartbild får endast motorcykel och moped parkeras under tiden 1 april - 30 september.'));
  assert.equal(r.reserved, true); assert.deepEqual(r.reservedSeason, [[4, 1], [9, 30]]); assert.equal(r.otherAllowed, true);
  r = parseRegulation(wrap('På östra sidan av Lagmansgatan ( enligt angiven kartbilaga ) får endast moped klass I och moped klass II parkeras under vardag utom vardag före sön- och helgdag mellan klockan 07.00 - 17.00.'));
  assert.deepEqual(r.reservedWindows, [{ dt: ['vardag'], a: 420, b: 1020 }]); assert.equal(r.otherAllowed, true);
  r = parseRegulation(wrap('Inom markerat område på Furuhällsplans parkering får endast motorcykel och moped klass I parkeras. Tillåtelsen gäller 1 april – 31 oktober.'));
  assert.deepEqual(r.reservedSeason, [[4, 1], [10, 31]]); assert.equal(r.otherAllowed, true); assert.deepEqual(r.unread, []);
  // not without "endast", not with a limit or a fee in the text, not for disabled bays, not inside an area parking ban
  r = parseRegulation(wrap('På bussvändslingan mellan Edsviksvägen och Sätraängsvägen får buss parkeras under tiden klockan 18.00 - 07.00.'));
  assert.notEqual(r.otherAllowed, true);
  r = parseRegulation(wrap('På markerad sträcka på Tallbacksgatans västra sida enligt kartbild får endast lastbil, buss och tungt släpfordon parkeras under högst 2 tim i följd under tiden vardag utom vardag före sön- och helgdag klockan 06.00 - 18.00.'));
  assert.notEqual(r.otherAllowed, true);
  r = parseRegulation(wrap('På markerad plats på Ekgränd enligt kartbild får endast motorcykel parkeras och mot avgift under tiden vardag utom vardag före sön- och helgdag klockan 07.00 - 19.00.'));
  assert.notEqual(r.otherAllowed, true);
  r = parseRegulation(wrap('På Löfströms Allé får endast fordon med rörelsehindrade som är innehavare av parkeringstillstånd enligt 13 kap. 8 § trafikförordningen (1998:1276) parkeras under tiden vardag utom vardag före sön- och helgdag klockan 10.00 - 19.00.'));
  assert.notEqual(r.otherAllowed, true);
  r = parseRegulation(wrap('På Storgatan får endast motorcykel, med avvikelse från kommunens lokala trafikföreskrifter om förbud att parkera inom ett område, parkeras under tiden 1 april - 30 september.'));
  assert.notEqual(r.otherAllowed, true);
});

test('sweep findings batch 5: hours and seasons of a ban that were dropped', () => {
  let r = parseRegulation(wrap('1 § Trulsibrunnvägen, mellan en punkt 417 m söder om Västra Fädriften och söderut, får fordon inte parkeras. 2 § Förbudet gäller under tiden den 15 maj t.o.m. 15 september mellan kl 08 och 18.'));
  assert.deepEqual(r.bans, [{ a: 480, b: 1080, m: [[5, 15], [9, 15]] }]);
  r = parseRegulation(wrap('På planen mellan Hullsta Gård och Storgatan får fordon inte stannas eller parkeras. Förbudet gäller dagligen mellan kl 18.00 – kl 02.00'));
  assert.deepEqual(r.bans, [{ a: 1080, b: 120 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På väg mot Degernäsbadet får inte fordon stannas eller parkeras. Förbudet gäller 15 april - 15 oktober 09.00 - 21.00.'));
  assert.deepEqual(r.bans, [{ a: 540, b: 1260, m: [[4, 15], [10, 15]] }]);
  r = parseRegulation(wrap('På Backgränd väster Hantverkaregatan får fordon under tiden 15 okt – 20 april inte stannas eller parkeras.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[10, 15], [4, 20]] }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På nordvästra sidan av Västra Järnvägsgatan i Hedemora får fordon på tisdagar inte parkeras 1 november - 30 april mellan klockan 07.00 - 11.00.'));
  assert.deepEqual(r.bans, [{ w: 2, a: 420, b: 660, m: [[11, 1], [4, 30]] }]);
  r = parseRegulation(wrap('På markerade sträckor på Stenkullevägens norra sida enligt kartbild under tiden 1 november - 30:april på onsdagar mellan kl. 08.00 - 15.00 får fordon inte parkeras.'));
  assert.deepEqual(r.bans, [{ w: 3, a: 480, b: 900, m: [[11, 1], [4, 30]] }]);
  // the terms of the ban just stated, not a second ban beside a plain one (Bollnäs)
  r = parseRegulation(wrap('1 § På Granbergsvägens södra sida får fordon inte parkeras.Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Förbudet gäller på dagar med jämna datum under tiden 1 november - 15 maj mellan klockan 00.00-08.00.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 480, m: [[11, 1], [5, 15]], dd: 'even' }]);
  // a seasonal permission with "Övrig tid är parkering förbjuden": banned the rest of the year (Sundsvall)
  r = parseRegulation(wrap('På Fredsgatans östra sida enligt markering på kartbild får fordon , med avvikelse från Sundsvalls kommuns lokala trafikföreskrifter (2281 2010-00850) om förbud mot att parkera fordon (datumzon) i Sundsvall, parkeras. Tillåtelsen gäller 1 maj - 30 november. Övrig tid är parkering förbjuden.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[12, 1], [4, 30]] }]); assert.deepEqual(r.unread, []);
  // "Tidsbegränsningen gäller alla dagar" after the hours keeps the hours (Huddinge)
  r = parseRegulation(wrap('1 § På Lammholmsbacken får fordon parkeras högst 3 tim i följd. 2 § Tidsbegränsningen gäller mellan klockan 08.00 - 22.00. 3 § Parkeringsskiva eller motsvarande ska användas. 4 § Tidsbegränsningen gäller alla dagar.'));
  assert.deepEqual(r.limits, [{ a: 480, b: 1320, max: 180 }]);
});

test('measure 25 Nov: a season "mellan D M och D M", a week span between two weekdays, a doubled letter in a weekday', () => {
  // Danderyd Slagrutevägen 0162 2008-25: banned all year
  let r = parseRegulation(wrap('På Slagrutevägen mellan Enstigen och Edsviksvägen får fordon inte parkeras mellan 1 nov\noch 30 april påföljande år.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[11, 1], [4, 30]] }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På Storgatan får fordon inte parkeras från den 1 juni till den 31 augusti.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[6, 1], [8, 31]] }]);
  // Vellinge Reuterswärds väg 1233 2022-75: the register had every weekend all year
  r = parseRegulation(wrap('1 § På Reuterswärds väg mellan Strandbadsvägen och infarten till campingplatsen får fordon inte stannas eller parkeras. 2 § Förbudet gäller årligen mellan lördagen vecka 27 och söndagen vecka 28.'));
  assert.deepEqual(r.bans, [{ w: 6, a: 0, b: 1440, wk: [27, 27] }, { w: 7, a: 0, b: 1440, wk: [27, 27] }, { a: 0, b: 1440, wk: [28, 28] }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § På Strandvägen får fordon inte parkeras. 2 § Förbudet gäller mellan fredagen vecka 30 och måndagen vecka 32.'));
  assert.deepEqual(r.bans.map((b) => b.wk[0]), [30, 30, 30, 31, 32]);
  // Örebro Toringsgatan 1880 2026-00429: "onssdag"
  r = parseRegulation(wrap('1 § På Toringsgatan får fordon parkeras. 2 § Parkering är dock förbjuden onssdag mellan klockan 00.00 och 09.00.'));
  assert.deepEqual(r.bans, [{ w: 3, a: 0, b: 540 }]);
});

test('sweep findings batch 6: slips that hid hours and seasons (0ch, a stray parenthesis, "och klockan", "till påföljande dag", "15:april", "15oktober", "I november")', () => {
  // Simrishamn Fredsdalsgatan 1291 2010-141: banned Mon–Fri around the clock
  let r = parseRegulation(wrap('1 § På Fredsdalsgatans södra sida får fordon inte parkeras. 2 § Förbudet gäller vardagar, utom dag före sön- och helgdag, mellan klockan 07 0ch 16.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 420, b: 960 }]); assert.deepEqual(r.unread, []);
  // Sollefteå Storgatan 2283 2009-005: limit at all hours
  r = parseRegulation(wrap('På parkeringsplatser belägna söder om Hullsta Gård får fordon parkeras högst 3 timmar i följd. (Tidsbegränsningen gäller vardagar utom dag före sön- och helgdag mellan klockan 09.00 och 18.00 och vardag före sön- och helgdag mellan klockan 09.00 och 15.00. Parkeringsskiva eller motsvarande ska användas.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 180 }, { dt: ['fore'], a: 540, b: 900, max: 180 }]);
  // Kumla 1881 2024-00055: the register had a ban around the clock
  r = parseRegulation(wrap('På markerat område på grusparkeringen i anslutning till Odengatan enligt kartbild får fordon parkeras. Parkeringsförbud gäller alla dagar mellan klockan 03:00 och klockan 05:00.'));
  assert.deepEqual(r.bans, [{ a: 180, b: 300 }]); assert.deepEqual(r.unread, []);
  // Jokkmokk Föreningsgatan 2510 2010-23, Herrevägen 2510 2010-27
  r = parseRegulation(wrap('På Föreningsgatans södra sida i Jokkmokk får fordon inte parkeras. Förbudet gäller alla dagar från klockan 19:00 till påföljande dag klockan 01:00.'));
  assert.deepEqual(r.bans, [{ a: 1140, b: 60 }]);
  r = parseRegulation(wrap('På Herrevägen i Jokkmokk, båda sidorna, får fordon inte parkeras onsdagar och fredagar mellan klockan 19:00 till påföljande dag klockan 01:00.'));
  assert.deepEqual(r.bans, [{ w: 3, a: 1140, b: 60 }, { w: 5, a: 1140, b: 60 }]);
  // Eskilstuna Årbygatan 0484 2026-133, Värmdö Ursula Printz gata 0120 2019-00059, Lycksele Arvid Franklins väg 2481 2003-74: the bans held all year
  r = parseRegulation(wrap('1 § På södra sidan av Årbygatan får fordon parkeras mot avgift. 2 § Parkering är dock förbjuden torsdag mellan klockan 08.00-12.00 under tiden 15 oktober till 15:april.'));
  assert.deepEqual(r.bans, [{ w: 4, a: 480, b: 720, m: [[10, 15], [4, 15]] }]);
  r = parseRegulation(wrap('På markerade sträckor på Ursula Printz gata enligt kartbild får fordon parkeras under högst 4 tim i följd. Parkering är dock förbjuden Torsdagar 09.00-15.00 under tiden 15oktober-15 maj.'));
  assert.deepEqual(r.bans, [{ w: 4, a: 540, b: 900, m: [[10, 15], [5, 15]] }]);
  r = parseRegulation(wrap('På Arvid Franklins väg, östra sidan mellan Hällforsvägen och Glasbergsvägen får fordon inte parkeras mellan klockan 00.00 och 08.00 under perioden I november - 15 april.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 480, m: [[11, 1], [4, 15]] }]);
  // Nynäshamn Järnvägsgatan 0192 2010-089: hours before a paragraph without a full stop
  r = parseRegulation(wrap('1 § I särskilt anordnad parkeringsficka vid Järnvägsgatan 1 får fordon parkeras under högst 30 minuter 2 § Tidsbegränsningen gäller alla dagar mellan 08:00 och 21:00 3 § Parkeringsskiva ska användas'));
  assert.deepEqual(r.limits, [{ a: 480, b: 1260, max: 30 }]);
  // Norrtälje Minervavägen 0188 2019-00627: "sön- eller helgdag" is the usual day type (it was read as Mon–Sat)
  r = parseRegulation(wrap('1 § På Storgatan får fordon parkeras. 2 § Tillåtelsen gäller dock i högst två timmar i följd. Villkoret gäller vardagar utom vardagar före sön- eller helgdag mellan klockan 9 och 18.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 120 }]);
});

test('sweep findings batch 6: a limit keeps its hours or its season when the next sentence gives only days or only hours', () => {
  // Tingsryd Torggatan 0763 2009-92: the limit held Mon–Fri around the clock
  let r = parseRegulation(wrap('På ett område på Torggatans västra sida i Tingsryd får fordon parkeras under högst 2 tim i följd vardag klockan 08.00 - 18.00. Tidsbegränsningen gäller vardag utom dag före sön- och helgdag.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 120 }]); assert.deepEqual(r.unread, []);
  // Askersund Hamngatan 1882 2025-00041: the summer season was on Mon–Fri only
  r = parseRegulation(wrap('På markerade sträckor på Hamngatan enligt kartbild får fordon parkeras under högst 3 tim i följd under tiden 1 maj - 30 september. Parkeringsskiva eller motsvarande ska användas. Tidsbegränsningen gäller under tiden vardag klockan 08.00 - 18.00, vardag före sön- och helgdag klockan 08.00 - 18.00 och sön- och helgdag klockan 08.00 - 18.00.'));
  assert.deepEqual(r.limits.map((l) => l.m), [[[5, 1], [9, 30]], [[5, 1], [9, 30]], [[5, 1], [9, 30]]]);
  assert.deepEqual(r.limits.map((l) => [l.a, l.b, l.max]), [[480, 1080, 180], [480, 1080, 180], [480, 1080, 180]]);
});

test('sweep findings batch 6: whole months, a day of every month, and exemptions that change nothing', () => {
  // Orust Rosenlundsvägen 1421 2012-17 (banned all year), Tidaholm Papegojas väg 1498 2014-19 (banned in July too)
  let r = parseRegulation(wrap('1 § På Rosenlundsvägen i Ellös får fordon inte parkeras under augusti.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[8, 1], [8, 31]] }]);
  r = parseRegulation(wrap('1 § På Papegojas väg i Tidaholm får fordon inte stannas eller parkeras. 2 § Förbudet gäller vardagar utom vardag före sön- och helgdag mellan klockan 07.00 – 16.00. 3 § Förbudet gäller ej juli månad.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 420, b: 960, m: [[8, 1], [6, 30]] }]); assert.deepEqual(r.unread, []);
  // Eslöv Odengatan 1285 2019-122: banned 08–12 every day
  r = parseRegulation(wrap('1 § På norra sidan av Odengatan i Eslöv får fordon inte parkeras. 2 § Förbudet gäller endast fordon den 1 varje månad mellan klockan 08.00-12.00.'));
  assert.deepEqual(r.bans, [{ dm: 1, a: 480, b: 720 }]); assert.deepEqual(r.unread, []);
  // Nynäshamn Nickstabadsvägen 0192 2014-004: the register had a ban around the clock
  r = parseRegulation(wrap('På västra sidan av parkeringsytan öster om Nickstabadsvägen får fordon parkeras. 2§ Undantag från §1 på vardagar utom vardag före sön- och helgdag mellan klockan 02 och 04 då parkeringsförbud gäller.'));
  assert.deepEqual(r.bans, [{ dt: ['vardag'], a: 120, b: 240 }]); assert.deepEqual(r.unread, []);
  // Vellinge Hamnvägen 1233 2023-145: the summer ban held all year because of the goods exemption
  r = parseRegulation(wrap('1 § På Hamnvägen i Skanör får fordon inte stannas eller parkeras. 2 § Förbudet gäller under tiden 1 maj - 30 september. 3 § Förbudet gäller inte varutransporter.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[5, 1], [9, 30]] }]); assert.deepEqual(r.unread, []);
  // Salem Tussilagostigen 0128 2014-00004, Katrineholm Hantverkaregatan 0483 2026-00004: notes that kept the text half-read
  r = parseRegulation(wrap('På markerad sträcka på Tussilagostigen får fordon parkeras under högst 24 tim i följd. Parkeringen avser besökande. Parkering är dock förbjuden under tiden tisdag klockan 00.00 - 06.00 jämna veckor under tiden 1 november - 15 maj.'));
  assert.deepEqual(r.unread, []); assert.deepEqual(r.bans, [{ w: 2, a: 0, b: 360, m: [[11, 1], [5, 15]], p: 'even' }]);
  r = parseRegulation(wrap('På markerade sträckor på Hantverkaregatans västra sida får fordon inte parkeras 1 onsdagen i månaden klockan 09.00 - 16.00. Under samma tid ska föreskrifter 0483 2022:00003 samt 0483 2023:00020 inte tillämpas på motsvarande sträckor.'));
  assert.deepEqual(r.unread, []); assert.deepEqual(r.bans, [{ w: 3, nw: 1, a: 540, b: 960 }]);
  // a parenthesis around an exemption is left alone (Ulricehamn Stenbocksgatan keeps its stopping ban)
  r = parseRegulation(wrap('1 § På östra sidan av Stenbocksgatan från en punkt 50 meter norr om Sanatorievägen till Höjdgatan (Förbudet gäller inte Buss, mellan en punkt 50 meter norr om Sanatorievägen till en punkt 90 meter norr om Sanatorievägen) får inte fordon stannas.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]);
});

test('sweep findings batch 6: bans and bays for other vehicles are no rule for cars; cars named among the vehicles keep the place open', () => {
  // bicycles and mopeds (Helsingborg Kungstorget, Lund Västra Stationstorget, Örebro Köpmangatan, Varberg resecentrum), detached trailers (Krokom)
  for (const s of ['På Kungstorget och Järnvägsgatan utanför cykelställ, enligt markering i kartbild får cykel och moped klass II inte parkeras.',
    'På Västra Stationstorget, det markerade området nedan, får cyklar inte parkeras utanför särskilt anordnade cykelställ eller markerade ytor för cykeluppställning, om inte annat föreskrivs.',
    'På markerade sträckor på Köpmangatan enligt kartbild får cykel och moped inte parkeras. Parkering av cykel och moped gäller endast på särskilt anordnad cykeluppställningsplats.',
    'Vid Varberg resecentrum inom markerat område enligt kartbild, får cykel och moped klass II endast parkeras i särskilt anordnade cykelställ.',
    '1 § På Krokoms rastplats får frånkopplade släp och redskap inte parkeras.']) {
    const r = parseRegulation(wrap(s)); assert.equal(r.heavyOnly, true, s); assert.deepEqual(r.bans, []); assert.equal(r.reserved, false); assert.deepEqual(r.unread, []);
  }
  // "Förbudet gäller endast husbilar / lastbil …" (Borgholm Sjöstugevägen, Mora Karlsvägen, Kiruna Forvägen, Mariestad Gummerstadsvägen)
  for (const s of ['1 § På Sjöstugevägen i Borgholm får fordon inte parkeras. 2 § Förbudet gäller endast husbilar.', 'På markerade sträckor på Karlsvägen enligt kartbild får inte fordon parkeras. Förbudet gäller endast lastbil.',
    '1 § På södra sidan av Forvägen får fordon inte parkeras. 2 § Förbudet gäller endast lastbil, tung lastbil, fordonståg och släpfordon.',
    'På Gummerstadsvägen inom markerat område enligt kartbild får fordon inte parkeras. Förbudet gäller endast för husbilar, husvagnar samt andra fordon med karosseri som är inrett som bostadsutrymme.']) {
    const r = parseRegulation(wrap(s)); assert.equal(r.heavyOnly, true, s); assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
  }
  // a ban with its own rule for every car stays
  let r = parseRegulation(wrap('1 § På Storgatan får fordon inte parkeras. 2 § Förbudet gäller endast personbil.'));
  assert.notEqual(r.heavyOnly, true);
  // motorhome bans are not motorhome bays (Falkenberg Doktorspromenaden, Båstad Fridhemsvägen were "reserved for motorhomes")
  r = parseRegulation(wrap('På markerade sträckor på Doktorspromenaden enligt kartbild får personbil klass II och släpvagn inte stannas eller parkeras.'));
  assert.equal(r.reserved, false); assert.equal(r.heavyOnly, true);
  r = parseRegulation(wrap('På markerade sträckor på Fridhemsvägen västra sida enligt kartbild får fordon parkeras under högst 2 tim i följd under tiden vardag klockan 09.00 - 18.00 och vardag före sön- och helgdag klockan 09.00 - 14.00. Under klockan 00.00 - 24.00 får dock buss, släpfordon, släpvagn, tung buss, tung lastbil och personbil klass II inte stannas eller parkeras.'));
  assert.equal(r.reserved, false); assert.deepEqual(r.bans, []); assert.equal(r.limits.length, 2);
  // a real motorhome bay with its night ban stays a bay (Simrishamn Rörumsstrandsvägen)
  r = parseRegulation(wrap('På två markerade ytor vid Rörumsstrandsvägen enligt kartbild får endast personbil klass II parkeras under tiden klockan 09.00 - 16.00. Under tiden klockan 16.00 - 09.00 får dock personbil klass II inte parkeras.'));
  assert.equal(r.reserved, true); assert.notEqual(r.heavyOnly, true);
  // Höganäs Klötesvägen 1284 2010-0169: the night ban is for caravans and motorhomes
  r = parseRegulation(wrap('1 § På Klötesvägen i Arild på parkeringsplats mellan Klötesvägen och vattnet får fordon parkeras. 2 § Tillåtelsen gäller inte husvagn och husbil att parkera under tiden vardag mellan klockan 20.00 - 06.00, vardag före sön- och helgdag mellan klockan 20.00 - 06.00 och sön- och helgdagar mellan klockan 20.00 - 06.00.'));
  assert.deepEqual(r.bans, []); assert.equal(r.permitted, true); assert.deepEqual(r.unread, []);
  // Västerås Lögarängsvägen 1980 2022-00061: ordinary cars are among the vehicles; a trailer or motorhome bay stays one (Uddevalla Brattgatan, Ludvika)
  r = parseRegulation(wrap('På med blått markerad sträcka på Lögarängsvägen enligt kartbild får fordon parkeras mot avgift under vardagar utom vardag före sön- och helgdag klockan 09.00 - 18.00. Tillåtelsen gäller endast lätt lastbil och personbil klass I.'));
  assert.equal(r.reserved, false);
  r = parseRegulation(wrap('1 § På södra sidan av Brattgatan i Uddevalla får fordon parkeras mot avgift. 2 § Tillåtelsen gäller endast personbil med tillkopplad släpkärra och personbil klass II.'));
  assert.equal(r.reserved, true);
  r = parseRegulation(wrap('På markerad sträcka vid Stationsområdet, Ludvika enligt kartbild får fordon parkeras under högst 3 tim i följd. Tillåtelsen gäller endast personbil med tillkopplad släpkärra.'));
  assert.equal(r.reserved, true);
  // Karlskrona Ringövägen 1080 2025-47: "Parkering är förbjuden utanför markerad plats" says where to stand
  r = parseRegulation(wrap('1 § På Ringövägen i Lyckeby får fordon parkeras. 2 § Parkering är dock förbjuden för personbil klass II och släpkärra under tiden vardagar utom vardag före söndag och helgdag mellan klockan 00.00-06.00. 3 § Parkering är förbjuden utanför markerad plats.'));
  assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
});

test('sweep findings batch 6: inside an area parking ban the permission\'s own hours or season are all it gives', () => {
  const area = 'med avvikelse från Örebro kommuns lokala trafikföreskrifter 1880 2024:00081 om förbud att parkera i Almby,';
  // Örebro Almbyvägen 1880 2024-00321: open at night
  let r = parseRegulation(wrap(`Längs turkosmarkerad sträcka på Almbyvägens södra sida enligt kartbild får fordon, ${area} parkeras under tiden vardag utom vardag före sön- och helgdag klockan 06.00 - 18.00. Fordon får parkeras i högst 15 min i följd.`));
  assert.deepEqual(r.allowOnly, [{ dt: ['vardag'], a: 360, b: 1080 }]); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 15 }]);
  // without an area ban the hours close nothing
  r = parseRegulation(wrap('Längs sträckan på Almbyvägens södra sida enligt kartbild får fordon parkeras under tiden vardag utom vardag före sön- och helgdag klockan 06.00 - 18.00.'));
  assert.deepEqual(r.allowOnly, []);
  // Lysekil Fiskebäckskil 1484 2022-10: fee parking all winter
  r = parseRegulation(wrap(`På Fiskebäckskilsvägen får personbil klass I, ${area} parkeras under högst 8 dygn i följd mot avgift under tiden 15 juni - 15 augusti.`));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[8, 16], [6, 14]] }]); assert.deepEqual(r.limits, [{ a: 0, b: 1440, m: [[6, 15], [8, 15]], max: 11520 }]);
  // Östersund Storgatan 2380 2026-00035, Örnsköldsvik Skolgatan 2284 2023-00510: "Tillåtelsen att parkera gäller …", "… gäller endast under perioden …"
  r = parseRegulation(wrap(`På Storgatans västra sida enligt markering i kartbild får fordon, ${area} parkeras under högst 3 tim i följd mot avgift under tiden vardag utom vardag före sön- och helgdag klockan 09.00 - 18.00. Tillåtelsen att parkera gäller under tiden 1 oktober - 31 maj.`));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[6, 1], [9, 30]] }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap(`1 § På Skolgatans norra sida får fordon, ${area} parkeras. 2 § Tillåtelsen att parkera i 1 § gäller dock högst 2 timmar i följd. Villkoret gäller vardagar utom vardag före sön- och helgdag klockan 09.00 - 18.00. Tillåtelsen gäller endast under perioden 1 oktober - 30 april.`));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[5, 1], [9, 30]] }]);
  // "Parkering är dock tillåten under högst 1 tim i följd under tiden 1 juni - 31 augusti" only limits the summer (Halmstad Norra Badvägen): no winter ban
  r = parseRegulation(wrap(`På markerad sträcka på Norra Badvägens sida enligt kartbild får fordon, ${area} parkeras. Parkering är dock tillåten under högst 1 tim i följd under tiden 1 juni - 31 augusti.`));
  assert.deepEqual(r.bans, []);
});

test('sweep findings batch 6: a disabled bay is opened outside its hours only when the text says "Övrig tid får fordon parkeras"', () => {
  const bay = 'får endast sådant fordon parkeras som används för befordran av rörelsehindrad med parkeringstillstånd enligt 13 kap. 8 § trafikförordningen (1998:1276) eller utländskt parkeringstillstånd som ger samma rätt att parkera.';
  // Sundbyberg Löfströms allé 0183 2025-00018, Söderhamn Norra Hamngatan 2182 2024-36, Karlskrona Vallgatan 1080 2010-0833
  let r = parseRegulation(wrap(`På markerad sträcka på Löfströms allés sydvästra sida enligt kartbild ${bay} Tillåtelsen gäller under tiden vardagar utom vardag före sön- och helgdag klockan 07.00 - 21.00. Övrig tid får fordon parkeras.`));
  assert.equal(r.reserved, true); assert.equal(r.reservedOpenOutside, true); assert.deepEqual(r.reservedWindows, [{ dt: ['vardag'], a: 420, b: 1260 }]);
  r = parseRegulation(wrap(`1 § På Norra Hamngatan ${bay} 2 § Tillåtelsen i paragraf gäller under vardagar utom vardag före sön- och helgdag mellan klockan 09.00 - 18.00 och vardagar före sön- och helgdag klockan 10.00 - 15.00. 3 § Övrig tid får fordon parkeras under högst 24 tim i följd.`));
  assert.equal(r.reservedOpenOutside, true); assert.deepEqual(r.reservedWindows, [{ dt: ['vardag'], a: 540, b: 1080 }, { dt: ['fore'], a: 600, b: 900 }]);
  r = parseRegulation(wrap(`På norra sidan av Vallgatan i Karlskrona, 3 st markerade platser, ${bay.slice(0, -1)} Denna föreskrift gäller vardag utom vardag före sön- och helgdag klockan 8-21, övrig tid är det allmän parkering.`));
  assert.equal(r.reservedOpenOutside, true);
  // the safe direction stays: "Parkering är dock tillåten under högst N tim" and hours with nothing said about other times keep the bay reserved
  r = parseRegulation(wrap(`På markerad sträcka på Östra Banvägens västra sida enligt kartbild ${bay} Parkering är dock tillåten under högst 2 tim i följd under tiden vardag utom vardag före sön- och helgdag klockan 06.00 - 20.00.`));
  assert.equal(r.reserved, true); assert.notEqual(r.reservedOpenOutside, true);
  r = parseRegulation(wrap(`1 § På Södra Kyrkogatan enligt markering i kartbild ${bay} 2 § Tillåtelsen gäller under vardagar utom vardag före sön- och helgdag mellan klockan 09.00 – 18.00 och under högst 2 tim i följd.`));
  assert.equal(r.reserved, true); assert.notEqual(r.reservedOpenOutside, true);
  // what permit holders get on top of a permission for every car reserves nothing (Visby S:t Hansgatan 0980 2015-16)
  r = parseRegulation(wrap('1 § På S:t Hansgatans östra sida i Visby inom markerade parkeringsplatser får fordon parkeras under högst 2 tim i följd. 2 § Parkeringsskiva eller motsvarande ska användas. 3 § Tidsbegränsningen gäller under tiden vardagar mellan klockan 09.00 – 18.00. 4 § Rörelsehindrad person med parkeringstillstånd för rörelsehindrad eller utländskt parkeringstillstånd som ger samma rätt att parkera får parkera under högst 3 tim i följd enligt 13 kap. 8 § trafikförordningen (1998:1276).'));
  assert.equal(r.reserved, false); assert.deepEqual(r.unread, []); assert.equal(r.limits.length, 1);
});

test('sweep findings batch 7: places the text gives to residents or permit holders only are reserved; bicycle racks are no place for a car', () => {
  let r;
  // "endast" + residents with a permit: nobody else may park (Lysekil, Orust, Sotenäs, Vaxholm, Danderyd, Mölndal)
  for (const s of ['På västra sidan av Hagen i Grundsund, i uppställningsraden norr om fastigheten Bockepall 2, får endast fordon som används av boende i området och för vilka särskilt tillstånd utfärdats parkeras.',
    '1 § På Carl Anderssons gatas sydvästra sida mellan Norrhamnsgatan och Trädgårdsgatan får endast sådana fordon parkeras för vars ägare särskilt boendeparkeringstillstånd utfärdats.',
    'På markerad plats vid Bredabergsvägen enligt kartbild får fordon parkeras. Tillåtelsen gäller endast fordon som används av boende i området och för vilka särskilt tillstånd utfärdats.',
    '1 § På Lergropsvägen enligt markering på kartbild får fordon parkeras. 2 § Tillåtelsen gäller endast boende med särskilt parkeringstillstånd.',
    '1 § På Torneviksvägen i Mollösund får personbil klass I, med avvikelse från Orusts kommuns lokala trafikföreskrifter ( 1421 2012 : 60 ) om parkeringsförbudsområde i Mollösund, parkeras. 2 § Tillåtelsen gäller endast fordon som används av boende i området och för vilka särskilt tillstånd utfärdats.']) {
    r = parseRegulation(wrap(s)); assert.equal(r.reserved, true, s); assert.equal(r.reservedFor, null); assert.deepEqual(r.unread, []); assert.deepEqual(r.bans, []);
  }
  // the bay's own limit stays with it (Uddevalla Kämpegatan)
  r = parseRegulation(wrap('1 § Inom ett område som motsvaras av parkeringsplatsen på Kämpegatan får endast fordon med särskilt boendeparkeringstillstånd parkeras. 2 § Tillåtelsen gäller under högst 24 tim i följd.'));
  assert.equal(r.reserved, true); assert.equal(r.limits[0].max, 1440);
  // reserved in the season the text names, open to all the rest of the year when the text says so (Orust Kvarnvägen)
  r = parseRegulation(wrap('1 § På den del av Kvarnvägen som anges i kartan får endast fordon som används av boende i området och för vilka särskilt tillstånd utfärdats parkeras mot avgift under tiden 15 maj - 15 september. 2 § Övrig tid får fordon parkeras under 17 september - 14 maj.'));
  assert.equal(r.reserved, true); assert.deepEqual(r.reservedSeason, [[5, 15], [9, 15]]); assert.equal(r.otherAllowed, true); assert.deepEqual(r.openSeason, [[9, 17], [5, 14]]); // the open season as the text names it (16 September is in neither)
  // WITHOUT "endast" the text says nothing about other cars: not reserved, as before (Västerås: the same bays have a regulation for every car)
  r = parseRegulation(wrap('På med rött markerade sträckor (59 parkeringsplatser) på Källgatan enligt kartbild får fordon som används av boende i området med särskilt tillstånd parkeras mot avgift under tiden vardagar utom vardag före sön- och helgdag klockan 09.00 - 18.00.'));
  assert.equal(r.reserved, false);
  // what residents get on top of a rule for everyone is still skipped
  r = parseRegulation(wrap('1 § På Storgatan får fordon parkeras under högst 2 tim i följd. 2 § Tidsbegränsningen gäller inte boende med särskilt tillstånd.'));
  assert.equal(r.reserved, false); assert.equal(r.limits[0].max, 120);
  // permit holders only (Valdemarsvik, Arboga)
  r = parseRegulation(wrap('1 § På del av parkeringen Löten, i karta rödmarkerat område, får fordon parkeras. 2 § Tillåtelsen gäller endast fordon med särskilt tillstånd, vilket erhålles efter kontakt med kommunen.'));
  assert.equal(r.reserved, true); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På markerat område på parkeringen vid Vasagymnasiet enligt kartbild får fordon parkeras.. Tillåtelsen gäller endast fordon med särskilt parkeringstillstånd'));
  assert.equal(r.reserved, true);
  // bicycle racks (Uppsala, Oxelösund, Laholm, Tanum, Linköping Resecentrum)
  r = parseRegulation(wrap('1 § Inom område centrala Uppsala 2 enligt kartbild i särskilt anordnade cykelställ på allmän platsmark får cykel parkeras. 2 § Tillåtelsen gäller under högst 2 veckor i följd.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'cykel'); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § På Järntorget i Oxelösund får cykel parkeras. 2 § Cykel får endast parkeras i cykelställ.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'cykel'); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('På blåmarkerade sträckor vid Resecentrum enligt kartbild får cykel och moped klass 2 parkeras under högst 24 tim i följd. Parkering är endast tillåten i cykelställ.'));
  assert.equal(r.reserved, true); assert.equal(r.limits[0].max, 1440); assert.deepEqual(r.unread, []);
  // one part of the text for cars, one for bicycles: the car rule is untouched and nothing is reserved (Härnösand Trädgårdsgatan)
  r = parseRegulation(wrap('1 § a På Trädgårdsgatan södra sidan får fordon parkeras under högst 2 timmar i följd. 2 § a Tidsbegränsningen gäller vardagar utom vardag före sön- och helgdag mellan klockan 09 och 18. 1 § b På Trädgårdsgatan mellan Storgatan och Norra Kyrkogatan får cyklar parkeras.'));
  assert.equal(r.reserved, false); assert.equal(r.limits.length, 1); assert.equal(r.limits[0].a, 540);
});

test('a limit repeated at the end of the "Tillåtelsen gäller" hours is the same limit, not one around the clock (QA 26 Nov: Osby)', () => {
  const r = parseRegulation(wrap('På markerad sträcka på Västra Storgatans östra sida enligt kartbild får fordon parkeras under högst 2 tim i följd. Tillåtelsen gäller under tiden vardag utom vardag före sön- och helgdag klockan 09.00 - 18.00 och vardag före sön- och helgdag klockan 09.00 - 14.00 och under högst 2 tim iföljd. Parkeringsskiva eller motsvarande ska användas.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 120 }, { dt: ['fore'], a: 540, b: 840, max: 120 }]);
  assert.deepEqual(r.unread, []);
  // a different second limit is left alone
  const s = parseRegulation(wrap('På Gatan får fordon parkeras under högst 2 tim i följd. Tillåtelsen gäller under tiden vardag utom vardag före sön- och helgdag klockan 09.00 - 18.00 och under högst 3 tim i följd.'));
  assert.notDeepEqual(s.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 120 }]);
});

// ---- Sweep findings, batch 8 (26 Nov 2026) ----
test('sweep findings batch 8: an exemption for dropping off or fetching people leaves the parking ban standing', () => {
  // Lekeberg Dammgatan, Tanum Solhöjdsvägen, Rättvik Thunbergs gata showed 10–30 minutes of free parking
  for (const t of ['1§ På Dammgatan från Skolgatan till en punkt 80 meter öster därom och på gatans båda sidor, får fordon inte parkeras. Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2§ Förbudet gäller inte vid lämnande och hämtning av barn vid Skattkistan, då parkering tillåts i högst 10 minuter.',
    '1 § På Solhöjdsvägen i Rabbalshede, som framgår av Kartbilaga 1, får fordon inte parkeras. 2 § Förbudet i 1 § tillåter av och påstigning i max 15 minuter.',
    'På samtliga vägar på Thunbergs gata inom resecenturm enligt kartbild får fordon inte stannas eller parkeras. Förbudet gäller inte fordon i linjetrafik. Förbudet gäller inte fordon parkerade för upphämtning av passargerare vid resecentrum, där parkeringsskiva eller motsvarande ska användas dock max 30 min.']) {
    const r = parseRegulation(wrap(t));
    assert.deepEqual(r.bans, [{ a: 0, b: 1440 }], t); assert.deepEqual(r.limits, [], t); assert.deepEqual(r.unread, [], t);
  }
  // an exemption for marked bays with their own limit is the bays' rule: still unread, the line is left to the register
  const s = parseRegulation(wrap('1 § På västra sidan av Norregatan i Sjöbo mellan Västergatan och Lillgatan får fordon inte stannas eller parkeras. 3 § Förbudet gäller inte markerade parkeringsplatser där parkering är tillåten högst 30 min i följd.'));
  assert.equal(s.unread.length, 1);
});

test('sweep findings batch 8: "tvåhjulig motorcykel och moped kl. 1 utan sidvagn" inside an area ban is a motorcycle bay', () => {
  // Sundsvall Kyrkogatan: the line kept the register's ban in the bay's season and was free for cars the rest of the year
  const r = parseRegulation(wrap('1 § På Kyrkogatans södra sida, enligt markering på kartbild får tvåhjulig motorcykel och moped kl. 1 utan sidvagn, med avvikelse från Sundsvalls kommuns lokala trafikföreskrifter (2281 2021:429) om förbud att parkera inom område Sundsvalls centrum, parkeras . Tillåtelsen ger inte rätt att parkera där det enligt trafikförordningen (1998:1276) är förbjudet att stanna och parkera. 2 § Tillåtelsen gäller 15 april-15 oktober.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'motorcykel'); assert.deepEqual(r.reservedSeason, [[4, 15], [10, 15]]);
  assert.ok(!r.otherAllowed, 'inside an area ban the rest of the year is not opened'); assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
  // Eskilstuna Rademachergatan, Sigtuna Hamngatan
  for (const t of ['1 § På nordöstra sidan av Rademachergatan får tvåhjulig motorcykel utan sidovagn och tvåhjulig moped klass I utan sidovagn, med avvikelse från Eskilstuna kommuns lokala trafikföreskrifter (0484 2017 : 77) om tidsbegränsad parkering, parkeras där stannande och parkering är förbjuden enligt 3 kap 52§ andra stycket trafikförordningen (1998:1276).',
    'På markerad sträcka på Hamngatan enligt kartbild får motorcykel och tvåhjulig moped klass I och klass II parkeras.']) {
    const q = parseRegulation(wrap(t)); assert.equal(q.reserved, true, t); assert.equal(q.reservedFor, 'motorcykel', t); assert.deepEqual(q.unread, [], t);
  }
});

test('sweep findings batch 8: bays for travellers are reserved; the limit is the bay\'s', () => {
  const a = parseRegulation(wrap('1 § Inom ett område i Moheda, som motsvarar markerade platser på östra sidan av Västra Järnvägsgatan, får fordon med resande med tåg eller buss, parkeras under högst 24 tim i följd.'));
  assert.equal(a.reserved, true); assert.deepEqual(a.limits, [{ a: 0, b: 1440, max: 1440 }]); assert.deepEqual(a.unread, []);
  const g = parseRegulation(wrap('1 § Inom Långstidsparkeringensplats på Godsgatan ( vid tågstationen ) får fordon parkeras under högst 4 dygn i följd. 2 § Endast resenärer i samband med långtidsresor som reser från Gällivare tågstation får parkera.'));
  assert.equal(g.reserved, true); assert.deepEqual(g.limits, [{ a: 0, b: 1440, max: 5760 }]); assert.deepEqual(g.unread, []);
  // an ordinary limit is no bay
  assert.equal(parseRegulation(wrap('1 § På Godsgatan får fordon parkeras under högst 4 dygn i följd.')).reserved, false);
});

test('sweep findings batch 8: a car park where only caravans have a limit gives cars no rule', () => {
  // Kiruna, Abisko östra: the caravans' 24 h must not become a reservation or a limit for cars
  const r = parseRegulation(wrap('På parkeringsplatserna mellan väg E10 och reningsverket i Abisko östra får husvagnar parkeras måndagar - fredagar högst 24 timmar i följd. För övrig parkering gäller ingen tidsbegränsning.'));
  assert.equal(r.reserved, false); assert.deepEqual(r.limits, []); assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
  // without that sentence it stays a caravan bay
  assert.equal(parseRegulation(wrap('På parkeringsplatserna i Abisko östra får husvagnar parkeras högst 24 timmar i följd.')).reserved, true);
});

test('sweep findings batch 8: stopping bans worded "får inte fordon stannas", "Stannande eller parkering är dock förbjuden"', () => {
  assert.ok(STOPPING.test('På norra sidan av Hallevadsgatan får inte fordon stannas.')); // Mjölby
  assert.ok(STOPPING.test('Stannande eller parkering är dock förbjuden torsdag klockan 07.00 - 16.00.')); // Falun, Trelleborg
  assert.ok(STOPPING.test('På norra sidan av Arklimästaregatan får fordon inte Stannande eller parkering.')); // Karlskrona
  // a permission to park where the traffic ordinance forbids stopping is no stopping ban (Örebro, Eskilstuna)
  assert.ok(!STOPPING.test('får fordon parkeras där stannande och parkering är förbjuden enligt 3 kap 52 § trafikförordningen (1998:1276).'));
  assert.ok(!STOPPING.test('På Langsgatan får fordon inte parkeras.'));
});

test('sweep findings batch 8: bays for a named owner or errand, police cars and ambulances are reserved', () => {
  // Osby Köpmannagatan, Hultsfred, Karlskrona Stenbergsgränd, Åsele Industrivägen, Partille Furulundsvägen, Kil Karlslundsgatan, Mönsterås Stationsgatan were grey
  for (const t of ['På två markerade parkeringsplatser, på parkeringsplatsen belägen på Köpmannagatans södra sida mellan Parkgatan och Västra Storgatan, får endast fordon tillhörande polismyndigheten parkeras. Fordon som inte får parkeras får inte heller stannas annat än för på- och avstigning.',
    '1 § På parkering vid Västra Långgatan/Koppargatan på fyra särskilt markerade platser får endast sådana fordon parkeras som används av polismyndigheten.',
    'På södra sidan av Stenbergsgränd i Karlskrona , 4 st markerade platser mellan 52 m och 74 m öster om Norra Smedjegatan, får endast fordon som tillhör Blekinge Läns Tidning parkeras.',
    'På markerade sträckor på Furulundsvägen enligt kartbild får endast fordon i linjetrafik parkeras. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276).',
    'På Karlslundsgatan, östra sidan, mellan Idrottsgatan och Långgatan får endast fordon som har ärende till förskolan parkera.',
    '1 § På norra sidan av Stationsgatan i Blomstermåla, 2 platser på parkering enligt område som framgår av rödmarkering i kartbild, får endast fordon som används av distriktsköterskor till läkarstationen parkeras.',
    'På Dalslundskolan i Åkarp på sträcka markerad i karbilaga får endast färdtjänstfordon parkeras.',
    '1 § På södra sidan av Skönbergagatan Söderköping (på markerad plats cirka 25 meter öster om korsning med Östra Hagagatan ) får polisbil stannas eller parkeras.',
    'På Talldungevägen i Tanumshede enligt markering i Kartbilaga 1, får ambulans parkeras.']) {
    const r = parseRegulation(wrap(t)); assert.equal(r.reserved, true, t); assert.deepEqual(r.unread, [], t); assert.deepEqual(r.bans, [], t);
  }
  // residents' bays keep their own rules; ordinary cars are no group
  assert.equal(parseRegulation(wrap('På Gatan får endast fordon parkeras.')).reserved, false);
  assert.equal(parseRegulation(wrap('På Gatan får endast personbil klass I parkeras under högst 2 tim i följd.')).reserved, false);
});

test('sweep findings batch 8: "får fordon ej parkeras längre tid än 2 timmar … Parkeringstiden övervakas med s.k P-skiva" is fully read', () => {
  const r = parseRegulation(wrap('På Storgatans östra sida mellan Packhusgatan och Sundellsgatan får fordon ej parkeras längre tid än 2 timmar. Parkeringstiden övervakas med s.k P-skiva.')); // Haparanda ×4 stayed grey
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 120 }]); assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
});

// ---- project 0, sweep findings batch 9 (26 Nov 2026): the loose rows with unchanged lines, read again by hand ----
test('sweep findings batch 9: a permission that departs from an area ban and holds every other week leaves the ban in the weeks between (Falun Hyttgatan)', () => {
  const t = (par) => `På markerad sträcka på Hyttgatans östra sida enligt kartbild får fordon, med avvikelse från kommunens lokala trafikföreskrifter 2080 2025:00259 om stannande och parkering, parkeras under högst 7 dygn i följd Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Tillåtelsen gäller ${par} veckor`;
  let r = parseRegulation(wrap(t('udda'))); assert.deepEqual(r.bans, [{ a: 0, b: 1440, p: 'even' }]); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 10080 }]); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap(t('jämna'))); assert.deepEqual(r.bans, [{ a: 0, b: 1440, p: 'odd' }]); assert.deepEqual(r.unread, []);
  // "Villkoret gäller ej 15 december - 30 april Tisdagar 09:00-15:00" without "mellan datumen" and without a full stop before it (Rostvändaregatan)
  r = parseRegulation(wrap('På markerade sträckor på Rostvändaregatan enligt kartbild får fordon, med avvikelse från kommunens lokala trafikföreskrifter 2080 2025:00259 om stannande och parkering, parkeras under högst 24 tim i följd Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag Villkoret gäller ej 15 december - 30 april Tisdagar 09:00-15:00'));
  assert.deepEqual(r.bans, [{ w: 2, a: 540, b: 900, m: [[12, 15], [4, 30]] }]); assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.unread, []);
  // a plain permission (no other regulation departed from) keeps the sentence unread: nothing says what holds in the other weeks
  assert.deepEqual(parseRegulation(wrap('På Storgatan får fordon parkeras under högst 7 dygn i följd. Tillåtelsen gäller udda veckor')).bans, []);
});

test('sweep findings batch 9: "får enbart personbil klass II parkera under högst 24 timmar i föjd" (Ängelholm, Hässleholm)', () => {
  let r = parseRegulation(wrap('Inom markerat område får enbart personbil klass II parkeras. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Inom markerat område får enbart personbil klass II parkera under högst 24 timmar i föjd vardag utom vardag före sön- och helgdag.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'husbil'); assert.deepEqual(r.unread, []);
  // ordinary cars: the limit is every car's (Hässleholm Österåsgatan had no limit)
  r = parseRegulation(wrap('Inom markerat område på markerade platser vid Österåsgatan enligt kartbild får enbart personbil klass I parkeras. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Inom markerat område på markerade platser får enbart peronbil klass I parkera under högst 24 h i följd vardag utom vardag före sön- och helgdag.'));
  assert.equal(r.reserved, false); assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.unread, []);
});

test('sweep findings batch 9: hours before the place inside an area ban on stopping and parking are the only hours parking is allowed (Gävle Slottstorget)', () => {
  const r = parseRegulation(wrap('1 § På särskilt markerade parkeringsplatser enligt markering på kartbild, mellan klockan 05-23 på Slottstorgets parkeringsplats får fordon, med avvikelse från Gävle kommuns lokala trafikföreskrifter (2180 2022:37) om område med förbud att stanna och parkera fordon, parkeras. Tillåtelsen ger inte rätt att parkera där det enligt trafikförordningen (1998:1276) är förbjudet att stanna och parkera. 2 § Avgift ska betalas för parkering enligt 1 §. Avgiftsplikten gäller vardag utom vardag före sön- och helgdag klockan 09.00 - 18.00 samt vardag före sön- och helgdag klockan 09.00 - 15.00. 3 § Avgiften i 2 § är enligt taxa gul.'));
  assert.deepEqual(r.allowOnly, [{ a: 300, b: 1380 }]); assert.equal(r.otherAllowed, false); assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
});

test('sweep findings batch 9: "Övrig tid får fordon inte stannas" before the hours it refers to (Gislaved Smålandsstenar)', () => {
  const r = parseRegulation(wrap('1 § Inom ett område i Smålandsstenar som anges på kartan i bilaga till dessa föreskrifter får fordon parkeras. 2 § Övrig tid får fordon inte stannas. 3 § Tillåtelsen gäller vardag utom vardag före sön- och helgdag mellan klockan 06.00 - 21.00, vardag före sön- och helgdag 06.00 - 18.00 och sön- och helgdag 06.00 - 18.00.'));
  assert.deepEqual(r.allowOnly, [{ dt: ['vardag'], a: 360, b: 1260 }, { dt: ['fore'], a: 360, b: 1080 }, { dt: ['helgdag'], a: 360, b: 1080 }]); assert.equal(r.otherAllowed, false); assert.deepEqual(r.unread, []);
});

test('sweep findings batch 9: a ticket handed out by a property is a permit; a motorhome season inside an area ban is a motorhome bay (Laholm, Sundsvall)', () => {
  let r = parseRegulation(wrap('1 § På parkeringsyta öster om Stationsgatan i Laholm på markerade platser, enligt område som framgår av markering i Kartbilaga 1 får fordon, med avvikelse från Laholms kommuns lokala trafikföreskrifter ( 1381 2022 : 182 ) om förbud att parkera inom område i Laholm, parkeras vardagar utom vardag före sön- och helgdag mellan klockan 09.00 - 18.00. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Tillåtelsen gäller endast fordon med giltigt parkeringsbiljett som hämtas från fastighet på Stationsgatan 2.'));
  assert.equal(r.reserved, true); assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § På Heffners Allé, södra sidan, enligt markering på kartbild får fordon, med avvikelse från Sundsvalls kommuns lokala trafikföreskrifter (2281 2021:415) om förbud att parkera inom område Norra kajen, parkeras . Tillåtelsen ger inte rätt att parkera där det enligt trafikförordningen (1998:1276) är förbjudet att stanna och parkera. 2 § Tillåtelsen att parkera gäller husbil under tiden 17 maj- 30 september.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'husbil'); assert.deepEqual(r.bans, []); assert.deepEqual(r.unread, []);
  // an ordinary fee ticket is no permit
  assert.equal(parseRegulation(wrap('På Storgatan får fordon parkeras. Tillåtelsen gäller endast fordon med giltig parkeringsbiljett.')).reserved, false);
});

test('sweep findings batch 9: a bay for another vehicle in a season or at stated hours is a ban for cars then', () => {
  // Lysekil Verkstadsgatan: buses only in summer
  let r = parseRegulation(wrap('1 § På västra sidan av Verkstadsgatan i Lysekil, mellan en punkt omkring 15 meter söder om Rinkenäsgatan och 140 meter söderut, får fordon parkeras under högst 24tim i följd. Under tiden 15 juni- 15 aug gäller tillåtelsen endast buss..'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[6, 15], [8, 15]] }]); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.unread, []);
  // Karlstad Bjurbäcksgatan: motorhomes only May–August
  r = parseRegulation(wrap('På Bjurbäcksgatans norra sidan från 10 meter väster om Mellangatan och 58 meter västerut får fordon parkeras under högst 2 tim i följd under tiden vardag före sön- och helgdag klockan 08.00 - 18.00 1 september - 30 april. Mellan den 1 maj - 31 augusti får endast personbil klass II parkeras. Parkering får dock endast ske under högst 2 tim i följd.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[5, 1], [8, 31]] }]); assert.equal(r.reserved, false); assert.deepEqual(r.unread, []);
  // Mölndal Göteborgsvägen: buses only on Saturday afternoons and Sundays
  r = parseRegulation(wrap('1 § På angivna platser på Göteborgsvägens västra sida mellan Knarrhögsgatan och Tempelgatan får fordon parkeras. Tillåtelsen ger inte rätt att parkera där det enligt trafikförordningen (1998:1276) är förbjudet att stanna och parkera. 2 § Tillåtelsen gäller under högst 30 minuter i följd under vardag utom vardag före sön- och helgdagar kl 00:00-24:00 samt vardag före sön- och helgdag kl 00:00-14:00. 3 § Tillåtelsen gäller för buss mot avgift enligt taxa gul. Det gäller för vardag före sön- och helgdag kl 14:00-24:00 samt sön- och helgdag kl 00:00-24:00.'));
  assert.deepEqual(r.bans, [{ dt: ['fore'], a: 840, b: 1440 }, { dt: ['helgdag'], a: 0, b: 1440 }]); assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 30 }, { dt: ['fore'], a: 0, b: 840, max: 30 }]); assert.deepEqual(r.unread, []);
  // Eslöv Göingevägen: trailers May–October, cars 24 h the rest of the year
  r = parseRegulation(wrap('1 § På Göingevägen i Eslöv, parallellt med Onsjövägen, på tre markerade platser enligt kartbilaga får endast släpvagn parkeras under högst 2 veckor i följd under tiden maj – oktober. 2 § Övrig tid får endast personbil klass I parkeras under högst 24 tim i följd..'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[5, 1], [10, 31]] }]); assert.deepEqual(r.limits, [{ a: 0, b: 1440, m: [[11, 1], [4, 30]], max: 1440 }]); assert.deepEqual(r.unread, []);
});

test('sweep findings batch 9: vehicle bays whose wording hid the vehicle (Mariestad, Tanum, Ronneby)', () => {
  let r = parseRegulation(wrap('På markerad parkeringsyta på fastigheten MARIESTAD FÅGELÖ 4:13 enligt kartbild får motordrivet fordon med tillkopplad släpvagn annat än påhängsvagn eller enaxlig släpvagn parkeras mot avgift. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Parkering är dock tillåten under högst 7 dygn i följd endast mot avgift. Avgift enligt taxa Kf2021/00094 parkeringsavgift för tunga fordon och motordrivet fordon med tillkopplad släpvagn. Parkeringensregleringen avser inte uppställning av husvagn.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'fordon med släp'); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('1 § På del av Prästgårdsvägen i Tanumshede ( som markerats i kartbilaga 1 ) får godstransporter, fordon i linjetrafik och lastbil parkeras under högst 24 tim i följd. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Parkerade fordon får inte blockera in och utfarter på Prästgårdsvägen.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'lastbil'); assert.deepEqual(r.unread, []);
  r = parseRegulation(wrap('Inom markerat område i anslutning till Karlskronagatan enligt kartbild får motorcykel med avvikelse från kommunens lokala trafikföreskrifter 1081 2009-00116 parkeras under högst 2 tim i följd under tiden vardag utom dag före sön- och helgdag klockan 09.00 - 18.00 och vardag före sön- och helgdag klockan 09.00 - 14.00. Övrig tid får motorcykel parkeras under högst 24 tim i följd.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'motorcykel'); assert.deepEqual(r.reservedWindows, []); assert.deepEqual(r.unread, []);
});

test('sweep findings batch 9: limits outside the stated hours or season, and limits bound to the fee hours', () => {
  // Lerum Almekärrsvägen: "Övrig tid får fordon parkeras 24 tim i följd vardagar utom …" inside an area ban is left as it was (weekends are not in the text)
  let r = parseRegulation(wrap('På markerad sträcka på Almekärrsvägen enligt kartbild får fordon, med avvikelse från kommunens lokala trafikföreskrifter 1441 2011-00066 om förbud mot att parkera fordon i område, parkeras under högst 15 min i följd. Tidsbegränsningen gäller under tiden vardag utom vardag före sön- och helgdag klockan 07.00 - 09.00. Övrig tid får fordon parkeras 24 tim i följd vardagar utom vardag före sön- och helgdag.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 420, b: 540, max: 15 }]);
  // Tanum Halsviksvägen: 6 h in the summer, 24 h the rest of the year
  r = parseRegulation(wrap('1 § På Halsviksvägen i Kämpersvik ( enligt Kartbilaga 1 ) får personbil klass I parkeras under högst 6 tim i följd under tiden 15 juni - 15 augusti. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Övrig tid får fordon parkeras 24 tim..'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, m: [[6, 15], [8, 15]], max: 360 }, { a: 0, b: 1440, m: [[8, 16], [6, 14]], max: 1440 }]);
  // Orust Hamntorget: "… under tiden måndag-söndag" is every day
  r = parseRegulation(wrap('1 § På Hamntorget i Henån, på angiven parkeringsyta enligt kartbilaga, får fordon parkeras under högst 24 tim i följd under vardag utom vardag före sön- och helgdag och under perioden 16 september – 14 maj. 2 § Övrig tid får fordon parkeras under högst 4 tim i följd under tiden måndag-söndag.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, m: [[9, 16], [5, 14]], max: 1440 }, { dt: ['fore', 'helgdag'], a: 0, b: 1440, m: [[9, 16], [5, 14]], max: 240 }, { a: 0, b: 1440, m: [[5, 15], [9, 15]], max: 240 }]); assert.deepEqual(r.unread, []);
  // Karlskrona Alamedan: the hours after "och mot avgift under tiden" are the fee's, 7 days hold at all hours
  r = parseRegulation(wrap('1 § På norra sidan av norra körbanan på Alamedan i Karlskrona får fordon inte parkeras. 2 § Förbudet gäller torsdag mellan klockan 07.00 - 16.00. 3 § Övrig tid får fordon parkeras under högst 7 dygn i följd och mot avgift under tiden vardagar utom vardag före sön- och helgdag mellan klockan 09.00 - 16.00. Avgift enligt Taxa C Grön zon.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 10080 }]); assert.deepEqual(r.bans, [{ w: 4, a: 420, b: 960 }]); assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 960 }]);
  // Nacka Järla östra skolväg: a limit with no hours at the end of a fee text
  r = parseRegulation(wrap('På markerad plats på Järla östra skolväg enligt kartbild får fordon parkeras. Avgift enligt taxa 1, 2 § allmänna föreskrifter taxor. Avgiftsplikten gäller under tiden vardag utom vardag före sön- och helgdag klockan 07:00-19:00 och vardag före sön- och helgdag klockan 11.00 - 17.00 Fordon får parkera högst under 2 tim'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 120 }]); assert.deepEqual(r.unread, []);
  // Växjö Värnamovägen and Ljusdal Lantmätargatan: a second, shorter limit worded on its own
  r = parseRegulation(wrap('1 § Inom området får fordon parkeras högst 24 timmar i följd, Följande inskränkningar gäller: Parkering högst 2 timmar i följd vardagar utom dag före helgdag kl 09.00 - 18.00 samt dag före helgdag kl 09.00 - 14.00.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 1440 }, { dt: ['vardag'], a: 540, b: 1080, max: 120 }, { dt: ['fore'], a: 540, b: 840, max: 120 }]);
  r = parseRegulation(wrap('1 § På Lantmätargatans östra sida 55 meter söder om Kyrkogatan och söderut får fordon parkeras under högst 24 timmar. 2 § En tidsbegränsning om att parkera fordon under högst 2 timmar gäller vardagar, vardag före sön- och helgdag, samt sön- och helgdag mellan klockan 08 och 18. 3 § Parkeringsskiva eller motsvarande ska användas.'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 1440 }, { a: 480, b: 1080, max: 120 }]); assert.deepEqual(r.unread, []);
});

test('sweep findings batch 9: slips that hid a day or a ban (Sundsvall, Eslöv, Sollentuna, Mölndal)', () => {
  // a third hour range after "samt" without day words follows weekdays and Saturdays: Sundays and holidays
  let r = parseRegulation(wrap('1 § På Tullgatans östra sida får fordon parkeras. 2 § Tillåtelsen gäller under högst 3 timmar i följd. Villkoret gäller vardag utom vardag före sön- och helgdag klockan 08.00 - 20.00, vardag före sön- och helgdag klockan 08.00 - 16.00 samt klockan 08.00 - 16.00.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1200, max: 180 }, { dt: ['fore'], a: 480, b: 960, max: 180 }, { dt: ['helgdag'], a: 480, b: 960, max: 180 }]);
  // "den första helgfria måndagen varje månad 08-00-12.00"
  r = parseRegulation(wrap('1 § På östra sidan av Palmgatan i Eslöv får fordon parkeras under högst 15 min i följd under tiden vardagar mellan klockan 07.00 – 09.00 och mellan klockan 14.00 – 17.00. 2 § Tillåtelsen gäller inte den första helgfria måndagen varje månad 08-00-12.00.'));
  assert.deepEqual(r.bans, [{ w: 1, nw: 1, nh: 1, a: 480, b: 720 }]); assert.deepEqual(r.unread, []);
  // "mellan klockan 07-00- 09.00" is 07.00–09.00, not 07–24
  r = parseRegulation(wrap('1 § På Silverdalsvägen får fordon parkeras högst 2 timmar i följd. 2 § Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag mellan klockan 09.00 - 19.00. 4 § Vardag utom vardag före sön- och helgdag mellan klockan 07-00- 09.00 får fordon parkeras under högst 30 min i följd.'));
  assert.ok(r.limits.some((l) => l.max === 30 && l.a === 420 && l.b === 540));
  // an exemption for refuse trucks leaves the ban, with both its mornings
  r = parseRegulation(wrap('Förbudet gäller inte Mölndals stads renhållningsfordon. På anvisad plats på södra sidan av Knarrhögsgatan väster om Göteborgsvägen (se kartbild) får fordon inte stannas eller parkeras. Förbudet gäller under tiden måndag klockan 07.00 - 09.00 och torsdag klockan 07.00 - 09.00.'));
  assert.deepEqual(r.bans, [{ w: 1, a: 420, b: 540 }, { w: 4, a: 420, b: 540 }]); assert.deepEqual(r.unread, []);
});
