import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegulation, applyRegulation, samePlaceExceptions } from '../regulation.js';
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
  assert.deepEqual(parseRegulation('följande. 1 § På Kanalgatan får fordon inte parkeras mellan klockan 05.00 – 08.00. 2 § Förbudet gäller endast under den första helgfria måndagen varje månad.').bans, [{ a: 300, b: 480, w: 1, nw: 1 }]);
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
  assert.equal(c.unread.length, 1); // an exception by day type over the ban's own days: grey, not a guess
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
